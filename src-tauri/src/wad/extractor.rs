use crate::wad::bin::BinValue;
use regex;
use serde_json;
use std::collections::HashMap;

pub struct SpellExtractionResult {
    pub flat_map: std::collections::HashMap<String, String>,
    pub debug_json: serde_json::Value,
    pub m_script_name: String,
}

pub fn extract_spell_vars(
    spell_obj: &std::collections::HashMap<String, BinValue>,
) -> Option<(String, SpellExtractionResult)> {
    let m_spell = match spell_obj.get("mSpell") {
        Some(BinValue::Struct(s)) | Some(BinValue::Embedded(s)) => s,
        _ => return None,
    };

    let spell_id = match spell_obj.get("mScriptName").or_else(|| spell_obj.get("ObjectName")) {
        Some(BinValue::String(s)) => s.clone(),
        Some(BinValue::Hash(s)) => s.clone(),
        _ => return None,
    };
    if spell_id.is_empty() {
        return None;
    }

    let mut data_values_map: std::collections::HashMap<String, Vec<f32>> = std::collections::HashMap::new();
    let mut hash_to_name: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut dbg_var_map = serde_json::Map::new();

    if let Some(BinValue::List(dv_list)) = m_spell.get("DataValues") {
        for dv_val in dv_list {
            if let BinValue::Struct(dv) | BinValue::Embedded(dv) = dv_val {
                let name = match dv.get("mName") {
                    Some(BinValue::String(s)) => s.clone(),
                    Some(BinValue::Hash(s)) => s.clone(),
                    _ => continue,
                };

                let vals = match dv.get("mValues") {
                    Some(BinValue::List(list)) => {
                        let mut v_arr = Vec::new();
                        for item in list {
                            match item {
                                BinValue::Float(f) => v_arr.push(*f),
                                BinValue::I32(i) => v_arr.push(*i as f32),
                                BinValue::U32(u) => v_arr.push(*u as f32),
                                BinValue::U8(u) => v_arr.push(*u as f32),
                                BinValue::I8(i) => v_arr.push(*i as f32),
                                BinValue::U16(u) => v_arr.push(*u as f32),
                                BinValue::I16(i) => v_arr.push(*i as f32),
                                _ => v_arr.push(0.0),
                            }
                        }
                        v_arr
                    }
                    _ => continue,
                };

                let lower_name = name.to_lowercase();

                // Calculate FNV1a_32 for the data value name
                let mut h: u32 = 0x811c9dc5;
                for b in lower_name.bytes() {
                    h ^= b as u32;
                    h = h.wrapping_mul(0x01000193);
                }
                let hash_str = format!("{{{:08x}}}", h);

                hash_to_name.insert(hash_str.clone(), lower_name.clone());

                data_values_map.insert(lower_name, vals.clone());
                data_values_map.insert(hash_str, vals);
            }
        }
    }

    let get_spell_prop = |prop: &str| -> Option<&BinValue> {
        if let Some(v) = m_spell.get(prop) {
            return Some(v);
        }
        let prop_lower = prop.to_lowercase();
        for (k, v) in m_spell.iter() {
            if k.eq_ignore_ascii_case(prop) {
                return Some(v);
            }
        }
        let mut h: u32 = 0x811c9dc5;
        for b in prop_lower.bytes() {
            h ^= b as u32;
            h = h.wrapping_mul(0x01000193);
        }
        let hashed_key = format!("{{{:08x}}}", h);
        m_spell.get(&hashed_key)
    };

    let mut add_standard_prop = |prop: &str, target_key: &str| {
        if data_values_map.contains_key(target_key) {
            return;
        }
        if let Some(val) = get_spell_prop(prop) {
            let mut v_arr = Vec::new();
            if let BinValue::List(list) = val {
                for item in list {
                    match item {
                        BinValue::Float(f) => v_arr.push(*f),
                        BinValue::I32(i) => v_arr.push(*i as f32),
                        BinValue::U32(u) => v_arr.push(*u as f32),
                        BinValue::U8(u) => v_arr.push(*u as f32),
                        BinValue::I8(i) => v_arr.push(*i as f32),
                        BinValue::U16(u) => v_arr.push(*u as f32),
                        BinValue::I16(i) => v_arr.push(*i as f32),
                        _ => {},
                    }
                }
            } else {
                let single = match val {
                    BinValue::Float(f) => Some(*f),
                    BinValue::I32(i) => Some(*i as f32),
                    BinValue::U32(u) => Some(*u as f32),
                    BinValue::U8(u) => Some(*u as f32),
                    BinValue::I8(i) => Some(*i as f32),
                    BinValue::U16(u) => Some(*u as f32),
                    BinValue::I16(i) => Some(*i as f32),
                    _ => None,
                };
                if let Some(f) = single {
                    v_arr = vec![f; 6];
                }
            }
            if !v_arr.is_empty() && v_arr.iter().any(|v| *v != 0.0) {
                let mut h: u32 = 0x811c9dc5;
                for b in target_key.bytes() {
                    h ^= b as u32;
                    h = h.wrapping_mul(0x01000193);
                }
                let hash_str = format!("{{{:08x}}}", h);
                
                data_values_map.insert(target_key.to_string(), v_arr.clone());
                data_values_map.insert(hash_str, v_arr);
            }
        }
    };

    add_standard_prop("cooldownTime", "cooldown");
    add_standard_prop("mCooldownTime", "cooldown");
    add_standard_prop("cooldown", "cooldown");
    add_standard_prop("recastCooldownTime", "cooldown");
    add_standard_prop("mRecastCooldownTime", "cooldown");
    add_standard_prop("manaCost", "cost");
    add_standard_prop("mana", "cost");
    add_standard_prop("mManaCost", "cost");
    add_standard_prop("mMana", "cost");
    add_standard_prop("castRangeDisplayOverride", "range");
    add_standard_prop("castRange", "range");
    add_standard_prop("castRangeDisplayOverride", "castrange");
    add_standard_prop("castRange", "castrange");
    add_standard_prop("castRadius", "range");
    add_standard_prop("castRadius", "castradius");
    add_standard_prop("castTime", "casttime");
    add_standard_prop("mCastTime", "casttime");
    add_standard_prop("missileSpeed", "speed");
    add_standard_prop("mMissileSpeed", "speed");
    add_standard_prop("lineWidth", "width");
    add_standard_prop("mLineWidth", "width");
    add_standard_prop("lineWidth", "linewidth");
    add_standard_prop("mLineWidth", "linewidth");
    add_standard_prop("ammoRechargeTime", "ammorechargetime");
    add_standard_prop("mAmmoRechargeTime", "ammorechargetime");

    // Fallback cast time from castFrame (Riot uses 48fps for many spell cast frames)
    if !data_values_map.contains_key("casttime") {
        if let Some(val) = get_spell_prop("castFrame") {
            let cast_frame = match val {
                BinValue::Float(f) => Some(*f),
                BinValue::I32(i) => Some(*i as f32),
                BinValue::U32(u) => Some(*u as f32),
                BinValue::U8(u) => Some(*u as f32),
                BinValue::I8(i) => Some(*i as f32),
                BinValue::U16(u) => Some(*u as f32),
                BinValue::I16(i) => Some(*i as f32),
                _ => None,
            };
            if let Some(frames) = cast_frame {
                if frames > 0.0 {
                    let seconds = frames / 48.0;
                    let arr = vec![seconds; 6];
                    let mut h: u32 = 0x811c9dc5;
                    for b in "casttime".bytes() {
                        h ^= b as u32;
                        h = h.wrapping_mul(0x01000193);
                    }
                    let hash_str = format!("{{{:08x}}}", h);
                    data_values_map.insert("casttime".to_string(), arr.clone());
                    data_values_map.insert(hash_str, arr);
                }
            }
        }
    }

    // Extract mEffectAmount (and mEffectBurnAmount) as effect1amount, effect2amount, ...
    let extract_float = |val: &BinValue| -> f32 {
        match val {
            BinValue::Float(f) => *f,
            BinValue::I32(i) => *i as f32,
            BinValue::U32(u) => *u as f32,
            BinValue::U8(u) => *u as f32,
            BinValue::I8(i) => *i as f32,
            BinValue::U16(u) => *u as f32,
            BinValue::I16(i) => *i as f32,
            _ => 0.0,
        }
    };

    for (field_name, prefix) in [("mEffectAmount", "effect"), ("mEffectBurnAmount", "effectburn")] {
        if let Some(BinValue::List(effect_list)) = m_spell.get(field_name) {
            for (idx, effect_val) in effect_list.iter().enumerate() {
                // each element is a struct/embedded with a mValues list
                let vals: Vec<f32> = if let BinValue::Struct(ef) | BinValue::Embedded(ef) = effect_val {
                    if let Some(BinValue::List(mv)) = ef.get("mValues").or_else(|| ef.get("{425ed3ca}")) {
                        mv.iter().map(|v| extract_float(v)).collect()
                    } else {
                        // fallback to finding the first List in the struct
                        let mut found_list = None;
                        for val in ef.values() {
                            if let BinValue::List(l) = val {
                                found_list = Some(l);
                                break;
                            }
                        }
                        if let Some(l) = found_list {
                            l.iter().map(|v| extract_float(v)).collect()
                        } else {
                            vec![extract_float(effect_val)]
                        }
                    }
                } else {
                    vec![extract_float(effect_val)]
                };

                if vals.is_empty() || vals.iter().all(|v| *v == 0.0) {
                    continue;
                }

                let key_name = format!("{}{}", prefix, idx + 1); // e.g., effect1
                let key_name_amount = format!("{}{}amount", prefix, idx + 1); // e.g., effect1amount
                let e_idx = format!("e{}", idx); // e.g., e0
                data_values_map.insert(key_name.clone(), vals.clone());
                data_values_map.insert(key_name_amount.clone(), vals.clone());
                if prefix == "effect" {
                    data_values_map.insert(e_idx.clone(), vals.clone());
                }
            }
        }
    }

    // Calculation rendering logic from JS port
    fn stat_name(id: Option<i32>) -> String {
        let id = id.unwrap_or(0);
        match id {
            0 | 1 => "AP".to_string(),
            2 => "AD".to_string(),
            3 | 5 => "Armor".to_string(),
            4 => "AS".to_string(),
            6 => "MR".to_string(),
            7 => "Lethality".to_string(),
            8 => "CDR".to_string(),
            9 => "CritDmg".to_string(),
            10 => "MS".to_string(),
            11 => "HP".to_string(),
            12 => "Mana".to_string(),
            14 => "OmniVamp".to_string(),
            15 => "PhysVamp".to_string(),
            20 => "Range".to_string(),
            26 => "ArmorPen".to_string(),
            28 => "BonusHP".to_string(),
            29 => "%BonusHP".to_string(),
            36 => "HealShield".to_string(),
            _ => format!("Stat{}", id),
        }
    }

    fn slice_for_rank(vals: &[f32], max_rank: usize) -> Vec<f32> {
        let mut arr = vals.to_vec();
        if arr.len() > max_rank {
            arr.remove(0);
        }
        if arr.len() > max_rank {
            arr.truncate(max_rank);
        }
        arr
    }

    fn dv_to_str(vals: &[f32], max_rank: usize) -> String {
        let mut arr = slice_for_rank(vals, max_rank);
        for v in arr.iter_mut() {
            *v = (*v * 10000.0).round() / 10000.0;
        }
        if arr.is_empty() {
            return "?".to_string();
        }
        let all_same = arr.iter().all(|&v| (v - arr[0]).abs() < f32::EPSILON);
        if all_same {
            arr[0].to_string()
        } else {
            arr.iter().map(|v| v.to_string()).collect::<Vec<_>>().join("/")
        }
    }

    fn part_to_formula(
        part_val: &BinValue,
        dv_map: &HashMap<String, Vec<f32>>,
        all_calcs: &HashMap<String, BinValue>,
        use_var_names: bool,
    ) -> String {
        if let BinValue::Struct(part) | BinValue::Embedded(part) = part_val {
            if let Some(BinValue::String(k) | BinValue::Hash(k)) = part.get("mSpellCalculationKey") {
                let mut ref_calc = all_calcs.get(k);
                if ref_calc.is_none() {
                    for (key, v) in all_calcs {
                        if key.eq_ignore_ascii_case(k) {
                            ref_calc = Some(v);
                            break;
                        }
                    }
                }
                if let Some(r) = ref_calc {
                    return calc_to_formula(r, dv_map, all_calcs, 0, use_var_names);
                }
                return format!("{{{}}}", k);
            }

            let ptype = match part.get("__type") {
                Some(BinValue::Hash(s)) | Some(BinValue::String(s)) => s.as_str(),
                _ => "",
            };

            if ptype == "NumberCalculationPart" || ptype == "{d2179e8e}" {
                let num = match part.get("mNumber") {
                    Some(BinValue::Float(f)) => *f,
                    Some(BinValue::I32(i)) => *i as f32,
                    _ => 0.0,
                };
                return num.to_string();
            }

            if ptype == "NamedDataValueCalculationPart" || ptype == "{332eb441}" {
                let name = match part.get("mDataValue") {
                    Some(BinValue::String(s)) | Some(BinValue::Hash(s)) => s.to_string(),
                    _ => "??".to_string(),
                };
                if use_var_names {
                    return name;
                }
                if let Some(vals) = dv_map.get(&name.to_lowercase()) {
                    return dv_to_str(vals, 5);
                }
                return format!("{{{}}}", name);
            }

            // EffectValueCalculationPart: maps mEffectIndex -> effect{index}
            let effect_key_hash = format!("{{{:08x}}}", crate::wad::hash::fnv1a_32("mEffectIndex"));
            let is_effect_part = ptype == "EffectValueCalculationPart"
                || ptype == "{8bc08357}"
                || part.get("mEffectIndex").is_some()
                || part.get(&effect_key_hash).is_some();
            if is_effect_part {
                let idx = match part.get("mEffectIndex").or_else(|| part.get(&effect_key_hash)) {
                    Some(BinValue::I32(i)) => *i as i32,
                    Some(BinValue::U32(i)) => *i as i32,
                    Some(BinValue::I16(i)) => *i as i32,
                    Some(BinValue::U16(i)) => *i as i32,
                    Some(BinValue::U8(i)) => *i as i32,
                    Some(BinValue::I8(i)) => *i as i32,
                    _ => 0,
                };
                let key = format!("effect{}", idx);
                if use_var_names {
                    return key;
                }
                if let Some(vals) = dv_map.get(&key) {
                    return dv_to_str(vals, 5);
                }
                return format!("{{{}}}", key);
            }

            if ptype == "StatByCoefficientCalculationPart" || ptype == "{5815b0a9}" {
                let coeff = match part.get("mCoefficient") {
                    Some(BinValue::Float(f)) => *f,
                    Some(BinValue::I32(i)) => *i as f32,
                    _ => 1.0,
                };
                let pct = (coeff * 100.0 * 100.0).round() / 100.0;
                let stat_id = match part.get("mStat") {
                    Some(BinValue::I32(i)) => Some(*i),
                    Some(BinValue::I16(i)) => Some(*i as i32),
                    Some(BinValue::U8(i)) => Some(*i as i32),
                    _ => None,
                };
                return format!("{}%{}", pct, stat_name(stat_id));
            }

            if ptype == "StatByNamedDataValueCalculationPart" || ptype == "{52834b6e}" {
                let name = match part.get("mDataValue") {
                    Some(BinValue::String(s)) | Some(BinValue::Hash(s)) => s.to_string(),
                    _ => "??".to_string(),
                };
                let stat_id = match part.get("mStat") {
                    Some(BinValue::I32(i)) => Some(*i),
                    Some(BinValue::I16(i)) => Some(*i as i32),
                    Some(BinValue::U8(i)) => Some(*i as i32),
                    _ => None,
                };
                if use_var_names {
                    return format!("{{{}*100}}%{}", name, stat_name(stat_id));
                }
                if let Some(vals) = dv_map.get(&name.to_lowercase()) {
                    let mapped: Vec<f32> = vals.iter().map(|&v| (v * 100.0 * 100.0).round() / 100.0).collect();
                    return format!("{}%{}", dv_to_str(&mapped, 5), stat_name(stat_id));
                }
                return format!("{{{}*100}}%{}", name, stat_name(stat_id));
            }

            if ptype == "StatBySubPartCalculationPart" || ptype == "{5ab29e30}" {
                let stat_id = match part.get("mStat") {
                    Some(BinValue::I32(i)) => Some(*i),
                    Some(BinValue::I16(i)) => Some(*i as i32),
                    Some(BinValue::U8(i)) => Some(*i as i32),
                    _ => None,
                };
                if let Some(sub) = part.get("mSubpart") {
                    let s = part_to_formula(sub, dv_map, all_calcs, use_var_names);
                    return format!("{}%{}", s, stat_name(stat_id));
                }
                return format!("?%{}", stat_name(stat_id));
            }

            if ptype == "ByCharLevelInterpolationCalculationPart" || ptype == "{bb6b35ee}" {
                let s = match part.get("mStartValue") {
                    Some(BinValue::Float(f)) => *f,
                    Some(BinValue::I32(i)) => *i as f32,
                    _ => 0.0,
                };
                let e = match part.get("mEndValue") {
                    Some(BinValue::Float(f)) => *f,
                    Some(BinValue::I32(i)) => *i as f32,
                    _ => 0.0,
                };
                let sv = (s * 10000.0).round() / 10000.0;
                let ev = (e * 10000.0).round() / 10000.0;
                return format!("{}~{}(Lv1-18)", sv, ev);
            }

            if ptype == "ByCharLevelBreakpointsCalculationPart" || ptype == "{09d8aa04}" {
                let lv1 = match part.get("mLevel1Value") {
                    Some(BinValue::Float(f)) => *f,
                    Some(BinValue::I32(i)) => *i as f32,
                    _ => 0.0,
                };
                return format!("LevelBreakpoints({})", lv1);
            }

            if ptype == "SumOfSubPartsCalculationPart" || ptype == "{d607e492}" {
                let mut parts = Vec::new();
                if let Some(BinValue::List(subs)) = part.get("mSubparts") {
                    for sp in subs {
                        parts.push(part_to_formula(sp, dv_map, all_calcs, use_var_names));
                    }
                }
                return format!("({})", parts.join(" + "));
            }

            if ptype == "ProductOfSubPartsCalculationPart" || ptype == "{17fd1e1f}" {
                let mut parts = Vec::new();
                if let Some(p1) = part.get("mPart1") {
                    parts.push(part_to_formula(p1, dv_map, all_calcs, use_var_names));
                }
                if let Some(p2) = part.get("mPart2") {
                    parts.push(part_to_formula(p2, dv_map, all_calcs, use_var_names));
                }
                if let Some(BinValue::List(subs)) = part.get("mSubparts") {
                    for sp in subs {
                        parts.push(part_to_formula(sp, dv_map, all_calcs, use_var_names));
                    }
                }
                return format!("({})", parts.join(" × "));
            }

            if ptype == "AbilityResourceByCoefficientCalculationPart" || ptype == "{8fa5dbf6}" {
                let coeff = match part.get("mCoefficient") {
                    Some(BinValue::Float(f)) => *f,
                    Some(BinValue::I32(i)) => *i as f32,
                    _ => 1.0,
                };
                let pct = (coeff * 100.0 * 100.0).round() / 100.0;
                return format!("{}%MaxMana", pct);
            }

            if ptype == "BuffCounterByCoefficientCalculationPart" || ptype == "{a7dcfdbe}" {
                let buff = match part.get("mBuff") {
                    Some(BinValue::String(s)) | Some(BinValue::Hash(s)) => s.to_string(),
                    _ => "??".to_string(),
                };
                let coeff = match part.get("mCoefficient") {
                    Some(BinValue::Float(f)) => *f,
                    Some(BinValue::I32(i)) => *i as f32,
                    _ => 1.0,
                };
                return format!("BuffCount({})×{}", buff, coeff);
            }

            return format!("[{}]", ptype);
        }
        "?".to_string()
    }

    fn resolve_multiplier(mult_val: &BinValue, dv_map: &HashMap<String, Vec<f32>>, max_rank: usize) -> String {
        if let BinValue::Struct(mult) | BinValue::Embedded(mult) = mult_val {
            if let Some(BinValue::String(k) | BinValue::Hash(k)) = mult.get("mSpellCalculationKey") {
                return format!("{{{}}}", k);
            }
            let ptype = match mult.get("__type") {
                Some(BinValue::Hash(s)) | Some(BinValue::String(s)) => s.as_str(),
                _ => "",
            };

            if ptype == "NumberCalculationPart" || ptype == "{d2179e8e}" {
                let num = match mult.get("mNumber") {
                    Some(BinValue::Float(f)) => *f,
                    Some(BinValue::I32(i)) => *i as f32,
                    _ => 1.0,
                };
                return num.to_string();
            }

            if ptype == "NamedDataValueCalculationPart" || ptype == "{332eb441}" {
                let name = match mult.get("mDataValue") {
                    Some(BinValue::String(s)) | Some(BinValue::Hash(s)) => s.to_string(),
                    _ => "??".to_string(),
                };
                if let Some(vals) = dv_map.get(&name.to_lowercase()) {
                    return dv_to_str(vals, max_rank);
                }
                return format!("{{{}}}", name);
            }

            if ptype == "SumOfSubPartsCalculationPart" || ptype == "{d607e492}" {
                let mut parts = Vec::new();
                if let Some(BinValue::List(subs)) = mult.get("mSubparts") {
                    for sp in subs {
                        parts.push(resolve_multiplier(sp, dv_map, max_rank));
                    }
                }
                return format!("({})", parts.join(" + "));
            }

            if ptype == "ProductOfSubPartsCalculationPart" || ptype == "{17fd1e1f}" {
                let mut parts = Vec::new();
                if let Some(p1) = mult.get("mPart1") {
                    parts.push(resolve_multiplier(p1, dv_map, max_rank));
                }
                if let Some(p2) = mult.get("mPart2") {
                    parts.push(resolve_multiplier(p2, dv_map, max_rank));
                }
                return format!("({})", parts.join(" × "));
            }

            if ptype == "StatByCoefficientCalculationPart" || ptype == "{5815b0a9}" {
                let coeff = match mult.get("mCoefficient") {
                    Some(BinValue::Float(f)) => *f,
                    Some(BinValue::I32(i)) => *i as f32,
                    _ => 1.0,
                };
                let pct = (coeff * 100.0).round();
                let stat_id = match mult.get("mStat") {
                    Some(BinValue::I32(i)) => Some(*i),
                    Some(BinValue::I16(i)) => Some(*i as i32),
                    Some(BinValue::U8(i)) => Some(*i as i32),
                    _ => None,
                };
                return format!("{}%{}", pct, stat_name(stat_id));
            }

            return format!("[{}]", ptype);
        }
        "1".to_string()
    }

    fn calc_to_formula(
        calc_val: &BinValue,
        dv_map: &HashMap<String, Vec<f32>>,
        all_calcs: &HashMap<String, BinValue>,
        depth: usize,
        use_var_names: bool,
    ) -> String {
        if depth > 5 {
            return "?".to_string();
        }
        if let BinValue::Struct(calc) | BinValue::Embedded(calc) = calc_val {
            let t = match calc.get("__type") {
                Some(BinValue::Hash(s)) | Some(BinValue::String(s)) => s.as_str(),
                _ => "",
            };

            if t == "GameCalculation" || t == "{b6dd4cc3}" {
                let mut parts = Vec::new();
                if let Some(BinValue::List(fps)) = calc.get("mFormulaParts") {
                    for p in fps {
                        parts.push(part_to_formula(p, dv_map, all_calcs, use_var_names));
                    }
                }
                let is_pct = match calc.get("mDisplayAsPercent") {
                    Some(BinValue::U8(1)) => true,
                    _ => false,
                };
                let mut s = parts.join(" + ");
                if is_pct {
                    s.push_str(" (displayAs%)");
                }
                return s;
            }

            if t == "GameCalculationModified" || t == "{f27c3ff5}" {
                let base_key = match calc.get("mModifiedGameCalculation") {
                    Some(BinValue::String(s)) | Some(BinValue::Hash(s)) => s.to_string(),
                    _ => "??".to_string(),
                };
                let mut base_calc = all_calcs.get(&base_key);
                if base_calc.is_none() {
                    for (k, v) in all_calcs {
                        if k.eq_ignore_ascii_case(&base_key) {
                            base_calc = Some(v);
                            break;
                        }
                    }
                }
                let base_formula = if let Some(b) = base_calc {
                    calc_to_formula(b, dv_map, all_calcs, depth + 1, use_var_names)
                } else {
                    format!("{{{}}}", base_key)
                };
                let mult = if let Some(m) = calc.get("mMultiplier") {
                    part_to_formula(m, dv_map, all_calcs, use_var_names)
                } else {
                    "1".to_string()
                };
                return format!("({}) × {}", base_formula, mult);
            }

            if t == "{f3cbe7b2}" {
                if let Some(BinValue::String(k) | BinValue::Hash(k)) = calc.get("mSpellCalculationKey") {
                    let mut base_calc = all_calcs.get(k);
                    if base_calc.is_none() {
                        for (key, v) in all_calcs {
                            if key.eq_ignore_ascii_case(k) {
                                base_calc = Some(v);
                                break;
                            }
                        }
                    }
                    if let Some(b) = base_calc {
                        return calc_to_formula(b, dv_map, all_calcs, depth + 1, use_var_names);
                    }
                }
            }

            if t == "GameCalculationConditional" || t == "{c0d45300}" {
                return format!("Conditional(default={})", "?");
            }

            return format!("[{}]", t);
        }
        "?".to_string()
    }

    #[derive(Clone, Debug)]
    struct CalcArray {
        base: Vec<f32>,
        ap: Vec<f32>,
    }

    fn eval_part(
        part_val: &BinValue,
        dv_map: &HashMap<String, Vec<f32>>,
        all_calcs: &HashMap<String, BinValue>,
        max_rank: usize,
        depth: usize,
    ) -> Option<CalcArray> {
        if depth > 5 {
            return None;
        }
        if let BinValue::Struct(part) | BinValue::Embedded(part) = part_val {
            if let Some(BinValue::String(k) | BinValue::Hash(k)) = part.get("mSpellCalculationKey") {
                let mut ref_calc = all_calcs.get(k);
                if ref_calc.is_none() {
                    for (key, v) in all_calcs {
                        if key.eq_ignore_ascii_case(k) {
                            ref_calc = Some(v);
                            break;
                        }
                    }
                }
                if let Some(r) = ref_calc {
                    return resolve_calc_arrays(r, dv_map, all_calcs, max_rank, depth + 1);
                }
                return None;
            }

            let ptype = match part.get("__type") {
                Some(BinValue::Hash(s)) | Some(BinValue::String(s)) => s.as_str(),
                _ => "",
            };

            if let Some(BinValue::List(vals)) = part.get("mValues") {
                let mut arr = Vec::new();
                for v in vals {
                    match v {
                        BinValue::Float(f) => arr.push(*f),
                        BinValue::I32(i) => arr.push(*i as f32),
                        BinValue::U32(u) => arr.push(*u as f32),
                        BinValue::U8(u) => arr.push(*u as f32),
                        BinValue::I8(i) => arr.push(*i as f32),
                        BinValue::U16(u) => arr.push(*u as f32),
                        BinValue::I16(i) => arr.push(*i as f32),
                        _ => {}
                    }
                }
                if !arr.is_empty() {
                    let arr = slice_for_rank(&arr, max_rank);
                    return Some(CalcArray {
                        base: arr.clone(),
                        ap: vec![0.0; arr.len()],
                    });
                }
            }

            let extract_float = |val: &BinValue| -> f32 {
                match val {
                    BinValue::Float(f) => *f,
                    BinValue::I32(i) => *i as f32,
                    BinValue::U32(u) => *u as f32,
                    BinValue::U8(u) => *u as f32,
                    BinValue::I8(i) => *i as f32,
                    BinValue::U16(u) => *u as f32,
                    BinValue::I16(i) => *i as f32,
                    _ => 0.0,
                }
            };

            if let Some(BinValue::List(vals)) = part.get("mValues") {
                let arr: Vec<f32> = vals.iter().map(extract_float).collect();
                let arr = slice_for_rank(&arr, max_rank);
                return Some(CalcArray {
                    base: arr.clone(),
                    ap: vec![0.0; arr.len()],
                });
            }

            if ptype == "NamedDataValueCalculationPart" || ptype == "{332eb441}" {
                let name = match part.get("mDataValue") {
                    Some(BinValue::String(s)) | Some(BinValue::Hash(s)) => s.to_string(),
                    _ => String::new(),
                };
                if let Some(vals) = dv_map.get(&name.to_lowercase()) {
                    let arr = slice_for_rank(vals, max_rank);
                    return Some(CalcArray {
                        base: arr.clone(),
                        ap: vec![0.0; arr.len()],
                    });
                }
            }

            let effect_key_hash = format!("{{{:08x}}}", crate::wad::hash::fnv1a_32("mEffectIndex"));
            let is_effect_part = ptype == "EffectValueCalculationPart"
                || ptype == "{8bc08357}"
                || part.get("mEffectIndex").is_some()
                || part.get(&effect_key_hash).is_some();
            if is_effect_part {
                let idx = match part.get("mEffectIndex").or_else(|| part.get(&effect_key_hash)) {
                    Some(BinValue::I32(i)) => *i as i32,
                    Some(BinValue::U32(i)) => *i as i32,
                    Some(BinValue::I16(i)) => *i as i32,
                    Some(BinValue::U16(i)) => *i as i32,
                    Some(BinValue::U8(i)) => *i as i32,
                    Some(BinValue::I8(i)) => *i as i32,
                    _ => 0,
                };
                let key = format!("effect{}", idx);
                if let Some(vals) = dv_map.get(&key) {
                    let arr = slice_for_rank(vals, max_rank);
                    return Some(CalcArray {
                        base: arr.clone(),
                        ap: vec![0.0; arr.len()],
                    });
                }
            }

            if ptype == "NumberCalculationPart" || ptype == "{d2179e8e}" {
                let v = match part.get("mNumber") {
                    Some(BinValue::Float(f)) => *f,
                    Some(BinValue::I32(i)) => *i as f32,
                    _ => 0.0,
                };
                return Some(CalcArray {
                    base: vec![v; max_rank],
                    ap: vec![0.0; max_rank],
                });
            }

            if ptype == "ByCharLevelBreakpointsCalculationPart" || ptype == "{09d8aa04}" {
                let lv1 = match part.get("mLevel1Value") {
                    Some(BinValue::Float(f)) => *f,
                    Some(BinValue::I32(i)) => *i as f32,
                    _ => 0.0,
                };
                return Some(CalcArray {
                    base: vec![lv1; max_rank],
                    ap: vec![0.0; max_rank],
                });
            }

            if ptype == "StatByCoefficientCalculationPart" || ptype == "{5815b0a9}" {
                let coeff = match part.get("mCoefficient") {
                    Some(BinValue::Float(f)) => *f,
                    Some(BinValue::I32(i)) => *i as f32,
                    _ => 1.0,
                };
                let stat_id = match part.get("mStat") {
                    Some(BinValue::I32(i)) => Some(*i),
                    Some(BinValue::I16(i)) => Some(*i as i32),
                    Some(BinValue::U8(i)) => Some(*i as i32),
                    _ => None,
                };
                if stat_name(stat_id) == "AP" {
                    return Some(CalcArray {
                        base: vec![0.0; max_rank],
                        ap: vec![coeff; max_rank],
                    });
                }
                return Some(CalcArray { base: vec![], ap: vec![] });
            }

            if ptype == "SumOfSubPartsCalculationPart" || ptype == "{d607e492}" {
                let mut subs = Vec::new();
                if let Some(BinValue::List(ls)) = part.get("mSubparts") {
                    for sp in ls {
                        if let Some(evaled) = eval_part(sp, dv_map, all_calcs, max_rank, depth) {
                            subs.push(evaled);
                        } else {
                            // If any part fails to evaluate (e.g., AD scaling), fail the whole sum to force string fallback
                            return None;
                        }
                    }
                }
                let mut b = vec![0.0; max_rank];
                let mut a = vec![0.0; max_rank];
                for p in subs {
                    for i in 0..max_rank {
                        let b_val = *p.base.get(i).unwrap_or(p.base.last().unwrap_or(&0.0));
                        let a_val = *p.ap.get(i).unwrap_or(p.ap.last().unwrap_or(&0.0));
                        b[i] += b_val;
                        a[i] += a_val;
                    }
                }
                return Some(CalcArray { base: b, ap: a });
            }

            if ptype == "ProductOfSubPartsCalculationPart" || ptype == "{17fd1e1f}" {
                let mut p1 = None;
                if let Some(part1) = part.get("mPart1") {
                    p1 = eval_part(part1, dv_map, all_calcs, max_rank, depth);
                }
                let mut p2 = None;
                if let Some(part2) = part.get("mPart2") {
                    p2 = eval_part(part2, dv_map, all_calcs, max_rank, depth);
                }
                if p1.is_none() && part.get("mPart1").is_none() {
                    p1 = Some(CalcArray {
                        base: vec![1.0; max_rank],
                        ap: vec![0.0; max_rank],
                    });
                }
                if p2.is_none() && part.get("mPart2").is_none() {
                    p2 = Some(CalcArray {
                        base: vec![1.0; max_rank],
                        ap: vec![0.0; max_rank],
                    });
                }

                if let (Some(arr1), Some(arr2)) = (p1, p2) {
                    let mut b = vec![0.0; max_rank];
                    let mut a = vec![0.0; max_rank];
                    for i in 0..max_rank {
                        let b1 = *arr1.base.get(i).unwrap_or(arr1.base.last().unwrap_or(&0.0));
                        let a1 = *arr1.ap.get(i).unwrap_or(arr1.ap.last().unwrap_or(&0.0));
                        let b2 = *arr2.base.get(i).unwrap_or(arr2.base.last().unwrap_or(&0.0));
                        let a2 = *arr2.ap.get(i).unwrap_or(arr2.ap.last().unwrap_or(&0.0));
                        b[i] = b1 * b2;
                        a[i] = b1 * a2 + b2 * a1; // ignore quadratic
                    }
                    return Some(CalcArray { base: b, ap: a });
                }
            }
        }
        None
    }

    fn resolve_calc_arrays(
        calc_val: &BinValue,
        dv_map: &HashMap<String, Vec<f32>>,
        all_calcs: &HashMap<String, BinValue>,
        max_rank: usize,
        depth: usize,
    ) -> Option<CalcArray> {
        if depth > 5 {
            return None;
        }
        if let BinValue::Struct(calc) | BinValue::Embedded(calc) = calc_val {
            let t = match calc.get("__type") {
                Some(BinValue::Hash(s)) | Some(BinValue::String(s)) => s.as_str(),
                _ => "",
            };

            if t == "GameCalculation" || t == "{b6dd4cc3}" || t == "{f3cbe7b2}" {
                if t == "{f3cbe7b2}" {
                    if let Some(BinValue::String(k) | BinValue::Hash(k)) = calc.get("mSpellCalculationKey") {
                        let mut base_calc = all_calcs.get(k);
                        if base_calc.is_none() {
                            for (key, v) in all_calcs {
                                if key.eq_ignore_ascii_case(k) {
                                    base_calc = Some(v);
                                    break;
                                }
                            }
                        }
                        if let Some(b) = base_calc {
                            return resolve_calc_arrays(b, dv_map, all_calcs, max_rank, depth + 1);
                        }
                    }
                }

                let mut base_arr = vec![0.0; max_rank];
                let mut ap_arr = vec![0.0; max_rank];

                if let Some(BinValue::List(fps)) = calc.get("mFormulaParts") {
                    for p in fps {
                        if let Some(r) = eval_part(p, dv_map, all_calcs, max_rank, depth) {
                            for i in 0..max_rank {
                                let bi = *r.base.get(i).unwrap_or(r.base.last().unwrap_or(&0.0));
                                let ai = *r.ap.get(i).unwrap_or(r.ap.last().unwrap_or(&0.0));
                                base_arr[i] += bi;
                                ap_arr[i] += ai;
                            }
                        } else {
                            // If any formula part fails to evaluate cleanly into arrays, fail entirely.
                            return None;
                        }
                    }
                }
                return Some(CalcArray { base: base_arr, ap: ap_arr });
            }
        }
        None
    }

    fn resolve_calc(
        calc_val: &BinValue,
        dv_map: &HashMap<String, Vec<f32>>,
        all_calcs: &HashMap<String, BinValue>,
        max_rank: usize,
        depth: usize,
    ) -> Option<String> {
        fn parse_num_list(s: &str) -> Option<Vec<f32>> {
            let cleaned = s.replace(' ', "");
            if cleaned.is_empty() {
                return None;
            }
            let parts: Vec<&str> = cleaned.split('/').collect();
            let mut vals = Vec::new();
            for p in parts {
                if p.is_empty() {
                    return None;
                }
                if !p.chars().all(|c| c.is_ascii_digit() || c == '.' || c == '-') {
                    return None;
                }
                if let Ok(v) = p.parse::<f32>() {
                    vals.push(v);
                } else {
                    return None;
                }
            }
            Some(vals)
        }

        fn format_num_list(vals: &[f32]) -> String {
            let rounded: Vec<f32> = vals.iter().map(|v| (v * 100.0).round() / 100.0).collect();
            if rounded.is_empty() {
                return String::new();
            }
            if rounded.len() == 1 {
                return rounded[0].to_string();
            }
            rounded.iter().map(|v| v.to_string()).collect::<Vec<_>>().join("/")
        }

        fn multiply_ranked(values: &[f32], multipliers: &[f32]) -> Vec<f32> {
            if values.is_empty() || multipliers.is_empty() {
                return Vec::new();
            }
            if multipliers.len() == 1 {
                let m = multipliers[0];
                return values.iter().map(|v| v * m).collect();
            }
            values
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    let m = *multipliers.get(i).unwrap_or(multipliers.last().unwrap_or(&1.0));
                    v * m
                })
                .collect()
        }

        fn split_resolved_base_and_scaling(s: &str) -> (String, Option<String>) {
            let st = s.trim();
            if st.starts_with('(') && st.ends_with(')') {
                return (String::new(), Some(st[1..st.len() - 1].trim().to_string()));
            }
            if let Some(idx) = st.rfind(" (") {
                if st.ends_with(')') {
                    let base = st[..idx].trim().to_string();
                    let scale = st[idx + 2..st.len() - 1].trim().to_string();
                    return (base, Some(scale));
                }
            }
            (st.to_string(), None)
        }

        fn scale_stat_expression(expr: &str, multipliers: &[f32]) -> Option<String> {
            let re = regex::Regex::new(r"([+-]?\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)*)%([A-Za-z]+)").ok()?;
            let mut out_terms: Vec<String> = Vec::new();
            for cap in re.captures_iter(expr) {
                let raw_num = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                let stat = cap.get(2).map(|m| m.as_str()).unwrap_or("");
                if raw_num.is_empty() || stat.is_empty() {
                    continue;
                }

                let sign = if raw_num.starts_with('-') { "-" } else { "+" };
                let abs_num = raw_num.trim_start_matches('+').trim_start_matches('-');
                let vals = parse_num_list(abs_num)?;
                let scaled = multiply_ranked(&vals, multipliers);
                if scaled.is_empty() {
                    continue;
                }
                let nums = format_num_list(&scaled);
                out_terms.push(format!("{}{}%{}", sign, nums, stat));
            }

            if out_terms.is_empty() {
                None
            } else {
                Some(out_terms.join(" "))
            }
        }

        if depth > 5 {
            return None;
        }
        if let BinValue::Struct(calc) | BinValue::Embedded(calc) = calc_val {
            let t = match calc.get("__type") {
                Some(BinValue::Hash(s)) | Some(BinValue::String(s)) => s.as_str(),
                _ => "",
            };

            if t == "GameCalculation" || t == "{b6dd4cc3}" || t == "{f3cbe7b2}" {
                if t == "{f3cbe7b2}" {
                    if let Some(BinValue::String(k) | BinValue::Hash(k)) = calc.get("mSpellCalculationKey") {
                        let mut base_calc = all_calcs.get(k);
                        if base_calc.is_none() {
                            for (key, v) in all_calcs {
                                if key.eq_ignore_ascii_case(k) {
                                    base_calc = Some(v);
                                    break;
                                }
                            }
                        }
                        if let Some(b) = base_calc {
                            return resolve_calc(b, dv_map, all_calcs, max_rank, depth + 1);
                        }
                    }
                }

                let detail = resolve_calc_arrays(calc_val, dv_map, all_calcs, max_rank, depth);
                if let Some(d) = detail {
                    let mut base_arr = d.base;
                    let mut ap_arr = d.ap;

                    let is_pct = match calc.get("mDisplayAsPercent") {
                        Some(BinValue::U8(1)) => true,
                        _ => false,
                    };

                    if is_pct {
                        for v in &mut base_arr {
                            *v *= 100.0;
                        }
                        for v in &mut ap_arr {
                            *v *= 100.0;
                        }
                    }

                    let mut base_str = String::new();

                    let rounded: Vec<f32> = base_arr.iter().map(|v| (v * 100.0).round() / 100.0).collect();
                    if !rounded.is_empty() {
                        let all_same = rounded.iter().all(|&v| (v - rounded[0]).abs() < f32::EPSILON);
                        base_str = if all_same {
                            rounded[0].to_string()
                        } else {
                            rounded.iter().map(|v| v.to_string()).collect::<Vec<_>>().join("/")
                        };
                    }

                    let mut result = base_str;
                    if ap_arr.iter().any(|&v| v.abs() > f32::EPSILON) {
                        let pct: Vec<String> = ap_arr
                            .iter()
                            .map(|&v| ((v * 1000.0).round() / 10.0).to_string())
                            .collect();
                        if !result.is_empty() {
                            result.push_str(" + ");
                        }
                        result.push_str("(");
                        let all_same_ap = pct.iter().all(|v| v == &pct[0]);
                        if all_same_ap {
                            result.push_str(&pct[0]);
                        } else {
                            result.push_str(&pct.join("/"));
                        }
                        result.push_str("%AP)");
                    }
                    if result.is_empty() {
                        return None;
                    }
                    return Some(result);
                }

                let is_pct = match calc.get("mDisplayAsPercent") {
                    Some(BinValue::U8(1)) => true,
                    _ => false,
                };
                let mut base_values: Vec<Vec<String>> = Vec::new();
                let mut scalings: Vec<String> = Vec::new();

                if let Some(BinValue::List(fps)) = calc.get("mFormulaParts") {
                    for part_val in fps {
                        if let BinValue::Struct(part) | BinValue::Embedded(part) = part_val {
                            if let Some(BinValue::String(k) | BinValue::Hash(k)) = part.get("mSpellCalculationKey") {
                                let mut ref_calc = all_calcs.get(k);
                                if ref_calc.is_none() {
                                    for (key, v) in all_calcs {
                                        if key.eq_ignore_ascii_case(k) {
                                            ref_calc = Some(v);
                                            break;
                                        }
                                    }
                                }
                                if let Some(r) = ref_calc {
                                    if let Some(res) = resolve_calc(r, dv_map, all_calcs, max_rank, depth + 1) {
                                        base_values.push(vec![res]);
                                    }
                                }
                                continue;
                            }

                            let pt = match part.get("__type") {
                                Some(BinValue::Hash(s)) | Some(BinValue::String(s)) => s.as_str(),
                                _ => "",
                            };

                            if pt == "ProductOfSubPartsCalculationPart"
                                || pt == "SumOfSubPartsCalculationPart"
                                || pt == "{d607e492}"
                                || pt == "{17fd1e1f}"
                            {
                                let text = part_to_formula(part_val, dv_map, all_calcs, false);
                                base_values.push(vec![text]);
                                continue;
                            }

                            if pt == "NamedDataValueCalculationPart" || pt == "{332eb441}" {
                                let name = match part.get("mDataValue") {
                                    Some(BinValue::String(s)) | Some(BinValue::Hash(s)) => s.to_lowercase(),
                                    _ => String::new(),
                                };
                                let target_vals = dv_map.get(&name).or_else(|| dv_map.get(&format!("{{{}}}", name)));
                                if let Some(vals) = target_vals {
                                    let arr = slice_for_rank(vals, max_rank);
                                    let mut mapped_str = Vec::new();
                                    for v in arr {
                                        let v_mapped = if is_pct {
                                            (v * 100.0 * 100.0).round() / 100.0
                                        } else {
                                            (v * 100.0).round() / 100.0
                                        };
                                        mapped_str.push(v_mapped.to_string());
                                    }
                                    base_values.push(mapped_str);
                                }
                            } else {
                                let effect_key_hash = format!("{{{:08x}}}", crate::wad::hash::fnv1a_32("mEffectIndex"));
                                let is_effect_part = pt == "EffectValueCalculationPart"
                                    || pt == "{8bc08357}"
                                    || part.get("mEffectIndex").is_some()
                                    || part.get(&effect_key_hash).is_some();
                                if is_effect_part {
                                    let idx = match part.get("mEffectIndex").or_else(|| part.get(&effect_key_hash)) {
                                        Some(BinValue::I32(i)) => *i as i32,
                                        Some(BinValue::U32(i)) => *i as i32,
                                        Some(BinValue::I16(i)) => *i as i32,
                                        Some(BinValue::U16(i)) => *i as i32,
                                        Some(BinValue::U8(i)) => *i as i32,
                                        Some(BinValue::I8(i)) => *i as i32,
                                        _ => 0,
                                    };
                                    let key = format!("effect{}", idx);
                                    if let Some(vals) = dv_map.get(&key) {
                                        let arr = slice_for_rank(vals, max_rank);
                                        let mut mapped_str = Vec::new();
                                        for v in arr {
                                            let v_mapped = if is_pct {
                                                (v * 100.0 * 100.0).round() / 100.0
                                            } else {
                                                (v * 100.0).round() / 100.0
                                            };
                                            mapped_str.push(v_mapped.to_string());
                                        }
                                        base_values.push(mapped_str);
                                    }
                                    continue;
                                }
                            }
                            if pt == "NumberCalculationPart" || pt == "{d2179e8e}" {
                                let v = match part.get("mNumber") {
                                    Some(BinValue::Float(f)) => *f,
                                    Some(BinValue::I32(i)) => *i as f32,
                                    _ => 0.0,
                                };
                                let v_mapped = if is_pct { (v * 100.0 * 100.0).round() / 100.0 } else { v };
                                base_values.push(vec![v_mapped.to_string(); max_rank]);
                            } else if pt == "ByCharLevelInterpolationCalculationPart" || pt == "{bb6b35ee}" {
                                let s = match part.get("mStartValue") {
                                    Some(BinValue::Float(f)) => *f,
                                    Some(BinValue::I32(i)) => *i as f32,
                                    _ => 0.0,
                                };
                                let e = match part.get("mEndValue") {
                                    Some(BinValue::Float(f)) => *f,
                                    Some(BinValue::I32(i)) => *i as f32,
                                    _ => 0.0,
                                };
                                let sv = if is_pct {
                                    (s * 100.0 * 100.0).round() / 100.0
                                } else {
                                    (s * 100.0).round() / 100.0
                                };
                                let ev = if is_pct {
                                    (e * 100.0 * 100.0).round() / 100.0
                                } else {
                                    (e * 100.0).round() / 100.0
                                };
                                base_values.push(vec![format!("{}~{}", sv, ev)]);
                            } else if pt == "StatByCoefficientCalculationPart" || pt == "{5815b0a9}" {
                                let coeff = match part.get("mCoefficient") {
                                    Some(BinValue::Float(f)) => *f,
                                    Some(BinValue::I32(i)) => *i as f32,
                                    _ => 1.0,
                                };
                                let pct = (coeff * 100.0 * 10.0).round() / 10.0;
                                let stat_id = match part.get("mStat") {
                                    Some(BinValue::I32(i)) => Some(*i),
                                    Some(BinValue::I16(i)) => Some(*i as i32),
                                    Some(BinValue::U8(i)) => Some(*i as i32),
                                    _ => None,
                                };
                                scalings.push(format!("+{}%{}", pct, stat_name(stat_id)));
                            } else if pt == "StatByNamedDataValueCalculationPart" || pt == "{52834b6e}" {
                                let name = match part.get("mDataValue") {
                                    Some(BinValue::String(s)) | Some(BinValue::Hash(s)) => s.to_lowercase(),
                                    _ => String::new(),
                                };
                                let target_vals = dv_map.get(&name).or_else(|| dv_map.get(&format!("{{{}}}", name)));
                                if let Some(vals) = target_vals {
                                    let mapped: Vec<f32> = slice_for_rank(vals, max_rank)
                                        .iter()
                                        .map(|&v| (v * 100.0 * 100.0).round() / 100.0)
                                        .collect();
                                    let all_same = mapped.iter().all(|&v| (v - mapped[0]).abs() < f32::EPSILON);
                                    let pct_str = if all_same {
                                        mapped[0].to_string()
                                    } else {
                                        mapped.iter().map(|v| v.to_string()).collect::<Vec<_>>().join("/")
                                    };
                                    let stat_id = match part.get("mStat") {
                                        Some(BinValue::I32(i)) => Some(*i),
                                        Some(BinValue::I16(i)) => Some(*i as i32),
                                        Some(BinValue::U8(i)) => Some(*i as i32),
                                        _ => None,
                                    };
                                    scalings.push(format!("+{}%{}", pct_str, stat_name(stat_id)));
                                }
                            } else if pt == "StatBySubPartCalculationPart" || pt == "{5ab29e30}" {
                                if let Some(BinValue::Struct(sub) | BinValue::Embedded(sub)) = part.get("mSubpart") {
                                    let sub_t = match sub.get("__type") {
                                        Some(BinValue::Hash(s)) | Some(BinValue::String(s)) => s.as_str(),
                                        _ => "",
                                    };
                                    let mut added_from_named_subpart = false;
                                    if sub_t == "NamedDataValueCalculationPart" || sub_t == "{332eb441}" {
                                        let name = match sub.get("mDataValue") {
                                            Some(BinValue::String(s)) | Some(BinValue::Hash(s)) => s.to_lowercase(),
                                            _ => String::new(),
                                        };
                                        if let Some(vals) = dv_map.get(&name) {
                                            let mapped: Vec<f32> = slice_for_rank(vals, max_rank)
                                                .iter()
                                                .map(|&v| (v * 100.0 * 10.0).round() / 10.0)
                                                .collect();
                                            let all_same = mapped.iter().all(|&v| (v - mapped[0]).abs() < f32::EPSILON);
                                            let pct_str = if all_same {
                                                mapped[0].to_string()
                                            } else {
                                                mapped.iter().map(|v| v.to_string()).collect::<Vec<_>>().join("/")
                                            };
                                            let stat_id = match part.get("mStat") {
                                                Some(BinValue::I32(i)) => Some(*i),
                                                Some(BinValue::I16(i)) => Some(*i as i32),
                                                Some(BinValue::U8(i)) => Some(*i as i32),
                                                _ => None,
                                            };
                                            scalings.push(format!("+{}%{}", pct_str, stat_name(stat_id)));
                                            added_from_named_subpart = true;
                                        }
                                    }
                                    if !added_from_named_subpart {
                                        let sub_text = part_to_formula(
                                            &BinValue::Struct(sub.clone()),
                                            dv_map,
                                            all_calcs,
                                            false,
                                        );
                                        if let Some(vals) = parse_num_list(&sub_text) {
                                            let mapped: Vec<f32> = vals
                                                .iter()
                                                .map(|v| (v * 100.0 * 10.0).round() / 10.0)
                                                .collect();
                                            let all_same =
                                                mapped.iter().all(|&v| (v - mapped[0]).abs() < f32::EPSILON);
                                            let pct_str = if all_same {
                                                mapped[0].to_string()
                                            } else {
                                                mapped.iter().map(|v| v.to_string()).collect::<Vec<_>>().join("/")
                                            };
                                            let stat_id = match part.get("mStat") {
                                                Some(BinValue::I32(i)) => Some(*i),
                                                Some(BinValue::I16(i)) => Some(*i as i32),
                                                Some(BinValue::U8(i)) => Some(*i as i32),
                                                _ => None,
                                            };
                                            scalings.push(format!("+{}%{}", pct_str, stat_name(stat_id)));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                let mut base_str = String::new();
                if !base_values.is_empty() {
                    let all_string = base_values.iter().all(|arr| {
                        arr.len() == 1 && arr[0].contains(|c: char| !c.is_numeric() && c != '.' && c != '-' && c != '/')
                    });
                    if all_string {
                        let parts: Vec<String> = base_values.into_iter().map(|mut arr| arr.remove(0)).collect();
                        base_str = parts.join(" + ");
                    } else {
                        let mut summed = vec![0.0; max_rank];
                        for arr in base_values {
                            for i in 0..max_rank {
                                let default_zero = "0".to_string();
                                let s = arr.get(i).unwrap_or(arr.last().unwrap_or(&default_zero));
                                if let Ok(v) = s.parse::<f32>() {
                                    summed[i] += v;
                                }
                            }
                        }
                        let rounded: Vec<f32> = summed.iter().map(|v| (v * 100.0).round() / 100.0).collect();
                        let all_same = rounded.iter().all(|&v| (v - rounded[0]).abs() < f32::EPSILON);
                        if all_same {
                            base_str = rounded[0].to_string();
                        } else {
                            base_str = rounded.iter().map(|v| v.to_string()).collect::<Vec<_>>().join("/");
                        }
                    }
                }

                let mut result = base_str;
                if !scalings.is_empty() {
                    if !result.is_empty() {
                        result.push_str(" ");
                    }
                    result.push_str("(");
                    result.push_str(&scalings.join(" "));
                    result.push_str(")");
                }
                if result.is_empty() {
                    return None;
                }
                return Some(result);
            }

            if t == "GameCalculationModified" || t == "{f27c3ff5}" {
                let base_key = match calc.get("mModifiedGameCalculation") {
                    Some(BinValue::String(s)) | Some(BinValue::Hash(s)) => s.to_string(),
                    _ => String::new(),
                };
                let mut base_calc = all_calcs.get(&base_key);
                if base_calc.is_none() {
                    for (k, v) in all_calcs {
                        if k.eq_ignore_ascii_case(&base_key) {
                            base_calc = Some(v);
                            break;
                        }
                    }
                }
                let base_resolved = if let Some(b) = base_calc {
                    resolve_calc(b, dv_map, all_calcs, max_rank, depth + 1)
                } else {
                    None
                };
                let mult_str = if let Some(m) = calc.get("mMultiplier") {
                    Some(resolve_multiplier(m, dv_map, max_rank))
                } else {
                    None
                };
                if let (Some(b), Some(m)) = (base_resolved.clone(), mult_str) {
                    if let Some(m_vals) = parse_num_list(&m) {
                        let (base_part, scaling_part) = split_resolved_base_and_scaling(&b);
                        if let Some(base_vals) = parse_num_list(&base_part) {
                            let out = multiply_ranked(&base_vals, &m_vals);
                            if !out.is_empty() {
                                let mut rendered = format_num_list(&out);
                                if let Some(scale_expr) = scaling_part {
                                    if let Some(scaled_expr) = scale_stat_expression(&scale_expr, &m_vals) {
                                        rendered.push_str(" (");
                                        rendered.push_str(&scaled_expr);
                                        rendered.push(')');
                                    }
                                }
                                return Some(rendered);
                            }
                        }
                    }
                    return Some(format!("{} * {}", b, m));
                }
                return base_resolved;
            }
        }
        None
    }

    let mut all_calcs_map: HashMap<String, BinValue> = HashMap::new();
    let mut spell_vars = std::collections::HashMap::new();
    let mut dbg_calcs_map = serde_json::Map::new();

    if let Some(BinValue::Map(calcs)) = m_spell.get("mSpellCalculations") {
        for (k, v) in calcs.iter() {
            all_calcs_map.insert(k.clone(), v.clone());
        }

        for (calc_key, calc_val) in calcs.iter() {
            let formula = calc_to_formula(calc_val, &data_values_map, &all_calcs_map, 0, true);
            let substituted_formula = calc_to_formula(calc_val, &data_values_map, &all_calcs_map, 0, false);

            if let Some(resolved) = resolve_calc(calc_val, &data_values_map, &all_calcs_map, 5, 0) {
                let mut dbg_calc_obj = serde_json::Map::new();
                dbg_calc_obj.insert("formula".to_string(), serde_json::Value::String(formula));
                dbg_calc_obj.insert(
                    "substitutedFormula".to_string(),
                    serde_json::Value::String(substituted_formula),
                );
                dbg_calc_obj.insert("resolvedValue".to_string(), serde_json::Value::String(resolved.clone()));
                dbg_calcs_map.insert(calc_key.clone(), serde_json::Value::Object(dbg_calc_obj));

                // Always add the full resolved value under the base lowercase key
                spell_vars.insert(calc_key.to_lowercase(), resolved.clone());

                let mut make_dbg_full = serde_json::Map::new();
                make_dbg_full.insert(
                    "source".to_string(),
                    serde_json::Value::String("calculationFull".to_string()),
                );
                make_dbg_full.insert(
                    "calculationKey".to_string(),
                    serde_json::Value::String(calc_key.clone()),
                );
                make_dbg_full.insert("resolvedValue".to_string(), serde_json::Value::String(resolved.clone()));
                dbg_var_map.insert(calc_key.to_lowercase(), serde_json::Value::Object(make_dbg_full));

                // Extract scaling string just like JS
                let mut scaling_str = None;
                if resolved.contains(" + (") && resolved.ends_with(")") {
                    let inner = &resolved[resolved.find(" + (").unwrap() + 4..resolved.len() - 1];
                    scaling_str = Some(format!(
                        "+{}",
                        inner.trim().trim_start_matches('+')
                    ));
                } else if resolved.contains(" (") && resolved.ends_with(")") {
                    let inner = &resolved[resolved.find(" (").unwrap() + 2..resolved.len() - 1];
                    scaling_str = Some(format!(
                        "+{}",
                        inner.trim().trim_start_matches('+')
                    ));
                } else if resolved.starts_with("(") && resolved.ends_with(")") {
                    scaling_str = Some(format!(
                        "+{}",
                        resolved[1..resolved.len() - 1].trim().trim_start_matches('+')
                    ));
                } else {
                    let re = regex::Regex::new(r"^[\d\.\/]+%[A-Za-z]+$").unwrap();
                    if re.is_match(&resolved) {
                        scaling_str = Some(format!("+{}", resolved));
                    }
                }

                if let Some(ss) = scaling_str {
                    let hashed_key = format!("{{{:08x}}}", crate::wad::hash::fnv1a_32(calc_key));

                    // Add flat map for scaling strings
                    // To prevent overwriting the full string on hashed keys, we insert hashed_key_calc instead if it overlaps
                    if calc_key.starts_with("{") && calc_key.ends_with("}") {
                        spell_vars.insert(format!("{}_calc", hashed_key), ss.clone());
                    } else {
                        spell_vars.insert(hashed_key.clone(), ss.clone());
                    }
                    spell_vars.insert(format!("{}_calc", calc_key.to_lowercase()), ss.clone());

                    // Add debug vars
                    let make_dbg = |src: &str, ss_val: &String| -> serde_json::Value {
                        let mut m = serde_json::Map::new();
                        m.insert("source".to_string(), serde_json::Value::String(src.to_string()));
                        m.insert(
                            "calculationKey".to_string(),
                            serde_json::Value::String(calc_key.clone()),
                        );
                        m.insert("resolvedValue".to_string(), serde_json::Value::String(ss_val.clone()));
                        serde_json::Value::Object(m)
                    };

                    if calc_key.starts_with("{") && calc_key.ends_with("}") {
                        dbg_var_map.insert(format!("{}_calc", hashed_key), make_dbg("calculationScaling", &ss));
                    } else {
                        dbg_var_map.insert(hashed_key, make_dbg("calculationScaling", &ss));
                    }
                    dbg_var_map.insert(
                        format!("{}_calc", calc_key.to_lowercase()),
                        make_dbg("calculationScaling", &ss),
                    );
                }
            }
        }
    }

    for (k, v) in data_values_map.iter() {
        if !v.is_empty() {
            let ranks_to_format = if v.len() >= 6 {
                let end = std::cmp::min(v.len(), 6);
                &v[1..end]
            } else if v.len() > 1 && v[0] == 0.0 {
                let end = std::cmp::min(v.len(), 6);
                &v[1..end]
            } else {
                let end = std::cmp::min(v.len(), 6);
                &v[0..end]
            };

            let formatted = dv_to_str(ranks_to_format, 6);
            if !formatted.is_empty() && formatted != "0" {
                spell_vars.insert(k.clone(), formatted.clone());

                let mut dv_dbg = serde_json::Map::new();
                dv_dbg.insert("source".to_string(), serde_json::Value::String("dataValue".to_string()));
                dv_dbg.insert("resolvedValue".to_string(), serde_json::Value::String(formatted));
                dbg_var_map.insert(k.clone(), serde_json::Value::Object(dv_dbg));
            }
        }
    }

    let mut main_dbg_obj = serde_json::Map::new();
    main_dbg_obj.insert("calculations".to_string(), serde_json::Value::Object(dbg_calcs_map));
    main_dbg_obj.insert("variableMapping".to_string(), serde_json::Value::Object(dbg_var_map));

    Some((
        spell_id.clone(),
        SpellExtractionResult {
            flat_map: spell_vars,
            debug_json: serde_json::Value::Object(main_dbg_obj),
            m_script_name: spell_id,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wad::parser::{parse_wad_entries, extract_file_from_wad};
    use crate::wad::bin::parse_prop;
    use std::path::PathBuf;

    #[test]
    fn test_dump_character_record() {
        let install_dir = crate::wad::updater::get_league_install_dir().unwrap_or(PathBuf::from("C:/Riot Games/League of Legends"));
        let wad_path = install_dir.join("Game/DATA/FINAL/Champions/Caitlyn.wad.client");
        if !wad_path.exists() {
            println!("No caitlyn wad found");
            return;
        }

        let mut db = crate::wad::hash::build_basic_hash_db();
        let words = vec!["Character", "mCharacter", "mSpells", "spellNames", "Abilities", "CharacterRecord"];
        for w in words {
            db.insert(crate::wad::hash::fnv1a_32(w), w.to_string());
        }

        let entries = parse_wad_entries(&wad_path).unwrap();
        for entry in entries {
            if entry.comp_size > 0 && (entry.comp_type == 0 || entry.comp_type == 2 || entry.comp_type == 3 || entry.comp_type == 36) {
                if let Ok(data) = extract_file_from_wad(&wad_path, &entry) {
                    if data.len() >= 4 && (&data[0..4] == b"PROP" || &data[0..4] == b"PTCH") {
                        if let Ok(parsed) = parse_prop(&data, &db) {
                            for (key, prop_val) in parsed {
                                if key.to_lowercase().contains("characterrecords/root") {
                                    println!("FOUND ROOT: {}", key);
                                    if let BinValue::Struct(obj) | BinValue::Embedded(obj) = prop_val {
                                        for (k, v) in obj {
                                            println!("  k: {} -> {:?}", k, v);
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
