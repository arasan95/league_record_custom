use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use chrono::Utc;

use tauri::AppHandle;
use xxhash_rust::xxh64::xxh64;

use crate::wad::parser::{extract_file_from_wad, parse_wad_entries, WadEntry};
use crate::wad::updater::get_league_install_dir;

mod media;
mod path_guard;
mod recordings;
mod tooltip_db;

pub use media::*;
pub use recordings::*;
pub use tooltip_db::*;

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn download_image(
    url: String,
    category: String,
    filename: String,
    app_handle: AppHandle,
) -> Result<String, String> {
    use std::io::Write;
    use tauri::Manager;

    if !is_safe_path_segment(&category)
        || !is_safe_path_segment(&filename)
        || !(filename.ends_with(".png") || filename.ends_with(".jpg") || filename.ends_with(".jpeg"))
    {
        return Err("Invalid path parameters".to_string());
    }

    let app_dir = app_handle.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let img_cache = app_dir.join("img_cache");
    let category_dir = img_cache.join(&category);

    if !img_cache.exists() {
        std::fs::create_dir(&img_cache).map_err(|e| e.to_string())?;
    }
    if !category_dir.exists() {
        std::fs::create_dir(&category_dir).map_err(|e| e.to_string())?;
    }

    let file_path = category_dir.join(&filename);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    // Prefer extracting from local LCU WADs for CDragon plugin assets.
    let (local_wad_hit, local_wad_probe) =
        try_extract_lcu_asset_from_local_wad(&url, &category, &filename, &file_path, &client).await?;
    if let Some(source_detail) = local_wad_hit {
        write_image_source_marker(
            &file_path,
            serde_json::json!({
                "source": "local_wad",
                "source_detail": source_detail,
                "local_wad_probe": local_wad_probe,
                "requested_url": url,
                "category": category,
                "filename": filename,
                "saved_at_utc": Utc::now().to_rfc3339(),
            }),
        )?;
        return Ok(file_path.to_string_lossy().to_string());
    }

    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Request failed: {}", response.status()));
    }

    let status_code = response.status().as_u16();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    let mut file = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    write_image_source_marker(
        &file_path,
        serde_json::json!({
            "source": "remote_http",
            "http_status": status_code,
            "requested_url": url,
            "category": category,
            "filename": filename,
            "local_wad_probe": local_wad_probe,
            "saved_at_utc": Utc::now().to_rfc3339(),
        }),
    )?;

    Ok(file_path.to_string_lossy().to_string())
}

fn is_safe_path_segment(segment: &str) -> bool {
    !segment.is_empty()
        && !segment.starts_with('.')
        && !segment.contains("..")
        && !segment.contains('/')
        && !segment.contains('\\')
        && !segment.contains(':')
        && segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
}

static LCU_WAD_ENTRIES_CACHE: OnceLock<Mutex<std::collections::HashMap<PathBuf, Arc<Vec<WadEntry>>>>> = OnceLock::new();
static ITEM_ICON_PATHS_CACHE: OnceLock<Mutex<Option<HashMap<String, String>>>> = OnceLock::new();
static SPELL_ICON_PATHS_CACHE: OnceLock<Mutex<Option<HashMap<String, String>>>> = OnceLock::new();
static TFT_ITEM_ICON_PATHS_CACHE: OnceLock<Mutex<Option<HashMap<String, String>>>> = OnceLock::new();
static TFT_TRAIT_ICON_PATHS_CACHE: OnceLock<Mutex<Option<HashMap<String, String>>>> = OnceLock::new();

fn normalize_cdragon_asset_path(url: &str) -> Option<String> {
    // Example URLs:
    // https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/266.png
    // https://raw.communitydragon.org/latest/game/assets/characters/tft16_ahri/hud/tft16_ahri_square.tft_set16.png
    let plugin_marker = "/latest/plugins/rcp-be-lol-game-data/";
    if let Some(idx) = url.find(plugin_marker) {
        let tail = &url[idx + "/latest/".len()..];
        return Some(tail.replace('\\', "/").to_lowercase());
    }

    let game_marker = "/latest/game/";
    if let Some(idx) = url.find(game_marker) {
        let tail = &url[idx + game_marker.len()..];
        return Some(format!(
            "plugins/rcp-be-lol-game-data/global/default/{}",
            tail.replace('\\', "/").to_lowercase()
        ));
    }

    None
}

