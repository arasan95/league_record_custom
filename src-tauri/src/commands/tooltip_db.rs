use std::path::PathBuf;

use tauri::AppHandle;

fn ensure_tooltip_db_installed(app_handle: &AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_dir = app_data_dir.join("tooltip_db");
    if !db_dir.exists() {
        std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
    }
    let target_db = db_dir.join("tooltip_data.db");
    if target_db.exists() {
        // Recover from corrupted/empty user DB by refreshing from bundled resource DB.
        if !tooltip_db_has_rows(&target_db) {
            copy_bundled_tooltip_db(app_handle, &target_db)?;
        }
        return Ok(target_db);
    }

    let source_db = find_bundled_tooltip_db(app_handle)?;
    std::fs::copy(source_db, &target_db).map_err(|e| format!("Failed to copy tooltip DB from resources: {}", e))?;
    Ok(target_db)
}

fn find_bundled_tooltip_db(app_handle: &AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    let resource_dir = app_handle.path().resource_dir().map_err(|e| e.to_string())?;
    let source_candidates = [
        resource_dir.join("tooltip_data.db"),
        resource_dir.join("resources").join("tooltip_data.db"),
    ];

    source_candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .ok_or_else(|| "Bundled tooltip_data.db not found in resources".to_string())
}

fn copy_bundled_tooltip_db(app_handle: &AppHandle, target_db: &PathBuf) -> Result<(), String> {
    let source_db = find_bundled_tooltip_db(app_handle)?;
    std::fs::copy(source_db, target_db).map_err(|e| format!("Failed to copy tooltip DB from resources: {}", e))?;
    Ok(())
}

fn read_tooltip_locale_json(db_path: &PathBuf, locale: &str) -> Result<Option<String>, String> {
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("Failed to open tooltip DB ({}): {}", db_path.display(), e))?;
    let mut stmt = conn
        .prepare("SELECT data_json FROM champion_tooltips WHERE locale = ?1 LIMIT 1")
        .map_err(|e| format!("Failed to prepare tooltip DB query: {}", e))?;
    let mut rows = stmt
        .query([locale])
        .map_err(|e| format!("Failed to execute tooltip DB query: {}", e))?;

    if let Some(row) = rows
        .next()
        .map_err(|e| format!("Failed to read tooltip DB row: {}", e))?
    {
        let data_json: String = row
            .get(0)
            .map_err(|e| format!("Failed to decode tooltip DB row: {}", e))?;
        Ok(Some(data_json))
    } else {
        Ok(None)
    }
}

fn is_tooltip_locale_payload_valid(data_json: &str) -> bool {
    let parsed = match serde_json::from_str::<serde_json::Value>(data_json) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let root = match parsed.as_object() {
        Some(obj) => obj,
        None => return false,
    };
    if root.len() < 120 {
        return false;
    }

    let mut champions = 0usize;
    let mut with_spell_map = 0usize;
    let mut with_champion_local = 0usize;
    for v in root.values() {
        let Some(champ) = v.as_object() else {
            continue;
        };
        champions += 1;
        if champ.get("spell_map").and_then(|x| x.as_object()).is_some() {
            with_spell_map += 1;
        }
        if champ
            .get("champion_local")
            .and_then(|x| x.as_str())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
        {
            with_champion_local += 1;
        }
    }

    // Legacy payloads can pass the old spell_map ratio check but still miss important
    // champion-specific detailed blocks (notably Aphelios weapon summary/bonus lines).
    // Treat such payloads as invalid so we refresh from bundled tooltip_data.db.
    let aphelios_has_extra_block = root
        .get("Aphelios")
        .and_then(|x| x.as_object())
        .map(|aphelios| {
            let has_summary = aphelios
                .get("Extra_ApheliosWeaponSummary")
                .and_then(|x| x.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            let has_weapon_detail = (1..=5).any(|idx| {
                let q_key = format!("Extra_ApheliosWeapon{}Q", idx);
                let e_key = format!("Extra_ApheliosWeapon{}E", idx);
                let offhand_key = format!("Extra_ApheliosWeapon{}Offhand", idx);
                let q_ok = aphelios
                    .get(&q_key)
                    .and_then(|x| x.as_str())
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false);
                let e_ok = aphelios
                    .get(&e_key)
                    .and_then(|x| x.as_str())
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false);
                let offhand_ok = aphelios
                    .get(&offhand_key)
                    .and_then(|x| x.as_str())
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false);
                q_ok || e_ok || offhand_ok
            });
            has_summary && has_weapon_detail
        })
        .unwrap_or(true);

    let enough_spell_map = with_spell_map * 100 >= champions * 60;
    let enough_modern_schema = with_champion_local * 100 >= champions * 60;
    champions >= 120 && (enough_spell_map || enough_modern_schema) && aphelios_has_extra_block
}

fn tooltip_db_has_rows(db_path: &PathBuf) -> bool {
    let conn = match rusqlite::Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let count: i64 = match conn.query_row("SELECT COUNT(*) FROM champion_tooltips", [], |row| row.get(0))
    {
        Ok(v) => v,
        Err(_) => return false,
    };
    count > 0
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn load_tooltip_locale_db(locale: String, app_handle: AppHandle) -> Result<Option<String>, String> {
    let db_path = ensure_tooltip_db_installed(&app_handle)?;
    let mut data_json = read_tooltip_locale_json(&db_path, &locale)?;

    // If locale row is missing (e.g. stale empty DB), restore bundled DB and retry once.
    if data_json.is_none() {
        copy_bundled_tooltip_db(&app_handle, &db_path)?;
        data_json = read_tooltip_locale_json(&db_path, &locale)?;
    }

    if let Some(ref payload) = data_json {
        if !is_tooltip_locale_payload_valid(payload) {
            eprintln!(
                "[tooltip-db] invalid payload detected for locale {}. restoring bundled tooltip_data.db",
                locale
            );
            copy_bundled_tooltip_db(&app_handle, &db_path)?;
            data_json = read_tooltip_locale_json(&db_path, &locale)?;
        }
    }

    Ok(data_json)
}
