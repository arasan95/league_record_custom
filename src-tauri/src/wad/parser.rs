use byteorder::{LittleEndian, ReadBytesExt};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::Path;

const WAD_ENTRY_SIZE: u64 = 32;
const MAX_WAD_ENTRIES: u32 = 1_000_000;
const MAX_COMPRESSED_ENTRY_SIZE: u32 = 128 * 1024 * 1024; // 128 MiB safety cap

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WadEntry {
    pub path_hash: u64,
    pub offset: u32,
    pub comp_size: u32,
    pub uncomp_size: u32,
    pub comp_type: u8,
}

pub fn parse_wad_entries(wad_path: &Path) -> Result<Vec<WadEntry>, anyhow::Error> {
    let mut f = File::open(wad_path)?;
    let file_len = f.metadata()?.len();

    let mut magic = [0u8; 2];
    f.read_exact(&mut magic)?;
    let magic_str = String::from_utf8_lossy(&magic);
    if magic_str != "RW" {
        return Err(anyhow::anyhow!("Invalid WAD magic: {}", magic_str));
    }

    let major = f.read_u8()?;
    let minor = f.read_u8()?;

    if major != 2 && major != 3 {
        return Err(anyhow::anyhow!("Unsupported WAD version: {}.{}", major, minor));
    }

    if major == 2 {
        f.seek(SeekFrom::Current(84))?;
    } else if major == 3 {
        f.seek(SeekFrom::Current(256))?;
    }

    let _checksum = f.read_u64::<LittleEndian>()?;
    let entry_count_raw = f.read_u32::<LittleEndian>()?;

    if entry_count_raw > MAX_WAD_ENTRIES {
        return Err(anyhow::anyhow!(
            "Suspicious WAD entry count: {} (>{})",
            entry_count_raw,
            MAX_WAD_ENTRIES
        ));
    }

    let current_pos = f.stream_position()?;
    if current_pos > file_len {
        return Err(anyhow::anyhow!(
            "WAD parser out of bounds: header pos {} > file size {}",
            current_pos,
            file_len
        ));
    }
    let remaining = file_len - current_pos;
    let max_entries_from_file = (remaining / WAD_ENTRY_SIZE) as u32;
    let entry_count = entry_count_raw.min(max_entries_from_file);

    let mut entries = Vec::with_capacity(entry_count as usize);
    for _ in 0..entry_count {
        let mut buf = [0u8; 32];
        let bytes_read = f.read(&mut buf)?;
        if bytes_read < 32 {
            break;
        }

        let mut c = Cursor::new(buf);
        let path_hash = c.read_u64::<LittleEndian>()?;
        let offset = c.read_u32::<LittleEndian>()?;
        let comp_size = c.read_u32::<LittleEndian>()?;
        let uncomp_size = c.read_u32::<LittleEndian>()?;
        let comp_type = c.read_u8()?;
        let _is_duplicate = c.read_u8()?;
        let _padding = c.read_u16::<LittleEndian>()?;
        let _file_sha = c.read_u64::<LittleEndian>()?;

        entries.push(WadEntry {
            path_hash,
            offset,
            comp_size,
            uncomp_size,
            comp_type,
        });
    }

    Ok(entries)
}

pub fn extract_file_from_wad(wad_path: &Path, entry: &WadEntry) -> Result<Vec<u8>, anyhow::Error> {
    let mut f = File::open(wad_path)?;
    let file_len = f.metadata()?.len();
    let start = entry.offset as u64;
    let comp_size = entry.comp_size as u64;

    if entry.comp_size > MAX_COMPRESSED_ENTRY_SIZE {
        return Err(anyhow::anyhow!(
            "Compressed entry too large: {} bytes (cap {})",
            entry.comp_size,
            MAX_COMPRESSED_ENTRY_SIZE
        ));
    }
    if start > file_len {
        return Err(anyhow::anyhow!(
            "Entry offset out of bounds: {} > file size {}",
            start,
            file_len
        ));
    }
    let end = start
        .checked_add(comp_size)
        .ok_or_else(|| anyhow::anyhow!("Entry offset overflow"))?;
    if end > file_len {
        return Err(anyhow::anyhow!(
            "Entry range out of bounds: {}..{} (file size {})",
            start,
            end,
            file_len
        ));
    }

    f.seek(SeekFrom::Start(entry.offset as u64))?;

    let mut comp_buf = vec![0u8; entry.comp_size as usize];
    f.read_exact(&mut comp_buf)?;

    match entry.comp_type {
        0 => Ok(comp_buf),
        2 | 3 | 36 => {
            // Zstd
            let uncomp_buf = zstd::stream::decode_all(Cursor::new(comp_buf))?;
            Ok(uncomp_buf)
        }
        _ => Err(anyhow::anyhow!("Unknown compression type: {}", entry.comp_type)),
    }
}
