use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[path = "../wad/mod.rs"]
mod wad;

use wad::bin::{parse_prop, BinValue};
use wad::extractor::extract_spell_vars;
use wad::hash::{build_basic_hash_db, fnv1a_32};
use wad::parser::{extract_file_from_wad, parse_wad_entries};
use wad::updater::get_league_install_dir;

fn test_champion(champ: &str) {
    println!("--- Testing extraction for: {} ---", champ);
    let install_dir = get_league_install_dir().expect("Failed to find League install dir");
    let wad_path = install_dir.join(format!("Game/DATA/FINAL/Champions/{}.wad.client", champ));

    if !wad_path.exists() {
        println!("WAD file not found: {:?}", wad_path);
        return;
    }

    let entries = parse_wad_entries(&wad_path).expect("Failed to parse WAD");
    let mut db = build_basic_hash_db();
    let common = vec![
        "SpellObject",
        "mSpell",
        "mScriptName",
        "ObjectName",
        "DataValues",
        "mName",
        "mValues",
        "mSpellCalculations",
        "mDisplayAsPercent",
        "mFormulaParts",
        "StatByCoefficientCalculationPart",
        "mCoefficient",
        "mStat",
        "mStatFormula",
        "NamedDataValueCalculationPart",
        "mDataValue",
        "StatByNamedDataValueCalculationPart",
        "StatBySubPartCalculationPart",
        "mSubpart",
        "AbilityPower",
        "AttackDamage",
        "GameCalculation",
        "GameCalculationModified",
        "mModifiedGameCalculation",
        "mMultiplier",
        "SumOfSubPartsCalculationPart",
        "ProductOfSubPartsCalculationPart",
        "mPart1",
        "mPart2",
        "mNumber",
        "mValue",
        "mSpellCalculationKey",
    ];
    for w in common {
        db.insert(fnv1a_32(w), w.to_string());
    }

    let mut found = false;
    for entry in entries {
        if entry.comp_size > 0
            && (entry.comp_type == 0 || entry.comp_type == 2 || entry.comp_type == 3 || entry.comp_type == 36)
        {
            if let Ok(data) = extract_file_from_wad(&wad_path, &entry) {
                if data.len() >= 4 && (&data[0..4] == b"PROP" || &data[0..4] == b"PTCH") {
                    if let Ok(parsed) = parse_prop(&data, &db) {
                        for (_, prop_val) in parsed {
                            if let BinValue::Struct(obj) | BinValue::Embedded(obj) = prop_val {
                                if let Some(BinValue::Hash(type_str)) = obj.get("__type") {
                                    if type_str == "SpellObject" {
                                        if let Some((spell_id, res)) = extract_spell_vars(&obj) {
                                            println!("Found spell: {}", spell_id);
                                            // Only print _calc variables for scaling checks
                                            let mut calcs: Vec<_> = res.flat_map.iter().collect();
                                            calcs.sort_by_key(|&(k, _)| k);
                                            for (k, v) in calcs {
                                                println!("    {}: {}", k, v);
                                            }
                                            found = true;
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

    if !found {
        println!("Did not find any SpellObject in {}", champ);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let champ = if args.len() > 1 { &args[1] } else { "Ekko" };
    test_champion(champ);
}
