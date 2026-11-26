use std::path::{Path, PathBuf};
use std::{ffi::OsStr, fs};

use crate::state::SettingsWrapper;

fn canonical_or_original(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

pub(super) fn library_roots(settings: &SettingsWrapper) -> Vec<PathBuf> {
    let snapshot = settings.get_settings();
    let alternate = settings.alternate_default_library(&snapshot.recordings_folder);
    let mut roots = vec![snapshot.recordings_folder, snapshot.clips_folder];
    roots.extend(alternate);
    roots
}

fn normalize_path_for_compare(path: &Path) -> String {
    let mut s = canonical_or_original(path).to_string_lossy().replace('/', "\\");
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        s = stripped.to_string();
    }
    while s.ends_with('\\') {
        s.pop();
    }
    if cfg!(windows) {
        s = s.to_ascii_lowercase();
    }
    s
}

fn is_under_allowed_roots(path: &Path, settings: &SettingsWrapper) -> bool {
    let candidate = normalize_path_for_compare(path);
    library_roots(settings)
        .into_iter()
        .map(|root| normalize_path_for_compare(&root))
        .any(|root| candidate == root || candidate.starts_with(&(root + "\\")))
}

pub(super) fn normalize_video_base_path(path: &Path) -> PathBuf {
    let mut out = path.to_path_buf();
    if matches!(
        out.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()),
        Some(ext) if ext == "mp4" || ext == "json"
    ) {
        out.set_extension("");
    }
    out
}

pub(crate) fn recording_file(path: &Path, extension: &str) -> PathBuf {
    let mut filename = normalize_video_base_path(path).into_os_string();
    filename.push(".");
    filename.push(extension);
    PathBuf::from(filename)
}

pub(crate) fn resolve_existing_video_base(video_id: &str, settings: &SettingsWrapper) -> Result<PathBuf, String> {
    let trimmed = video_id.trim().trim_end_matches('.');
    if trimmed.is_empty() || trimmed.contains('\0') {
        return Err("Invalid video id".to_string());
    }

    let raw = PathBuf::from(trimmed);
    let mut candidates = Vec::new();
    if raw.is_absolute() {
        candidates.push(normalize_video_base_path(&raw));
    } else {
        candidates.push(normalize_video_base_path(&settings.get_recordings_path().join(&raw)));
        candidates.push(normalize_video_base_path(&settings.get_clips_path().join(&raw)));
    }

    for base in candidates {
        let mp4 = recording_file(&base, "mp4");
        let json = recording_file(&base, "json");
        if mp4.exists() || json.exists() {
            if !is_under_allowed_roots(&base, settings) {
                return Err("Access denied for video path".to_string());
            }
            return Ok(base);
        }
    }

    // A complete path identifies one folder even when both folders contain the same name.
    if raw.is_absolute() {
        return Err("Input video not found".into());
    }

    // Older callers also pass just the filename.
    let requested_stem = Path::new(trimmed)
        .file_stem()
        .or_else(|| Path::new(trimmed).file_name())
        .and_then(OsStr::to_str)
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if !requested_stem.is_empty() {
        for root in [settings.get_recordings_path(), settings.get_clips_path()] {
            if let Ok(entries) = fs::read_dir(&root) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.extension()
                        .and_then(OsStr::to_str)
                        .map(|e| e.eq_ignore_ascii_case("mp4"))
                        != Some(true)
                    {
                        continue;
                    }
                    let stem = p
                        .file_stem()
                        .and_then(OsStr::to_str)
                        .map(|s| s.to_ascii_lowercase())
                        .unwrap_or_default();
                    if stem != requested_stem {
                        continue;
                    }
                    let base = p.with_extension("");
                    if is_under_allowed_roots(&base, settings) {
                        return Ok(base);
                    }
                }
            }
        }
    }

    Err("Input video not found".to_string())
}

pub(crate) fn resolve_clip_input_path(video_id: &str, settings: &SettingsWrapper) -> Result<PathBuf, String> {
    let base = resolve_existing_video_base(video_id, settings)?;
    let mp4 = recording_file(&base, "mp4");
    if mp4.exists() {
        Ok(mp4)
    } else {
        Err("Input video not found".to_string())
    }
}
