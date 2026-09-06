// The frame codec against a real byte stream from tools/tcd1304-sim.py.
//
// Unit tests in frame.rs feed the parser buffers we built ourselves. This
// drives it over a pty from a separate process, so chunk boundaries land
// wherever the OS puts them — which is the only way the resync path gets
// exercised for real.
//
// Unlike the test this replaces, a missing simulator FAILS. A test that skips
// itself when its fixture is absent reports success for a protocol nobody ran.
//
// Override the path with JASPER_SIM=/path/to/tcd1304-sim.py.

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use jasper_lib::instrument::tcd1304::frame::{self, Frame, FrameType, PIXELS};

struct KillOnDrop(Child);
impl Drop for KillOnDrop {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn sim_path() -> String {
    std::env::var("JASPER_SIM")
        .unwrap_or_else(|_| format!("{}/../tools/tcd1304-sim.py", env!("CARGO_MANIFEST_DIR")))
}

/// Spawn the simulator; returns the process guard and the pty path it printed.
fn spawn_sim(extra: &[&str]) -> (KillOnDrop, String) {
    let sim = sim_path();
    assert!(
        std::path::Path::new(&sim).exists(),
        "simulator not found at {sim} — the protocol is untested without it (set JASPER_SIM to override)"
    );

    let mut args = vec![sim.as_str()];
    args.extend_from_slice(extra);
    let mut child = KillOnDrop(
        Command::new("python3")
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap_or_else(|e| panic!("cannot spawn python3: {e}")),
    );

    let stdout = child.0.stdout.take().expect("sim stdout");
    let mut line = String::new();
    BufReader::new(stdout)
        .read_line(&mut line)
        .expect("simulator should print its pty path");
    let pty = line.trim().to_string();
    assert!(pty.starts_with("/dev/"), "unexpected pty path: {pty}");
    (child, pty)
}

/// A port plus the read buffer the parser consumes from.
struct Link {
    port: Box<dyn serialport::SerialPort>,
    buf:  Vec<u8>,
}

impl Link {
    fn open(pty: &str) -> Self {
        let port = serialport::new(pty, 115_200)
            .timeout(Duration::from_millis(200))
            .open()
            .unwrap_or_else(|e| panic!("cannot open {pty}: {e}"));
        Self { port, buf: Vec::new() }
    }

    fn send(&mut self, cmd: &str) {
        self.port.write_all(cmd.as_bytes()).expect("write");
        self.port.flush().expect("flush");
    }

    /// Read until a frame of `want` appears. Frames of other types are skipped,
    /// so a late ACK after a timeout cannot be mistaken for the next capture.
    fn read_frame(&mut self, want: FrameType, timeout: Duration) -> Frame {
        let deadline = Instant::now() + timeout;
        let mut scratch = [0u8; 4096];
        loop {
            while let Some(f) = frame::parse(&mut self.buf) {
                if f.kind == want {
                    return f;
                }
                assert_ne!(f.kind, FrameType::Err, "device said: {}", f.text());
            }
            assert!(Instant::now() < deadline, "timed out waiting for {want:?}");
            match self.port.read(&mut scratch) {
                Ok(0) => {}
                Ok(n) => self.buf.extend_from_slice(&scratch[..n]),
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(e) => panic!("read failed: {e}"),
            }
        }
    }

