#[path = "../wad/mod.rs"]
mod wad;

use wad::bin::{parse_prop, BinValue};
use wad::parser::{extract_file_from_wad, parse_wad_entries};
use wad::updater::{get_league_install_dir, load_hash_db};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let champ = if args.len() > 1 { &args[1] } else { "Darius" };
    let spell_id_filter = if args.len() > 2 { Some(args[2].as_str()) } else { None };

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

    for entry in entries {
        if entry.comp_size > 0
            && (entry.comp_type == 0 || entry.comp_type == 2 || entry.comp_type == 3 || entry.comp_type == 36)
        {
            if let Ok(data) = extract_file_from_wad(&wad_path, &entry) {
                if data.len() >= 4 && (&data[0..4] == b"PROP" || &data[0..4] == b"PTCH") {
                    if let Ok(parsed) = parse_prop(&data, &db) {
                        for (_key, prop_val) in parsed.iter() {
                            if let BinValue::Struct(obj) | BinValue::Embedded(obj) = prop_val {
                                if let Some(BinValue::Hash(type_str)) = obj.get("__type") {
                                    if type_str != "SpellObject" {
                                        continue;
                                    }
                                } else {
                                    continue;
                                }

                                let spell_id = match obj.get("mScriptName").or_else(|| obj.get("ObjectName")) {
                                    Some(BinValue::String(s)) | Some(BinValue::Hash(s)) => s.as_str(),
                                    _ => "",
                                };
                                if let Some(filter) = spell_id_filter {
                                    if spell_id != filter {
                                        continue;
                                    }
                                }

                                if let Some(BinValue::Struct(m_spell) | BinValue::Embedded(m_spell)) = obj.get("mSpell") {
                                    println!("--- Spell: {} ---", spell_id);
                                    let mut mkeys: Vec<_> = m_spell.keys().collect();
                                    mkeys.sort();
                                    println!("mSpell keys: {:?}", mkeys);
                                    if let Some(BinValue::Struct(client) | BinValue::Embedded(client)) = m_spell.get("mClientData") {
                                        let mut ckeys: Vec<_> = client.keys().collect();
                                        ckeys.sort();
                                        println!("mClientData keys: {:?}", ckeys);
                                        if let Some(BinValue::Struct(tt) | BinValue::Embedded(tt)) = client.get("mTooltipData") {
                                            let mut tkeys: Vec<_> = tt.keys().collect();
                                            tkeys.sort();
                                            println!("mTooltipData keys: {:?}", tkeys);
                                            for (k, v) in tt {
                                                if k == "__type" || k == "mLocKeys" {
                                                    continue;
                                                }
                                                match v {
                                                    BinValue::List(list) => {
                                                        println!("  {}: List({})", k, list.len());
                                                        if let Some(first) = list.get(0) {
                                                            println!("    first item: {:?}", first);
                                                        }
                                                    }
                                                    BinValue::Struct(s) | BinValue::Embedded(s) => {
                                                        let mut skeys: Vec<_> = s.keys().collect();
                                                        skeys.sort();
                                                        println!("  {}: Struct keys {:?}", k, skeys);
                                                    }
                                                    BinValue::Link(link_key) => {
                                                        println!("  {}: Link({})", k, link_key);
                                                        if let Some(target) = parsed.get(link_key) {
                                                            println!("    linked object found");
                                                            if let BinValue::Struct(s) | BinValue::Embedded(s) = target {
                                                                let mut skeys: Vec<_> = s.keys().collect();
                                                                skeys.sort();
                                                                println!("    linked keys: {:?}", skeys);
                                                            } else {
                                                                println!("    linked value: {:?}", target);
                                                            }
                                                        } else {
                                                            println!("    linked object missing in current PROP map");
                                                        }
                                                    }
                                                    _ => {
                                                        println!("  {}: {:?}", k, v);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    if let Some(val) = m_spell.get("mSpellCalculations") {
                                        match val {
                                            BinValue::Map(map) => {
                                                println!("mSpellCalculations: Map ({} keys)", map.len());
                                                let mut keys: Vec<_> = map.keys().collect();
                                                keys.sort();
                                                println!("keys sample: {:?}", keys.into_iter().take(20).collect::<Vec<_>>());

                                                for (key, calc_val) in map.iter() {
                                                    println!("--- Calc {} ---", key);
                                                    if let BinValue::Struct(calc) | BinValue::Embedded(calc) = calc_val {
                                                        let t = match calc.get("__type") {
                                                            Some(BinValue::Hash(s)) | Some(BinValue::String(s)) => s.as_str(),
                                                            _ => "",
                                                        };
                                                        println!("type: {}", t);
                                                        if let Some(BinValue::List(fps)) = calc.get("mFormulaParts") {
                                                            println!("formula parts: {}", fps.len());
                                                            for (i, p) in fps.iter().enumerate() {
                                                                if let BinValue::Struct(part) | BinValue::Embedded(part) = p {
                                                                    let pt = match part.get("__type") {
                                                                        Some(BinValue::Hash(s)) | Some(BinValue::String(s)) => s.as_str(),
                                                                        _ => "",
                                                                    };
                                                                    println!("  part {} type: {}", i, pt);
                                                                    if pt.starts_with('{') {
                                                                        let mut pkeys: Vec<_> = part.keys().collect();
                                                                        pkeys.sort();
                                                                        println!("    keys: {:?}", pkeys);
                                                                    }
                                                                } else {
                                                                    println!("  part {} type: {:?}", i, p);
                                                                }
                                                            }
                                                        }
                                                    } else {
                                                        println!("calc value: {:?}", calc_val);
                                                    }
                                                }
                                            }
                                            BinValue::List(list) => {
                                                println!("mSpellCalculations: List ({} items)", list.len());
                                                if let Some(first) = list.get(0) {
                                                    match first {
                                                        BinValue::Struct(s) | BinValue::Embedded(s) => {
                                                            let mut keys: Vec<_> = s.keys().collect();
                                                            keys.sort();
                                                            println!("first item keys: {:?}", keys);
                                                        }
                                                        _ => println!("first item type: {:?}", first),
                                                    }
                                                }
                                            }
                                            other => {
                                                println!("mSpellCalculations: Other {:?}", other);
                                            }
                                        }
                                    } else {
                                        println!("mSpellCalculations: <missing>");
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
