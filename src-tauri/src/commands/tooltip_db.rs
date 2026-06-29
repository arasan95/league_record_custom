use std::io::Write;
use std::path::PathBuf;

use tauri::AppHandle;

const TOOLTIP_DB_REMOTE_URL: &str =
    "https://raw.githubusercontent.com/arasan95/league_record_custom/main/src-tauri/resources/tooltip_data.db";

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TooltipDbUpdateInfo {
    pub update_available: bool,
    pub current_sha256: String,
    pub remote_sha256: String,
    pub remote_size: u64,
    pub checked_url: String,
}

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

fn is_tooltip_locale_payload_valid(locale: &str, data_json: &str) -> bool {
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
    let mut same_as_key_local_names = 0usize;
    for (champ_id, v) in root {
        let Some(champ) = v.as_object() else {
            continue;
        };
        champions += 1;
        if champ.get("spell_map").and_then(|x| x.as_object()).is_some() {
            with_spell_map += 1;
        }
        if let Some(local_name) = champ
            .get("champion_local")
            .and_then(|x| x.as_str())
        {
            if !local_name.trim().is_empty() {
                with_champion_local += 1;
                if local_name.trim() == champ_id {
                    same_as_key_local_names += 1;
                }
            }
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
    champions >= 120
        && (enough_spell_map || enough_modern_schema)
        && aphelios_has_extra_block
        && (locale != "ja_JP" || same_as_key_local_names == 0)
        && !has_stale_english_champion_meta(locale, root)
        && !has_known_bad_ja_slot_payload(root)
}

fn has_stale_english_champion_meta(locale: &str, root: &serde_json::Map<String, serde_json::Value>) -> bool {
    if locale.eq_ignore_ascii_case("en_US") {
        return false;
    }

    fn champ_field_is(
        root: &serde_json::Map<String, serde_json::Value>,
        champ: &str,
        field: &str,
        needle: &str,
    ) -> bool {
        root.get(champ)
            .and_then(|x| x.as_object())
            .and_then(|x| x.get(field))
            .and_then(|x| x.as_str())
            .map(|s| s == needle)
            .unwrap_or(false)
    }

    champ_field_is(root, "Ahri", "champion_title", "the Nine-Tailed Fox")
        || champ_field_is(root, "Yuumi", "champion_title", "the Magical Cat")
        || champ_field_is(root, "Jax", "champion_title", "Grandmaster at Arms")
        || champ_field_is(root, "Sett", "champion_title", "the Boss")
        || champ_field_is(root, "Vayne", "champion_title", "the Night Hunter")
}

fn has_known_bad_ja_slot_payload(root: &serde_json::Map<String, serde_json::Value>) -> bool {
    fn slot_contains(root: &serde_json::Map<String, serde_json::Value>, champ: &str, slot: &str, needle: &str) -> bool {
        root.get(champ)
            .and_then(|x| x.as_object())
            .and_then(|x| x.get(slot))
            .and_then(|x| x.as_str())
            .map(|s| s.contains(needle))
            .unwrap_or(false)
    }

    // Stale tooltip DBs generated with bad slot data duplicated some spells into
    // neighboring slots. Reject them so the bundled fixed DB replaces existing
    // user copies at startup.
    slot_contains(root, "Yuumi", "E", "&nbsp;行け！")
        || slot_contains(root, "Jax", "E", "&nbsp;パワーバッシュ")
        || slot_contains(root, "Vayne", "Q", "&nbsp;ファイナルアワー")
        || slot_contains(root, "Hecarim", "R", "&nbsp;파멸의 돌격")
}

fn tooltip_db_has_rows(db_path: &PathBuf) -> bool {
    let conn = match rusqlite::Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let count: i64 = match conn.query_row("SELECT COUNT(*) FROM champion_tooltips", [], |row| row.get(0)) {
        Ok(v) => v,
        Err(_) => return false,
    };
    count > 0
}

fn tooltip_db_update_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let update_dir = app_data_dir.join("tooltip_db").join("updates");
    std::fs::create_dir_all(&update_dir).map_err(|e| e.to_string())?;
    Ok(update_dir)
}

fn sha256_file(path: &PathBuf) -> Result<String, String> {
    use sha2::{Digest, Sha256};

    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

fn validate_tooltip_db_file(db_path: &PathBuf) -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("Failed to open tooltip DB ({}): {}", db_path.display(), e))?;
    let mut stmt = conn
        .prepare("SELECT locale, data_json FROM champion_tooltips")
        .map_err(|e| format!("Failed to prepare tooltip DB validation query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            let locale: String = row.get(0)?;
            let data_json: String = row.get(1)?;
            Ok((locale, data_json))
        })
        .map_err(|e| format!("Failed to query tooltip DB validation rows: {}", e))?;

    let mut locales = 0usize;
    for row in rows {
        let (locale, data_json) = row.map_err(|e| format!("Failed to read tooltip DB validation row: {}", e))?;
        if !is_tooltip_locale_payload_valid(&locale, &data_json) {
            return Err(format!(
                "Downloaded tooltip DB has invalid payload for locale {}",
                locale
            ));
        }
        locales += 1;
    }

    if locales < 13 {
        return Err(format!("Downloaded tooltip DB has too few locales: {}", locales));
    }

    Ok(())
}

