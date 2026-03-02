use super::bin::{parse_prop, BinValue};
use super::extractor::extract_spell_vars;
use super::hash::{build_basic_hash_db, fnv1a_32};
use super::parser::{extract_file_from_wad, parse_wad_entries};
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Attempt to find League of Legends installation directory
pub fn get_league_install_dir() -> Option<PathBuf> {
    let common_paths = vec![
        "C:\\Riot Games\\League of Legends",
        "D:\\Riot Games\\League of Legends",
        "E:\\Riot Games\\League of Legends",
    ];

    for path_str in common_paths {
        let p = PathBuf::from(path_str);
        if p.exists() && p.join("LeagueClient.exe").exists() {
            return Some(p);
        }
    }
    None
}

/// Recursively or directly find all .wad.client files in Champions folder
pub fn get_champion_wads(install_dir: &Path) -> Vec<PathBuf> {
    let mut wads = Vec::new();
    let champ_dir = install_dir.join("Game/DATA/FINAL/Champions");

    if champ_dir.exists() {
        if let Ok(entries) = fs::read_dir(champ_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext) = path.extension() {
                        if ext == "client" && path.to_string_lossy().ends_with(".wad.client") {
                            wads.push(path);
                        }
                    }
                }
            }
        }
    }
    wads
}

/// Helper function to build db, can be loaded from hashes in future
fn load_hash_db() -> HashMap<u32, String> {
    let mut db = build_basic_hash_db();

    // As a dynamic list we can just pre-fill a lot of known strings or rely on fnv1a_32 strings
    // For now the extraction logic is heavily relying on strings, Python reads big lists.
    // In Rust, for tooltips, we might only care about keys resolved during parse_prop.
    // The Python extracted raw hashes if not found.
    // We add common strings here.
    let common_words = vec![
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
        "Armor",
        "MagicResist",
        "SpellBlock",
        "AttackSpeed",
        "MoveSpeed",
        "CritChance",
        "CritDamage",
        "Health",
        "BonusHealth",
        "BonusArmor",
        "BonusMagicResist",
        "BonusAttackDamage",
        "LifeSteal",
        "Lethality",
    ];
    for w in common_words {
        db.insert(fnv1a_32(w), w.to_string());
    }
    db
}

pub fn extract_all_champions_to_json(install_dir: &Path, output_path: &Path) -> Result<(), anyhow::Error> {
    let wads = get_champion_wads(install_dir);
    if wads.is_empty() {
        return Err(anyhow::anyhow!("No WAD files found in {:?}", install_dir));
    }

    let db = load_hash_db();

    // Process WADs in parallel using rayon
    let results: Vec<HashMap<String, HashMap<String, String>>> = wads
        .par_iter()
        .filter_map(|wad_path| {
            let mut champ_vars = HashMap::new();

            let entries = parse_wad_entries(wad_path).ok()?;

            for entry in entries {
                // Find entries that are uncompressed or zstd compressed (0, 2, 3, 36)
                if entry.comp_size > 0
                    && (entry.comp_type == 0 || entry.comp_type == 2 || entry.comp_type == 3 || entry.comp_type == 36)
                {
                    if let Ok(data) = extract_file_from_wad(wad_path, &entry) {
                        if data.len() >= 4 && (&data[0..4] == b"PROP" || &data[0..4] == b"PTCH") {
                            if let Ok(parsed) = parse_prop(&data, &db) {
                                for (_key, prop_val) in parsed {
                                    if let BinValue::Struct(obj) | BinValue::Embedded(obj) = prop_val {
                                        if let Some(BinValue::Hash(type_str)) = obj.get("__type") {
                                            if type_str == "SpellObject" {
                                                if let Some((spell_id, vars)) = extract_spell_vars(&obj) {
                                                    champ_vars.insert(spell_id, vars);
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

            if champ_vars.is_empty() {
                None
            } else {
                Some(champ_vars)
            }
        })
        .collect();

    let mut all_mappings = HashMap::new();
    for res in results {
        for (spell_id, vars) in res {
            all_mappings.insert(spell_id, vars);
        }
    }

    // Write to JSON
    let json_str = serde_json::to_string_pretty(&all_mappings)?;
    fs::write(output_path, json_str)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_extract_all() {
        if let Some(install_dir) = get_league_install_dir() {
            let output_path = PathBuf::from(
                "C:/Users/fjnce/AppData/Local/com.leaguerecord.custom/tooltip_cache/tooltip_variable_fallback.json",
            );
            let _ = extract_all_champions_to_json(&install_dir, &output_path);
        }
    }
}
