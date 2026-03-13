use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[path = "../wad/mod.rs"]
mod wad;

fn main() {
    let install_dir = match wad::updater::get_league_install_dir() {
        Some(d) => d,
        None => {
            println!("No League install dir found.");
            return;
        }
    };
    
    let caitlyn_wad = install_dir.join("Game/DATA/FINAL/Champions/Jayce.wad.client");
    if !caitlyn_wad.exists() {
        println!("Jayce.wad.client not found.");
        return;
    }

    println!("Parsing: {:?}", caitlyn_wad);
    
    let mut db = wad::updater::load_hash_db();
    let words = vec!["Character", "mCharacter", "mSpells", "spellNames", "Abilities", "CharacterRecord", "Characters/Jayce/CharacterRecords/Root"];
    for w in words {
        db.insert(wad::hash::fnv1a_32(w), w.to_string());
    }

    let entries = wad::parser::parse_wad_entries(&caitlyn_wad).unwrap();
    let mut count = 0;
    for entry in entries {
        if entry.comp_size > 0 && (entry.comp_type == 0 || entry.comp_type == 2 || entry.comp_type == 3 || entry.comp_type == 36) {
            if let Ok(data) = wad::parser::extract_file_from_wad(&caitlyn_wad, &entry) {
                if data.len() >= 4 && (&data[0..4] == b"PROP" || &data[0..4] == b"PTCH") {
                    if let Ok(parsed) = wad::bin::parse_prop(&data, &db) {
                        for (key, val) in parsed {
                            if key.contains("CharacterRecords/Root") {
                                println!("FOUND JAYCE ROOT: {}", key);
                                if let wad::bin::BinValue::Struct(s) | wad::bin::BinValue::Embedded(s) = val {
                                    for (k, v) in s {
                                        println!(" -> prop: {}", k);
                                        if k == "mCharacter" || k == "Character" || k == "mSpells" || k == "spellNames" {
                                            println!("    VAL: {:?}", v);
                                        }
                                    }
                                }
                            }
                        }

                    }
                }
            }
        }
    }
}
