#[path = "../wad/mod.rs"]
mod wad;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use wad::parser::{extract_file_from_wad, parse_wad_entries};
use wad::updater::get_league_install_dir;

fn load_hash_map(root: &Path) -> HashMap<u64, String> {
    let mut out = HashMap::new();
    let candidates = [
        root.join(".vscode/wad_japan/ritobin_release/bin/Data/hashes/lol/hashes.game.txt.0"),
        root.join(".vscode/wad_japan/ritobin_release/bin/Data/hashes/lol/hashes.game.txt.1"),
        root.join(".vscode/wad_japan/ritobin_release/bin/hashescopy/lol/hashes.game.txt.0"),
    ];

    for p in candidates {
        if !p.exists() {
            continue;
        }
        if let Ok(text) = fs::read_to_string(&p) {
            for line in text.lines() {
                let mut parts = line.splitn(2, ' ');
                let h = parts.next().unwrap_or_default().trim();
                let path = parts.next().unwrap_or_default().trim();
                if h.len() != 16 || path.is_empty() {
                    continue;
                }
                if let Ok(v) = u64::from_str_radix(h, 16) {
                    out.insert(v, path.to_string());
                }
            }
        }
    }
    out
}

fn detect_ext(buf: &[u8], fallback: &str) -> &'static str {
    if buf.len() >= 4 && &buf[0..4] == b"DDS " {
        "dds"
    } else if buf.len() >= 4 && &buf[0..4] == b"\x89PNG" {
        "png"
    } else if buf.len() >= 4 && (&buf[0..4] == b"TEX\0" || &buf[0..4] == b"TEX1" || &buf[0..4] == b"TEX2") {
        "tex"
    } else if fallback.ends_with(".dds") {
        "dds"
    } else if fallback.ends_with(".png") {
        "png"
    } else if fallback.ends_with(".tex") {
        "tex"
    } else {
        "bin"
    }
}

fn main() {
    let cwd = std::env::current_dir().expect("cwd");
    let root = cwd
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| cwd.clone());

    let install_dir = get_league_install_dir().unwrap_or_else(|| PathBuf::from("C:/Riot Games/League of Legends"));
    let wad_path = install_dir.join("Game/DATA/FINAL/Champions/Shyvana.wad.client");
    if !wad_path.exists() {
        eprintln!("WAD not found: {:?}", wad_path);
        std::process::exit(1);
    }

    let entries = parse_wad_entries(&wad_path).expect("parse_wad_entries failed");
    let hash_map = load_hash_map(&root);
    println!("entries={}, resolved_paths={}", entries.len(), hash_map.len());

    let mut candidates: Vec<(u64, String, usize)> = Vec::new();
    for e in &entries {
        let resolved = hash_map
            .get(&e.path_hash)
            .cloned()
            .unwrap_or_else(|| format!("{{{:016x}}}", e.path_hash));
        let low = resolved.to_lowercase();
        if !low.contains("shyvana") {
            continue;
        }
        if !(low.ends_with(".tex") || low.ends_with(".dds") || low.ends_with(".png") || low.ends_with(".jpg")) {
            continue;
        }
        if !(low.contains("icon")
            || low.contains("square")
            || low.contains("circle")
            || low.contains("hud")
            || low.contains("spell")
            || low.contains("ability"))
        {
            continue;
        }
        candidates.push((e.path_hash, resolved, e.comp_size as usize));
    }

    candidates.sort_by_key(|x| x.2);
    println!("candidate_files={}", candidates.len());
    for (_, p, s) in &candidates {
        println!("  - {} ({} bytes)", p, s);
    }

    let out_dir = root.join("debug/icon_probe/shyvana");
    fs::create_dir_all(&out_dir).expect("create output dir");

    let mut written = 0usize;
    for e in &entries {
        let maybe = candidates.iter().find(|x| x.0 == e.path_hash);
        let Some((hash, resolved, _)) = maybe else { continue };
        if let Ok(data) = extract_file_from_wad(&wad_path, e) {
            let ext = detect_ext(&data, resolved);
            let base = Path::new(resolved)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown");
            let safe = base.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
            let out = out_dir.join(format!("{:016x}_{}.{}", hash, safe, ext));
            if fs::write(&out, &data).is_ok() {
                written += 1;
            }
        }
    }

    println!("written_files={}", written);
    println!("output_dir={}", out_dir.display());
}

