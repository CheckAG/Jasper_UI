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

    // The 'lines' scene puts emission peaks well above the baseline.
    let peak = *samples.iter().max().unwrap();
    let floor = *samples.iter().min().unwrap();
    assert!(peak > 3000, "expected emission lines, peak was {peak}");
    assert!(floor > 0, "the lines scene should not saturate; min was {floor}");

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