fn candidate_lcu_path_hashes_full(path: &str) -> Vec<u64> {
    let normalized = path.trim().replace('\\', "/").to_lowercase();
    let no_slash = normalized.trim_start_matches('/').to_string();
    let with_slash = format!("/{}", no_slash);
    let mut forms = vec![normalized, no_slash, with_slash];
    forms.sort();
    forms.dedup();
    let mut out: Vec<u64> = Vec::new();
    for f in forms {
        let h = xxh64(f.as_bytes(), 0);
        if !out.contains(&h) {
            out.push(h);
        }
    }
    out
}

fn normalize_icon_path_to_lcu_asset_path(icon_path: &str) -> Option<String> {
    let p = icon_path.trim().replace('\\', "/").to_lowercase();
    let p = p.trim_start_matches('/');
    let rest = p.strip_prefix("lol-game-data/assets/")?;
    Some(format!("plugins/rcp-be-lol-game-data/global/default/{}", rest))
}

fn normalize_generic_icon_path_to_lcu_asset_path(icon_path: &str) -> Option<String> {
    let mut p = icon_path.trim().replace('\\', "/").to_lowercase();
    p = p.trim_start_matches('/').to_string();
    if p.ends_with(".tex") {
        p = format!("{}.png", p.trim_end_matches(".tex"));
    }

    if let Some(rest) = p.strip_prefix("lol-game-data/assets/") {
        return Some(format!("plugins/rcp-be-lol-game-data/global/default/{}", rest));
    }
    if let Some(rest) = p.strip_prefix("game/assets/") {
        return Some(format!("plugins/rcp-be-lol-game-data/global/default/assets/{}", rest));
    }
    if p.starts_with("assets/") {
        return Some(format!("plugins/rcp-be-lol-game-data/global/default/{}", p));
    }
    None
}

fn extract_basename_no_ext(path: &str) -> String {
    let base = path.rsplit('/').next().unwrap_or(path);
    match base.rsplit_once('.') {
        Some((stem, _ext)) => stem.to_string(),
        None => base.to_string(),
    }
}

