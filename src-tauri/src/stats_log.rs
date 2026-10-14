//! Voice diagnostics log: one CSV line per stats event while in a room.
//!
//! Lets a tester send the file after a call that sounded bad. Holds only counters and timings;
//! no audio, tokens or participant names. Size-bounded: rotated to `.1.csv` above [`MAX_BYTES`].

use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::voice::VoiceStatsDto;

const FILE_NAME: &str = "voice-stats.csv";
const MAX_BYTES: u64 = 5 * 1024 * 1024;
const HEADER: &str = "unix_ms,channel_id,round_trip_ms,inbound_packets_received,inbound_packets_lost,\
inbound_jitter_ms,inbound_concealed_ms,outbound_packets_lost,playout_buffered_ms,playout_underruns,\
playout_skipped_ms,capture_overflow_ms,remote_frames_dropped,microphone_frames_dropped";

pub struct StatsLog {
    path: PathBuf,
    writer: Option<BufWriter<File>>,
}

impl StatsLog {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            path: directory.join(FILE_NAME),
            writer: None,
        }
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    /// Appends one line; logging failures never affect the call.
    pub fn write(&mut self, channel_id: Option<&str>, stats: &VoiceStatsDto) {
        if self.writer.is_none() {
            self.writer = self.open();
        }
        let Some(writer) = self.writer.as_mut() else {
            return;
        };
        let unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        let opt = |v: Option<u32>| v.map(|v| v.to_string()).unwrap_or_default();
        let line = format!(
            "{unix_ms},{},{},{},{},{},{},{},{},{},{},{},{},{}\n",
            channel_id.unwrap_or(""),
            opt(stats.round_trip_ms),
            stats.inbound_packets_received,
            stats.inbound_packets_lost,
            opt(stats.inbound_jitter_ms),
            stats.inbound_concealed_ms,
            stats.outbound_packets_lost,
            stats.playout_buffered_ms,
            stats.playout_underruns,
            stats.playout_skipped_ms,
            stats.capture_overflow_ms,
            stats.remote_frames_dropped,
            stats.microphone_frames_dropped,
        );
        if writer
            .write_all(line.as_bytes())
            .and_then(|()| writer.flush())
            .is_err()
        {
            self.writer = None;
        }
    }

    fn open(&self) -> Option<BufWriter<File>> {
        let directory = self.path.parent()?;
        fs::create_dir_all(directory).ok()?;
        if fs::metadata(&self.path).is_ok_and(|m| m.len() > MAX_BYTES) {
            let _ = fs::rename(&self.path, self.path.with_extension("1.csv"));
        }
        let is_new = !self.path.exists();
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .ok()?;
        let mut writer = BufWriter::new(file);
        if is_new {
            writeln!(writer, "{HEADER}").ok()?;
        }
        Some(writer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_header_once_then_lines() {
        let directory =
            std::env::temp_dir().join(format!("ovrilo-stats-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        let stats = VoiceStatsDto {
            round_trip_ms: Some(42),
            inbound_concealed_ms: 7,
            ..Default::default()
        };

        let mut log = StatsLog::new(directory.clone());
        log.write(Some("c1"), &stats);
        drop(log);
        let mut log = StatsLog::new(directory.clone());
        log.write(None, &stats);

        let text = fs::read_to_string(directory.join(FILE_NAME)).unwrap();
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines.len(), 3, "{text}");
        assert_eq!(lines[0], HEADER);
        assert_eq!(HEADER.split(',').count(), lines[1].split(',').count());
        assert!(lines[1].contains(",c1,42,"), "{}", lines[1]);
        assert!(lines[2].contains(",,42,"), "{}", lines[2]);
        let _ = fs::remove_dir_all(&directory);
    }
}
