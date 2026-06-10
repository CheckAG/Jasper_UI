// SerialDriver — speaks the specbench PROTOCOL.md v1.0 over a USB-CDC serial
// port (real RA2A1 board, C16605 bridge, or tools/protocol-sim/sim.py pty).
//
// Wire format (see claude_hw_design/PROTOCOL.md):
//   - ASCII commands, "\n"-terminated; replies "OK ..." / "ERR <code> <msg>".
//   - ACQUIRE → "OK BIN <nbytes>\n" + binary block:
//     STX 0x02, VERSION, PIXELS u16, INTEG_US u32, AVG u16, CLKHZ_DIV1K u16,
//     FLAGS u16, 1024 x uint16 LE, CRC-16/CCITT (LE) — 2064 bytes total.

use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serialport::SerialPort;

use crate::instrument::driver::*;

const BAUD: u32 = 115_200; // irrelevant for CDC; convention per PROTOCOL.md §1
const STX: u8 = 0x02;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn crc16_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &b in data {
        crc ^= (b as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 { (crc << 1) ^ 0x1021 } else { crc << 1 };
        }
    }
    crc
}

/// Live connection state. Settings are pushed lazily: scan() re-sends
/// SET INTEG / SET AVG only when they differ from what the device has.
struct Io {
    port:   Box<dyn SerialPort>,
    idn:    String,
    pixels: usize,
    /// Wavelengths from the device's GET CAL polynomial (pixel index if uncalibrated).
    xs:     Vec<f32>,
    pushed: Option<(u32, u32)>, // (integ_us, avg) last accepted by the device
}

impl Io {
    fn read_line(&mut self) -> Result<String, String> {
        let mut line = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            self.port.read_exact(&mut byte).map_err(|e| format!("read: {e}"))?;
            match byte[0] {
                b'\n' => return Ok(String::from_utf8_lossy(&line).trim().to_string()),
                b'\r' => {}
                b => line.push(b),
            }
        }
    }

    /// Send one command, return the "OK ..." reply (ERR replies become Err).
    fn cmd(&mut self, command: &str) -> Result<String, String> {
        self.port
            .write_all(format!("{command}\n").as_bytes())
            .map_err(|e| format!("write: {e}"))?;
        let reply = self.read_line()?;
        if reply.starts_with("OK") {
            Ok(reply)
        } else {
            Err(format!("device replied to {command:?}: {reply}"))
        }
    }

    /// ACQUIRE one frame, validate framing + CRC, return pixel counts.
    fn acquire(&mut self) -> Result<Vec<f32>, String> {
        let reply = self.cmd("ACQUIRE")?;
        let nbytes: usize = reply
            .strip_prefix("OK BIN ")
            .and_then(|n| n.trim().parse().ok())
            .ok_or_else(|| format!("expected OK BIN <n>, got {reply:?}"))?;

        let mut block = vec![0u8; nbytes];
        self.port.read_exact(&mut block).map_err(|e| format!("read block: {e}"))?;

        if nbytes < 16 || block[0] != STX {
            return Err(format!("bad block framing (len {nbytes})"));
        }
        let crc_off = nbytes - 2;
        let got = u16::from_le_bytes([block[crc_off], block[crc_off + 1]]);
        let want = crc16_ccitt(&block[..crc_off]);
        if got != want {
            return Err(format!("CRC mismatch (got {got:#06x}, want {want:#06x})"));
        }
        let pixels = u16::from_le_bytes([block[2], block[3]]) as usize;
        if nbytes != 14 + pixels * 2 + 2 {
            return Err(format!("block length {nbytes} doesn't match {pixels} pixels"));
        }

        Ok((0..pixels)
            .map(|i| u16::from_le_bytes([block[14 + i * 2], block[15 + i * 2]]) as f32)
            .collect())
    }
}

pub struct SerialDriver {
    port_path: String,
    io: Mutex<Option<Io>>,
}

impl SerialDriver {
    pub fn new(port_path: String) -> Self {
        Self { port_path, io: Mutex::new(None) }
    }

    fn open(&self) -> Result<Io, String> {
        let port = serialport::new(&self.port_path, BAUD)
            .timeout(Duration::from_secs(3))
            .open()
            .map_err(|e| format!("open {}: {e}", self.port_path))?;

        let mut io = Io { port, idn: String::new(), pixels: 0, xs: Vec::new(), pushed: None };

        io.idn = io.cmd("*IDN?")?.trim_start_matches("OK").trim().to_string();

        let info = io.cmd("INFO")?;
        io.pixels = info
            .split_whitespace()
            .find_map(|kv| kv.strip_prefix("PIXELS="))
            .and_then(|v| v.parse().ok())
            .ok_or_else(|| format!("INFO reply missing PIXELS: {info:?}"))?;

        // Wavelength polynomial λ(p) = c0 + c1·p + … + c5·p⁵ (PROTOCOL.md §5).
        let cal: Vec<f64> = io
            .cmd("GET CAL")?
            .trim_start_matches("OK")
            .split_whitespace()
            .filter_map(|c| c.parse().ok())
            .collect();
        io.xs = if cal.len() == 6 && cal.iter().any(|&c| c != 0.0) {
            (0..io.pixels)
                .map(|p| {
                    let p = p as f64;
                    cal.iter().rev().fold(0.0, |acc, &c| acc * p + c) as f32
                })
                .collect()
        } else {
            (0..io.pixels).map(|p| p as f32).collect()
        };

        Ok(io)
    }

