// Firmware update through the device's USB bootloader.
//
// The wire protocol is defined in docs/firmware-update.md §"Bootloader
// protocol". The bootloader speaks the same envelope as the application —
// ASCII commands in, `TC` frames out — so this reuses `Io` unchanged.
//
// The image is an S-record file, as `build_linux.py --srec` emits. S-records
// carry their own load addresses, so an image linked for the wrong place (a
// build from before the bootloader existed, linked at 0x0) is refused here
// instead of being written over the bootloader.

use std::time::{Duration, Instant};

use super::frame::FrameType;
use super::metadata::Metadata;
use super::{looks_like_a_serial_port, Io, Tcd1304Driver, CMD_TIMEOUT, MODEL};

/// IDN model field the bootloader answers with. Its serial is the same MCU
/// unique ID the application reports, which is how the host finds the same
/// board again after it re-enumerates.
pub const BOOT_MODEL: &str = "TCD1304-BL";

/// Erasing 200 KB of RA2A1 flash takes a few seconds.
const ERASE_TIMEOUT: Duration = Duration::from_secs(15);

/// How long a reset may take to come back as a serial port. Linux and macOS
/// take about a second; Windows can take tens of seconds the first time it sees
/// a USB identity, while it binds the CDC driver.
const REENUMERATE_TIMEOUT: Duration = Duration::from_secs(30);

/// One data record: load address and bytes.
type Record = (u32, Vec<u8>);

/// Parse S-record text into data records. Header, count and start records are
/// skipped; anything malformed is an error, because a silently dropped record
/// is a hole in the flashed image.
pub fn parse_srec(text: &str) -> Result<Vec<Record>, String> {
    let mut records = Vec::new();
    for (n, line) in text.lines().enumerate().map(|(i, l)| (i + 1, l.trim())) {
        if line.is_empty() {
            continue;
        }
        let bad = |why: &str| format!("line {n} of the firmware file: {why}");
        let kind = line.strip_prefix('S').and_then(|r| r.chars().next()).ok_or_else(|| bad("not an S-record"))?;
        let bytes = (2..line.len())
            .step_by(2)
            .map(|i| line.get(i..i + 2).and_then(|h| u8::from_str_radix(h, 16).ok()))
            .collect::<Option<Vec<u8>>>()
            .ok_or_else(|| bad("invalid hex"))?;
        if bytes.is_empty() || bytes[0] as usize != bytes.len() - 1 {
            return Err(bad("length byte does not match the record"));
        }
        let sum = bytes[..bytes.len() - 1].iter().fold(0u8, |a, &b| a.wrapping_add(b));
        if !sum != bytes[bytes.len() - 1] {
            return Err(bad("checksum mismatch — the file is corrupt"));
        }
        let addr_len = match kind {
            '1' => 2,
            '2' => 3,
            '3' => 4,
            '0' | '5' | '6' | '7' | '8' | '9' => continue,
            _ => return Err(bad("unknown record type")),
        };
        let body = &bytes[1..bytes.len() - 1];
        if body.len() < addr_len {
            return Err(bad("record shorter than its address"));
        }
        let addr = body[..addr_len].iter().fold(0u32, |a, &b| (a << 8) | b as u32);
        records.push((addr, body[addr_len..].to_vec()));
    }
    if records.is_empty() {
        return Err("the firmware file contains no data".into());
    }
    Ok(records)
}

/// Lay the records out as one image starting at `base`. Gaps are 0xFF, which
/// is what erased flash reads as.
pub fn flatten(records: &[Record], base: u32, max: u32) -> Result<Vec<u8>, String> {
    let lo = records.iter().map(|r| r.0).min().unwrap_or(base);
    let hi = records.iter().map(|r| r.0 as u64 + r.1.len() as u64).max().unwrap_or(base as u64);
    if lo < base {
        return Err(format!(
            "this image is linked at 0x{lo:X}, below the application area at 0x{base:X} — \
             it was not built for the bootloader and would overwrite it"
        ));
    }
    if hi > base as u64 + max as u64 {
        return Err(format!("image is {} bytes, the application area holds {max}", hi - base as u64));
    }
    let mut image = vec![0xFF; (hi - base as u64) as usize];
    for (addr, data) in records {
        let at = (addr - base) as usize;
        image[at..at + data.len()].copy_from_slice(data);
    }
    Ok(image)
}

/// CRC-32 (IEEE 802.3, as zlib): reflected poly 0xEDB88320, init and final xor 0xFFFFFFFF.
pub fn crc32(data: &[u8]) -> u32 {
    !data.iter().fold(!0u32, |crc, &b| {
        (0..8).fold(crc ^ b as u32, |c, _| if c & 1 != 0 { (c >> 1) ^ 0xEDB8_8320 } else { c >> 1 })
    })
}

/// Send a command and insist the ACK echoes `expect`, so a reply that belongs
/// to some other command can never be read as success.
fn expect_ack(io: &mut Io, cmd: &str, expect: &str, timeout: Duration) -> Result<(), String> {
    let got = io.command(cmd, FrameType::Ack, timeout)?.text();
    if got != expect {
        return Err(format!("bootloader answered {got:?} to {}, expected {expect:?}",
            cmd.get(..12).unwrap_or(cmd)));
    }
    Ok(())
}

