use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use anyhow::Result;
use tauri::{AppHandle, Manager};

use super::recording_paths::{normalize_video_base_path, recording_file};
use crate::recorder::MetadataFile;
use crate::state::{CurrentlyRecording, SettingsWrapper};

#[cfg_attr(test, derive(specta::Type))]
#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    video_id: String,
    metadata: Option<MetadataFile>,
    video_exists: bool,
    is_recording: bool,
}

#[cfg_attr(test, derive(specta::Type))]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSnapshot {
    pub recordings: Vec<Recording>,
    pub size_gb: f32,
    pub stale: bool,
}

#[derive(Default)]
pub struct RecordingLibrary(
    std::sync::Mutex<Option<([PathBuf; 2], RecordingSnapshot)>>,
    std::sync::atomic::AtomicBool,
);

impl RecordingLibrary {
    pub fn watcher_needs_restart(&self, unavailable: bool) -> bool {
        self.1.swap(unavailable, std::sync::atomic::Ordering::AcqRel) && !unavailable
    }

    #[cfg(test)]
    pub fn refresh(&self, roots: [PathBuf; 2], active: Option<&Path>) -> Result<RecordingSnapshot, String> {
        self.refresh_with_alternate(roots, &[], active)
    }

    pub fn refresh_with_alternate(
        &self,
        roots: [PathBuf; 2],
        alternate: &[PathBuf],
        active: Option<&Path>,
    ) -> Result<RecordingSnapshot, String> {
        let mut previous = self.0.lock().map_err(|error| error.to_string())?;
        let active = active.map(normalize_video_base_path);
        let (recordings, bytes) = match collect_recording_files(&roots, None) {
            Ok(mut files) => {
                for root in alternate {
                    if roots.contains(root) {
                        continue;
                    }
                    match collect_recording_files(&[root.clone(), root.clone()], None) {
                        Ok(extra) => files.extend(extra),
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => log::warn!("Alternate recording folder unavailable: {error}"),
                    }
                }
                let mut files: Vec<_> = files.into_iter().collect();
                files.sort_by_key(|(_, file)| std::cmp::Reverse(file.created));
                let mut bytes = 0u64;
                let recordings = files
                    .into_iter()
                    .filter_map(|(base, file)| {
                        bytes = bytes.saturating_add(file.bytes);
                        Some(Recording {
                            video_id: base.to_str()?.to_owned(),
                            metadata: action::get_recording_metadata_for_list(&base).ok(),
                            video_exists: file.video_exists,
                            is_recording: active.as_ref() == Some(&base),
                        })
                    })
                    .collect();
                (recordings, bytes)
            }
            Err(error) => {
                log::warn!("Recording library could not refresh: {error}");
                return previous
                    .as_ref()
                    .filter(|(paths, _)| *paths == roots)
                    .map(|(_, snapshot)| {
                        let mut stale = snapshot.clone();
                        stale.stale = true;
                        for recording in &mut stale.recordings {
                            recording.is_recording = active.as_deref() == Some(Path::new(&recording.video_id));
                        }
                        stale
                    })
                    .ok_or_else(|| error.to_string());
            }
        };
        let snapshot = RecordingSnapshot {
            recordings,
            size_gb: bytes as f32 / 1_000_000_000.0,
            stale: false,
        };
        *previous = Some((roots, snapshot.clone()));
        Ok(snapshot)
    }
}

#[derive(Default)]
struct RecordingFiles {
    bytes: u64,
    video_exists: bool,
    created: Option<SystemTime>,
}

