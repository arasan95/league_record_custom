use super::bin::{parse_prop, BinValue};
use super::extractor::extract_spell_vars;
use super::hash::{build_basic_hash_db, fnv1a_32};
use super::parser::{extract_file_from_wad, parse_wad_entries};
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
fn query_registry_value(key: &str, value: &str) -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let (root, subkey) = if let Some(rest) = key.strip_prefix("HKCU\\") {
        (HKEY_CURRENT_USER, rest)
    } else if let Some(rest) = key.strip_prefix("HKLM\\") {
        (HKEY_LOCAL_MACHINE, rest)
    } else {
        return None;
    };

    let root = RegKey::predef(root);
    let key = root.open_subkey(subkey).ok()?;
    key.get_value::<String, _>(value).ok().filter(|v| !v.is_empty())
}

#[cfg(target_os = "windows")]
fn find_lol_install_from_registry() -> Option<PathBuf> {
    let keys = [
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Riot Game league_of_legends.live",
        r"HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\Riot Game league_of_legends.live",
        r"HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Riot Game league_of_legends.live",
    ];
    for key in keys {
        if let Some(path) = query_registry_value(key, "InstallLocation") {
            return Some(PathBuf::from(path));
        }
    }
    None
}

/// Attempt to find League of Legends installation directory
pub fn get_league_install_dir() -> Option<PathBuf> {
    let is_valid_lol_dir = |p: &Path| p.exists() && p.join("LeagueClient.exe").exists();

    if let Ok(env_path) = std::env::var("LEAGUE_INSTALL_DIR") {
        let p = PathBuf::from(env_path);
        if is_valid_lol_dir(&p) {
            return Some(p);
        }
    }

    #[cfg(target_os = "windows")]
    if let Some(path) = find_lol_install_from_registry() {
        if is_valid_lol_dir(&path) {
            return Some(path);
        }
    }

    let common_paths = [
        "C:\\Riot Games\\League of Legends",
        "D:\\Riot Games\\League of Legends",
        "E:\\Riot Games\\League of Legends",
        "F:\\Riot Games\\League of Legends",
        "G:\\Riot Games\\League of Legends",
    ];

    for path_str in common_paths {
        let p = PathBuf::from(path_str);
        if is_valid_lol_dir(&p) {
            return Some(p);
        }
    }

    // Fallback: parse Riot installs manifest to support custom/non-standard install paths.
    let installs_json = PathBuf::from(r"C:\ProgramData\Riot Games\RiotClientInstalls.json");
    if let Ok(raw) = fs::read_to_string(&installs_json) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            fn collect_strings(v: &serde_json::Value, out: &mut Vec<String>) {
                match v {
                    serde_json::Value::String(s) => out.push(s.clone()),
                    serde_json::Value::Array(arr) => {
                        for x in arr {
                            collect_strings(x, out);
                        }
                    }
                    serde_json::Value::Object(map) => {
                        for x in map.values() {
                            collect_strings(x, out);
                        }
                    }
                    _ => {}
                }
            }

            let mut paths = Vec::new();
            collect_strings(&value, &mut paths);

            for s in paths {
                // Manifest paths can point directly to LeagueClient.exe or its parent directory.
                let lower = s.to_lowercase();
                if !lower.contains("league of legends") {
                    continue;
                }

                let mut p = PathBuf::from(&s);
                if p.file_name().map(|x| x.eq_ignore_ascii_case("LeagueClient.exe")).unwrap_or(false) {
                    p.pop();
                }
                if is_valid_lol_dir(&p) {
                    return Some(p);
                }
            }
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
                            let file_name = path.file_name().unwrap_or_default().to_string_lossy();
                            let base_name = file_name.replace(".wad.client", "");
                            if !base_name.contains('.') {
                                wads.push(path);
                            }
                        }
                    }
                }
            }
        }
    }
    wads
}

