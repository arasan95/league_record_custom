#[path = "../wad/mod.rs"]
#[allow(dead_code)]
mod wad;

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};
use wad::bin::{parse_prop, BinValue};
use wad::parser::{extract_file_from_wad, parse_wad_entries};
use wad::updater::{get_league_install_dir, load_hash_db};

fn get_string_field(map: &std::collections::HashMap<String, BinValue>, key: &str) -> Option<String> {
    map.get(key).and_then(|v| match v {
        BinValue::String(s) | BinValue::Hash(s) | BinValue::Path(s) | BinValue::Link(s) => Some(s.clone()),
        _ => None,
    })
}

fn collect_strings(v: &BinValue, out: &mut Vec<String>) {
    match v {
        BinValue::String(s) | BinValue::Hash(s) | BinValue::Path(s) | BinValue::Link(s) => out.push(s.clone()),
        BinValue::List(list) => {
            for item in list {
                collect_strings(item, out);
            }
        }
        BinValue::Struct(map) | BinValue::Embedded(map) | BinValue::Map(map) => {
            for (k, vv) in map {
                out.push(k.clone());
                collect_strings(vv, out);
            }
        }
        BinValue::Option(Some(inner)) => collect_strings(inner, out),
        _ => {}
    }
}

fn is_tooltip_related_key(key: &str) -> bool {
    let k = key.to_lowercase();
    k.contains("tooltip") || k.contains("loc") || k.contains("description") || k.contains("spell")
}

fn build_out_path(arg_out: Option<&String>) -> PathBuf {
    if let Some(v) = arg_out {
        return PathBuf::from(v);
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    cwd.join("debug").join("wad_aphelios_tooltip_dump.json")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let champion = if args.len() > 1 { args[1].clone() } else { "Aphelios".to_string() };
    let out_path = build_out_path(args.get(2));

    let install_dir = match get_league_install_dir() {
        Some(p) => p,
        None => {
            eprintln!("League install directory not found.");
            std::process::exit(1);
        }
    };

    let wad_path = install_dir.join(format!("Game/DATA/FINAL/Champions/{}.wad.client", champion));
    if !wad_path.exists() {
        eprintln!("WAD not found: {}", wad_path.display());
        std::process::exit(1);
    }

    let hash_db = load_hash_db();
    let entries = match parse_wad_entries(&wad_path) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Failed to parse WAD: {e}");
            std::process::exit(1);
        }
    };

    let mut spell_objects: Vec<Value> = Vec::new();
    let mut character_records: Vec<Value> = Vec::new();
    let mut unique_strings: HashSet<String> = HashSet::new();
    let mut tooltip_like_strings: HashSet<String> = HashSet::new();

    for entry in entries {
        if entry.comp_size == 0 {
            continue;
        }
        if !(entry.comp_type == 0 || entry.comp_type == 2 || entry.comp_type == 3 || entry.comp_type == 36) {
            continue;
        }

        let data = match extract_file_from_wad(&wad_path, &entry) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if data.len() < 4 || (&data[0..4] != b"PROP" && &data[0..4] != b"PTCH") {
            continue;
        }

        let parsed = match parse_prop(&data, &hash_db) {
            Ok(v) => v,
            Err(_) => continue,
        };

        for (obj_key, obj_val) in parsed {
            let obj_map = match &obj_val {
                BinValue::Struct(m) | BinValue::Embedded(m) => m,
                _ => continue,
            };
            let obj_type = get_string_field(obj_map, "__type").unwrap_or_default();
            if obj_type != "SpellObject" && obj_type != "CharacterRecord" {
                continue;
            }

            let object_name = get_string_field(obj_map, "ObjectName").unwrap_or_default();
            let script_name = get_string_field(obj_map, "mScriptName").unwrap_or_default();
            let root_name = get_string_field(obj_map, "mCharacterName").unwrap_or_default();

            let mut strings = Vec::new();
            collect_strings(&obj_val, &mut strings);
            for s in strings {
                if s.trim().is_empty() {
                    continue;
                }
                unique_strings.insert(s.clone());
                let lower = s.to_lowercase();
                if lower.contains("tooltip")
                    || lower.contains("loc")
                    || lower.contains("spell_")
                    || lower.contains("description")
                    || lower.contains("aphelios")
                {
                    tooltip_like_strings.insert(s);
                }
            }

            let mut tooltip_related_top_keys: Vec<String> = obj_map
                .keys()
                .filter(|k| is_tooltip_related_key(k))
                .cloned()
                .collect();
            tooltip_related_top_keys.sort();

            let row = json!({
                "entry_path_hash": format!("{:016x}", entry.path_hash),
                "object_key": obj_key,
                "type": obj_type,
                "object_name": object_name,
                "m_script_name": script_name,
                "m_character_name": root_name,
                "tooltip_related_top_keys": tooltip_related_top_keys,
                "raw": obj_val,
            });

            if row["type"] == "SpellObject" {
                spell_objects.push(row);
            } else {
                character_records.push(row);
            }
        }
    }

    spell_objects.sort_by(|a, b| {
        let asn = a["m_script_name"].as_str().unwrap_or_default();
        let bsn = b["m_script_name"].as_str().unwrap_or_default();
        asn.cmp(bsn)
    });
    character_records.sort_by(|a, b| {
        let akey = a["object_key"].as_str().unwrap_or_default();
        let bkey = b["object_key"].as_str().unwrap_or_default();
        akey.cmp(bkey)
    });

    let mut unique_strings_vec: Vec<String> = unique_strings.into_iter().collect();
    unique_strings_vec.sort();
    let mut tooltip_like_vec: Vec<String> = tooltip_like_strings.into_iter().collect();
    tooltip_like_vec.sort();

    let output = json!({
        "champion": champion,
        "wad_path": wad_path.display().to_string(),
        "spell_object_count": spell_objects.len(),
        "character_record_count": character_records.len(),
        "spell_objects": spell_objects,
        "character_records": character_records,
        "tooltip_like_strings": tooltip_like_vec,
        "all_strings": unique_strings_vec,
    });

    if let Some(parent) = out_path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            eprintln!("Failed to create output directory {}: {e}", parent.display());
            std::process::exit(1);
        }
    }

    let encoded = match serde_json::to_string_pretty(&output) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Failed to encode output JSON: {e}");
            std::process::exit(1);
        }
    };

    if let Err(e) = fs::write(&out_path, encoded) {
        eprintln!("Failed to write {}: {e}", out_path.display());
        std::process::exit(1);
    }

    println!("Wrote {}", out_path.display());
    println!("spell_objects={}", output["spell_object_count"]);
    println!("character_records={}", output["character_record_count"]);
    println!(
        "tooltip_like_strings={}",
        output["tooltip_like_strings"].as_array().map(|v| v.len()).unwrap_or(0)
    );
}