/// Wait for the board with `serial` to answer as `model`. After a reset the
/// port may come back under a different name, so every serial port is tried,
/// the old name first.
fn wait_for(first: &str, serial: &str, model: &str) -> Result<(String, Io), String> {
    let deadline = Instant::now() + REENUMERATE_TIMEOUT;
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(300));
        let mut ports = vec![first.to_string()];
        ports.extend(
            serialport::available_ports().unwrap_or_default().into_iter()
                .map(|p| p.port_name)
                .filter(|p| looks_like_a_serial_port(p) && p != first),
        );
        for p in ports {
            if let Ok(io) = Tcd1304Driver::identify(&p) {
                if io.idn.model == model && io.idn.serial == serial {
                    return Ok((p, io));
                }
            }
        }
    }
    Err(format!("board {serial} did not come back as {model} within {}s", REENUMERATE_TIMEOUT.as_secs()))
}

/// Install `srec` on the board at `port_path`, which may be running the
/// application or already sitting in its bootloader (a retry). Returns the
/// port it came back on and the firmware version it now reports.
///
/// `progress(stage, done, total)`; stages are "restart", "erase", "write",
/// "verify", "boot".
///
/// The bootloader is never erased by this, so any failure leaves the board in
/// the bootloader, ready to be retried.
pub fn install(
    port_path: &str,
    srec: &str,
    mut progress: impl FnMut(&str, usize, usize),
) -> Result<(String, String), String> {
    // Parse before touching the device: a bad file must not restart anything.
    let records = parse_srec(srec)?;

    let mut io = Tcd1304Driver::identify(port_path)?;
    let serial = io.idn.serial.clone();
    let mut boot_port = port_path.to_string();
    match io.idn.model.as_str() {
        MODEL => {
            progress("restart", 0, 1);
            expect_ack(&mut io, "U", "U", CMD_TIMEOUT)?;
            drop(io); // release the port so the re-enumerated device can take it
            (boot_port, io) = wait_for(port_path, &serial, BOOT_MODEL)?;
        }
        BOOT_MODEL => {}
        other => return Err(format!("not a {MODEL}: model {other:?}")),
    }

    let meta = Metadata::parse(&io.command("M", FrameType::Metadata, CMD_TIMEOUT)?.text());
    let key = |k: &str| meta.raw.get(k).and_then(|v| v.parse::<u32>().ok())
        .ok_or_else(|| format!("bootloader metadata has no {k}"));
    let (base, max, chunk) = (key("APP_BASE")?, key("APP_MAX")?, key("CHUNK_MAX")?.max(1) as usize);
    let image = flatten(&records, base, max)?;
    let total = image.len();

    progress("erase", 0, total);
    expect_ack(&mut io, &format!("E{total}"), "E", ERASE_TIMEOUT)?;

    for (i, c) in image.chunks(chunk).enumerate() {
        let off = i * chunk;
        let hex: String = c.iter().map(|b| format!("{b:02X}")).collect();
        expect_ack(&mut io, &format!("W{off}:{hex}"), &format!("W{off}"), CMD_TIMEOUT)?;
        progress("write", off + c.len(), total);
    }

    progress("verify", total, total);
    expect_ack(&mut io, &format!("V{total}:{:08X}", crc32(&image)), "V", CMD_TIMEOUT)?;

    progress("boot", total, total);
    expect_ack(&mut io, "B", "B", CMD_TIMEOUT)?;
    drop(io);
    let (port, io) = wait_for(&boot_port, &serial, MODEL)?;
    Ok((port, io.idn.firmware))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a record the way objcopy does: `addr` already sized for `kind`.
    fn rec(kind: char, addr: &[u8], data: &[u8]) -> String {
        let mut b = vec![(addr.len() + data.len() + 1) as u8];
        b.extend_from_slice(addr);
        b.extend_from_slice(data);
        let sum = !b.iter().fold(0u8, |a, &x| a.wrapping_add(x));
        b.push(sum);
        format!("S{kind}{}", b.iter().map(|x| format!("{x:02X}")).collect::<String>())
    }

    fn s3(addr: u32, data: &[u8]) -> String {
        rec('3', &addr.to_be_bytes(), data)
    }

    #[test]
    fn crc32_matches_the_standard_check_value() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn srec_round_trips_and_fills_gaps_with_erased_flash() {
        // Header and start records must be skipped, not treated as data.
        let text = [rec('0', &[0, 0], b"hdr"), s3(0x8000, &[1, 2]), s3(0x8004, &[3]),
            rec('7', &0x8000u32.to_be_bytes(), &[])].join("\n");
        let recs = parse_srec(&text).unwrap();
        assert_eq!(recs.len(), 2);
        assert_eq!(flatten(&recs, 0x8000, 0x1000).unwrap(), vec![1, 2, 0xFF, 0xFF, 3]);
    }

    #[test]
    fn a_corrupt_record_is_refused() {
        let mut line = s3(0x8000, &[1, 2, 3]);
        line.replace_range(14..16, "FF"); // change a data byte, keep the checksum
        assert!(parse_srec(&line).unwrap_err().contains("checksum"));
    }

    #[test]
    fn an_image_linked_over_the_bootloader_is_refused() {
        let recs = parse_srec(&s3(0x0000, &[0; 4])).unwrap();
        assert!(flatten(&recs, 0x8000, 0x1000).unwrap_err().contains("overwrite"));
    }

    #[test]
    fn an_image_larger_than_the_application_area_is_refused() {
        let recs = parse_srec(&s3(0x8000, &[0; 8])).unwrap();
        assert!(flatten(&recs, 0x8000, 4).is_err());
    }
}