    fn command(&mut self, cmd: &str, want: FrameType) -> Frame {
        self.send(cmd);
        self.read_frame(want, Duration::from_secs(2))
    }
}

#[test]
fn handshake_and_capture_against_the_simulator() {
    let (_sim, pty) = spawn_sim(&["--scene", "lines", "--no-delay"]);
    let mut link = Link::open(&pty);

    // A previous session may have left a capture armed, which would dump 7406
    // bytes into the middle of the handshake. Disarm first, as the reference
    // host does.
    assert_eq!(link.command("X\n", FrameType::Ack).text(), "X");

    let idn = link.command("*IDN?\n", FrameType::Idn).text();
    let fields: Vec<&str> = idn.split(',').collect();
    assert_eq!(fields.len(), 4, "SCPI *IDN? is four comma-separated fields: {idn}");
    assert_eq!(fields[0], "Jasper");
    assert_eq!(fields[1], "TCD1304", "match on the model field, not a prefix of the whole string");
    assert_eq!(fields[2].len(), 16, "serial is the MCU unique ID as 16 hex digits");
    assert_eq!(fields[3], "0.1", "firmware version is an opaque string, not the protocol version");

    let meta = link.command("M\n", FrameType::Metadata).text();
    assert!(meta.contains("PIXELS=3694"));
    assert!(meta.contains("MAX_INTENSITY=32767"));
    assert!(meta.ends_with(';'), "every pair is semicolon-terminated, including the last");

    // The device clamps and reports what it applied.
    assert_eq!(link.command("I3\n", FrameType::Ack).text(), "I8", "floor clamp");
    assert_eq!(link.command("I99999\n", FrameType::Ack).text(), "I10000", "ceiling clamp");
    let ack = link.command("I25\n", FrameType::Ack);
    assert_eq!(ack.text(), "I25");
    assert_eq!(ack.integ_ms, 25, "the header carries the integration time in force");

    // A is answered by the spectrum itself — there is no ACK.
    let first = link.command("A\n", FrameType::Spectrum);
    assert_eq!(first.integ_ms, 25);
    assert!(!first.dropped());
    let samples = first.samples().expect("spectrum samples");
    assert_eq!(samples.len(), PIXELS);

    // Raw counts, before the host inverts them. The video is inverted: masked
    // pixels read high and light pulls the value down, so an emission line is a
    // DIP. Checked in-frame, masked window against the illuminated one — the
    // same comparison that settled this on real hardware.
    let dark_window: i32 =
        samples[16..=28].iter().map(|&v| v as i32).sum::<i32>() / 13;
    let brightest = *samples[32..3680].iter().min().unwrap() as i32;
    assert!(
        dark_window > 20_000,
        "masked pixels should sit near the dark level, got {dark_window}"
    );
    assert!(
        brightest < dark_window - 2_000,
        "an emission line should read well BELOW the dark level: line {brightest} vs dark {dark_window}"
    );

    // Each capture discards the in-progress frame, so seq advances by at least 2.
    let second = link.command("A\n", FrameType::Spectrum);
    assert!(
        second.seq.wrapping_sub(first.seq) >= 2,
        "seq {} -> {} — a capture must discard the in-progress frame",
        first.seq,
        second.seq
    );
    assert_ne!(samples, second.samples().unwrap(), "consecutive frames should differ");

    // An unknown command is an ERR frame, never silence and never data.
    link.send("Q\n");
    let err = link.read_frame(FrameType::Err, Duration::from_secs(2));
    assert_eq!(err.text(), "unknown command");
}

#[test]
fn saturated_pixels_read_negative() {
    // The ADC is single-ended and rolls past 0x7FFF; samples are read signed so
    // that shows up as a negative excursion rather than a plausible large value.
    let (_sim, pty) = spawn_sim(&["--scene", "saturated", "--no-delay"]);
    let mut link = Link::open(&pty);
    link.command("X\n", FrameType::Ack);
    link.command("I100\n", FrameType::Ack);

    let samples = link
        .command("A\n", FrameType::Spectrum)
        .samples()
        .expect("spectrum samples");
    assert_eq!(samples.len(), PIXELS);
    let saturated = samples.iter().filter(|&&v| v < 0).count();
    assert!(saturated > 0, "the saturated scene should push pixels past MAX_INTENSITY");
    assert!(saturated < PIXELS / 10, "only the brightest line should saturate, got {saturated}");
}

#[test]
fn a_capture_takes_about_two_integration_periods() {
    // The firmware discards one frame and sends the next, so the host timeout
    // has to be 3 x integ + slack rather than 1 x integ.
    let (_sim, pty) = spawn_sim(&["--scene", "flat"]); // real timing, no --no-delay
    let mut link = Link::open(&pty);
    link.command("X\n", FrameType::Ack);
    link.command("I50\n", FrameType::Ack);

    let t0 = Instant::now();
    link.send("A\n");
    let frame = link.read_frame(FrameType::Spectrum, Duration::from_millis(3 * 50 + 500));
    let elapsed = t0.elapsed();

    assert_eq!(frame.samples().unwrap().len(), PIXELS);
    assert!(
        elapsed >= Duration::from_millis(90),
        "a capture should cost about 2 x 50 ms, took {elapsed:?}"
    );
}

// ── The driver itself, not just the codec ────────────────────────────────────

use jasper_lib::instrument::driver::{AcqParams, SpectrumDriver};
use jasper_lib::instrument::tcd1304::Tcd1304Driver;

fn params(integration: u32) -> AcqParams {
    AcqParams { integration, ..Default::default() }
}

#[test]
fn driver_handshakes_and_scans() {
    let (_sim, pty) = spawn_sim(&["--scene", "lines", "--no-delay"]);
    let mut drv = Tcd1304Driver::new(pty);

    drv.connect("").expect("handshake");

    let meta = drv.device_metadata().expect("connected, so metadata is cached");
    assert_eq!(meta.model, "TCD1304");
    assert_eq!(meta.serial.len(), 16);
    assert_eq!(meta.firmware, "0.1");
    assert_eq!(meta.protocol_version, 1);
    assert_eq!(meta.pixels, PIXELS as u32);
    assert_eq!((meta.integ_min_ms, meta.integ_max_ms), (8, 10_000));
    assert_eq!(meta.max_intensity, 32_767);
    assert_eq!(meta.sensor, "TCD1304AP");

    let frame = drv.scan(&params(25)).expect("scan");
    assert_eq!(frame.ys.len(), PIXELS);
    assert_eq!(frame.xs.len(), PIXELS);
    assert_eq!(frame.units, "counts");
    // xs is the pixel index until a wavelength calibration exists (E5).
    assert_eq!(frame.xs[0], 0.0);
    assert_eq!(frame.xs[PIXELS - 1], (PIXELS - 1) as f32);
    // ys is inverted (max_intensity - raw), so a line is now a peak above a
    // small dark baseline rather than a dip below a large one.
    let baseline = frame.ys[16..=28].iter().sum::<f32>() / 13.0;
    let peak = frame.ys[32..3680].iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    assert!(baseline > 0.0, "dark baseline should be positive after inversion, got {baseline}");
    assert!(
        peak > baseline + 2_000.0,
        "an emission line should stand well above the dark baseline: peak {peak} vs baseline {baseline}"
    );

    let after = drv.device_metadata().unwrap();
    assert!(after.last_seq > 0, "the header's seq should be recorded");
    assert_eq!(after.dropped_frames, 0);

    drv.disconnect();
    // Not device_list(): that now probes the machine's real serial ports, so
    // what it returns depends on what is plugged in. Metadata is the
    // machine-independent statement that we are no longer connected.
    assert!(drv.device_metadata().is_none(), "disconnect should clear the cached identity");

    // The driver logged the connect and the disconnect.
    let diag = drv.diagnostics();
    assert!(diag.iter().any(|d| d.message.contains("connected")), "{diag:?}");
    assert!(diag.iter().any(|d| d.message.contains("disconnected")), "{diag:?}");
}

#[test]
fn driver_reports_the_clamped_integration_the_device_applied() {
    let (_sim, pty) = spawn_sim(&["--scene", "flat", "--no-delay"]);
    let mut drv = Tcd1304Driver::new(pty);
    drv.connect("").expect("handshake");
    // 3 ms is below the device floor; the scan must still succeed, using the
    // clamped value the ACK reported rather than what was asked for.
    let frame = drv.scan(&params(3)).expect("scan below the floor still works");
    assert_eq!(frame.ys.len(), PIXELS);
}

#[test]
fn a_disconnected_driver_refuses_to_work_instead_of_connecting_itself() {
    // This used to open the port on first use, so pressing "Run" on a
    // calibration with no instrument selected quietly connected and captured.
    // Connecting is the operator's decision.
    let (_sim, pty) = spawn_sim(&["--scene", "flat", "--no-delay"]);
    let mut drv = Tcd1304Driver::new(pty);

    assert!(!drv.is_connected());
    let err = drv.scan(&params(8)).expect_err("a scan must not connect on its own");
    assert!(err.contains("No instrument connected"), "unhelpful error: {err}");
    assert!(drv.device_metadata().is_none(), "and nothing should have been opened");

    // The same call works once connecting is asked for explicitly.
    drv.connect("").expect("handshake");
    assert!(drv.is_connected());
    drv.scan(&params(8)).expect("scan after an explicit connect");

    // ...and stops working again after disconnect.
    drv.disconnect();
    assert!(!drv.is_connected());
    assert!(drv.scan(&params(8)).is_err(), "a disconnected driver must stay refused");
}

#[test]
fn driver_refuses_a_device_that_is_not_a_tcd1304() {
    // A pty that holds the port open but never replies. The handshake must
    // fail rather than hang or half-connect.
    let (_sim, pty) = spawn_sim(&["--mute"]);
    let mut drv = Tcd1304Driver::new(pty);
    let err = drv.connect("").expect_err("a silent port is not a spectrometer");
    assert!(err.contains("timed out"), "unexpected error: {err}");
}

#[test]
fn driver_declines_wavelength_calibration_rather_than_inventing_it() {
    let (_sim, pty) = spawn_sim(&["--scene", "flat", "--no-delay"]);
    let mut drv = Tcd1304Driver::new(pty);
    drv.connect("").expect("handshake");
    // The device stores no wavelength calibration; fitting one is E5.
    assert!(drv.calibrate_xcal().is_err());
}

#[test]
fn device_metadata_is_none_until_connected() {
    let (_sim, pty) = spawn_sim(&["--scene", "flat", "--no-delay"]);
    let mut drv = Tcd1304Driver::new(pty);
    assert!(drv.device_metadata().is_none(), "nothing to report before the handshake");
    drv.connect("").expect("handshake");
    let m = drv.device_metadata().expect("populated after the handshake");
    assert_eq!(m.model, "TCD1304");
    assert_eq!(m.protocol_version, 1);
    assert_eq!(m.max_intensity, 32_767);
    assert_eq!(m.last_capture_ms, 0, "no capture yet");
    drv.scan(&params(8)).expect("scan");
    assert!(drv.device_metadata().unwrap().last_capture_ms > 0, "a capture updates it");
}

// ── Real hardware ────────────────────────────────────────────────────────────
//
// Ignored by default so `cargo test` stays green without a board. Run with:
//
//     JASPER_PORT=/dev/ttyACM0 cargo test --test tcd1304_sim -- --ignored --nocapture
//
// The simulator can only ever prove we agree with our own reading of the spec.
// This proves we agree with the firmware.

#[test]
#[ignore = "requires a TCD1304 on JASPER_PORT"]
fn real_hardware_handshake_and_capture() {
    let port = std::env::var("JASPER_PORT")
        .expect("set JASPER_PORT=/dev/ttyACM0 (or wherever the board enumerated)");
    let mut drv = Tcd1304Driver::new(port);

    drv.connect("").expect("handshake with the real board");
    let meta = drv.device_metadata().expect("metadata cached after connect");
    println!(
        "{} {} serial {} firmware {} protocol v{} — {} px, {}-{} ms, max {}",
        meta.manufacturer, meta.model, meta.serial, meta.firmware,
        meta.protocol_version, meta.pixels, meta.integ_min_ms, meta.integ_max_ms,
        meta.max_intensity
    );

    assert_eq!(meta.model, "TCD1304");
    assert_eq!(meta.protocol_version, 1);
    assert_eq!(meta.pixels, PIXELS as u32);
    assert_eq!(meta.sensor, "TCD1304AP");
    assert_eq!(meta.serial.len(), 16, "MCU unique ID is 16 hex digits");
    assert_ne!(
        meta.serial, "0011223344556677",
        "that is the simulator's placeholder — a real board has its own unique ID"
    );

    // Capture at three integration times; the device clamps the first.
    for requested in [3u32, 25, 100] {
        let started = std::time::Instant::now();
        let frame = drv.scan(&params(requested)).expect("scan");
        let elapsed = started.elapsed();

        assert_eq!(frame.ys.len(), PIXELS);
        assert_eq!(frame.units, "counts");
        let min = frame.ys.iter().cloned().fold(f32::INFINITY, f32::min);
        let max = frame.ys.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let mean = frame.ys.iter().sum::<f32>() / frame.ys.len() as f32;
        println!(
            "  requested {requested:>4} ms -> {elapsed:>8.1?}  min {min:8.0}  max {max:8.0}  mean {mean:8.1}",
        );

        // A frame that is all one value means the link is echoing, not sensing.
        assert!(max > min, "spectrum is flat — no signal reached the host");

        // Polarity evidence, in-frame: pixels 16-28 are masked on this sensor,
        // so they see no light whatever the scene. After inversion they are the
        // dark baseline and anything illuminated should sit above them. Printed
        // rather than asserted, because with the lamp off there is nothing to
        // rise above and that is not a failure.
        let masked = frame.ys[16..=28].iter().sum::<f32>() / 13.0;
        let lit = frame.ys[32..3680].iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        println!("       masked (dark) {masked:8.0}   brightest {lit:8.0}   signal {:+.0}", lit - masked);
    }

    let after = drv.device_metadata().unwrap();
    println!("  last seq {}, dropped {}", after.last_seq, after.dropped_frames);
    assert!(after.last_capture_ms > 0);

    drv.disconnect();
}

#[test]
#[ignore = "requires a TCD1304 attached to a real serial port"]
fn real_hardware_is_found_by_probing() {
    // No JASPER_PORT, no VID/PID: enumerate the machine's serial ports, open
    // each, and keep whatever answers the handshake as a TCD1304.
    let found = jasper_lib::instrument::tcd1304::discover(None);
    for d in &found {
        println!("  {} — {} serial {} firmware {}", d.id, d.model, d.serial, d.firmware);
    }
    assert!(!found.is_empty(), "no TCD1304 found on any serial port");
    let d = &found[0];
    assert_eq!(d.model, "TCD1304");
    assert_eq!(d.status, "available", "not connected yet, just seen");
    assert_eq!(d.serial.len(), 16);
    assert!(d.name.starts_with("TCD1304 · "), "friendly name was {:?}", d.name);
}
