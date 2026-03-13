use league_record::wad::bin::{parse_prop, BinValue};
use league_record::wad::hash::fnv1a_32;
use league_record::wad::parser::{extract_file_from_wad, parse_wad_entries};
use std::collections::HashMap;
use std::path::PathBuf;

pub fn load_hash_db() -> HashMap<u32, String> {
    let mut db = league_record::wad::hash::build_basic_hash_db();
    let common_words = vec![
        "SpellObject", "mSpell", "mScriptName", "ObjectName", "DataValues",
        "mName", "mValues", "mSpellCalculations", "CharacterRecord", "spellNames",
        "cooldownTime", "mCooldownTime", "mana", "manaCost", "mMana", "mManaCost",
        "castRange", "mCastRange", "castRadius", "mCastRadius", "castTime",
        "mCastTime", "delayCastOffsetPercent", "mDelayCastOffsetPercent",
        "missileSpeed", "mMissileSpeed", "castRangeDisplayOverride",
    ];
    for w in common_words {
        db.insert(fnv1a_32(w), w.to_string());
    }
    for w in league_record::wad::known_hashes::get_known_hashes() {
        db.insert(fnv1a_32(w), w.to_string());
    }
    db
}

fn main() {
    let wad_path = PathBuf::from(r"C:\Riot Games\League of Legends\Game\DATA\FINAL\Champions\Ahri.wad.client");
    if !wad_path.exists() {
        println!("WAD not found!");
        return;
    }

    let db = load_hash_db();
    let entries = parse_wad_entries(&wad_path).unwrap();

    for entry in entries {
        if entry.comp_size > 0 && (entry.comp_type == 0 || entry.comp_type == 2 || entry.comp_type == 3 || entry.comp_type == 36) {
            if let Ok(data) = extract_file_from_wad(&wad_path, &entry) {
                if data.len() >= 4 && (&data[0..4] == b"PROP" || &data[0..4] == b"PTCH") {
                    if let Ok(parsed) = parse_prop(&data, &db) {
                        for (key, prop_val) in parsed {
                            if let BinValue::Struct(obj) | BinValue::Embedded(obj) = prop_val {
                                if let Some(BinValue::Hash(type_str)) = obj.get("__type") {
                                    if type_str == "SpellObject" {
                                        if let Some(BinValue::Struct(m_spell) | BinValue::Embedded(m_spell)) = obj.get("mSpell") {
                                            println!("--- SpellObject: {} ---", key);
                                            let mut keys: Vec<&String> = m_spell.keys().collect();
                                            keys.sort();
                                            for k in keys {
                                                println!("Key: {}", k);
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
}
