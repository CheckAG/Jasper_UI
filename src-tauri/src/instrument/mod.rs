//! Every sensor JASPER can drive, and the only place that names one.
//!
//! Everything above this module works through `SpectrumDriver` and the limits
//! a device reports in `DeviceMetadata` (pixels, integration range, full
//! scale), so nothing else assumes a TCD1304. Adding a sensor:
//!   1. a module implementing `SpectrumDriver` (see driver.rs for what each
//!      method and field must carry: `SpectrumFrame.peak`, metadata limits);
//!   2. its constructor in `DRIVERS` and its probe in `discover`.

pub mod driver;
pub mod process;
pub mod tcd1304;

use driver::{DeviceInfo, SpectrumDriver};

type Driver = Box<dyn SpectrumDriver + Send>;

/// Constructors for each supported sensor, tried in order on connect.
const DRIVERS: &[fn(&str) -> Driver] = &[
    |port| Box::new(tcd1304::Tcd1304Driver::new(port.to_string())),
];

/// Instruments found by probing ports, skipping the one already connected.
pub fn discover(skip: Option<&str>) -> Vec<DeviceInfo> {
    tcd1304::discover(skip)
}

/// Open whatever answers on `port`: each driver's handshake in turn, the first
/// that succeeds wins.
pub fn connect(port: &str) -> Result<Driver, String> {
    let mut errors = vec![];
    for make in DRIVERS {
        let mut d = make(port);
        match d.connect(port) {
            Ok(()) => return Ok(d),
            Err(e) => errors.push(e),
        }
    }
    Err(errors.join("; "))
}

/// A driver with no device: lists nothing, reports not connected, refuses
/// every operation. What the app holds until something connects.
pub fn disconnected() -> Driver {
    DRIVERS[0]("")
}
