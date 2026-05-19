use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use anyhow::Result;
use tauri::{AppHandle, Manager};

use crate::state::{CurrentlyRecording, SettingsWrapper};
use crate::util;

pub trait RecordingManager {
    fn get_recordings(&self) -> Vec<PathBuf>;

    fn cleanup_recordings(&self);
    fn cleanup_recordings_by_size(&self);
    fn cleanup_recordings_by_age(&self);
}

impl RecordingManager for AppHandle {
    fn get_recordings(&self) -> Vec<PathBuf> {
        let mut recordings = Vec::<PathBuf>::new();
        let settings = self.state::<SettingsWrapper>();
        let currently_recording = self.state::<CurrentlyRecording>().get();

        let paths_to_scan = vec![settings.get_recordings_path(), settings.get_clips_path()];

        for dir_path in paths_to_scan {
            if let Ok(read_dir) = dir_path.read_dir() {
                for entry in read_dir.flatten() {
                    let path = entry.path();

                    if !path.is_file() || Some(&path) == currently_recording.as_ref() {
                        continue;
                    }

                    if let Some(ext) = path.extension() {
                        if ext == "mp4" || ext == "json" {
                            recordings.push(path.with_extension(""));
                        }
                    }
                }
            }
        }

        // Remove duplicates in case folders are the same or nested,
        // or if both .mp4 and .json exist for the same base name.
        recordings.sort();
        recordings.dedup();

        recordings
    }

    fn cleanup_recordings(&self) {
        self.cleanup_recordings_by_age();
        self.cleanup_recordings_by_size();
    }

    fn cleanup_recordings_by_size(&self) {
        use std::cmp::Ordering;

        let settings = self.state::<SettingsWrapper>();
        let auto_delete_clips = settings.auto_delete_clips();
        let clips_path = settings.get_clips_path();
        let Some(max_gb) = settings.max_recordings_size() else { return };
        let max_size = max_gb * 1_000_000_000; // convert to bytes

        let mut recordings = self.get_recordings();
        recordings.sort_by(|a, b| util::compare_time(a, b).unwrap_or(Ordering::Equal));

        let mut total_size = 0;

        // add size from video thats currently being recorded to the total (in case there is one)
        // so the total size of all videos stays below the threshhold set in settings
        if let Some(currently_recording_metadata) = self
            .state::<CurrentlyRecording>()
            .get()
            .and_then(|pb| pb.metadata().ok())
        {
            total_size += currently_recording_metadata.len();
        }

        // split recordings into 'favorites' and 'others' by json metadata 'favorite' value
        // in case reading the metadata fails put the recording into favorites so it doesn't get deleted
        let (protected, others): (Vec<_>, Vec<_>) = recordings.into_iter().partition(|recording| {
            if !auto_delete_clips && is_clip_recording(recording, &clips_path) {
                return true;
            }

            let mut with_ext = recording.clone();
            with_ext.set_extension("mp4");
            action::get_recording_metadata(&with_ext, false)
                .map(|metadata_file| metadata_file.is_favorite())
                .unwrap_or(true)
        });

        // get sum of sizes of recordings marked as favorites or clips
        for mut recording in protected {
            recording.set_extension("mp4");
            match recording.metadata() {
                Ok(metadata) => total_size += metadata.len(),
                Err(e) => log::warn!(
                    "failed to get size of recording (protected) {}: {e}",
                    recording.display(),
                ),
            }
        }

        for mut recording in others {
            recording.set_extension("mp4");
            match recording.metadata() {
                Ok(metadata) => total_size += metadata.len(),
                Err(e) => log::warn!("failed to get size of recording {}: {e}", recording.display(),),
            }

            if total_size > max_size {
                let keep_json = self.state::<SettingsWrapper>().keep_video_json_on_auto_delete();
                if keep_json {
                    if let Err(e) = action::delete_video_file_only(recording) {
                        log::error!("failed to delete file due to size limit: {e}");
                    }
                } else {
                    if let Err(e) = action::delete_recording(recording) {
                        log::error!("failed to delete file due to size limit: {e}");
                    }
                }
            }
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
        for mut recording in self.get_recordings() {
            recording.set_extension("mp4");
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
    use std::io::{BufReader, BufWriter};
    use std::path::{Path, PathBuf};

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
        let mut new_recording_path = recording_path.clone();
        new_recording_path.set_file_name(PathBuf::from(new_name).file_name().context("invalid new filename")?);

        let mut metadata_path = recording_path.clone();
        metadata_path.set_extension("json");

        let mut new_metadata_path = new_recording_path.clone();
        new_metadata_path.set_extension("json");

        if new_recording_path.is_file() || new_metadata_path.is_file() {
            return Ok(false);
        }

        fs::rename(&recording_path, &new_recording_path)?;
        fs::rename(&metadata_path, &new_metadata_path)?;

        Ok(true)
    }

    pub fn delete_recording(mut recording: PathBuf) -> Result<()> {
        recording.set_extension("mp4");
        if recording.exists() {
            fs::remove_file(&recording)?;
        }

        let mut metadata_file = recording;
        metadata_file.set_extension("json");
        if metadata_file.exists() {
            fs::remove_file(metadata_file)?;
        }

        Ok(())
    }

    pub fn delete_video_file_only(mut recording: PathBuf) -> Result<()> {
        recording.set_extension("mp4");
        if recording.exists() {
            fs::remove_file(&recording)?;
        }
        Ok(())
    }

    pub fn get_recording_metadata(video_path: &Path, fetch: bool) -> Result<MetadataFile> {
        let metadata_path = video_path.with_extension("json");
        let mp4_path = video_path.with_extension("mp4");

        if !metadata_path.is_file() && !mp4_path.is_file() {
            bail!("no such video");
        }

        let filedata = if metadata_path.exists() && fs::metadata(&metadata_path)?.is_file() {
            let reader = BufReader::new(File::open(&metadata_path)?);
            serde_json::from_reader::<_, MetadataFile>(reader)?
        } else {
            let metadata_file = MetadataFile::NoData(NoData { favorite: false });
            save_recording_metadata(&metadata_path, &metadata_file)?;
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
        let metadata_path = video_path.with_extension("json");
        let mp4_path = video_path.with_extension("mp4");

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

        let metadata_file = MetadataFile::NoData(NoData { favorite: false });
        save_recording_metadata(&metadata_path, &metadata_file)?;
        Ok(metadata_file)
    }

    pub fn save_recording_metadata(path: &Path, metadata_file: &MetadataFile) -> Result<()> {
        let mut path = path.to_owned();
        path.set_extension("json");

        let writer = BufWriter::new(File::create(path)?);
        Ok(serde_json::to_writer_pretty(writer, &metadata_file)?)
    }
}
