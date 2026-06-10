// SerialDriver vs the specbench PROTOCOL.md simulator.
//
// Spawns tools/protocol-sim/sim.py (pty-based, --fast), connects the real
// SerialDriver to it, and validates the full chain: identity, INFO, GET CAL
// wavelength mapping, settings push, binary block framing + CRC, and the
// Hg-line scene peak position.
//
// Override the simulator path with SPECBENCH_SIM=/path/to/sim.py.
// Skips (passes with a notice) if python3 or sim.py is unavailable.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};

use jasper_lib::instrument::driver::{AcqParams, SpectrumDriver};
use jasper_lib::instrument::process::{average_scans, process, CalFrame, Calibration};
use jasper_lib::instrument::serial::SerialDriver;

struct KillOnDrop(Child);
impl Drop for KillOnDrop {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn sim_path() -> Option<String> {
    let sim = std::env::var("SPECBENCH_SIM").unwrap_or_else(|_| {
        format!(
            "{}/../../claude_hw_design/tools/protocol-sim/sim.py",
            env!("CARGO_MANIFEST_DIR")
        )
    });
    if std::path::Path::new(&sim).exists() {
        Some(sim)
    } else {
        eprintln!("SKIP: simulator not found at {sim} (set SPECBENCH_SIM)");
        None
    }
}

/// Spawn sim.py with the given scene; returns the process guard + pty path.
fn spawn_sim(sim: &str, scene: &str) -> Option<(KillOnDrop, String)> {
    let mut child = match Command::new("python3")
        .args([sim, "--fast", "--scene", scene])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => KillOnDrop(c),
        Err(e) => {
            eprintln!("SKIP: cannot spawn python3: {e}");
            return None;
        }
    };
    let pty = {
        let stdout = child.0.stdout.take().expect("sim stdout");
        let mut line = String::new();
        BufReader::new(stdout).read_line(&mut line).expect("read pty path");
        line.trim().to_string()
    };
    assert!(pty.starts_with("/dev/"), "unexpected pty path: {pty}");
    Some((child, pty))
}

#[test]
fn serial_driver_against_simulator() {
    let Some(sim) = sim_path() else { return };
    let Some((_child, pty)) = spawn_sim(&sim, "hg") else { return };

    let mut drv = SerialDriver::new(pty.clone());

    // Before connect: listed but disconnected
    let list = drv.device_list();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].status, "disconnected");

    drv.connect(&pty).expect("connect");
    let list = drv.device_list();
    assert_eq!(list[0].status, "connected");
    assert!(list[0].model.contains("S15739-1024"), "model: {}", list[0].model);

    // Scan through the trait, exactly as the streaming thread does
    let params = AcqParams { integration: 10, averaging: 4, ..AcqParams::default() };
    let frame = drv.scan(&params).expect("scan");

    assert_eq!(frame.ys.len(), 1024, "pixel count");
    assert_eq!(frame.xs.len(), 1024);
    // Default sim cal: λ(p) = 200 + (800/1023)·p → 200..1000 nm
    assert!((frame.xs[0] - 200.0).abs() < 0.5, "xs[0] = {}", frame.xs[0]);
    assert!((frame.xs[1023] - 1000.0).abs() < 0.5, "xs[1023] = {}", frame.xs[1023]);

    // Hg scene: global peak at the 435.8 nm line
    let (pmax, &ymax) = frame
        .ys
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
        .unwrap();
    let lambda = frame.xs[pmax];
    assert!((lambda - 435.8).abs() < 5.0, "peak at {lambda} nm, expected ~435.8");
    assert!(ymax > 1000.0, "peak suspiciously low: {ymax}");
    assert!(ymax <= 65535.0);

    // Second scan: settings already pushed (exercises the lazy-push branch)
    let frame2 = drv.scan(&params).expect("second scan");
    assert_ne!(frame.ys, frame2.ys, "frames identical — no noise?");

    // Calibration round-trip via the trait
    let xcal = drv.calibrate_xcal().expect("xcal");
    assert_eq!(xcal.coefficients.len(), 6);
    assert!((xcal.coefficients[0] - 200.0).abs() < 0.5);

    let dark = drv.calibrate_dark(&params).expect("dark");
    assert_eq!(dark.status, "ok");

    drv.telemetry().expect("telemetry");
    drv.disconnect();
    assert_eq!(drv.device_list()[0].status, "disconnected");

    // Lazy auto-connect: the GUI streams without an explicit connect first
    let frame3 = drv.scan(&params).expect("scan after disconnect (lazy connect)");
    assert_eq!(frame3.ys.len(), 1024);
    assert_eq!(drv.device_list()[0].status, "connected");
}

/// Gap-4 pipeline on realistic data: dark frame from the `dark` scene,
/// reference from `broadband`, sample from `hg`, then counts → absorbance.
#[test]
fn dark_reference_absorbance_pipeline() {
    let Some(sim) = sim_path() else { return };
    let params = AcqParams { integration: 10, averaging: 4, ..AcqParams::default() };

    // Each scene is a fresh sim instance — like changing the light physically
    let capture = |scene: &str| {
        let (child, pty) = spawn_sim(&sim, scene).expect("spawn sim");
        let drv = SerialDriver::new(pty);
        let avg = average_scans(&drv, &params, 4).expect("average scans");
        drop(child);
        avg
    };

    let dark = capture("dark");
    let reference = capture("broadband");
    let sample = capture("hg");

    // Dark scene: baseline ~600 counts, flat
    let dmean = dark.ys.iter().sum::<f32>() / dark.ys.len() as f32;
    assert!((dmean - 600.0).abs() < 50.0, "dark mean {dmean}");

    let cal = Calibration {
        dark:      Some(CalFrame { ys: dark.ys, integration_ms: params.integration }),
        reference: Some(CalFrame { ys: reference.ys, integration_ms: params.integration }),
    };
    let out = process(sample, &cal);
    assert_eq!(out.units, "abs");

    // hg scene = 0.25 × broadband continuum + emission lines, so away from
    // the lines A ≈ −log10(0.25) ≈ 0.602
    let i700 = out.xs.iter().position(|&x| x >= 700.0).unwrap();
    assert!(
        (out.ys[i700] - 0.602).abs() < 0.1,
        "A(700 nm) = {}, expected ~0.602",
        out.ys[i700]
    );
    // At the 435.8 nm emission line the sample is brighter → lower absorbance
    let i436 = out.xs.iter().position(|&x| x >= 435.8).unwrap();
    assert!(
        out.ys[i436] < out.ys[i700] - 0.3,
        "A(436) = {} not clearly below A(700) = {}",
        out.ys[i436],
        out.ys[i700]
    );
}
