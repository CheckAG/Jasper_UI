// Frame codec for TCD1304 protocol v1.
//
// Every reply the device sends — spectrum, IDN, ACK, ERR, metadata — uses one
// envelope. All multi-byte fields are little-endian. There is no STX/ETX:
// framing is magic + length + CRC, so the reader is content-addressed rather
// than position-based. See TCD1304_Timer_ADC/PROTOCOL.md §"Frame format".
//
//   offset  size  field
//        0     2  magic 'T','C'
//        2     1  version (0x01)
//        3     1  type
//        4     2  seq          completed CCD frames, free-running, wraps
//        6     2  payload_len
//        8     4  integ_ms     integration time in force for this frame
//       12     2  status       bit 0 = DROPPED, rest reserved
//       14     2  reserved
//       16     N  payload
//     16+N     2  CRC-16/CCITT-FALSE over bytes [0 .. 16+N)

pub const MAGIC: [u8; 2] = *b"TC";
pub const VERSION: u8 = 0x01;
pub const HDR_LEN: usize = 16;
pub const CRC_LEN: usize = 2;

/// Pixels in a spectrum, and therefore the largest payload any frame can carry.
/// Non-spectrum payloads are capped at 256 bytes by the firmware's reply buffer.
pub const PIXELS: usize = 3694;
pub const MAX_PAYLOAD: usize = PIXELS * 2; // 7388

/// A requested frame missed its USB write slot and was retried on the following
/// frame. The spectrum is valid — it is one integration period later than asked
/// for. Mask this bit specifically: bits 4-6 are earmarked for a future device
/// state machine, so `status != 0` would break against newer firmware.
pub const STATUS_DROPPED: u16 = 1 << 0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameType {
    Spectrum = 0x01,
    Idn      = 0x02,
    Ack      = 0x03,
    Err      = 0x04,
    Metadata = 0x05,
}

impl FrameType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0x01 => Some(Self::Spectrum),
            0x02 => Some(Self::Idn),
            0x03 => Some(Self::Ack),
            0x04 => Some(Self::Err),
            0x05 => Some(Self::Metadata),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Frame {
    pub kind:     FrameType,
    pub seq:      u16,
    pub integ_ms: u32,
    pub status:   u16,
    pub payload:  Vec<u8>,
}

impl Frame {
    /// Payload as ASCII, for IDN / ACK / ERR / METADATA. Invalid bytes are
    /// replaced rather than rejected — a garbled reason string is still worth
    /// showing, and the CRC has already vouched for the bytes.
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.payload).into_owned()
    }

    pub fn dropped(&self) -> bool {
        self.status & STATUS_DROPPED != 0
    }

    /// Spectrum samples. Signed on purpose: the ADC is single-ended and rolls
    /// past 0x7FFF on saturated pixels, so reading them signed makes saturation
    /// a visible negative excursion instead of a plausible large positive value.
    /// Do not "fix" this to unsigned.
    pub fn samples(&self) -> Result<Vec<i16>, FrameError> {
        if self.kind != FrameType::Spectrum {
            return Err(FrameError::WrongType(self.kind));
        }
        if self.payload.len() % 2 != 0 {
            return Err(FrameError::OddSpectrumLen(self.payload.len()));
        }
        Ok(self
            .payload
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]))
            .collect())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameError {
    WrongType(FrameType),
    OddSpectrumLen(usize),
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WrongType(t) => write!(f, "expected a SPECTRUM frame, got {t:?}"),
            Self::OddSpectrumLen(n) => write!(f, "spectrum payload of {n} bytes is not a whole number of samples"),
        }
    }
}

impl std::error::Error for FrameError {}

/// CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final XOR.
/// Carried over unchanged from the previous driver.
pub fn crc16_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &b in data {
        crc ^= (b as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 { (crc << 1) ^ 0x1021 } else { crc << 1 };
        }
    }
    crc
}