/// Helper function to build db, can be loaded from hashes in future
pub fn load_hash_db() -> HashMap<u32, String> {
    let mut db = build_basic_hash_db();

    // As a dynamic list we can just pre-fill a lot of known strings or rely on fnv1a_32 strings
    // For now the extraction logic is heavily relying on strings, Python reads big lists.
    // In Rust, for tooltips, we might only care about keys resolved during parse_prop.
    // The Python extracted raw hashes if not found.
    // We add common strings here.
    let common_words = vec![
        "SpellObject",
        "mSpell",
        "mClientData",
        "mTooltipData",
        "mLocKeys",
        "keyName",
        "mScriptName",
        "ObjectName",
        "DataValues",
        "mName",
        "mValues",
        "mEffectAmount",
        "mEffectBurnAmount",
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
        "mSubparts",
        "NumberCalculationPart",
        "AbilityResourceByCoefficientCalculationPart",
        "BuffCounterByCoefficientCalculationPart",
        "ByCharLevelInterpolationCalculationPart",
        "ByCharLevelBreakpointsCalculationPart",
        "mLevel1Value",
        "mStartValue",
        "mEndValue",
        "mBuff",
        "GameCalculationConditional",
        "InitialDamage",
        "Damage",
        "MonsterDamage",
        "AllDamageHit",
        "TotalDamage",
        "TotalExplosionDamage",
        "StunDuration",
        "RootDuration",
        "SlowDuration",
        "MaxDamage",
        "MinDamage",
        "DamageRatio",
        "MaxHealth",
        "BonusHealth",
        "MissingHealth",
        "Amount",
        "TotalAmount",
        "HealAmount",
        "ShieldAmount",
        "BonusArmor",
        "BonusMagicResist",
        "MaxHealthDamageCalc",
        "mEffectAmount",
        "mEffectAmounts",
        "mEffectBurnAmount",
        "mEffectBurnAmounts",
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
        "e0",
        "e1",
        "e2",
        "e3",
        "e4",
        "e5",
        "e6",
        "e7",
        "e10",
        "CharacterRecord",
        "spellNames",
        "cooldownTime",
        "manaCost",
        "mana",
        "castRangeDisplayOverride",
        "castRange",
        "castRadius",
        "castTime",
        "ammoRechargeTime",
        "mAmmoRechargeTime",
        "delayCastOffsetPercent",
        "missileSpeed",
    ];
    for w in common_words {
        let hash = fnv1a_32(w);
        if w == "MaxHealthDamageCalc" {
            println!("REGISTERING MaxHealthDamageCalc with hash: {:08x}", hash);
        }
        db.insert(hash, w.to_string());
    }

    // Load dynamically extracted calculations
    for w in crate::wad::known_hashes::get_known_hashes() {
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
    let results: Vec<(String, HashMap<String, crate::wad::extractor::SpellExtractionResult>, Vec<String>)> = wads
        .par_iter()
        .filter_map(|wad_path| {
            let champ_name = wad_path.file_name().unwrap_or_default().to_string_lossy().replace(".wad.client", "");
            let mut champ_vars = HashMap::new();
            let mut champ_slots = Vec::new();
            let mut spell_hashes_to_id = HashMap::new();

            let entries = parse_wad_entries(wad_path).ok()?;

            for entry in entries {
                if entry.comp_size > 0
                    && (entry.comp_type == 0 || entry.comp_type == 2 || entry.comp_type == 3 || entry.comp_type == 36)
                {
                    if let Ok(data) = extract_file_from_wad(wad_path, &entry) {
                        if data.len() >= 4 && (&data[0..4] == b"PROP" || &data[0..4] == b"PTCH") {
                            if let Ok(parsed) = parse_prop(&data, &db) {
                                for (key, prop_val) in parsed {
                                    if let BinValue::Struct(obj) | BinValue::Embedded(obj) = prop_val {
                                        if let Some(BinValue::Hash(type_str)) = obj.get("__type") {
                                            if type_str == "SpellObject" {
                                                if let Some((spell_id, vars)) = extract_spell_vars(&obj) {
                                                    spell_hashes_to_id.insert(key.clone(), spell_id.clone());
                                                    champ_vars.insert(spell_id, vars);
                                                }
                                            } else if type_str == "CharacterRecord" {
                                                if let Some(BinValue::List(spell_list)) = obj.get("spellNames") {
                                                    let mut slots = Vec::new();
                                                    for s in spell_list {
                                                        if let BinValue::String(spell_path) = s {
                                                            let hash = fnv1a_32(&spell_path.to_lowercase());
                                                            let key_to_look = if let Some(known) = db.get(&hash) {
                                                                known.clone()
                                                            } else {
                                                                format!("{{{:08x}}}", hash)
                                                            };
                                                            slots.push(key_to_look);
                                                        }
                                                    }
                                                    if !slots.is_empty() {
                                                        champ_slots = slots;
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

            if champ_vars.is_empty() && champ_slots.is_empty() {
                None
            } else {
                let mut final_slots = Vec::new();
                for hash_key in champ_slots {
                    if let Some(spell_id) = spell_hashes_to_id.get(&hash_key) {
                        final_slots.push(spell_id.clone());
                    } else {
                        // fallback to the old method of getting basename
                        let parts: Vec<&str> = hash_key.split('/').collect();
                        if let Some(last) = parts.last() {
                            final_slots.push(last.to_string());
                        } else {
                            final_slots.push(hash_key);
                        }
                    }
                }
                Some((champ_name, champ_vars, final_slots))
            }
        })
        .collect();

    let mut all_mappings = HashMap::new();
    let mut all_debug = serde_json::Map::new();
    let mut all_slots = HashMap::new();

    for (champ_name, vars, slots) in results {
        let mut champion_spell_debug = serde_json::Map::new();
        let champ_lower = champ_name.to_lowercase();

        let infer_slot_from_spell_id = |spell_id: &str| -> Option<&'static str> {
            let lower = spell_id.to_lowercase();
            if lower.contains("passive") {
                return Some("Passive");
            }
            let stripped = lower
                .strip_prefix(&champ_lower)
                .unwrap_or(&lower)
                .trim_start_matches('_');
            if stripped.starts_with('q') { return Some("Q"); }
            if stripped.starts_with('w') { return Some("W"); }
            if stripped.starts_with('e') { return Some("E"); }
            if stripped.starts_with('r') { return Some("R"); }
            None
        };

        // Fallback candidates inferred directly from mScriptName.
        let mut inferred_slot_spell: HashMap<&'static str, String> = HashMap::new();
        for spell_id in vars.keys() {
            if let Some(slot_key) = infer_slot_from_spell_id(spell_id) {
                match inferred_slot_spell.get(slot_key) {
                    Some(prev) => {
                        if spell_id.len() < prev.len() {
                            inferred_slot_spell.insert(slot_key, spell_id.clone());
                        }
                    }
                    None => {
                        inferred_slot_spell.insert(slot_key, spell_id.clone());
                    }
                }
            }
        }

        if !slots.is_empty() {
            let mut qwer_map = serde_json::Map::new();
            let keys = ["Q", "W", "E", "R"];
            for (i, slot) in slots.iter().enumerate().take(4) {
                let mut final_name = slot.clone();
                if let Some(ext_res) = vars.get(slot) {
                    final_name = ext_res.m_script_name.clone();
                    champion_spell_debug.insert(keys[i].to_string(), ext_res.debug_json.clone());
                } else if let Some(inferred_spell_id) = inferred_slot_spell.get(keys[i]) {
                    if let Some(ext_res) = vars.get(inferred_spell_id) {
                        final_name = ext_res.m_script_name.clone();
                        champion_spell_debug.insert(keys[i].to_string(), ext_res.debug_json.clone());
                    }
                }
                qwer_map.insert(keys[i].to_string(), serde_json::Value::String(final_name));
            }
            all_slots.insert(champ_name.clone(), serde_json::Value::Object(qwer_map));
        } else {
            // If CharacterRecord slot list was unavailable, still export inferred QWER names.
            let mut qwer_map = serde_json::Map::new();
            for key in ["Q", "W", "E", "R"] {
                if let Some(inferred_spell_id) = inferred_slot_spell.get(key) {
                    qwer_map.insert(key.to_string(), serde_json::Value::String(inferred_spell_id.clone()));
                    if let Some(ext_res) = vars.get(inferred_spell_id) {
                        champion_spell_debug.insert(key.to_string(), ext_res.debug_json.clone());
                    }
                }
            }
            if !qwer_map.is_empty() {
                all_slots.insert(champ_name.clone(), serde_json::Value::Object(qwer_map));
            }
        }

        // Best-effort passive mapping for compatibility with champion->spells format.
        if !champion_spell_debug.contains_key("Passive") {
            if let Some(passive_id) = inferred_slot_spell.get("Passive") {
                if let Some(ext_res) = vars.get(passive_id) {
                    champion_spell_debug.insert("Passive".to_string(), ext_res.debug_json.clone());
                }
            } else if let Some((_sid, ext_res)) = vars
                .iter()
                .find(|(sid, _)| sid.to_lowercase().contains("passive"))
            {
                champion_spell_debug.insert("Passive".to_string(), ext_res.debug_json.clone());
            }
        }

        if !champion_spell_debug.is_empty() {
            let mut champ_obj = serde_json::Map::new();
            champ_obj.insert("spells".to_string(), serde_json::Value::Object(champion_spell_debug));
            all_debug.insert(champ_name.clone(), serde_json::Value::Object(champ_obj));
        }

        for (spell_id, ext_res) in vars {
            all_mappings.insert(spell_id.clone(), ext_res.flat_map);
            all_debug.insert(spell_id, ext_res.debug_json);
        }
    }

    // Write to JSON
    let json_str = serde_json::to_string_pretty(&all_mappings)?;
    fs::write(output_path, json_str)?;

    let debug_output_path = output_path.with_file_name("all_calc_formulas.json");
    let debug_json_str = serde_json::to_string_pretty(&serde_json::Value::Object(all_debug))?;
    fs::write(debug_output_path, debug_json_str)?;

    let slots_output_path = output_path.with_file_name("champion_spell_slots.json");
    let slots_json_str = serde_json::to_string_pretty(&all_slots)?;
    fs::write(slots_output_path, slots_json_str)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_extract_all() {
        if let Some(install_dir) = get_league_install_dir() {
            let output_path = std::env::temp_dir().join("tooltip_variable_fallback.json");
            let _ = extract_all_champions_to_json(&install_dir, &output_path);
        }
    }
}