async fn download_remote_tooltip_db(app_handle: &AppHandle) -> Result<(PathBuf, String, u64), String> {
    let client = reqwest::Client::builder()
        .user_agent("LeagueRecord tooltip-db-updater")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(TOOLTIP_DB_REMOTE_URL)
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|e| format!("Failed to download tooltip DB: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Tooltip DB download failed: {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read tooltip DB download: {}", e))?;
    let size = bytes.len() as u64;
    if size < 1_000_000 {
        return Err(format!("Downloaded tooltip DB is unexpectedly small: {} bytes", size));
    }

    let update_dir = tooltip_db_update_dir(app_handle)?;
    let tmp_path = update_dir.join("tooltip_data.remote.tmp");
    let db_path = update_dir.join("tooltip_data.remote.db");
    if tmp_path.exists() {
        std::fs::remove_file(&tmp_path).map_err(|e| format!("Failed to remove old temp tooltip DB: {}", e))?;
    }
    if db_path.exists() {
        std::fs::remove_file(&db_path).map_err(|e| format!("Failed to remove old staged tooltip DB: {}", e))?;
    }
    {
        let mut file =
            std::fs::File::create(&tmp_path).map_err(|e| format!("Failed to create temp tooltip DB: {}", e))?;
        file.write_all(&bytes)
            .map_err(|e| format!("Failed to write temp tooltip DB: {}", e))?;
    }
    std::fs::rename(&tmp_path, &db_path).map_err(|e| format!("Failed to stage downloaded tooltip DB: {}", e))?;
    validate_tooltip_db_file(&db_path)?;
    let sha = sha256_file(&db_path)?;
    Ok((db_path, sha, size))
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
        if !is_tooltip_locale_payload_valid(&locale, payload) {
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

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn check_tooltip_db_update(app_handle: AppHandle) -> Result<TooltipDbUpdateInfo, String> {
    let current_db = ensure_tooltip_db_installed(&app_handle)?;
    let current_sha256 = sha256_file(&current_db)?;
    let (_remote_db, remote_sha256, remote_size) = download_remote_tooltip_db(&app_handle).await?;

    Ok(TooltipDbUpdateInfo {
        update_available: current_sha256 != remote_sha256,
        current_sha256,
        remote_sha256,
        remote_size,
        checked_url: TOOLTIP_DB_REMOTE_URL.to_string(),
    })
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn apply_tooltip_db_update(
    expected_sha256: String,
    app_handle: AppHandle,
) -> Result<TooltipDbUpdateInfo, String> {
    let current_db = ensure_tooltip_db_installed(&app_handle)?;
    let update_dir = tooltip_db_update_dir(&app_handle)?;
    let staged_db = update_dir.join("tooltip_data.remote.db");
    if !staged_db.exists() {
        return Err("No downloaded tooltip DB update is staged. Please check for updates again.".to_string());
    }

    validate_tooltip_db_file(&staged_db)?;
    let remote_sha256 = sha256_file(&staged_db)?;
    if remote_sha256 != expected_sha256 {
        return Err("Downloaded tooltip DB changed after the update check. Please check again.".to_string());
    }

    let current_sha256 = sha256_file(&current_db)?;
    if current_sha256 == remote_sha256 {
        return Ok(TooltipDbUpdateInfo {
            update_available: false,
            current_sha256,
            remote_sha256,
            remote_size: std::fs::metadata(&staged_db).map(|m| m.len()).unwrap_or(0),
            checked_url: TOOLTIP_DB_REMOTE_URL.to_string(),
        });
    }

    let backup_db = current_db.with_extension("db.bak");
    let replacement_db = current_db.with_extension("db.new");
    std::fs::copy(&staged_db, &replacement_db).map_err(|e| format!("Failed to stage tooltip DB replacement: {}", e))?;
    validate_tooltip_db_file(&replacement_db)?;
    if backup_db.exists() {
        std::fs::remove_file(&backup_db).map_err(|e| format!("Failed to remove old tooltip DB backup: {}", e))?;
    }
    std::fs::rename(&current_db, &backup_db).map_err(|e| format!("Failed to backup current tooltip DB: {}", e))?;
    if let Err(e) = std::fs::rename(&replacement_db, &current_db) {
        let _ = std::fs::rename(&backup_db, &current_db);
        return Err(format!("Failed to replace tooltip DB: {}", e));
    }

    Ok(TooltipDbUpdateInfo {
        update_available: false,
        current_sha256: sha256_file(&current_db)?,
        remote_sha256,
        remote_size: std::fs::metadata(&current_db).map(|m| m.len()).unwrap_or(0),
        checked_url: TOOLTIP_DB_REMOTE_URL.to_string(),
    })
}