fn collect_recording_files(
    roots: &[PathBuf; 2],
    active: Option<&Path>,
) -> std::io::Result<std::collections::BTreeMap<PathBuf, RecordingFiles>> {
    let mut files = std::collections::BTreeMap::<PathBuf, RecordingFiles>::new();
    let active = active.map(|path| path.with_extension(""));
    for (index, root) in roots.iter().enumerate() {
        if index == 1 && root == &roots[0] {
            break;
        }
        for entry in root.read_dir()? {
            let entry = entry?;
            let path = entry.path();
            let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else { continue };
            if ext != "mp4" && ext != "json" {
                continue;
            }
            let base = path.with_extension("");
            if active.as_ref() == Some(&base) {
                continue;
            }
            let metadata = match entry.metadata() {
                Ok(metadata) if metadata.is_file() => metadata,
                Ok(_) => continue,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            let files = files.entry(base).or_default();
            files.bytes = files.bytes.saturating_add(metadata.len());
            if ext == "mp4" || !files.video_exists {
                files.created = metadata.created().ok().or_else(|| metadata.modified().ok());
            }
            files.video_exists |= ext == "mp4";
        }
    }
    Ok(files)
}

pub trait RecordingManager {
    fn get_recordings(&self) -> Vec<PathBuf>;

    fn cleanup_recordings(&self);
    fn cleanup_recordings_by_size(&self);
    fn cleanup_recordings_by_age(&self);
}

impl RecordingManager for AppHandle {
    fn get_recordings(&self) -> Vec<PathBuf> {
        let settings = self.state::<SettingsWrapper>().get_settings();
        let active = self.state::<CurrentlyRecording>().get();
        collect_recording_files(&[settings.recordings_folder, settings.clips_folder], active.as_deref())
            .map(|entries| entries.into_keys().collect())
            .unwrap_or_else(|error| {
                log::warn!("Recording folders are unavailable: {error}");
                Vec::new()
            })
    }

    fn cleanup_recordings(&self) {
        self.cleanup_recordings_by_age();
        self.cleanup_recordings_by_size();
    }

    fn cleanup_recordings_by_size(&self) {
        let settings = self.state::<SettingsWrapper>();
        let Some(max_gb) = settings.max_recordings_size() else { return };
        let roots = [settings.get_recordings_path(), settings.get_clips_path()];
        let active = self.state::<CurrentlyRecording>().get();
        if let Err(error) = cleanup_by_size(
            &roots,
            active.as_deref(),
            max_gb.saturating_mul(1_000_000_000),
            settings.auto_delete_clips(),
            settings.keep_video_json_on_auto_delete(),
        ) {
            log::warn!("Recording cleanup stopped: {error}");
        }
    }

    fn cleanup_recordings_by_age(&self) {
        fn too_old(file: &Path, max_age: Duration, now: SystemTime) -> Result<bool> {
            let creation_time = file.metadata()?.created()?;
            let time_passed = now.duration_since(creation_time)?;
            Ok(time_passed > max_age)
        }

        fn is_favorite(file: &Path) -> Result<bool> {
            action::get_recording_metadata(file, false).map(|metadata_file| metadata_file.is_favorite())
        }

        let settings = self.state::<SettingsWrapper>();
        let auto_delete_clips = settings.auto_delete_clips();
        let clips_path = settings.get_clips_path();
        let Some(max_days) = settings.max_recording_age() else { return };
        let max_age = Duration::from_secs(max_days * 24 * 60 * 60);
        let now = SystemTime::now();
        for recording in self.get_recordings() {
            let recording = recording_file(&recording, "mp4");
            if !auto_delete_clips && is_clip_recording(&recording, &clips_path) {
                continue;
            }
            // in case checking 'too_old(...)' or 'is_favorite(...)' fails default to not deleting the file
            if too_old(&recording, max_age, now).unwrap_or(false) && !is_favorite(&recording).unwrap_or(true) {
                let keep_json = self.state::<SettingsWrapper>().keep_video_json_on_auto_delete();
                if keep_json {
                    if let Err(e) = action::delete_video_file_only(recording) {
                        log::error!("failed to delete file due to age limit: {e}");
                    }
                } else {
                    if let Err(e) = action::delete_recording(recording) {
                        log::error!("failed to delete file due to age limit: {e}");
                    }
                }
            }
        }
    }
}

fn cleanup_by_size(
    roots: &[PathBuf; 2],
    active: Option<&Path>,
    max_size: u64,
    delete_clips: bool,
    keep_json: bool,
) -> Result<()> {
    let mut files: Vec<_> = collect_recording_files(roots, None)?.into_iter().collect();
    let mut total = files.iter().fold(0u64, |sum, (_, file)| sum.saturating_add(file.bytes));
    files.sort_by_key(|(_, file)| file.created);
    let active = active.map(|path| path.with_extension(""));
    for (base, file) in files {
        if total <= max_size {
            break;
        }
        if !file.video_exists
            || active.as_ref() == Some(&base)
            || (!delete_clips && is_clip_recording(&base, &roots[1]))
        {
            continue;
        }
        let video = recording_file(&base, "mp4");
        let bytes = video.metadata()?.len();
        if action::delete_if_unprotected(&base, keep_json)? {
            total = total.saturating_sub(if keep_json { bytes } else { file.bytes });
        }
    }
    Ok(())
}

fn is_clip_recording(recording_base_path: &Path, clips_path: &Path) -> bool {
    let in_clips_folder = recording_base_path
        .parent()
        .map(|p| p.starts_with(clips_path))
        .unwrap_or(false);
    if in_clips_folder {
        return true;
    }

    recording_base_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.contains("_clip_"))
        .unwrap_or(false)
}

