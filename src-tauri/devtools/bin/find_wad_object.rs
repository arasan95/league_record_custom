#[path = "../wad/mod.rs"]
#[allow(dead_code)]
mod wad;

use wad::bin::{parse_prop, BinValue};
use wad::parser::{extract_file_from_wad, parse_wad_entries};
use wad::updater::{get_league_install_dir, load_hash_db};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let champ = if args.len() > 1 { &args[1] } else { "Braum" };
    let target = if args.len() > 2 { &args[2] } else { "{476ec0b8}" };

    let install_dir = match get_league_install_dir() {
        Some(d) => d,
        None => {
            println!("No League install dir found.");
            return;
        }
    };
    let wad_path = install_dir.join(format!("Game/DATA/FINAL/Champions/{}.wad.client", champ));
    if !wad_path.exists() {
        println!("WAD not found: {:?}", wad_path);
        return;
    }

    let db = load_hash_db();
    let entries = parse_wad_entries(&wad_path).expect("Failed to parse WAD");

    let mut found = false;
    for entry in entries {
        if entry.comp_size == 0 {
            continue;
        }
        if !(entry.comp_type == 0 || entry.comp_type == 2 || entry.comp_type == 3 || entry.comp_type == 36) {
            continue;
        }
        if let Ok(data) = extract_file_from_wad(&wad_path, &entry) {
            if data.len() < 4 || (&data[0..4] != b"PROP" && &data[0..4] != b"PTCH") {
                continue;
            }
            if let Ok(parsed) = parse_prop(&data, &db) {
                if let Some(val) = parsed.get(target) {
                    found = true;
                    println!("FOUND in entry path hash: {}", entry.path_hash);
                    match val {
                        BinValue::Struct(s) | BinValue::Embedded(s) => {
                            let mut keys: Vec<_> = s.keys().collect();
                            keys.sort();
                            println!("keys: {:?}", keys);
                            for (k, v) in s {
                                if k == "__type" {
                                    println!("type: {:?}", v);
                                }
                            }
                        }
                        _ => println!("value: {:?}", val),
                    }
                }
            }
        }
    }

    if !found {
        println!("Not found: {}", target);
    }
}