fn normalize_icon_key(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn normalize_spell_lookup_key(base: &str) -> String {
    let key = normalize_icon_key(base);
    match key.as_str() {
        // Legacy DataDragon spell names that differ from current LCU icon names.
        "summonerdot" => "summonerignite".to_string(),
        _ => key,
    }
}

async fn load_item_icon_paths(client: &reqwest::Client) -> Result<HashMap<String, String>, String> {
    let cache = ITEM_ICON_PATHS_CACHE.get_or_init(|| Mutex::new(None));
    if let Some(existing) = cache.lock().map_err(|_| "item cache lock poisoned".to_string())?.clone() {
        return Ok(existing);
    }

    let url = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json";
    let data = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    if let Some(arr) = data.as_array() {
        for row in arr {
            let id = row.get("id").and_then(|v| v.as_i64()).map(|x| x.to_string());
            let icon = row.get("iconPath").and_then(|v| v.as_str());
            if let (Some(id), Some(icon)) = (id, icon) {
                if let Some(asset_path) = normalize_icon_path_to_lcu_asset_path(icon) {
                    map.insert(id, asset_path);
                }
            }
        }
    }

    let mut guard = cache.lock().map_err(|_| "item cache lock poisoned".to_string())?;
    *guard = Some(map.clone());
    Ok(map)
}

async fn load_spell_icon_paths(client: &reqwest::Client) -> Result<HashMap<String, String>, String> {
    let cache = SPELL_ICON_PATHS_CACHE.get_or_init(|| Mutex::new(None));
    if let Some(existing) = cache.lock().map_err(|_| "spell cache lock poisoned".to_string())?.clone() {
        return Ok(existing);
    }

    let url = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/summoner-spells.json";
    let data = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    if let Some(arr) = data.as_array() {
        for row in arr {
            if let Some(icon) = row.get("iconPath").and_then(|v| v.as_str()) {
                if let Some(asset_path) = normalize_icon_path_to_lcu_asset_path(icon) {
                    let base = extract_basename_no_ext(icon);
                    map.insert(normalize_icon_key(&base), asset_path);
                }
            }
        }
    }

    let mut guard = cache.lock().map_err(|_| "spell cache lock poisoned".to_string())?;
    *guard = Some(map.clone());
    Ok(map)
}

async fn load_tft_item_icon_paths(client: &reqwest::Client) -> Result<HashMap<String, String>, String> {
    let cache = TFT_ITEM_ICON_PATHS_CACHE.get_or_init(|| Mutex::new(None));
    if let Some(existing) = cache.lock().map_err(|_| "tft item cache lock poisoned".to_string())?.clone() {
        return Ok(existing);
    }

    let url = "https://raw.communitydragon.org/latest/cdragon/tft/en_us.json";
    let data = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    if let Some(arr) = data.get("items").and_then(|v| v.as_array()) {
        for row in arr {
            let api_name = row.get("apiName").and_then(|v| v.as_str());
            let icon = row.get("icon").and_then(|v| v.as_str());
            if let (Some(api_name), Some(icon)) = (api_name, icon) {
                if let Some(asset_path) = normalize_generic_icon_path_to_lcu_asset_path(icon) {
                    map.insert(normalize_icon_key(api_name), asset_path);
                }
            }
        }
    }

    let mut guard = cache.lock().map_err(|_| "tft item cache lock poisoned".to_string())?;
    *guard = Some(map.clone());
    Ok(map)
}

async fn load_tft_trait_icon_paths(client: &reqwest::Client) -> Result<HashMap<String, String>, String> {
    let cache = TFT_TRAIT_ICON_PATHS_CACHE.get_or_init(|| Mutex::new(None));
    if let Some(existing) = cache.lock().map_err(|_| "tft trait cache lock poisoned".to_string())?.clone() {
        return Ok(existing);
    }

    let url = "https://raw.communitydragon.org/latest/cdragon/tft/en_us.json";
    let data = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    if let Some(sets) = data.get("sets").and_then(|v| v.as_object()) {
        for set_obj in sets.values() {
            if let Some(traits) = set_obj.get("traits").and_then(|v| v.as_array()) {
                for row in traits {
                    let icon = row.get("icon").and_then(|v| v.as_str());
                    if let Some(icon) = icon {
                        if let Some(asset_path) = normalize_generic_icon_path_to_lcu_asset_path(icon) {
                            let base = extract_basename_no_ext(icon);
                            let key = format!("{}.png", base.to_lowercase());
                            map.insert(key, asset_path);
                        }
                    }
                }
            }
        }
    }

    let mut guard = cache.lock().map_err(|_| "tft trait cache lock poisoned".to_string())?;
    *guard = Some(map.clone());
    Ok(map)
}

async fn build_local_asset_candidates_from_url(
    url: &str,
    category: &str,
    filename: &str,
    client: &reqwest::Client,
) -> Result<Vec<String>, String> {
    let mut out = Vec::new();

    if let Some(path) = normalize_cdragon_asset_path(url) {
        out.push(path);
    }

    if category.eq_ignore_ascii_case("item") {
        let id = filename.strip_suffix(".png").unwrap_or(filename);
        if id.chars().all(|c| c.is_ascii_digit()) {
            let map = load_item_icon_paths(client).await?;
            if let Some(path) = map.get(id) {
                out.push(path.clone());
            }
        }
    }

    if category.eq_ignore_ascii_case("spell") {
        let base = filename.strip_suffix(".png").unwrap_or(filename);
        let key = normalize_spell_lookup_key(base);
        let map = load_spell_icon_paths(client).await?;
        if let Some(path) = map.get(&key) {
            out.push(path.clone());
        } else if let Some((_, path)) = map.iter().find(|(k, _)| k.starts_with(&key) || key.starts_with(*k)) {
            // Example: SummonerTeleport -> Summoner_Teleport_New in latest game assets.
            out.push(path.clone());
        }
    }

    if category.eq_ignore_ascii_case("tft_item") {
        let base = filename.strip_suffix(".png").unwrap_or(filename);
        let key = normalize_icon_key(base);
        let map = load_tft_item_icon_paths(client).await?;
        if let Some(path) = map.get(&key) {
            out.push(path.clone());
        }
    }

    if category.eq_ignore_ascii_case("tft_trait") {
        let key = filename.to_lowercase();
        let map = load_tft_trait_icon_paths(client).await?;
        if let Some(path) = map.get(&key) {
            out.push(path.clone());
        }
    }

    out.sort();
    out.dedup();
    Ok(out)
}

fn get_wad_entries_cached(wad_path: &PathBuf) -> Result<Arc<Vec<WadEntry>>, String> {
    let cache = LCU_WAD_ENTRIES_CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()));
    {
        let guard = cache.lock().map_err(|_| "WAD cache lock poisoned".to_string())?;
        if let Some(v) = guard.get(wad_path) {
            return Ok(Arc::clone(v));
        }
    }

    let parsed = parse_wad_entries(wad_path).map_err(|e| format!("Failed to parse WAD {}: {}", wad_path.display(), e))?;
    let parsed = Arc::new(parsed);

    let mut guard = cache.lock().map_err(|_| "WAD cache lock poisoned".to_string())?;
    guard.insert(wad_path.clone(), Arc::clone(&parsed));
    Ok(parsed)
}

