use super::bin::BinValue;
use std::collections::HashMap;

pub fn resolve_stat_name(m_stat: Option<&BinValue>, data_value_name: &str) -> String {
    let sid = match m_stat {
        Some(BinValue::String(s)) => s.clone(),
        Some(BinValue::U8(n)) => n.to_string(),
        Some(BinValue::I8(n)) => n.to_string(),
        Some(BinValue::U16(n)) => n.to_string(),
        Some(BinValue::I16(n)) => n.to_string(),
        Some(BinValue::U32(n)) => n.to_string(),
        Some(BinValue::I32(n)) => n.to_string(),
        Some(BinValue::U64(n)) => n.to_string(),
        Some(BinValue::I64(n)) => n.to_string(),
        Some(BinValue::Hash(s)) => s.clone(),
        _ => String::new(),
    };

    let dvn = data_value_name.to_lowercase();

    if sid.contains("AttackDamage") || sid == "2" {
        return "{AD}".to_string();
    }
    if sid.contains("BonusAttackDamage") || sid == "14" {
        return "{BonusAD}".to_string();
    }
    if sid.contains("AbilityPower") || sid == "1" || sid == "100" {
        return "{AP}".to_string();
    }
    if sid.contains("BonusHealth") || sid == "12" {
        return "{BonusHealth}".to_string();
    }
    if sid.contains("Health") || sid == "0" || sid == "11" {
        return "{Health}".to_string();
    }
    if sid.contains("Armor") || sid == "5" {
        return "{Armor}".to_string();
    }
    if sid.contains("BonusArmor") || sid == "17" {
        return "{BonusArmor}".to_string();
    }
    if sid.contains("SpellBlock") || sid.contains("MagicResist") || sid == "6" {
        return "{MagicResist}".to_string();
    }
    if sid.contains("BonusMagicResist") || sid == "18" {
        return "{BonusMagicResist}".to_string();
    }
    if sid.contains("AttackSpeed") || sid == "3" || sid == "36" {
        return "{AttackSpeed}".to_string();
    }
    if sid.contains("MoveSpeed") || sid == "4" {
        return "{MoveSpeed}".to_string();
    }
    if sid.contains("CritChance") || sid == "7" {
        return "{CritChance}".to_string();
    }
    if sid.contains("CritDamage") || sid == "8" {
        return "{CritDamage}".to_string();
    }
    if sid.contains("LifeSteal") || sid == "10" {
        return "{LifeSteal}".to_string();
    }
    if sid.contains("Lethality") || sid == "15" {
        return "{Lethality}".to_string();
    }
    if sid == "9" {
        return "{AbilityHaste}".to_string();
    }

    if dvn.contains("ad") || dvn.contains("attack") {
        return "{AD}".to_string();
    }
    if dvn.contains("ap") || dvn.contains("ability") {
        return "{AP}".to_string();
    }
    if dvn.contains("hp") || dvn.contains("health") {
        return "{Health}".to_string();
    }

    "{AD}".to_string()
}

pub fn format_ranks(ranks: &[f32]) -> String {
    if ranks.is_empty() {
        return String::new();
    }
    let end = std::cmp::min(ranks.len(), 6);
    let clean = &ranks[0..end];

    let first = clean[0];
    let all_same = clean.iter().all(|&v| (v * 100.0).round() == (first * 100.0).round());

    if all_same {
        return format!("{}", first); // Note: ideally we want general number formatting
    }

    let strs: Vec<String> = clean.iter().map(|&v| format!("{}", v)).collect();
    strs.join("/")
}

