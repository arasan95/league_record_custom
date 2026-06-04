#[path = "../wad/mod.rs"]
mod wad;

use std::fs;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use wad::parser::{extract_file_from_wad, parse_wad_entries, WadEntry};
use wad::updater::get_league_install_dir;
use xxhash_rust::xxh64::xxh64;

fn print_usage() {
    eprintln!(
        "Usage:\n  extract_rcp_asset <asset_path> <out_file>\n\nExamples:\n  extract_rcp_asset plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/266.png out/266.png\n  extract_rcp_asset plugins/rcp-be-lol-game-data/global/default/v1/perk-images/styles/precision/presstheattack/presstheattack.png out/pta.png\n"
    );
}

fn candidate_wads(install_dir: &Path) -> Vec<PathBuf> {
    let plugin_dir = install_dir.join("Plugins/rcp-be-lol-game-data");
    vec![
        plugin_dir.join("default-assets.wad"),
        plugin_dir.join("default-assets2.wad"),
        plugin_dir.join("ja_JP-assets.wad"),
    ]
}

fn find_entry_by_hash(entries: &[WadEntry], target_hash: u64) -> Option<WadEntry> {
    // WADs can contain duplicates; first match is good enough for our use.
    entries.iter().find(|e| e.path_hash == target_hash).cloned()
}

fn normalize_asset_path(s: &str) -> String {
    s.trim().replace('\\', "/").to_lowercase()
}

fn candidate_hashes(asset_path: &str) -> Vec<u64> {
    let normalized = normalize_asset_path(asset_path);
    let no_slash = normalized.trim_start_matches('/').to_string();
    let with_slash = format!("/{}", no_slash);
    let mut forms: Vec<String> = vec![normalized, no_slash, with_slash];
    forms.sort();
    forms.dedup();

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for form in forms {
        let h = xxh64(form.as_bytes(), 0);
        if seen.insert(h) {
            out.push(h);
        }
    }
    out
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        print_usage();
        std::process::exit(2);
    }

    let asset_path = args[1].trim();
    let out_file = PathBuf::from(&args[2]);

    let install_dir = match get_league_install_dir() {
        Some(d) => d,
        None => {
            eprintln!("League of Legends install not found. Set LEAGUE_INSTALL_DIR or install in a standard path.");
            std::process::exit(1);
        }
    };

    let hashes = candidate_hashes(asset_path);
    let wads = candidate_wads(&install_dir);

    let mut found: Option<(PathBuf, WadEntry)> = None;
    for wad_path in &wads {
        if !wad_path.exists() {
            continue;
        }
        let entries = match parse_wad_entries(wad_path) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("Failed to parse WAD {}: {e}", wad_path.display());
                continue;
            }
        };

        for h in &hashes {
            if let Some(entry) = find_entry_by_hash(&entries, *h) {
                found = Some((wad_path.to_path_buf(), entry));
                break;
            }
        }
        if found.is_some() {
            break;
        }
    }

    let Some((wad_path, entry)) = found else {
        eprintln!("Not found in local WADs: {asset_path}");
        eprintln!("Checked:");
        for w in wads {
            eprintln!("  {}", w.display());
        }
        std::process::exit(1);
    };

    let bytes = match extract_file_from_wad(&wad_path, &entry) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("Failed to extract from {}: {e}", wad_path.display());
            std::process::exit(1);
        }
    };

    if let Some(parent) = out_file.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Err(e) = fs::write(&out_file, &bytes) {
        eprintln!("Failed to write {}: {e}", out_file.display());
        std::process::exit(1);
    }

    println!(
        "OK\n  install_dir: {}\n  wad: {}\n  asset_path: {}\n  out: {}\n  bytes: {}",
        install_dir.display(),
        wad_path.display(),
        asset_path,
        out_file.display(),
        bytes.len()
    );
}