fn find_lcu_wad_bundles(install_dir: &std::path::Path) -> Vec<PathBuf> {
    let plugin_dir = install_dir.join("Plugins").join("rcp-be-lol-game-data");
    if !plugin_dir.exists() {
        return Vec::new();
    }
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(plugin_dir) {
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_file() {
                continue;
            }
            let Some(name) = p.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if name.ends_with("-assets.wad") {
                out.push(p);
            }
        }
    }
    out
}

fn preferred_lcu_wad_bundles(install_dir: &std::path::Path) -> Vec<PathBuf> {
    let plugin_dir = install_dir.join("Plugins").join("rcp-be-lol-game-data");
    vec![
        plugin_dir.join("default-assets.wad"),
        plugin_dir.join("default-assets2.wad"),
        plugin_dir.join("ja_JP-assets.wad"),
    ]
}

async fn try_extract_lcu_asset_from_local_wad(
    url: &str,
    category: &str,
    filename: &str,
    out_file: &PathBuf,
    client: &reqwest::Client,
) -> Result<(Option<String>, String), String> {
    let asset_paths = build_local_asset_candidates_from_url(url, category, filename, client).await?;
    if asset_paths.is_empty() {
        return Ok((None, "not_applicable".to_string()));
    }

    let Some(install_dir) = get_league_install_dir() else {
        return Ok((None, "league_install_not_found".to_string()));
    };
    let mut wads = preferred_lcu_wad_bundles(&install_dir)
        .into_iter()
        .filter(|p| p.exists())
        .collect::<Vec<_>>();
    // Keep compatibility with non-standard locales/install layouts.
    if wads.is_empty() {
        wads = find_lcu_wad_bundles(&install_dir);
    }
    if wads.is_empty() {
        return Ok((None, "no_lcu_wads_found".to_string()));
    }

    for asset_path in &asset_paths {
        let target_hashes = candidate_lcu_path_hashes_full(asset_path);
        for wad_path in &wads {
            let entries = get_wad_entries_cached(wad_path)?;
            for target_hash in &target_hashes {
                if let Some(entry) = entries.iter().find(|e| e.path_hash == *target_hash) {
                    let bytes = extract_file_from_wad(wad_path, entry)
                        .map_err(|e| format!("Failed to extract local asset from {}: {}", wad_path.display(), e))?;
                    let mut file = std::fs::File::create(out_file).map_err(|e| e.to_string())?;
                    use std::io::Write as _;
                    file.write_all(&bytes).map_err(|e| e.to_string())?;
                    let detail = format!(
                        "{}#path_hash={:016x} path={}",
                        wad_path.display(),
                        target_hash,
                        asset_path
                    );
                    return Ok((Some(detail), "hit".to_string()));
                }
            }
        }
    }
    Ok((None, format!("hash_not_found_for_paths:{:?}", asset_paths)))
}

fn write_image_source_marker(file_path: &PathBuf, payload: serde_json::Value) -> Result<(), String> {
    // Opt-in only: avoid writing marker files unless explicitly enabled.
    let enabled = std::env::var("LEAGUERECORD_WRITE_IMAGE_MARKERS")
        .map(|v| v == "1")
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }

    let sidecar = PathBuf::from(format!("{}.source.json", file_path.display()));
    let body = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    std::fs::write(sidecar, body).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(test, specta::specta)]
#[tauri::command]
pub async fn update_champion_data(app_handle: AppHandle) -> Result<String, String> {
    use crate::wad::updater::{extract_all_champions_to_json, get_league_install_dir};
    use tauri::Manager;

    let install_dir = get_league_install_dir().ok_or("League of Legends install not found")?;

    let app_dir = app_handle.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let cache_dir = app_dir.join("tooltip_cache");
    if !cache_dir.exists() {
        std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }

    let output_path = cache_dir.join("tooltip_variable_fallback.json");

    // Perform the heavy extraction in a background task
    let result = tokio::task::spawn_blocking(move || {
        extract_all_champions_to_json(&install_dir, &output_path).map(|_| output_path)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    match result {
        Ok(path) => Ok(path.to_string_lossy().into_owned()),
        Err(e) => Err(format!("Extraction error: {}", e)),
    }
}
