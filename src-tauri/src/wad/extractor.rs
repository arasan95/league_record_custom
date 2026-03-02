use super::bin::BinValue;
use std::collections::HashMap;

pub fn resolve_stat_name(
    m_stat: Option<&BinValue>,
    m_stat_formula: Option<&BinValue>,
    data_value_name: &str,
) -> String {
    let mut sids = Vec::new();

    if let Some(st) = m_stat {
        match st {
            BinValue::String(s) => sids.push(s.clone()),
            BinValue::U8(n) => sids.push(n.to_string()),
            BinValue::I8(n) => sids.push(n.to_string()),
            BinValue::U16(n) => sids.push(n.to_string()),
            BinValue::I16(n) => sids.push(n.to_string()),
            BinValue::U32(n) => sids.push(n.to_string()),
            BinValue::I32(n) => sids.push(n.to_string()),
            BinValue::U64(n) => sids.push(n.to_string()),
            BinValue::I64(n) => sids.push(n.to_string()),
            BinValue::Hash(s) => sids.push(s.clone()),
            _ => {}
        }
    }

    if let Some(sf) = m_stat_formula {
        match sf {
            BinValue::String(s) => sids.push(s.clone()),
            BinValue::U8(n) => sids.push(n.to_string()),
            BinValue::I8(n) => sids.push(n.to_string()),
            BinValue::U16(n) => sids.push(n.to_string()),
            BinValue::I16(n) => sids.push(n.to_string()),
            BinValue::U32(n) => sids.push(n.to_string()),
            BinValue::I32(n) => sids.push(n.to_string()),
            BinValue::U64(n) => sids.push(n.to_string()),
            BinValue::I64(n) => sids.push(n.to_string()),
            BinValue::Hash(s) => sids.push(s.clone()),
            _ => {}
        }
    }

    let has_stat = |target: &str| -> bool { sids.iter().any(|s| s == target || s.contains(target)) };

    let dvn = data_value_name.to_lowercase();

    if has_stat("AttackDamage") || has_stat("2") {
        return "{AD}".to_string();
    }
    if has_stat("BonusAttackDamage") || has_stat("14") {
        return "{BonusAD}".to_string();
    }
    if has_stat("AbilityPower") || has_stat("1") || has_stat("10") || has_stat("100") {
        return "{AP}".to_string();
    }
    if has_stat("BonusHealth") || has_stat("12") {
        return "{BonusHealth}".to_string();
    }
    if has_stat("Health") || has_stat("0") || has_stat("11") {
        return "{Health}".to_string();
    }
    if has_stat("Armor") || has_stat("5") {
        return "{Armor}".to_string();
    }
    if has_stat("BonusArmor") || has_stat("17") {
        return "{BonusArmor}".to_string();
    }
    if has_stat("SpellBlock") || has_stat("MagicResist") || has_stat("6") {
        return "{MagicResist}".to_string();
    }
    if has_stat("BonusMagicResist") || has_stat("18") {
        return "{BonusMagicResist}".to_string();
    }
    if has_stat("AttackSpeed") || has_stat("3") || has_stat("36") {
        return "{AttackSpeed}".to_string();
    }
    if has_stat("MoveSpeed") || has_stat("4") {
        return "{MoveSpeed}".to_string();
    }
    if has_stat("CritChance") || has_stat("7") {
        return "{CritChance}".to_string();
    }
    if has_stat("CritDamage") || has_stat("8") {
        return "{CritDamage}".to_string();
    }
    if has_stat("LifeSteal") || has_stat("10") {
        return "{LifeSteal}".to_string();
    }
    if has_stat("Lethality") || has_stat("15") {
        return "{Lethality}".to_string();
    }
    if has_stat("9") {
        return "{AbilityHaste}".to_string();
    }

    if dvn.contains("ad") || dvn.contains("attack") {
        return "{AD}".to_string();
    }
    if dvn.contains("ap") || dvn.contains("ability") || dvn.contains("magic") || dvn.contains("ratio") {
        if dvn.contains("ad") || dvn.contains("attack") {
            // AD ratio overrides
            return "{AD}".to_string();
        }
        return "{AP}".to_string();
    }
    if dvn.contains("hp") || dvn.contains("health") {
        return "{Health}".to_string();
    }

    if dvn.contains("speed") {
        if dvn.contains("attack") {
            return "{AttackSpeed}".to_string();
        }
        return "{MoveSpeed}".to_string();
    }

    // Default to an empty string instead of {AD} to prevent false AD scalings
    String::new()
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
    let mut hash_to_name: HashMap<String, String> = HashMap::new();

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

                            if ptype == "StatByCoefficientCalculationPart" || ptype == "{5815b0a9}" {
                                let coeff = match part.get("mCoefficient") {
                                    Some(BinValue::Float(f)) => *f,
                                    Some(BinValue::I32(i)) => *i as f32,
                                    _ => 0.0,
                                };
                                // Always treat as a standard multiplier (* 100) for tooltip display strings.
                                // Do not multiply by 100 again just because it's a percent calculation.
                                // Try to resolve the actual name for the calc_key to help with Stat guesses
                                let actual_calc_name = hash_to_name.get(calc_key).unwrap_or(calc_key);
                                let mut stat_match =
                                    resolve_stat_name(part.get("mStat"), part.get("mStatFormula"), actual_calc_name);

                                // If stat_match is completely empty for a coefficient scaling, it's very likely {AP}
                                if stat_match.trim().is_empty() {
                                    stat_match = "{AP}".to_string();
                                }

                                // To get 1.1 from 0.011 we scale by 100 and format.
                                // Multiply by 10.0 and round, then divide by 10.0 to keep 1 decimal place (e.g. 1.1)
                                let display_val = (coeff * 100.0 * 10.0).round() / 10.0;
                                local_scalings.push(format!("+{}% {}", display_val, stat_match));
                            } else if ptype == "NamedDataValueCalculationPart" || ptype == "{332eb441}" {
                                let dv_key = match part.get("mDataValue") {
                                    Some(BinValue::String(s)) => s.to_lowercase(),
                                    Some(BinValue::Hash(s)) => s.to_lowercase(),
                                    _ => String::new(),
                                };
                                if let Some(arr) = data_values_map.get(&dv_key) {
                                    let mut new_arr = arr.clone();
                                    if is_percent {
                                        for v in new_arr.iter_mut() {
                                            // Heuristics: if value is small, it's likely a decimal percentage (e.g. 0.1 -> 10%)
                                            // If it's already > 5.0 naturally, it might already be an integer percent (e.g. 16 -> 16%)
                                            if v.abs() < 5.0 && v.abs() > 0.0 {
                                                *v = (*v * 100.0 * 10.0).round() / 10.0;
                                            } else {
                                                *v = (*v * 10.0).round() / 10.0;
                                            }
                                        }
                                    }

                                    let key_str = calc_key.to_lowercase();
                                    data_values_map.insert(key_str, new_arr);
                                }
                            } else {
                                let mut m_data_value = None;
                                let mut m_stat = None;
                                let mut m_stat_formula = None;

                                if ptype == "StatByNamedDataValueCalculationPart" || ptype == "{5f5c70a4}" {
                                    m_data_value = part.get("mDataValue");
                                    m_stat = part.get("mStat");
                                    m_stat_formula = part.get("mStatFormula");
                                } else if ptype == "StatBySubPartCalculationPart" || ptype == "{cd156c7f}" {
                                    if let Some(BinValue::Struct(subpart)) | Some(BinValue::Embedded(subpart)) =
                                        part.get("mSubpart")
                                    {
                                        let sptype = match subpart.get("__type") {
                                            Some(BinValue::Hash(s)) => s.as_str(),
                                            Some(BinValue::String(s)) => s.as_str(),
                                            _ => "",
                                        };
                                        if sptype == "NamedDataValueCalculationPart" || sptype == "{332eb441}" {
                                            m_data_value = subpart.get("mDataValue");
                                            m_stat = part.get("mStat");
                                            m_stat_formula = part.get("mStatFormula");
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
                                                let actual_name = hash_to_name.get(&dv_key).unwrap_or(&dv_key);
                                                // Updated call to resolve_stat_name with the plain text name (if available)
                                                let mut stat_match =
                                                    resolve_stat_name(m_stat, m_stat_formula, actual_name);
                                                if stat_match.trim().is_empty() {
                                                    stat_match = "{AP}".to_string();
                                                }
                                                let mut ranks = arr.clone();
                                                if ranks.len() > 5 {
                                                    let end = std::cmp::min(ranks.len(), 6);
                                                    ranks = ranks[1..end].to_vec();
                                                }
                                                // Always use 100.0 for scaling to percentage display
                                                let mult = 100.0;
                                                let first = ranks[0];
                                                let all_same = ranks.iter().all(|&v| {
                                                    (v * mult * 10.0).round() == (first * mult * 10.0).round()
                                                });

                                                // Removed DEBUG println!

                                                if all_same {
                                                    let display_val = (first * mult * 10.0).round() / 10.0;
                                                    local_scalings.push(format!("+{}% {}", display_val, stat_match));
                                                } else {
                                                    let strs: Vec<String> = ranks
                                                        .iter()
                                                        .map(|&v| format!("{}", (v * mult * 10.0).round() / 10.0))
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

            let formatted = format_ranks(ranks_to_format);
            if !formatted.is_empty() && formatted != "0" {
                spell_vars.insert(k.clone(), formatted);
            }
        }
    }

    for (k, v) in calc_map.into_iter() {
        if !v.is_empty() {
            spell_vars.insert(format!("{}_calc", k), v);
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
        let res = resolve_stat_name(sid.as_ref(), None, "");
        assert_eq!(res, "{MagicResist}");

        let sid2 = None;
        let res2 = resolve_stat_name(sid2, None, "");
        assert_eq!(res2, "");
    }
}