/// Encode a frame exactly as the firmware does. Only the simulator and the
/// tests need this; the device never receives a framed message.
pub fn build(kind: FrameType, payload: &[u8], seq: u16, integ_ms: u32, status: u16) -> Vec<u8> {
    let mut out = Vec::with_capacity(HDR_LEN + payload.len() + CRC_LEN);
    out.extend_from_slice(&MAGIC);
    out.push(VERSION);
    out.push(kind as u8);
    out.extend_from_slice(&seq.to_le_bytes());
    out.extend_from_slice(&(payload.len() as u16).to_le_bytes());
    out.extend_from_slice(&integ_ms.to_le_bytes());
    out.extend_from_slice(&status.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // reserved
    out.extend_from_slice(payload);
    let crc = crc16_ccitt(&out);
    out.extend_from_slice(&crc.to_le_bytes());
    out
}

/// Pull the first valid frame out of `buf`, consuming the bytes it used.
///
/// Returns `None` when more bytes are needed. Anything that fails validation
/// costs exactly one byte, so a corrupt or truncated frame is a one-frame
/// hiccup rather than a permanent desync — the bytes of a spectrum contain
/// 'T','C' pairs often enough that this matters in practice.
pub fn parse(buf: &mut Vec<u8>) -> Option<Frame> {
    loop {
        let Some(start) = find_magic(buf) else {
            // A lone trailing 'T' may be the first half of the next magic.
            let keep = usize::from(buf.last() == Some(&MAGIC[0]));
            buf.drain(..buf.len() - keep);
            return None;
        };
        buf.drain(..start);

        if buf.len() < HDR_LEN {
            return None;
        }

        let version = buf[2];
        let kind = FrameType::from_u8(buf[3]);
        let payload_len = u16::from_le_bytes([buf[6], buf[7]]) as usize;

        // Validate before trusting payload_len — a false 'TC' inside spectrum
        // data would otherwise make us wait for bytes that are never coming.
        let Some(kind) = kind.filter(|_| version == VERSION && payload_len <= MAX_PAYLOAD) else {
            buf.drain(..1);
            continue;
        };

        let total = HDR_LEN + payload_len + CRC_LEN;
        if buf.len() < total {
            return None;
        }

        let want = u16::from_le_bytes([buf[HDR_LEN + payload_len], buf[HDR_LEN + payload_len + 1]]);
        if crc16_ccitt(&buf[..HDR_LEN + payload_len]) != want {
            buf.drain(..1);
            continue;
        }

        let frame = Frame {
            kind,
            seq:      u16::from_le_bytes([buf[4], buf[5]]),
            integ_ms: u32::from_le_bytes([buf[8], buf[9], buf[10], buf[11]]),
            status:   u16::from_le_bytes([buf[12], buf[13]]),
            payload:  buf[HDR_LEN..HDR_LEN + payload_len].to_vec(),
        };
        buf.drain(..total);
        return Some(frame);
    }
}

fn find_magic(buf: &[u8]) -> Option<usize> {
    buf.windows(2).position(|w| w == MAGIC)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spectrum(seq: u16, status: u16) -> Vec<u8> {
        let payload: Vec<u8> = (0..PIXELS)
            .flat_map(|i| (i as i16).to_le_bytes())
            .collect();
        build(FrameType::Spectrum, &payload, seq, 25, status)
    }

    #[test]
    fn crc_matches_the_ccitt_false_check_value() {
        assert_eq!(crc16_ccitt(b"123456789"), 0x29B1);
    }

    #[test]
    fn spectrum_frame_round_trips() {
        let mut buf = spectrum(7, 0);
        assert_eq!(buf.len(), HDR_LEN + MAX_PAYLOAD + CRC_LEN); // 7406
        let f = parse(&mut buf).expect("frame");
        assert!(buf.is_empty(), "the whole frame should be consumed");
        assert_eq!(f.kind, FrameType::Spectrum);
        assert_eq!(f.seq, 7);
        assert_eq!(f.integ_ms, 25);
        assert!(!f.dropped());
        let s = f.samples().unwrap();
        assert_eq!(s.len(), PIXELS);
        assert_eq!(s[0], 0);
        assert_eq!(s[3693], 3693);
    }

    #[test]
    fn samples_are_signed_so_saturation_reads_negative() {
        let payload = 0x8000u16.to_le_bytes().to_vec(); // one saturated pixel
        let mut buf = build(FrameType::Spectrum, &payload, 0, 8, 0);
        let f = parse(&mut buf).unwrap();
        assert_eq!(f.samples().unwrap(), vec![i16::MIN]);
    }

    #[test]
    fn ascii_frames_decode() {
        let idn = b"Jasper,TCD1304,0011223344556677,0.1";
        let mut buf = build(FrameType::Idn, idn, 0, 8, 0);
        let f = parse(&mut buf).unwrap();
        assert_eq!(f.kind, FrameType::Idn);
        assert_eq!(f.text(), "Jasper,TCD1304,0011223344556677,0.1");
    }

    #[test]
    fn dropped_status_bit_is_reported_and_other_bits_ignored() {
        // Bits 4-6 are reserved for a future state machine; only bit 0 means dropped.
        let mut buf = spectrum(9, STATUS_DROPPED | 0b0100_0000);
        assert!(parse(&mut buf).unwrap().dropped());
        let mut buf = spectrum(9, 0b0100_0000);
        assert!(!parse(&mut buf).unwrap().dropped());
    }

    #[test]
    fn leading_garbage_containing_a_false_magic_is_skipped() {
        // 'TC' with a bad version, then 'TC' with a plausible header whose CRC
        // fails — both must cost one byte each, not desync the reader.
        let mut buf = b"noise\x54\x43\x09\x01ABCDEFGHIJKL\x54\x43\x01\x01".to_vec();
        buf.extend_from_slice(&[0; 12]);
        let good = spectrum(3, 0);
        buf.extend_from_slice(&good);
        let f = parse(&mut buf).expect("the real frame survives");
        assert_eq!(f.seq, 3);
        assert_eq!(f.samples().unwrap().len(), PIXELS);
    }

    #[test]
    fn a_false_magic_inside_spectrum_data_does_not_break_the_next_frame() {
        // 0x4354 little-endian is the bytes 'T','C' — a real sample value.
        let payload: Vec<u8> = std::iter::repeat(0x4354u16.to_le_bytes())
            .take(PIXELS)
            .flatten()
            .collect();
        let mut buf = build(FrameType::Spectrum, &payload, 1, 8, 0);
        buf.extend_from_slice(&spectrum(2, 0));

        let first = parse(&mut buf).unwrap();
        assert_eq!(first.seq, 1);
        assert_eq!(first.samples().unwrap()[0], 0x4354);
        let second = parse(&mut buf).unwrap();
        assert_eq!(second.seq, 2);
        assert!(buf.is_empty());
    }

    #[test]
    fn partial_frame_waits_for_more_bytes_without_consuming_it() {
        let full = spectrum(4, 0);
        let mut buf = full[..full.len() - 1].to_vec(); // one byte short
        assert!(parse(&mut buf).is_none());
        assert_eq!(buf.len(), full.len() - 1, "an incomplete frame must be kept intact");
        buf.push(*full.last().unwrap());
        assert_eq!(parse(&mut buf).unwrap().seq, 4);
    }

    #[test]
    fn truncated_frame_costs_one_frame_not_the_stream() {
        // A frame missing its last byte, followed by a whole one: the reader
        // must find the second rather than stalling forever on the first.
        let broken = spectrum(5, 0);
        let mut buf = broken[..broken.len() - 1].to_vec();
        buf.extend_from_slice(&spectrum(6, 0));
        assert_eq!(parse(&mut buf).unwrap().seq, 6);
    }

    #[test]
    fn magic_split_across_two_reads_is_not_lost() {
        let full = spectrum(8, 0);
        let mut buf = b"junk\x54".to_vec(); // trailing 'T' is half a magic
        assert!(parse(&mut buf).is_none());
        assert_eq!(buf, b"\x54", "the trailing T must be kept");
        buf.extend_from_slice(&full[1..]);
        assert_eq!(parse(&mut buf).unwrap().seq, 8);
    }

    #[test]
    fn buffer_with_no_magic_is_drained() {
        let mut buf = b"nothing here at all".to_vec();
        assert!(parse(&mut buf).is_none());
        assert!(buf.is_empty());
    }

    #[test]
    fn oversized_payload_len_is_rejected_rather_than_awaited() {
        let mut buf = build(FrameType::Spectrum, &[0; 4], 0, 8, 0);
        buf[6..8].copy_from_slice(&((MAX_PAYLOAD + 1) as u16).to_le_bytes());
        buf.extend_from_slice(&spectrum(11, 0));
        assert_eq!(parse(&mut buf).unwrap().seq, 11);
    }

    #[test]
    fn unknown_version_and_type_are_rejected() {
        let mut bad_version = build(FrameType::Ack, b"I25", 0, 8, 0);
        bad_version[2] = 0x02;
        let mut buf = bad_version;
        buf.extend_from_slice(&spectrum(12, 0));
        assert_eq!(parse(&mut buf).unwrap().seq, 12);

        let mut bad_type = build(FrameType::Ack, b"I25", 0, 8, 0);
        bad_type[3] = 0x42;
        let mut buf = bad_type;
        buf.extend_from_slice(&spectrum(13, 0));
        assert_eq!(parse(&mut buf).unwrap().seq, 13);
    }

    #[test]
    fn samples_refuses_non_spectrum_frames() {
        let mut buf = build(FrameType::Err, b"unknown command", 0, 8, 0);
        let f = parse(&mut buf).unwrap();
        assert_eq!(f.samples(), Err(FrameError::WrongType(FrameType::Err)));
    }
}