pub fn extract_spell_vars(spell_obj: &HashMap<String, BinValue>) -> Option<(String, HashMap<String, String>)> {
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

    let mut data_values_map: HashMap<String, Vec<f32>> = HashMap::new();

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

                data_values_map.insert(name.to_lowercase(), vals);
            }
        }
    }

    let mut calc_map: HashMap<String, String> = HashMap::new();
    if let Some(BinValue::Map(calcs)) = m_spell.get("mSpellCalculations") {
        for (calc_key, calc_val) in calcs.iter() {
            if let BinValue::Struct(calc) | BinValue::Embedded(calc) = calc_val {
                let is_percent = match calc.get("mDisplayAsPercent") {
                    Some(BinValue::Bool(b)) => *b,
                    Some(BinValue::U8(n)) => *n != 0,
                    _ => false,
                };

                let mut local_scalings = Vec::new();

                if let Some(BinValue::List(formula_parts)) = calc.get("mFormulaParts") {
                    for part_val in formula_parts {
                        if let BinValue::Struct(part) | BinValue::Embedded(part) = part_val {
                            let ptype = match part.get("__type") {
                                Some(BinValue::Hash(s)) => s.as_str(),
                                Some(BinValue::String(s)) => s.as_str(),
                                _ => "",
                            };

                            if ptype == "StatByCoefficientCalculationPart" || ptype == "{d95eaffe}" {
                                let mut coeff = match part.get("mCoefficient") {
                                    Some(BinValue::Float(f)) => *f,
                                    Some(BinValue::I32(i)) => *i as f32,
                                    _ => 0.0,
                                };
                                if is_percent {
                                    coeff *= 100.0;
                                }
                                // Updated call to resolve_stat_name
                                let stat_match = resolve_stat_name(part.get("mStat"), "");
                                // Removed DEBUG println!
                                local_scalings.push(format!("+{}% {}", (coeff * 100.0).round(), stat_match));
                            } else if ptype == "NamedDataValueCalculationPart" || ptype == "{79c3b878}" {
                                let dv_key = match part.get("mDataValue") {
                                    Some(BinValue::String(s)) => s.to_lowercase(),
                                    Some(BinValue::Hash(s)) => s.to_lowercase(),
                                    _ => String::new(),
                                };
                                if let Some(arr) = data_values_map.get(&dv_key) {
                                    let mut new_arr = arr.clone();
                                    if is_percent {
                                        for v in new_arr.iter_mut() {
                                            *v = (*v * 100.0 * 10.0).round() / 10.0;
                                        }
                                    }
                                    data_values_map.insert(calc_key.to_lowercase(), new_arr);
                                }
                            } else {
                                let mut m_data_value = None;
                                let mut m_stat = None;
                                // let mut m_stat_formula = None; // Removed as per instruction

                                if ptype == "StatByNamedDataValueCalculationPart" || ptype == "{8fa5fc3c}" {
                                    m_data_value = part.get("mDataValue");
                                    m_stat = part.get("mStat");
                                    // m_stat_formula = part.get("mStatFormula"); // Removed as per instruction
                                } else if ptype == "StatBySubPartCalculationPart" || ptype == "{39480a40}" {
                                    if let Some(BinValue::Struct(subpart)) | Some(BinValue::Embedded(subpart)) =
                                        part.get("mSubpart")
                                    {
                                        let sptype = match subpart.get("__type") {
                                            Some(BinValue::Hash(s)) => s.as_str(),
                                            Some(BinValue::String(s)) => s.as_str(),
                                            _ => "",
                                        };
                                        if sptype == "NamedDataValueCalculationPart" || sptype == "{79c3b878}" {
                                            m_data_value = subpart.get("mDataValue");
                                            m_stat = part.get("mStat");
                                            // m_stat_formula = part.get("mStatFormula"); // Removed as per instruction
                                        }
                                    }
                                }

                                if let Some(dv_val) = m_data_value {
                                    let dv_key = match dv_val {
                                        BinValue::String(s) => s.to_lowercase(),
                                        BinValue::Hash(s) => s.to_lowercase(),
                                        _ => String::new(),
                                    };
                                    if !dv_key.is_empty() {
                                        if let Some(arr) = data_values_map.get(&dv_key) {
                                            if !arr.is_empty() {
                                                // Updated call to resolve_stat_name
                                                let stat_match = resolve_stat_name(m_stat, &dv_key);
                                                let mut ranks = arr.clone();
                                                if ranks.len() > 5 {
                                                    let end = std::cmp::min(ranks.len(), 6);
                                                    ranks = ranks[1..end].to_vec();
                                                }
                                                let mult = if is_percent { 10000.0 } else { 100.0 };
                                                let first = ranks[0];
                                                let all_same =
                                                    ranks.iter().all(|&v| (v * mult).round() == (first * mult).round());

                                                // Removed DEBUG println!

                                                if all_same {
                                                    local_scalings.push(format!(
                                                        "+{}% {}",
                                                        (first * mult).round(),
                                                        stat_match
                                                    ));
                                                } else {
                                                    let strs: Vec<String> = ranks
                                                        .iter()
                                                        .map(|&v| format!("{}", (v * mult).round()))
                                                        .collect();
                                                    local_scalings.push(format!("+{}% {}", strs.join("/"), stat_match));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if !local_scalings.is_empty() {
                    calc_map.insert(calc_key.to_lowercase(), local_scalings.join(" "));
                }
            }
        }
    }

    let mut spell_vars = HashMap::new();
    for (k, v) in data_values_map.iter() {
        if !v.is_empty() {
            let ranks_to_format = if v.len() > 1 && v[0] == 0.0 {
                let end = std::cmp::min(v.len(), 6);
                &v[1..end]
            } else {
                let end = std::cmp::min(v.len(), 6);
                &v[0..end]
            };

            let formatted = format_ranks(ranks_to_format);
            if !formatted.is_empty() && formatted != "0" {
                spell_vars.insert(k.clone(), formatted);
            }
        }
    }

    for (k, v) in calc_map.into_iter() {
        if !v.is_empty() {
            spell_vars.insert(k, v);
        }
    }

    Some((spell_id, spell_vars))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_stat_name() {
        let sid = Some(BinValue::U8(6));
        let res = resolve_stat_name(sid.as_ref(), "");
        assert_eq!(res, "{MagicResist}");

        let sid2 = None;
        let res2 = resolve_stat_name(sid2, "");
        assert_eq!(res2, "{AD}");
    }
}