pub mod action {
    use std::fs::{self, File};
    use std::io::BufReader;
    use std::path::{Path, PathBuf};

    use super::recording_file;
    use anyhow::{bail, Context, Result};
    use riot_datatypes::{lcu, MatchId, ParticipantId, Queue};
    use serde::Deserialize;
    use tauri::async_runtime;

    use crate::recorder::MetadataFile;
    use crate::recorder::{self, Deferred, GameMetadata, NoData, Participant, TftRoundMarker};

    #[derive(Debug, Deserialize)]
    enum MetadataFileList {
        Metadata(GameMetadataList),
        Deferred(DeferredList),
        NoData(NoData),
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GameMetadataList {
        favorite: bool,
        match_id: MatchId,
        ingame_time_rec_start_offset: f64,
        #[serde(default)]
        highlights: Vec<f64>,
        #[serde(default)]
        tft_round_markers: Vec<TftRoundMarker>,
        queue: Queue,
        player: lcu::Player,
        champion_name: String,
        stats: lcu::Stats,
        participant_id: ParticipantId,
        #[serde(default)]
        participants: Vec<Participant>,
        #[serde(default)]
        teams: Vec<lcu::MatchTeam>,
        #[serde(default)]
        game_version: String,
        #[serde(default)]
        game_duration: i64,
        #[serde(default)]
        lp_diff: Option<i32>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DeferredList {
        favorite: bool,
        match_id: MatchId,
        ingame_time_rec_start_offset: f64,
        #[serde(default)]
        highlights: Vec<f64>,
        #[serde(default)]
        tft_round_markers: Vec<TftRoundMarker>,
        #[serde(default)]
        participants: Vec<Participant>,
    }

    impl MetadataFileList {
        fn into_metadata_file(self) -> MetadataFile {
            match self {
                MetadataFileList::Metadata(meta) => MetadataFile::Metadata(GameMetadata {
                    favorite: meta.favorite,
                    match_id: meta.match_id,
                    ingame_time_rec_start_offset: meta.ingame_time_rec_start_offset,
                    highlights: meta.highlights,
                    tft_round_markers: meta.tft_round_markers,
                    queue: meta.queue,
                    player: meta.player,
                    champion_name: meta.champion_name,
                    stats: meta.stats,
                    participant_id: meta.participant_id,
                    participants: meta.participants,
                    teams: meta.teams,
                    events: vec![],
                    gold_timeline: vec![],
                    game_version: meta.game_version,
                    game_duration: meta.game_duration,
                    lp_diff: meta.lp_diff,
                }),
                MetadataFileList::Deferred(def) => MetadataFile::Deferred(Deferred {
                    favorite: def.favorite,
                    match_id: def.match_id,
                    ingame_time_rec_start_offset: def.ingame_time_rec_start_offset,
                    highlights: def.highlights,
                    tft_round_markers: def.tft_round_markers,
                    events: vec![],
                    participants: def.participants,
                }),
                MetadataFileList::NoData(no_data) => MetadataFile::NoData(no_data),
            }
        }
    }

    pub fn rename_recording(recording_path: PathBuf, new_name: String) -> Result<bool> {
        let requested_name = PathBuf::from(new_name);
        let name = requested_name.file_name().context("invalid new filename")?;
        let target = recording_path.with_file_name(name);
        let video = recording_file(&recording_path, "mp4");
        let metadata = recording_file(&recording_path, "json");
        let new_video = recording_file(&target, "mp4");
        let new_metadata = recording_file(&target, "json");

        if new_video.try_exists()? || new_metadata.try_exists()? {
            return Ok(false);
        }

        let has_video = video.is_file();
        let has_metadata = metadata.is_file();
        if !has_video && !has_metadata {
            return Ok(false);
        }
        if has_video {
            fs::rename(&video, &new_video)?;
        }
        if has_metadata {
            if let Err(error) = fs::rename(&metadata, &new_metadata) {
                if has_video {
                    fs::rename(&new_video, &video)
                        .with_context(|| format!("metadata rename failed ({error}); could not restore original MP4"))?;
                }
                return Err(error.into());
            }
        }
        Ok(true)
    }

    pub fn delete_recording(recording: PathBuf) -> Result<()> {
        let video = recording_file(&recording, "mp4");
        let metadata = recording_file(&recording, "json");
        if video.is_dir() || metadata.is_dir() {
            bail!("recording pair contains a directory");
        }
        remove_if_present(&video)?;
        remove_if_present(&metadata)
    }

    pub fn delete_video_file_only(recording: PathBuf) -> Result<()> {
        remove_if_present(&recording_file(&recording, "mp4"))
    }

    fn remove_if_present(path: &Path) -> Result<()> {
        match fs::remove_file(path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }

    pub fn get_recording_metadata(video_path: &Path, fetch: bool) -> Result<MetadataFile> {
        let metadata_path = recording_file(video_path, "json");
        let mp4_path = recording_file(video_path, "mp4");

        if !metadata_path.is_file() && !mp4_path.is_file() {
            bail!("no such video");
        }

        let filedata = if metadata_path.exists() && fs::metadata(&metadata_path)?.is_file() {
            let reader = BufReader::new(File::open(&metadata_path)?);
            serde_json::from_reader::<_, MetadataFile>(reader)?
        } else {
            let metadata_file = MetadataFile::NoData(NoData { favorite: false });
            metadata_file
        };

        match filedata {
            MetadataFile::Deferred(Deferred {
                match_id,
                ingame_time_rec_start_offset,
                favorite,
                highlights,
                tft_round_markers,
                events: _,
                participants: _,
            }) if fetch => {
                let mut metadata =
                    async_runtime::block_on(recorder::process_data(ingame_time_rec_start_offset, match_id, vec![]))?;
                metadata.favorite = favorite;
                metadata.highlights = highlights;
                metadata.tft_round_markers = tft_round_markers;
                let metadata_file = MetadataFile::Metadata(metadata);
                if let Err(e) = save_recording_metadata(&metadata_path, &metadata_file) {
                    log::error!("failed to save re-processed game metadata: {e}");
                }
                Ok(metadata_file)
            }
            metadata_file => Ok(metadata_file),
        }
    }

    pub fn get_recording_metadata_for_list(video_path: &Path) -> Result<MetadataFile> {
        let metadata_path = recording_file(video_path, "json");
        let mp4_path = recording_file(video_path, "mp4");

        if !metadata_path.is_file() && !mp4_path.is_file() {
            bail!("no such video");
        }

        if metadata_path.exists() && fs::metadata(&metadata_path)?.is_file() {
            let reader = BufReader::new(File::open(&metadata_path)?);
            return match serde_json::from_reader::<_, MetadataFileList>(reader) {
                Ok(light) => Ok(light.into_metadata_file()),
                Err(_) => {
                    let reader = BufReader::new(File::open(&metadata_path)?);
                    Ok(serde_json::from_reader::<_, MetadataFile>(reader)?)
                }
            };
        }

        Ok(MetadataFile::NoData(NoData { favorite: false }))
    }

    static METADATA_WRITE: std::sync::Mutex<()> = std::sync::Mutex::new(());

    pub fn save_recording_metadata(path: &Path, metadata_file: &MetadataFile) -> Result<()> {
        let _guard = METADATA_WRITE.lock().unwrap_or_else(|error| error.into_inner());
        crate::util::write_json_atomically(&recording_file(path, "json"), metadata_file)
    }

    pub fn update_recording_metadata<T>(path: &Path, update: impl FnOnce(&mut MetadataFile) -> T) -> Result<T> {
        let _guard = METADATA_WRITE.lock().unwrap_or_else(|error| error.into_inner());
        let json = recording_file(path, "json");
        let mut metadata = read_metadata_for_update(path)?;
        let result = update(&mut metadata);
        crate::util::write_json_atomically(&json, &metadata)?;
        Ok(result)
    }

    fn read_metadata_for_update(path: &Path) -> Result<MetadataFile> {
        match File::open(recording_file(path, "json")) {
            Ok(file) => Ok(serde_json::from_reader(BufReader::new(file))?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && recording_file(path, "mp4").is_file() => {
                Ok(MetadataFile::NoData(NoData { favorite: false }))
            }
            Err(error) => Err(error.into()),
        }
    }

    pub(super) fn delete_if_unprotected(path: &Path, keep_json: bool) -> Result<bool> {
        let _guard = METADATA_WRITE.lock().unwrap_or_else(|error| error.into_inner());
        if read_metadata_for_update(path)
            .map(|metadata| metadata.is_favorite())
            .unwrap_or(true)
        {
            return Ok(false);
        }
        if keep_json {
            delete_video_file_only(path.to_owned())?;
        } else {
            delete_recording(path.to_owned())?;
        }
        Ok(true)
    }
}

#[cfg(test)]
mod library_tests {
    use super::{action, collect_recording_files, RecordingLibrary};
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU32, Ordering},
    };

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            loop {
                let path = std::env::temp_dir().join(format!(
                    "league-record-library-{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed),
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("{error}"),
                }
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn alternate_library_shows_older_recordings_and_optional_clips() {
        let root = Fixture::new();
        let current = root.0.join("league_recordings");
        let previous = root.0.join("LeagueRecord");
        fs::create_dir(&current).unwrap();
        fs::create_dir(&previous).unwrap();
        fs::write(current.join("new.mp4"), [1]).unwrap();
        fs::write(previous.join("old.mp4"), [2]).unwrap();
        let alternate = [previous.clone(), previous.join("clips")];
        let snapshot = RecordingLibrary::default()
            .refresh_with_alternate([current.clone(), current], &alternate, None)
            .unwrap();
        assert!(!snapshot.stale);
        assert_eq!(snapshot.recordings.len(), 2);
        assert!(snapshot.recordings.iter().any(|item| item.video_id.ends_with("old")));
        assert!(super::super::playback::authorized(&previous.join("old.mp4"), &alternate).is_some());
    }

    #[test]
    fn active_video_remains_in_sidebar_and_loses_badge_after_stop() {
        let root = Fixture::new();
        let video = root.0.join("game.mp4");
        fs::write(&video, b"recording").unwrap();
        let roots = [root.0.clone(), root.0.clone()];
        let library = RecordingLibrary::default();
        let active = library.refresh(roots.clone(), Some(&video)).unwrap();
        assert_eq!(active.recordings.len(), 1);
        assert!(active.recordings[0].is_recording);
        let stopped = library.refresh(roots, None).unwrap();
        assert_eq!(stopped.recordings.len(), 1);
        assert!(!stopped.recordings[0].is_recording);
    }

    #[test]
    fn capacity_removes_only_oldest_until_under_limit() {
        let root = Fixture::new();
        let roots = [root.0.clone(), root.0.clone()];
        for (name, bytes) in [("a-oldest.mp4", 4), ("b-next.mp4", 4), ("c-latest.mp4", 1)] {
            fs::write(root.0.join(name), vec![0; bytes]).unwrap();
        }
        super::cleanup_by_size(&roots, None, 6, true, false).unwrap();
        assert!(!root.0.join("a-oldest.mp4").exists());
        assert!(root.0.join("b-next.mp4").exists());
        assert!(root.0.join("c-latest.mp4").exists());
    }

    #[cfg(windows)]
    #[test]
    fn capacity_cleanup_does_not_delete_newer_video_when_oldest_is_locked() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = Fixture::new();
        let oldest = root.0.join("a-oldest.mp4");
        let next = root.0.join("b-next.mp4");
        fs::write(&oldest, [0; 4]).unwrap();
        fs::write(&next, [0; 4]).unwrap();
        let _lock = fs::OpenOptions::new().read(true).share_mode(1).open(&oldest).unwrap();
        assert!(super::cleanup_by_size(&[root.0.clone(), root.0.clone()], None, 6, true, false).is_err());
        assert!(oldest.is_file() && next.is_file());
    }

    #[cfg(windows)]
    #[test]
    fn failed_atomic_replacement_keeps_the_previous_json() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = Fixture::new();
        let path = root.0.join("settings.json");
        crate::util::write_json_atomically(&path, &serde_json::json!({"old": true})).unwrap();
        let lock = fs::OpenOptions::new().read(true).share_mode(1).open(&path).unwrap();
        assert!(crate::util::write_json_atomically(&path, &serde_json::json!({"old": false})).is_err());
        drop(lock);
        assert_eq!(
            serde_json::from_reader::<_, serde_json::Value>(fs::File::open(path).unwrap()).unwrap()["old"],
            true
        );
        assert_eq!(fs::read_dir(&root.0).unwrap().count(), 1);
    }

    #[test]
    fn favorite_and_live_metadata_changes_survive_concurrent_updates() {
        use crate::recorder::{Deferred, MetadataFile};
        let root = Fixture::new();
        let path = root.0.join("game");
        let deferred = Deferred {
            favorite: false,
            match_id: riot_datatypes::MatchId {
                game_id: 1,
                platform_id: "JP1".into(),
            },
            ingame_time_rec_start_offset: 0.0,
            highlights: Vec::new(),
            tft_round_markers: Vec::new(),
            events: Vec::new(),
            participants: Vec::new(),
        };
        action::save_recording_metadata(&path, &MetadataFile::Deferred(deferred)).unwrap();
        std::thread::scope(|threads| {
            threads.spawn(|| action::update_recording_metadata(&path, |data| data.set_favorite(true)).unwrap());
            threads.spawn(|| {
                action::update_recording_metadata(&path, |data| {
                    let MetadataFile::Deferred(deferred) = data else { panic!("expected deferred metadata") };
                    deferred.highlights.push(12.0);
                })
                .unwrap()
            });
        });
        let MetadataFile::Deferred(data) = action::get_recording_metadata(&path, false).unwrap() else {
            panic!("expected deferred metadata");
        };
        assert!(data.favorite);
        assert_eq!(data.highlights, vec![12.0]);
    }

    #[test]
    fn playback_only_allows_mp4_inside_the_current_roots() {
        let root = Fixture::new();
        let allowed = root.0.join("Video folder");
        let outside = root.0.join("Video folder backup");
        fs::create_dir(&allowed).unwrap();
        fs::create_dir(&outside).unwrap();
        let video = allowed.join("a.mp4");
        let json = allowed.join("a.json");
        let unrelated = outside.join("a.mp4");
        for file in [&video, &json, &unrelated] {
            fs::write(file, b"fixture").unwrap();
        }
        let authorized = super::super::playback::authorized;
        assert!(authorized(&video, std::slice::from_ref(&allowed)).is_some());
        assert!(authorized(&json, std::slice::from_ref(&allowed)).is_none());
        assert!(authorized(&unrelated, &[allowed]).is_none());
        assert!(authorized(&video, &[outside]).is_none());
    }

    #[test]
    fn scans_both_roots_and_keeps_last_complete_snapshot_when_clips_disconnect() {
        let root = Fixture::new();
        let recordings = root.0.join("recordings");
        let clips = root.0.join("clips");
        fs::create_dir(&recordings).unwrap();
        fs::create_dir(&clips).unwrap();
        fs::write(recordings.join("same.mp4"), b"video").unwrap();
        fs::write(recordings.join("same.json"), br#"{"NoData":{"favorite":true}}"#).unwrap();
        fs::write(clips.join("same.mp4"), b"clip").unwrap();
        let roots = [recordings.clone(), clips.clone()];
        let library = RecordingLibrary::default();

        let scan = collect_recording_files(&roots, None).unwrap();
        assert_eq!(scan.len(), 2);
        assert!(scan[&recordings.join("same")].bytes > scan[&clips.join("same")].bytes);
        assert_eq!(
            collect_recording_files(&[recordings.clone(), recordings], None)
                .unwrap()
                .len(),
            1
        );
        let first = library.refresh(roots.clone(), None).unwrap();
        assert_eq!(first.recordings.len(), 2);
        assert_eq!(
            first.size_gb,
            scan.values().map(|item| item.bytes).sum::<u64>() as f32 / 1_000_000_000.0
        );

        let disconnected = root.0.join("disconnected");
        fs::rename(&clips, &disconnected).unwrap();
        let fallback = library.refresh(roots.clone(), None).unwrap();
        assert!(fallback.stale);
        assert_eq!(fallback.recordings.len(), 2);
        assert_eq!(fallback.size_gb, first.size_gb);
        assert!(RecordingLibrary::default().refresh(roots.clone(), None).is_err());

        fs::rename(disconnected, clips).unwrap();
        assert!(!library.refresh(roots, None).unwrap().stale);
    }

    #[test]
    fn renames_and_deletes_recording_pairs_without_replacing_a_collision() {
        let root = Fixture::new();
        let source = root.0.join("game.2026");
        fs::write(root.0.join("game.2026.mp4"), b"video").unwrap();
        fs::write(root.0.join("game.2026.json"), b"metadata").unwrap();
        fs::write(root.0.join("collision.json"), b"existing").unwrap();

        assert!(!action::rename_recording(source.clone(), "collision".into()).unwrap());
        assert!(action::rename_recording(source, "renamed.mp4".into()).unwrap());
        assert_eq!(fs::read(root.0.join("renamed.mp4")).unwrap(), b"video");
        assert_eq!(fs::read(root.0.join("renamed.json")).unwrap(), b"metadata");
        assert_eq!(fs::read(root.0.join("collision.json")).unwrap(), b"existing");
        action::delete_recording(root.0.join("renamed")).unwrap();
        assert!(!root.0.join("renamed.mp4").exists());
        assert!(!root.0.join("renamed.json").exists());
    }

    #[cfg(windows)]
    #[test]
    fn restores_original_video_when_metadata_rename_fails() {
        use std::os::windows::fs::OpenOptionsExt;

        let root = Fixture::new();
        let video = root.0.join("source.mp4");
        let metadata = root.0.join("source.json");
        fs::write(&video, b"video").unwrap();
        fs::write(&metadata, b"metadata").unwrap();
        let _lock = fs::OpenOptions::new().read(true).share_mode(1).open(&metadata).unwrap();

        assert!(action::rename_recording(root.0.join("source"), "new".into()).is_err());
        assert_eq!(fs::read(video).unwrap(), b"video");
        assert!(metadata.is_file());
        assert!(!root.0.join("new.mp4").exists());
    }
}
