use std::path::PathBuf;

fn main() {
    let install_dir = crate::wad::updater::get_league_install_dir().unwrap();
    let mut sett_wad: Option<PathBuf> = None;
    for wad in crate::wad::updater::get_champion_wads(&install_dir) {
        if let Some(name) = wad.file_name() {
            if name.to_string_lossy() == "Sett.wad.client" {
                sett_wad = Some(wad);
                break;
            }
        }
    }

    let db = crate::wad::updater::load_hash_db();
    let entries = crate::wad::parser::parse_wad_entries(sett_wad.as_ref().unwrap()).unwrap();
    for entry in entries {
        if entry.comp_size > 0 {
            if let Ok(data) = crate::wad::parser::extract_file_from_wad(sett_wad.as_ref().unwrap(), &entry) {
                if data.len() >= 4 && (data.as_slice().starts_with(b"PROP") || data.as_slice().starts_with(b"PTCH")) {
                    if let Ok(parsed) = crate::wad::parser::parse_prop(&data, &db) {
                        for (_, prop_val) in parsed {
                            if let crate::wad::parser::BinValue::Struct(obj)
                            | crate::wad::parser::BinValue::Embedded(obj) = prop_val
                            {
                                if let Some(crate::wad::parser::BinValue::Hash(t)) = obj.get("__type") {
                                    if t == "SpellObject" {
                                        if let Some(crate::wad::parser::BinValue::Hash(name)) = obj.get("mScriptName") {
                                            if name == "SettQ" {
                                                if let Some(crate::wad::parser::BinValue::Map(calcs)) =
                                                    obj.get("mSpellCalculations")
                                                {
                                                    for (k, v) in calcs.iter() {
                                                        if k == "MaxHealthDamageCalc" {
                                                            println!("Found MaxHealthDamageCalc in SettQ: {:#?}", v);
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
}
