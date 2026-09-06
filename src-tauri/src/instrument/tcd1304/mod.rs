// TCD1304 linear-CCD spectrometer, protocol v1 over USB CDC-ACM.
// TCD1304_Timer_ADC/PROTOCOL.md is canonical and was verified against the
// firmware; Python_User_Code/tcd1304.py is the reference host.
//
// Request/response, one command at a time. The device sends nothing unsolicited,
// so a single owning lock over the port is enough — there is no reader task and
// no reordering to defend against.

pub mod frame;
pub mod metadata;

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serialport::SerialPort;

use crate::instrument::driver::*;
use frame::{Frame, FrameType};
use metadata::Metadata;

/// Ignored by the device — the link is USB, not a UART — but the API wants one.
const BAUD: u32 = 115_200;

/// Shown verbatim in the UI when an operation needs a connection it does not have.
pub const NOT_CONNECTED: &str = "No instrument connected — connect one first.";

/// Everything except ACQUIRE answers immediately.
const CMD_TIMEOUT: Duration = Duration::from_secs(1);

/// A capture costs about 2x the integration time, because the firmware discards
/// the in-progress frame and sends the next one. Same slack the reference host uses.
fn capture_timeout(integ_ms: u32) -> Duration {
    Duration::from_millis(3 * integ_ms as u64 + 500)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

/// Raw counts to intensity: `max_intensity - raw`.
///
/// This video is inverted — a masked pixel reads HIGH and light pulls the value
/// down — so the host has to flip it, exactly as the PyQt6 reference does with
/// its default-on "Invert".
///
/// Measured 2026-09-06 on serial 380B1C3537323731 with a light source attached.
/// Within a single frame, the masked DARK window (pixels 16-28, which no light
/// reaches) against the ACTIVE window minimum:
///
/// ```text
/// integration     DARK mean     ACTIVE min
///       8 ms         29234          28099
///      50 ms         29314          20866
///     200 ms         29308          16100
/// ```
///
/// The masked pixels stay pinned near 29300 whatever the integration time,
/// while illuminated pixels read lower and fall further the longer the sensor
/// integrates. Same frame, same conditions, differing only in whether light
/// lands on them — so dark is high and bright is low.
///
/// After inversion a dark pixel is ~3400 and a strongly lit one ~16700, which
/// is the right way round for display and for the (S-D)/(R-D) maths in
/// process.rs.
///
/// This corrects an earlier reading of an unlit probe, where the whole array
/// — masked pixels included — sat near 2500 and was taken as evidence that
/// bright meant high. Masked pixels cannot respond to illumination, so that
/// difference was never about light; something in the detector's power or
/// clocking state differed between the two sessions. The within-frame
/// comparison above does not depend on comparing sessions at all.
fn to_intensity(raw: i16, max_intensity: i32) -> f32 {
    (max_intensity - raw as i32) as f32
}

/// Saturation is judged on the raw sample: at or past `max_intensity`, or
/// negative because it rolled past 0x7FFF. Never a hardcoded constant — the
/// limit comes from the device's own metadata.
fn is_saturated(raw: i16, max_intensity: i32) -> bool {
    raw < 0 || raw as i32 >= max_intensity
}

/// An open port plus what the device told us about itself.
struct Io {
    port: Box<dyn SerialPort>,
    /// Bytes read but not yet consumed by the parser. Frames are found in here
    /// by content, never by position, so a partial read is harmless.
    buf: Vec<u8>,
    idn: Idn,
    meta: Metadata,
    /// Last integration time the device acknowledged, so `I<ms>` is only re-sent
    /// when it actually changes.
    pushed_integ_ms: Option<u32>,
    /// Last frame's header, for the Instrument panel.
    last_seq: u16,
    dropped_frames: u32,
    last_capture_ms: u32,
}

/// The four SCPI fields of an IDN reply: `Jasper,TCD1304,<serial>,0.1`.
#[derive(Debug, Clone, Default)]
pub struct Idn {
    pub manufacturer: String,
    pub model: String,
    /// MCU unique ID as 16 uppercase hex digits. The only per-unit identifier
    /// the device has — the USB serial string descriptor is a constant.
    pub serial: String,
    /// Opaque display string. Gate behaviour on the frame header's version byte,
    /// never on this.
    pub firmware: String,
}

impl Idn {
    fn parse(text: &str) -> Result<Self, String> {
        let f: Vec<&str> = text.split(',').collect();
        if f.len() != 4 {
            return Err(format!("malformed IDN: {text:?}"));
        }
        Ok(Self {
            manufacturer: f[0].to_string(),
            model:        f[1].to_string(),
            serial:       f[2].to_string(),
            firmware:     f[3].to_string(),
        })
    }
}

pub const MODEL: &str = "TCD1304";

impl Io {
    fn write_cmd(&mut self, cmd: &str) -> Result<(), String> {
        self.port
            .write_all(format!("{cmd}\n").as_bytes())
            .and_then(|_| self.port.flush())
            .map_err(|e| format!("write {cmd:?}: {e}"))
    }

    /// Read until a frame of `want` arrives.
    ///
    /// Frames of other types are skipped rather than returned, so a late ACK
    /// that arrived after a timeout cannot be mistaken for the next capture.
    /// An ERR frame is an error whatever we were waiting for — an unknown
    /// command must never be silently read as data.
    ///
    /// On timeout the whole receive buffer is dropped. That is safe precisely
    /// because the device sends nothing unsolicited: anything still buffered is
    /// a reply to a command we have already given up on.
    fn read_frame(&mut self, want: FrameType, timeout: Duration) -> Result<Frame, String> {
        let deadline = Instant::now() + timeout;
        let mut scratch = [0u8; 8192];
        loop {
            while let Some(f) = frame::parse(&mut self.buf) {
                if f.kind == FrameType::Err {
                    self.buf.clear();
                    return Err(format!("device: {}", f.text()));
                }
                if f.kind == want {
                    return Ok(f);
                }
                // Stale reply from an earlier command; drop it and keep reading.
            }
            if Instant::now() >= deadline {
                self.buf.clear();
                return Err(format!("timed out waiting for {want:?}"));
            }
            match self.port.read(&mut scratch) {
                Ok(0) => {}
                Ok(n) => self.buf.extend_from_slice(&scratch[..n]),
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(e) => {
                    self.buf.clear();
                    return Err(format!("read: {e}"));
                }
            }
        }
    }

    fn command(&mut self, cmd: &str, want: FrameType, timeout: Duration) -> Result<Frame, String> {
        self.write_cmd(cmd)?;
        self.read_frame(want, timeout)
    }

    /// Push the integration time only when it differs from what the device has.
    /// The reply carries the value actually applied, after the device's own
    /// clamp — that is what the caller should believe, not what it asked for.
    fn set_integration(&mut self, integ_ms: u32) -> Result<u32, String> {
        if self.pushed_integ_ms == Some(integ_ms) {
            return Ok(integ_ms);
        }
        let ack = self.command(&format!("I{integ_ms}"), FrameType::Ack, CMD_TIMEOUT)?;
        let applied: u32 = ack
            .text()
            .strip_prefix('I')
            .and_then(|n| n.trim().parse().ok())
            .ok_or_else(|| format!("expected ACK I<ms>, got {:?}", ack.text()))?;
        self.pushed_integ_ms = Some(applied);
        Ok(applied)
    }

    /// One capture. `A` is answered by the spectrum itself — there is no ACK.
    fn acquire(&mut self, integ_ms: u32) -> Result<Vec<i16>, String> {
        let started = Instant::now();
        self.write_cmd("A")?;
        let f = self.read_frame(FrameType::Spectrum, capture_timeout(integ_ms))?;

        self.last_seq = f.seq;
        self.last_capture_ms = started.elapsed().as_millis() as u32;
        if f.dropped() {
            // The frame is valid — it is one integration period later than asked
            // for, because it missed its USB write slot and was retried.
            self.dropped_frames = self.dropped_frames.saturating_add(1);
        }

        let samples = f.samples().map_err(|e| e.to_string())?;
        if samples.len() != self.meta.pixels {
            return Err(format!(
                "expected {} samples, got {}",
                self.meta.pixels,
                samples.len()
            ));
        }
        Ok(samples)
    }
}

/// How many log lines to keep. The panel shows the tail; older lines are noise.
const DIAG_CAPACITY: usize = 200;

pub struct Tcd1304Driver {
    port_path: String,
    io: Mutex<Option<Io>>,
    diag: Mutex<VecDeque<DiagEntry>>,
}

/// Port names worth probing. A pty (the simulator) never appears in
/// `available_ports()`, which is what the JASPER_PORT override is for.
fn looks_like_a_serial_port(name: &str) -> bool {
    let base = name.rsplit('/').next().unwrap_or(name);
    base.starts_with("ttyACM")
        || base.starts_with("ttyUSB")
        || base.starts_with("cu.usbmodem")
        || base.starts_with("COM")
}

/// Open a port, handshake, and report who answered — then close it again.
///
/// This is how discovery works. The device ships the stock Renesas CDC
/// VID:PID (045B:5310), shared with other RA demo firmware, and a USB serial
/// string descriptor that is identical on every board — so neither identifies a
/// unit. `serialport` is also built without libudev here, so VID/PID are not
/// even readable. Asking the device who it is, is both more reliable and the
/// only option.
pub fn probe(port_path: &str) -> Result<Idn, String> {
    let io = Tcd1304Driver::open(port_path)?;
    Ok(io.idn.clone())
}

/// Every TCD1304 the host can see.
///
/// `skip` is the port already held open by the live driver — probing it would
/// fail with "device busy" and knock out a working connection, so the caller
/// passes it in and supplies that entry from its own cached identity.
pub fn discover(skip: Option<&str>) -> Vec<DeviceInfo> {
    let ports = serialport::available_ports().unwrap_or_default();
    ports
        .into_iter()
        .map(|p| p.port_name)
        .filter(|name| looks_like_a_serial_port(name))
        .filter(|name| Some(name.as_str()) != skip)
        .filter_map(|name| {
            probe(&name).ok().map(|idn| DeviceInfo {
                id:       name.clone(),
                name:     friendly_name(&idn),
                model:    idn.model,
                status:   "available".into(),
                serial:   idn.serial,
                firmware: idn.firmware,
            })
        })
        .collect()
}

/// "TCD1304 · 323731" — the serial's tail is enough to tell two units apart
/// without filling the button with 16 hex digits.
fn friendly_name(idn: &Idn) -> String {
    let tail = idn.serial.len().saturating_sub(6);
    if idn.serial.is_empty() {
        idn.model.clone()
    } else {
        format!("{} · {}", idn.model, &idn.serial[tail..])
    }
}

impl Tcd1304Driver {
    pub fn new(port_path: String) -> Self {
        Self { port_path, io: Mutex::new(None), diag: Mutex::new(VecDeque::new()) }
    }

    fn log(&self, severity: &str, message: impl Into<String>) {
        if let Ok(mut d) = self.diag.lock() {
            if d.len() >= DIAG_CAPACITY {
                d.pop_front();
            }
            let ts = now_ms();
            let id = format!("{ts}-{}", d.len());
            d.push_back(DiagEntry { id, ts, severity: severity.to_string(), message: message.into() });
        }
    }

    pub fn port_path(&self) -> &str {
        &self.port_path
    }

    /// Open the port and run the handshake.
    fn open(port_path: &str) -> Result<Io, String> {
        let port = serialport::new(port_path, BAUD)
            .timeout(Duration::from_millis(200))
            .open()
            .map_err(|e| format!("open {port_path}: {e}"))?;

        let mut io = Io {
            port,
            buf: Vec::new(),
            idn: Idn::default(),
            meta: Metadata::default(),
            pushed_integ_ms: None,
            last_seq: 0,
            dropped_frames: 0,
            last_capture_ms: 0,
        };

        // A previous session may have left a capture armed, which would dump
        // 7406 bytes into the middle of the handshake. Disarm, settle, discard.
        io.write_cmd("X")?;
        std::thread::sleep(Duration::from_millis(50));
        let _ = io.port.clear(serialport::ClearBuffer::Input);
        io.buf.clear();

        let idn_text = io.command("*IDN?", FrameType::Idn, CMD_TIMEOUT)?.text();
        let idn = Idn::parse(&idn_text)?;
        if idn.model != MODEL {
            // Match on the model field, not a prefix of the whole string.
            return Err(format!("not a {MODEL} spectrometer: {idn_text:?}"));
        }
        io.idn = idn;

        let meta_text = io.command("M", FrameType::Metadata, CMD_TIMEOUT)?.text();
        io.meta = Metadata::parse(&meta_text);
        io.pushed_integ_ms = None;
        Ok(io)
    }

    /// Run something against the open port.
    ///
    /// Errors when nothing is connected. This used to open the port on first
    /// use, which meant a calibration or a scan would silently connect to
    /// whatever port the driver was constructed with — so pressing "Run" on
    /// Dark with no instrument selected quietly connected and captured. With
    /// connect and disconnect now explicit in the UI, an operation on a
    /// disconnected instrument is a mistake worth reporting, not something to
    /// paper over.
    fn with_io<T>(&self, f: impl FnOnce(&mut Io) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.io.lock().map_err(|_| "driver lock poisoned".to_string())?;
        let Some(io) = guard.as_mut() else {
            return Err(NOT_CONNECTED.to_string());
        };
        let result = f(io);
        if let Err(e) = &result {
            // Drop the connection so the next call re-handshakes rather than
            // inheriting a stream we have lost our place in.
            *guard = None;
            drop(guard);
            self.log("error", format!("{e} — connection dropped, will re-handshake"));
        }
        result
    }
}

impl SpectrumDriver for Tcd1304Driver {
    /// Everything the device told us at handshake, plus what the frame headers
    /// have said since. `None` until connected.
    fn device_metadata(&self) -> Option<DeviceMetadata> {
        let guard = self.io.lock().ok()?;
        let io = guard.as_ref()?;
        Some(DeviceMetadata {
            port:             self.port_path.clone(),
            manufacturer:     io.idn.manufacturer.clone(),
            model:            io.idn.model.clone(),
            serial:           io.idn.serial.clone(),
            firmware:         io.idn.firmware.clone(),
            protocol_version: frame::VERSION as u32,
            pixels:           io.meta.pixels as u32,
            integ_min_ms:     io.meta.integ_min_ms,
            integ_max_ms:     io.meta.integ_max_ms,
            max_intensity:    io.meta.max_intensity,
            sensor:           io.meta.sensor.clone(),
            last_seq:         io.last_seq,
            dropped_frames:   io.dropped_frames,
            last_capture_ms:  io.last_capture_ms,
            timestamp:        now_ms(),
        })
    }

    /// Only this driver's own connection. Scanning the machine for other
    /// instruments is `discover()`, called from the command layer — it is not a
    /// property of an already-connected driver, and probing a port we hold open
    /// would fail as busy.
    fn device_list(&self) -> Vec<DeviceInfo> {
        self.io
            .lock()
            .ok()
            .and_then(|g| {
                g.as_ref().map(|io| DeviceInfo {
                    id:       self.port_path.clone(),
                    name:     friendly_name(&io.idn),
                    model:    io.idn.model.clone(),
                    status:   "online".into(),
                    serial:   io.idn.serial.clone(),
                    firmware: io.idn.firmware.clone(),
                })
            })
            .into_iter()
            .collect()
    }

    fn connect(&mut self, device_id: &str) -> Result<(), String> {
        if !device_id.is_empty() && device_id != self.port_path {
            self.port_path = device_id.to_string();
            *self.io.lock().map_err(|_| "driver lock poisoned".to_string())? = None;
        }
        let io = match Self::open(&self.port_path) {
            Ok(io) => io,
            Err(e) => {
                self.log("error", format!("connect {}: {e}", self.port_path));
                return Err(e);
            }
        };
        self.log("info", format!("connected {} — {} {} firmware {}",
            self.port_path, io.idn.model, io.idn.serial, io.idn.firmware));
        *self.io.lock().map_err(|_| "driver lock poisoned".to_string())? = Some(io);
        Ok(())
    }

    fn disconnect(&mut self) {
        if let Ok(mut guard) = self.io.lock() {
            if let Some(io) = guard.as_mut() {
                // Clear any pending capture before dropping the port, so the
                // next session does not open onto a spectrum in flight.
                let _ = io.write_cmd("X");
            }
            if guard.is_some() {
                *guard = None;
                self.log("info", format!("disconnected {}", self.port_path));
            }
        }
    }

    fn scan(&self, params: &AcqParams) -> Result<SpectrumFrame, String> {
        self.with_io(|io| {
            let applied = io.set_integration(params.integration)?;
            let samples = io.acquire(applied)?;
            let max_intensity = io.meta.max_intensity;

            let ys: Vec<f32> = samples
                .iter()
                .map(|&raw| to_intensity(raw, max_intensity))
                .collect();

            Ok(SpectrumFrame {
                // Pixel index until a wavelength calibration exists (E5). Honest
                // beats a fabricated nm axis.
                xs: (0..ys.len()).map(|i| i as f32).collect(),
                ys,
                mode: params.mode.clone(),
                units: "counts".to_string(),
                timestamp: now_ms(),
            })
        })
    }

    fn is_connected(&self) -> bool {
        self.io.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    fn diagnostics(&self) -> Vec<DiagEntry> {
        self.diag.lock().map(|d| d.iter().cloned().collect()).unwrap_or_default()
    }

    fn calibrate_dark(&self, _params: &AcqParams) -> Result<CalResult, String> {
        // The frame averaging and storage happen in the command layer; the
        // device has no calibration command of its own.
        Ok(CalResult { status: "ok".into(), rms: None, warn: None })
    }

    fn calibrate_reference(&self, _params: &AcqParams) -> Result<CalResult, String> {
        Ok(CalResult { status: "ok".into(), rms: None, warn: None })
    }

    fn calibrate_xcal(&self) -> Result<XCalResult, String> {
        // The device stores no wavelength calibration and the firmware roadmap
        // keeps it that way. Fitting one from a lamp spectrum is E5.
        Err("wavelength calibration is host-side; not implemented yet (E5)".to_string())
    }
}

/// Saturated pixel indices in a raw sample block, for the caller to warn about.
pub fn saturated_pixels(samples: &[i16], max_intensity: i32) -> Vec<usize> {
    samples
        .iter()
        .enumerate()
        .filter(|(_, &v)| is_saturated(v, max_intensity))
        .map(|(i, _)| i)
        .collect()
}