    /// The GUI may start streaming before any explicit connect (the mock
    /// allowed that), so open the port lazily on first use.
    fn ensure_connected<'a>(&self, guard: &'a mut Option<Io>) -> Result<&'a mut Io, String> {
        if guard.is_none() {
            let io = self.open()?;
            eprintln!("[serial] connected: {} ({} px)", io.idn, io.pixels);
            *guard = Some(io);
        }
        Ok(guard.as_mut().unwrap())
    }
}

impl SpectrumDriver for SerialDriver {
    fn device_list(&self) -> Vec<DeviceInfo> {
        let io = self.io.lock().ok();
        let connected = io.as_ref().map_or(false, |g| g.is_some());
        let model = io
            .as_ref()
            .and_then(|g| g.as_ref().map(|io| io.idn.clone()))
            .unwrap_or_else(|| "PROTOCOL.md serial device".into());
        vec![DeviceInfo {
            id:     self.port_path.clone(),
            name:   self.port_path.clone(),
            model,
            status: if connected { "connected".into() } else { "disconnected".into() },
            temp_c: 0.0, // no TEMP? in PROTOCOL.md v1.0
        }]
    }

    fn connect(&mut self, _device_id: &str) -> Result<(), String> {
        let io = self.open()?;
        eprintln!("[serial] connected: {} ({} px)", io.idn, io.pixels);
        *self.io.lock().map_err(|e| e.to_string())? = Some(io);
        Ok(())
    }

    fn disconnect(&mut self) {
        if let Ok(mut guard) = self.io.lock() {
            *guard = None;
        }
    }

    fn scan(&self, params: &AcqParams) -> Result<SpectrumFrame, String> {
        let mut guard = self.io.lock().map_err(|e| e.to_string())?;
        let io = self.ensure_connected(&mut guard)?;

        // AcqParams.integration is ms; the protocol takes µs. TODO(gap-2):
        // carry µs (+ gain/offset/trigger) end-to-end through AcqParams.
        let integ_us = params.integration.saturating_mul(1000).max(1);
        let avg = params.averaging.max(1);

        if io.pushed != Some((integ_us, avg)) {
            io.cmd(&format!("SET INTEG {integ_us}"))?;
            io.cmd(&format!("SET AVG {avg}"))?;
            io.pushed = Some((integ_us, avg));
        }

        // The device integrates for integ × avg before replying.
        let acq_ms = (integ_us as u64 * avg as u64) / 1000 + 3000;
        io.port
            .set_timeout(Duration::from_millis(acq_ms))
            .map_err(|e| e.to_string())?;

        let ys = io.acquire()?;

        // Always raw counts; instrument::process turns them into the
        // requested mode using the stored dark/reference frames.
        Ok(SpectrumFrame {
            xs:        io.xs.clone(),
            ys,
            mode:      params.mode.clone(),
            units:     "counts".into(),
            timestamp: now_ms(),
        })
    }

    fn telemetry(&self) -> Result<TelemetryData, String> {
        // PROTOCOL.md v1.0 has no telemetry commands (gap 5); report neutral
        // values so the panel renders without inventing readings.
        Ok(TelemetryData {
            device_id:   self.port_path.clone(),
            temp_c:      0.0,
            lamp_hours:  0,
            drift_sigma: 0.0,
            headroom:    0.0,
            queue_depth: 0,
            timestamp:   now_ms(),
        })
    }

    fn calibrate_dark(&self, _params: &AcqParams) -> Result<CalResult, String> {
        // Frame capture + storage happen in the command layer
        // (instrument::process); nothing device-specific to do here.
        Ok(CalResult { status: "ok".into(), rms: None, warn: None })
    }

    fn calibrate_reference(&self, _params: &AcqParams) -> Result<CalResult, String> {
        Ok(CalResult { status: "ok".into(), rms: None, warn: None })
    }

    fn calibrate_xcal(&self) -> Result<XCalResult, String> {
        let mut guard = self.io.lock().map_err(|e| e.to_string())?;
        let io = self.ensure_connected(&mut guard)?;
        let coefficients: Vec<f32> = io
            .cmd("GET CAL")?
            .trim_start_matches("OK")
            .split_whitespace()
            .filter_map(|c| c.parse().ok())
            .collect();
        Ok(XCalResult { status: "ok".into(), rms: 0.0, coefficients, peaks_found: 0 })
    }
}
