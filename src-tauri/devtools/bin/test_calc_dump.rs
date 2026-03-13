use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[path = "../wad/mod.rs"]
mod wad;

use wad::bin::{parse_prop, BinValue};
use wad::hash::{build_basic_hash_db, fnv1a_32};
use wad::parser::{extract_file_from_wad, parse_wad_entries};
use wad::updater::get_league_install_dir;

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

fn dv_to_str(vals: &[f32], max_rank: usize) -> String {
    let mut arr = vals.to_vec();
    if arr.len() > max_rank {
        arr.remove(0);
    }
    if arr.len() > max_rank {
        arr.truncate(max_rank);
    }
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

        // Also support tooltip only wrappers like {f3cbe7b2}
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

        if ptype == "NamedDataValueCalculationPart" || ptype == "{332eb441}" {
            let name = match part.get("mDataValue") {
                Some(BinValue::String(s)) | Some(BinValue::Hash(s)) => s.to_string(),
                _ => String::new(),
            };
            if let Some(vals) = dv_map.get(&name.to_lowercase()) {
                let mut arr = vals.to_vec();
                if arr.len() > max_rank {
                    arr.remove(0);
                }
                if arr.len() > max_rank {
                    arr.truncate(max_rank);
                }
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
            // Check if f3cbe7b2 redirects
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
                let base_arr = d.base;
                let ap_arr = d.ap;
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

            // Fallback evaluation for other scalings not supported by linear resolution
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
                            if let Some(vals) = dv_map.get(&name) {
                                let mut arr = vals.to_vec();
                                if arr.len() > max_rank + 1 && arr[0] <= 0.0 && arr[1] > 0.0 {
                                    arr.remove(0);
                                }
                                if arr.len() > max_rank {
                                    arr.truncate(max_rank);
                                }
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
                        } else if pt == "NumberCalculationPart" || pt == "{d2179e8e}" {
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
                            if let Some(vals) = dv_map.get(&name) {
                                let mapped: Vec<f32> = vals
                                    .iter()
                                    .take(max_rank)
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
                            }
                        } else if pt == "StatBySubPartCalculationPart" || pt == "{5ab29e30}" {
                            if let Some(BinValue::Struct(sub) | BinValue::Embedded(sub)) = part.get("mSubpart") {
                                let sub_t = match sub.get("__type") {
                                    Some(BinValue::Hash(s)) | Some(BinValue::String(s)) => s.as_str(),
                                    _ => "",
                                };
                                if sub_t == "NamedDataValueCalculationPart" || sub_t == "{332eb441}" {
                                    let name = match sub.get("mDataValue") {
                                        Some(BinValue::String(s)) | Some(BinValue::Hash(s)) => s.to_lowercase(),
                                        _ => String::new(),
                                    };
                                    if let Some(vals) = dv_map.get(&name) {
                                        let mapped: Vec<f32> = vals
                                            .iter()
                                            .take(max_rank)
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
                                    }
                                }
                            }
                        }
                    }
                }
            }

            let mut base_str = String::new();
            if !base_values.is_empty() {
                let all_string = base_values
                    .iter()
                    .all(|arr| arr.len() == 1 && arr[0].contains(|c: char| !c.is_numeric() && c != '.' && c != '-'));
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
                return Some(format!("[{}] × {}", b, m));
            }
            return base_resolved;
        }
    }
    None
}

fn test_champion(champ: &str) {
    println!("--- Testing calculation formulas for: {} ---", champ);
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
        "mSubparts",
        "InitialDamage",
        "ExplosionDamage",
        "ExplosionCount",
        "TotalExplosionDamage",
        "AllDamageHit",
        "NumberCalculationPart",
    ];
    for w in common {
        db.insert(fnv1a_32(w), w.to_string());
    }

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
                                        if let Some(BinValue::Struct(ms) | BinValue::Embedded(ms)) = obj.get("mSpell") {
                                            // Process DataValues
                                            let mut dv_map = HashMap::new();
                                            if let Some(BinValue::List(dvs)) = ms.get("DataValues") {
                                                for dv in dvs {
                                                    if let BinValue::Struct(dvo) | BinValue::Embedded(dvo) = dv {
                                                        if let Some(BinValue::String(n) | BinValue::Hash(n)) =
                                                            dvo.get("mName")
                                                        {
                                                            if let Some(BinValue::List(vals)) = dvo.get("mValues") {
                                                                let mut floats = Vec::new();
                                                                for v in vals {
                                                                    if let BinValue::Float(f) = v {
                                                                        floats.push(*f);
                                                                    }
                                                                }
                                                                if !floats.is_empty() {
                                                                    dv_map.insert(n.to_lowercase(), floats);
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }

                                            // Process Calculations
                                            let mut all_calcs: HashMap<String, BinValue> = HashMap::new();
                                            if let Some(BinValue::Map(calcs_map)) = ms.get("mSpellCalculations") {
                                                for (k, v) in calcs_map {
                                                    all_calcs.insert(k.clone(), v.clone());
                                                }

                                                for (k, v) in calcs_map {
                                                    if k == "{28408fda}"
                                                        || k == "AllDamageHit"
                                                        || k == "{c6579b07}"
                                                        || k == "TotalExplosionDamage"
                                                    {
                                                        let formula = calc_to_formula(v, &dv_map, &all_calcs, 0, true);
                                                        let substituted =
                                                            calc_to_formula(v, &dv_map, &all_calcs, 0, false);
                                                        let resolved = resolve_calc(v, &dv_map, &all_calcs, 5, 0);
                                                        println!("Calc: {}", k);
                                                        println!("  formula: {}", formula);
                                                        println!("  substitutedFormula: {}", substituted);
                                                        println!(
                                                            "  resolvedValue: {}",
                                                            resolved.unwrap_or_else(|| "null".to_string())
                                                        );
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
    }
}

fn main() {
    test_champion("Mel");
}
