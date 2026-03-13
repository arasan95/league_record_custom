use std::path::PathBuf;

#[path = "../wad/mod.rs"]
mod wad;

use wad::bin::*;
use wad::extractor::*;
use wad::hash::*;
use wad::parser::*;
use wad::updater::*;

fn main() {
    let mut db = build_basic_hash_db();
    let common_words = vec![
        "SpellObject",
        "mSpell",
        "mScriptName",
        "ObjectName",
        "DataValues",
        "mName",
        "mValues",
        "mSpellCalculations",
        "mEffectAmount",
        "mEffectAmounts",
        "EffectAmount",
        "EffectAmounts",
        "mEffect1Amount",
        "mEffect2Amount",
        "mEffect3Amount",
        "mEffect4Amount",
        "mEffect5Amount",
        "mEffect6Amount",
        "mEffect7Amount",
        "mEffect8Amount",
        "mEffect9Amount",
        "mEffect10Amount",
    ];
    for w in common_words {
        db.insert(fnv1a_32(w), w.to_string());
    }

    let wad_path = PathBuf::from("C:/Riot Games/League of Legends/Game/DATA/FINAL/Champions/Ekko.wad.client");
    if let Ok(entries) = parse_wad_entries(&wad_path) {
        for entry in entries {
            if entry.comp_size > 0
                && (entry.comp_type == 0 || entry.comp_type == 2 || entry.comp_type == 3 || entry.comp_type == 36)
            {
                if let Ok(data) = extract_file_from_wad(&wad_path, &entry) {
                    if data.len() >= 4 && (&data[0..4] == b"PROP" || &data[0..4] == b"PTCH") {
                        if let Ok(parsed) = parse_prop(&data, &db) {
                            for (key, prop_val) in parsed {
                                if let BinValue::Struct(obj) | BinValue::Embedded(obj) = prop_val {
                                    let mut is_ekkow = false;
                                    if let Some(BinValue::Hash(spell_name)) =
                                        obj.get("mScriptName").or_else(|| obj.get("ObjectName"))
                                    {
                                        if spell_name.to_lowercase() == "ekkow" {
                                            is_ekkow = true;
                                        }
                                    } else if let Some(BinValue::String(spell_name)) =
                                        obj.get("mScriptName").or_else(|| obj.get("ObjectName"))
                                    {
                                        if spell_name.to_lowercase() == "ekkow" {
                                            is_ekkow = true;
                                        }
                                    }

                                    if !is_ekkow {
                                        if let Some(BinValue::String(s)) = obj.get("mName") {
                                            if s.to_lowercase() == "ekkow" {
                                                is_ekkow = true;
                                            }
                                        }
                                    }

                                    if is_ekkow {
                                        println!("Found EkkoW! Key: {}", key);
                                        if let Some(BinValue::Struct(m_spell) | BinValue::Embedded(m_spell)) =
                                            obj.get("mSpell")
                                        {
                                            println!("mSpell keys: {:?}", m_spell.keys().collect::<Vec<_>>());
                                            if let Some(effect) = m_spell.get("mEffectAmount") {
                                                println!("mEffectAmount: {:?}", effect);
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
