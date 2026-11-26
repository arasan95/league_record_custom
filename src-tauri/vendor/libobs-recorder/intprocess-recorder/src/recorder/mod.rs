use std::cell::Cell;
use std::ffi::CStr;
use std::os::raw::{c_char, c_int};
use std::ptr::{null_mut, NonNull};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, ThreadId};
use std::time::Duration;

use crate::settings::{
    Adapter, AdapterId, ApplicationAudioTrackSetting, AudioSource, Encoder, Framerate, RateControl, RecorderSettings,
    Resolution,
};
use get::Get;
use obs_data::ObsData;

mod get;
pub(crate) mod obs_data;

#[cfg(target_os = "windows")]
const GRAPHICS_MODULE: &str = "libobs-d3d11.dll";
#[cfg(not(target_os = "windows"))]
const GRAPHICS_MODULE: &str = "libobs-opengl.dll";

// default asset paths
const DEFAULT_LIBOBS_DATA_PATH: &str = "./data/libobs/";
const DEFAULT_PLUGIN_BIN_PATH: &str = "./obs-plugins/64bit/";
const DEFAULT_PLUGIN_DATA_PATH: &str = "./data/obs-plugins/%module%/";

// define null terminated libobs object names for ffi
const OUTPUT: *const i8 = c"output".as_ptr().cast();
const VIDEO_ENCODER: *const i8 = c"video_encoder".as_ptr().cast();
const AUDIO_ENCODER1: *const i8 = c"audio_encoder1".as_ptr().cast();
const AUDIO_ENCODER2: *const i8 = c"audio_encoder2".as_ptr().cast();
const AUDIO_ENCODER3: *const i8 = c"audio_encoder3".as_ptr().cast();
const AUDIO_ENCODER4: *const i8 = c"audio_encoder4".as_ptr().cast();
const VIDEO_SOURCE: *const i8 = c"video_source".as_ptr().cast();
const AUDIO_SOURCE1: *const i8 = c"audio_source1".as_ptr().cast();
const AUDIO_SOURCE2: *const i8 = c"audio_source2".as_ptr().cast();
const AUDIO_SOURCE3: *const i8 = c"audio_source3".as_ptr().cast();

// libobs output channel assignments
const VIDEO_CHANNEL: u32 = 0;
const AUDIO_CHANNEL1: u32 = 1;
const AUDIO_CHANNEL2: u32 = 2;
const AUDIO_CHANNEL3: u32 = 3;

const AUDIO_MIX_FULL: u32 = 1 << 0;
const AUDIO_MIX_GAME: u32 = 1 << 1;
const AUDIO_MIX_SYSTEM: u32 = 1 << 2;
const AUDIO_MIX_MIC: u32 = 1 << 3;
const RAW_VIDEO_FRAME_RATE_DIVISOR: u32 = 30;
const RAW_VIDEO_MAX_HEIGHT: u32 = 720;

#[derive(Default)]
struct LatestRawVideoFrame {
    width: u32,
    height: u32,
    x: f64,
    y: f64,
    normalized_width: f64,
    normalized_height: f64,
    bgra: Vec<u8>,
}

pub struct VideoRegionFrame {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

struct RawVideoFrames {
    latest: Arc<Mutex<Option<LatestRawVideoFrame>>>,
    callback_state: Box<RawVideoCallbackState>,
}

struct RawVideoCallbackState {
    latest: Arc<Mutex<Option<LatestRawVideoFrame>>>,
    width: u32,
    height: u32,
    x: f64,
    y: f64,
    normalized_width: f64,
    normalized_height: f64,
}

impl RawVideoFrames {
    fn start(width: u32, height: u32, x: f64, y: f64, normalized_width: f64, normalized_height: f64) -> Self {
        let (width, height) = raw_video_callback_size(width, height);
        let latest = Arc::new(Mutex::new(None));
        let mut callback_state = Box::new(RawVideoCallbackState {
            latest: latest.clone(),
            width,
            height,
            x: x.clamp(0.0, 1.0),
            y: y.clamp(0.0, 1.0),
            normalized_width: normalized_width.clamp(0.01, 1.0),
            normalized_height: normalized_height.clamp(0.01, 1.0),
        });
        let conversion = libobs_sys::video_scale_info {
            format: libobs_sys::video_format_VIDEO_FORMAT_BGRA,
            width,
            height,
            range: libobs_sys::video_range_type_VIDEO_RANGE_FULL,
            colorspace: libobs_sys::video_colorspace_VIDEO_CS_709,
        };
        unsafe {
            libobs_sys::obs_add_raw_video_callback2(
                &conversion,
                RAW_VIDEO_FRAME_RATE_DIVISOR,
                Some(raw_video_callback),
                callback_state.as_mut() as *mut RawVideoCallbackState as *mut _,
            );
        }
        Self { latest, callback_state }
    }

    fn contains(&self, x: f64, y: f64, width: f64, height: f64) -> bool {
        let epsilon = 0.0005;
        let state = self.callback_state.as_ref();
        x + epsilon >= state.x
            && y + epsilon >= state.y
            && x + width <= state.x + state.normalized_width + epsilon
            && y + height <= state.y + state.normalized_height + epsilon
    }

    fn crop(&self, x: f64, y: f64, width: f64, height: f64) -> Option<VideoRegionFrame> {
        let latest = self.latest.lock().ok()?;
        let frame = latest.as_ref()?;
        let source_x = (((x - frame.x) / frame.normalized_width) * frame.width as f64)
            .round()
            .max(0.0) as u32;
        let source_y = (((y - frame.y) / frame.normalized_height) * frame.height as f64)
            .round()
            .max(0.0) as u32;
        let crop_width = ((width / frame.normalized_width) * frame.width as f64).round().max(8.0) as u32;
        let crop_height = ((height / frame.normalized_height) * frame.height as f64)
            .round()
            .max(8.0) as u32;
        let crop_width = crop_width.min(frame.width.saturating_sub(source_x));
        let crop_height = crop_height.min(frame.height.saturating_sub(source_y));
        if crop_width == 0 || crop_height == 0 {
            return None;
        }

        let mut bgra = Vec::with_capacity(crop_width as usize * crop_height as usize * 4);
        for row in source_y..source_y + crop_height {
            let start = ((row * frame.width + source_x) * 4) as usize;
            let end = start + crop_width as usize * 4;
            bgra.extend_from_slice(frame.bgra.get(start..end)?);
        }
        Some(VideoRegionFrame {
            width: crop_width,
            height: crop_height,
            bgra,
        })
    }
}

fn raw_video_callback_size(width: u32, height: u32) -> (u32, u32) {
    if width == 0 || height == 0 || height <= RAW_VIDEO_MAX_HEIGHT {
        return (width, height);
    }
    let scaled_height = RAW_VIDEO_MAX_HEIGHT;
    let scaled_width = ((width as u64 * scaled_height as u64) / height as u64)
        .max(1)
        .min(u32::MAX as u64) as u32;
    (scaled_width, scaled_height)
}

impl Drop for RawVideoFrames {
    fn drop(&mut self) {
        unsafe {
            libobs_sys::obs_remove_raw_video_callback(
                Some(raw_video_callback),
                self.callback_state.as_mut() as *mut RawVideoCallbackState as *mut _,
            );
        }
    }
}

unsafe extern "C" fn raw_video_callback(param: *mut std::ffi::c_void, frame: *mut libobs_sys::video_data) {
    if param.is_null() || frame.is_null() {
        return;
    }
    let state = &*(param as *const RawVideoCallbackState);
    let frame = &*frame;
    let source = frame.data[0];
    let line_size = frame.linesize[0] as usize;
    let row_bytes = state.width as usize * 4;
    if source.is_null() || line_size < row_bytes || state.width == 0 || state.height == 0 {
        return;
    }

    let base_width = (state.height as f64 * 16.0 / 9.0).min(state.width as f64);
    let source_x = (state.x * base_width).round().max(0.0) as usize;
    let source_y = (state.y * state.height as f64).round().max(0.0) as usize;
    let crop_width = (state.normalized_width * base_width).round().max(8.0) as usize;
    let crop_height = (state.normalized_height * state.height as f64).round().max(8.0) as usize;
    let crop_width = crop_width.min((state.width as usize).saturating_sub(source_x));
    let crop_height = crop_height.min((state.height as usize).saturating_sub(source_y));
    if crop_width == 0 || crop_height == 0 {
        return;
    }

    let mut bgra = Vec::with_capacity(crop_width * crop_height * 4);
    for row in source_y..source_y + crop_height {
        let source_row = std::slice::from_raw_parts(source.add(row * line_size + source_x * 4), crop_width * 4);
        bgra.extend_from_slice(source_row);
    }
    if let Ok(mut latest) = state.latest.lock() {
        *latest = Some(LatestRawVideoFrame {
            width: crop_width as u32,
            height: crop_height as u32,
            x: state.x,
            y: state.y,
            normalized_width: state.normalized_width,
            normalized_height: state.normalized_height,
            bgra,
        });
    }
}

fn normalize_process_name(value: Option<&str>) -> Option<String> {
    let trimmed = value.unwrap_or_default().trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut process = trimmed.to_string();
    if !process.to_ascii_lowercase().ends_with(".exe") {
        process.push_str(".exe");
    }
    Some(process)
}

fn normalized_track(track: Option<&ApplicationAudioTrackSetting>) -> (Option<String>, bool, u8) {
    let enabled = track.map(|t| t.enabled).unwrap_or(false);
    let volume_percent = track.map(|t| t.volume_percent.min(100)).unwrap_or(100);
    let app = normalize_process_name(track.and_then(|t| t.application.as_deref()));
    (app, enabled, volume_percent)
}

static LIBOBS_THREAD: OnceLock<ThreadId> = OnceLock::new();
static LIBOBS_SHUTDOWN: AtomicBool = AtomicBool::new(false);

// stores how many instances of Recorder exist in each thread
// it is only possible to create instances of Recorder on one thread due to LIBOBS_THREAD
//
// these are thread local so I don't have to make them thread-safe
thread_local! {
    static REF_COUNT: Cell<u32> = const { Cell::new(0) };
    static CURRENT_ENCODER: Cell<Encoder> = const { Cell::new(Encoder::OBS_X264) };
}

type PhantomUnsync = std::marker::PhantomData<Cell<()>>;
type PhantomUnsend = std::marker::PhantomData<*mut ()>;

pub struct InpRecorder {
    output: NonNull<libobs_sys::obs_output>,
    video_encoder: Cell<NonNull<libobs_sys::obs_encoder>>,
    audio_encoder1: NonNull<libobs_sys::obs_encoder>,
    audio_encoder2: NonNull<libobs_sys::obs_encoder>,
    audio_encoder3: NonNull<libobs_sys::obs_encoder>,
    audio_encoder4: NonNull<libobs_sys::obs_encoder>,
    video_source: NonNull<libobs_sys::obs_source>,
    audio_source1: NonNull<libobs_sys::obs_source>,
    audio_source2: NonNull<libobs_sys::obs_source>,
    audio_source3: NonNull<libobs_sys::obs_source>,
    raw_video_frames: Option<RawVideoFrames>,

    _phantom: std::marker::PhantomData<(PhantomUnsend, PhantomUnsync)>,
}

// implement associated functions
impl InpRecorder {
    /// # Panics
    /// Panics if the libobs initialization sequence fails.
    ///
    /// This can happen because the necessary DLLs are missing or some other necessary files can not be found.
    /// If the `initialize` function runs once without panicking for a certain environment (DLLs, config files, ...)
    /// it is garuanteed to never panic as long as the environment stays the same. If it does it is a bug.
    pub fn initialize(
        libobs_data_path: Option<&str>,
        plugin_bin_path: Option<&str>,
        plugin_data_path: Option<&str>,
    ) -> Result<(), &'static str> {
        // libobs currently cant be reinitialized after being shutdown
        // I assume this is a limitation of libobs
        if LIBOBS_SHUTDOWN.load(Ordering::Acquire) {
            return Err("libobs has already been shut down");
        }

        if LIBOBS_THREAD.get().is_some() {
            return Err("libobs has already been initialized");
        }

        LIBOBS_THREAD.get_or_init(|| {
            if let Err(e) = Self::init_internal(libobs_data_path, plugin_bin_path, plugin_data_path) {
                // println!("Error initializing libobs: {e}");
                panic!("Error initializing libobs: {e}");
            }

            thread::current().id()
        });

        // println!("libobs {} initialized", libobs_sys::VERSION);

        Ok(())
    }

    fn init_internal(
        libobs_data_path: Option<&str>,
        plugin_bin_path: Option<&str>,
        plugin_data_path: Option<&str>,
    ) -> Result<(), &'static str> {
        // set defaults in case no arguments were provided
        let libobs_data_path = libobs_data_path.unwrap_or(DEFAULT_LIBOBS_DATA_PATH);
        let plugin_bin_path = plugin_bin_path.unwrap_or(DEFAULT_PLUGIN_BIN_PATH);
        let plugin_data_path = plugin_data_path.unwrap_or(DEFAULT_PLUGIN_DATA_PATH);

        // INITIALIZE
        let mut get = Get::new();

        if unsafe { !libobs_sys::obs_startup(get.c_str("en-US"), null_mut(), null_mut()) } {
            return Err("libobs startup failed");
        }

        let default_fps = Framerate::new(30, 1);
        let default_size = Resolution::new(1920, 1080);
        unsafe { libobs_sys::obs_add_data_path(get.c_str(libobs_data_path)) };
        Self::reset_video(default_size, default_size, default_fps).expect("unable to initialize video");
        Self::reset_audio().expect("unable to initialize audio");

        unsafe {
            libobs_sys::obs_add_module_path(get.c_str(plugin_bin_path), get.c_str(plugin_data_path));
            libobs_sys::obs_load_all_modules();
            libobs_sys::obs_post_load_modules();
            libobs_sys::obs_log_loaded_modules();
        }

        // CREATE OUTPUT
        let mut data = ObsData::new();
        data.set_string("path", "./recording.mp4");
        let output =
            unsafe { libobs_sys::obs_output_create(get.c_str("ffmpeg_muxer"), OUTPUT, data.as_ptr(), null_mut()) };

        // choose 'best' encoder
        let encoders = Self::get_available_encoders_internal();
        if encoders.is_empty() {
            return Err("no encoder available");
        }
        let current_encoder = *encoders.first().unwrap();
        Self::set_current_encoder(current_encoder);

        // CREATE VIDEO ENCODER
        let mut get = Get::new();
        let data: ObsData = current_encoder.settings(RateControl::default());
        let video_encoder = unsafe {
            libobs_sys::obs_video_encoder_create(
                get.c_str(current_encoder.id()),
                VIDEO_ENCODER,
                data.as_ptr(),
                null_mut(),
            )
        };
        unsafe {
            libobs_sys::obs_encoder_set_video(video_encoder, libobs_sys::obs_get_video());
            libobs_sys::obs_output_set_video_encoder(output, video_encoder);
        }

        // CREATE VIDEO SOURCE
        let mut data = ObsData::new();
        data.set_string("capture_mode", "window");
        data.set_string("window", "");
        data.set_bool("capture_cursor", true);
        let video_source = unsafe {
            libobs_sys::obs_source_create(
                get.c_str("game_capture"),
                VIDEO_SOURCE,
                data.as_ptr(),
                std::ptr::null_mut(),
            )
        };
        unsafe { libobs_sys::obs_set_output_source(VIDEO_CHANNEL, video_source) };

        // CREATE AUDIO ENCODERS
        let audio_encoder1 = Self::create_audio_encoder(&mut get, AUDIO_ENCODER1, 0)?;
        let audio_encoder2 = Self::create_audio_encoder(&mut get, AUDIO_ENCODER2, 1)?;
        let audio_encoder3 = Self::create_audio_encoder(&mut get, AUDIO_ENCODER3, 2)?;
        let audio_encoder4 = Self::create_audio_encoder(&mut get, AUDIO_ENCODER4, 3)?;
        unsafe {
            libobs_sys::obs_output_set_audio_encoder(output, audio_encoder1, 0);
            libobs_sys::obs_output_set_audio_encoder(output, audio_encoder2, 1);
            libobs_sys::obs_output_set_audio_encoder(output, audio_encoder3, 2);
            libobs_sys::obs_output_set_audio_encoder(output, audio_encoder4, 3);
        }

        // CREATE AUDIO SOURCE 1
        unsafe {
            libobs_sys::obs_source_create(
                get.c_str("wasapi_process_output_capture"),
                AUDIO_SOURCE1,
                null_mut(),
                null_mut(),
            )
        };

        // CREATE AUDIO SOURCE 2
        let mut data = ObsData::new();
        data.set_string("device_id", "default");
        let audio_source2 = unsafe {
            libobs_sys::obs_source_create(
                get.c_str("wasapi_output_capture"),
                AUDIO_SOURCE2,
                data.as_ptr(),
                null_mut(),
            )
        };
        unsafe { libobs_sys::obs_set_output_source(AUDIO_CHANNEL2, audio_source2) };

        // CREATE AUDIO SOURCE 3
        let mut data = ObsData::new();
        data.set_string("device_id", "default");
        unsafe {
            libobs_sys::obs_source_create(
                get.c_str("wasapi_input_capture"),
                AUDIO_SOURCE3,
                data.as_ptr(),
                null_mut(),
            )
        };

        Ok(())
    }

    pub fn get_handle() -> Result<Self, &'static str> {
        Self::check_thread_initialized()?;

        unsafe {
            let output =
                NonNull::new(libobs_sys::obs_get_output_by_name(OUTPUT)).ok_or("got nullpointer instead of output")?;
            let video_encoder = Cell::new(
                NonNull::new(libobs_sys::obs_get_encoder_by_name(VIDEO_ENCODER))
                    .ok_or("got nullpointer instead of video encoder")?,
            );
            let audio_encoder1 = NonNull::new(libobs_sys::obs_get_encoder_by_name(AUDIO_ENCODER1))
                .ok_or("got nullpointer instead of audio encoder 1")?;
            let audio_encoder2 = NonNull::new(libobs_sys::obs_get_encoder_by_name(AUDIO_ENCODER2))
                .ok_or("got nullpointer instead of audio encoder 2")?;
            let audio_encoder3 = NonNull::new(libobs_sys::obs_get_encoder_by_name(AUDIO_ENCODER3))
                .ok_or("got nullpointer instead of audio encoder 3")?;
            let audio_encoder4 = NonNull::new(libobs_sys::obs_get_encoder_by_name(AUDIO_ENCODER4))
                .ok_or("got nullpointer instead of audio encoder 4")?;
            let video_source = NonNull::new(libobs_sys::obs_get_source_by_name(VIDEO_SOURCE))
                .ok_or("got nullpointer instead of video source")?;
            let audio_source1 = NonNull::new(libobs_sys::obs_get_source_by_name(AUDIO_SOURCE1))
                .ok_or("got nullpointer instead of audio source 1")?;
            let audio_source2 = NonNull::new(libobs_sys::obs_get_source_by_name(AUDIO_SOURCE2))
                .ok_or("got nullpointer instead of audio source2")?;
            let audio_source3 = NonNull::new(libobs_sys::obs_get_source_by_name(AUDIO_SOURCE3))
                .ok_or("got nullpointer instead of audio source3")?;

            Self::increment_refcount();

            Ok(Self {
                output,
                video_encoder,
                audio_encoder1,
                audio_encoder2,
                audio_encoder3,
                audio_encoder4,
                video_source,
                audio_source1,
                audio_source2,
                audio_source3,
                raw_video_frames: None,
                _phantom: std::marker::PhantomData,
            })
        }
    }

    pub fn shutdown() -> Result<(), &'static str> {
        Self::check_thread_initialized()?;

        if LIBOBS_SHUTDOWN.load(Ordering::Acquire) {
            return Ok(());
        }

        if REF_COUNT.get() > 0 {
            return Err("libobs can't be shut down due to existing Recorder instances");
        }

        unsafe { libobs_sys::obs_shutdown() };
        LIBOBS_SHUTDOWN.store(true, Ordering::Release);

        Ok(())
    }

    fn get_video_info() -> Result<libobs_sys::obs_video_info, &'static str> {
        let mut ovi = libobs_sys::obs_video_info::default();
        if unsafe { libobs_sys::obs_get_video_info(&mut ovi) } {
            Ok(ovi)
        } else {
            Err("Error video was not set! Maybe Recorder was not initialized?")
        }
    }

    fn reset_video(input_size: Resolution, output_size: Resolution, framerate: Framerate) -> Result<(), &'static str> {
        unsafe {
            let mut get = Get::new();
            let mut ovi = libobs_sys::obs_video_info {
                adapter: AdapterId::default(),
                graphics_module: get.c_str(GRAPHICS_MODULE),
                fps_num: framerate.num(),
                fps_den: framerate.den(),
                base_width: input_size.width(),
                base_height: input_size.height(),
                output_width: output_size.width(),
                output_height: output_size.height(),
                output_format: libobs_sys::video_format_VIDEO_FORMAT_NV12,
                gpu_conversion: true,
                colorspace: libobs_sys::video_colorspace_VIDEO_CS_709,
                range: libobs_sys::video_range_type_VIDEO_RANGE_DEFAULT,
                scale_type: libobs_sys::obs_scale_type_OBS_SCALE_LANCZOS,
            };

            // OBS_VIDEO_SUCCESS is 0, so casting it to c_int should be fine
            if libobs_sys::obs_reset_video(&mut ovi) != libobs_sys::OBS_VIDEO_SUCCESS as c_int {
                return Err("error on libobs reset video");
            }
        }

        Ok(())
    }

    /// only call this function once on startup
    /// resetting audio after initialisation crashes libobs
    fn reset_audio() -> Result<(), String> {
        let ai = libobs_sys::obs_audio_info {
            samples_per_sec: 44100,
            speakers: libobs_sys::speaker_layout_SPEAKERS_STEREO,
        };
        let ok = unsafe { libobs_sys::obs_reset_audio(&ai) };
        if !ok {
            return Err(String::from("error on libobs reset audio"));
        }
        Ok(())
    }

    fn create_audio_encoder(
        get: &mut Get,
        name: *const i8,
        mixer_idx: usize,
    ) -> Result<*mut libobs_sys::obs_encoder, &'static str> {
        let mut data = ObsData::new();
        data.set_int("bitrate", 160);
        let audio_encoder = unsafe {
            libobs_sys::obs_audio_encoder_create(get.c_str("ffmpeg_aac"), name, data.as_ptr(), mixer_idx, null_mut())
        };
        if audio_encoder.is_null() {
            return Err("unable to create audio encoder");
        }
        unsafe { libobs_sys::obs_encoder_set_audio(audio_encoder, libobs_sys::obs_get_audio()) };
        Ok(audio_encoder)
    }

    fn get_available_encoders_internal() -> Vec<Encoder> {
        let adapter = Self::get_adapters_internal()
            .into_iter()
            .find(|e| e.id() == AdapterId::default())
            .expect("no adapters found?");

        // GET AVAILABLE ENCODERS
        let mut n = 0;
        let mut encoders = Vec::new();
        let mut ptr: *const c_char = unsafe { std::mem::zeroed() };
        while unsafe { libobs_sys::obs_enum_encoder_types(n, &mut ptr) } {
            n += 1;
            let cstring = unsafe { CStr::from_ptr(ptr) };
            if let Ok(enc) = cstring.to_str() {
                let Ok(enc) = Encoder::try_from(enc) else { continue };

                if enc.matches_adapter(&adapter) {
                    encoders.push(enc);
                }
            }
        }
        encoders.sort();
        encoders
    }

    fn get_adapters_internal() -> Vec<Adapter> {
        let mut adapters: Vec<Adapter> = Vec::new();

        unsafe extern "C" fn callback(
            vec: *mut ::std::os::raw::c_void,
            name: *const ::std::os::raw::c_char,
            id: u32,
        ) -> bool {
            let adapters = &mut *(vec as *mut Vec<Adapter>);
            adapters.push(Adapter::new(id, CStr::from_ptr(name).to_string_lossy().to_string()));

            true
        }

        unsafe {
            libobs_sys::obs_enter_graphics();
            libobs_sys::gs_enum_adapters(
                Some(callback),
                &mut adapters as *mut Vec<Adapter> as *mut ::std::os::raw::c_void,
            );
            libobs_sys::obs_leave_graphics();
        }

        adapters
    }

    fn check_thread_initialized() -> Result<(), &'static str> {
        match LIBOBS_THREAD.get() {
            Some(thread_id) if thread_id == &thread::current().id() => Ok(()),
            Some(_) => Err("wrong thread - libobs was initialized in another thread"),
            None => Err("libos has not been initialized yet"),
        }
    }

    fn set_current_encoder(encoder: Encoder) {
        CURRENT_ENCODER.set(encoder);
    }

    fn get_current_encoder() -> Encoder {
        CURRENT_ENCODER.with(Cell::get)
    }

    fn increment_refcount() {
        REF_COUNT.with(|cell| cell.set(cell.get() + 1));
    }

    fn decrement_refcount() {
        REF_COUNT.with(|cell| cell.set(cell.get() - 1));
    }
}

impl InpRecorder {
    pub fn start_recording(&mut self) -> Result<(), String> {
        // println!("Recording Start: {}", unsafe { libobs_sys::bnum_allocs() });
        if self.is_recording() {
            Ok(()) // already recording
        } else {
            if unsafe { libobs_sys::obs_output_start(self.output.as_ptr()) } {
                return Ok(());
            }

            let error = unsafe {
                let err = libobs_sys::obs_output_get_last_error(self.output.as_ptr());
                if err.is_null() {
                    c"no error message"
                } else {
                    CStr::from_ptr(err)
                }
            };
            Err(error.to_str().unwrap_or("error message is invalid UTF-8").to_string())
        }
    }

    pub fn stop_recording(&mut self) {
        self.raw_video_frames = None;
        if self.is_recording() {
            unsafe { libobs_sys::obs_output_stop(self.output.as_ptr()) }
            // println!("Recording Stop: {}", unsafe { libobs_sys::bnum_allocs() });
        }

        let now = std::time::Instant::now();
        loop {
            thread::sleep(Duration::from_millis(100));
            if !self.is_recording() {
                return;
            } else if now.elapsed().as_millis() > 3000 {
                unsafe { libobs_sys::obs_output_force_stop(self.output.as_ptr()) };
                return;
            }
        }
    }

    pub fn configure(&self, settings: &RecorderSettings) -> Result<(), &'static str> {
        if self.is_recording() {
            return Err("can't change settings while recording");
        }

        // set adapter, input_resolution, output_resolution, framerate
        let ovi = Self::get_video_info()?;

        let framerate = settings.framerate.unwrap_or(Framerate::new(30, 1));

        // SMART SCALING: Recalculate output resolution to maintain aspect ratio
        let input = settings.input_resolution;
        let output_target = settings.output_resolution;

        // Calculate aspect ratio from input (Game Window)
        let aspect = input.width() as f64 / input.height() as f64;

        // Calculate new width based on target height (e.g. 720) and input aspect ratio
        let new_width = (output_target.height() as f64 * aspect).round() as u32;

        // Ensure even width (required for many encoders/formats like NV12)
        let new_width = new_width + (new_width % 2);

        let effective_output_resolution = Resolution::new(new_width, output_target.height());

        // println!(
        //     "Configuring Resolution: Input {:?} -> Target {:?} -> Effective {:?}",
        //     input, output_target, effective_output_resolution
        // );

        let video_reset_necessary = settings.input_resolution.width() != ovi.base_width
            || settings.input_resolution.height() != ovi.base_height
            || effective_output_resolution.width() != ovi.output_width
            || effective_output_resolution.height() != ovi.output_height
            || framerate.num() != ovi.fps_num
            || framerate.den() != ovi.fps_den;
        if video_reset_necessary {
            Self::reset_video(settings.input_resolution, effective_output_resolution, framerate)?;

            unsafe {
                // reconfigure video output pipeline after resetting the video backend
                libobs_sys::obs_encoder_set_video(self.video_encoder.get().as_ptr(), libobs_sys::obs_get_video());
                libobs_sys::obs_output_set_video_encoder(self.output.as_ptr(), self.video_encoder.get().as_ptr());
                libobs_sys::obs_set_output_source(VIDEO_CHANNEL, self.video_source.as_ptr());
            }
        }

        let available_encoders = Self::get_available_encoders_internal();
        if let Some(encoder) = settings.encoder {
            // check if the given encoder is available on the current adapter
            if !available_encoders.contains(&encoder) {
                return Err("encoder not available");
            }
        }

        // if no encoder was explicitly set, choose an available encoder
        let encoder = match settings.encoder {
            Some(encoder) => encoder,
            None => *available_encoders.first().ok_or("no encoders available")?,
        };

        let mut get = Get::new();

        // set output_path
        let mut data = ObsData::new();
        data.set_string("path", &settings.output_path);
        unsafe { libobs_sys::obs_output_update(self.output.as_ptr(), data.as_ptr()) };

        // set video encoder
        Self::set_current_encoder(encoder);

        let data = encoder.settings(settings.rate_control.unwrap_or_default());
        let new_video_encoder = NonNull::new(unsafe {
            libobs_sys::obs_video_encoder_create(
                get.c_str(encoder.id()),
                get.c_str("video_encoder"),
                data.as_ptr(),
                null_mut(),
            )
        })
        .ok_or("unable to create video encoder")?;

        unsafe {
            libobs_sys::obs_encoder_set_video(new_video_encoder.as_ptr(), libobs_sys::obs_get_video());
            libobs_sys::obs_output_set_video_encoder(self.output.as_ptr(), new_video_encoder.as_ptr());
        }

        // replace and release old encoder
        let old_encoder = self.video_encoder.replace(new_video_encoder);
        unsafe { libobs_sys::obs_encoder_release(old_encoder.as_ptr()) };

        // set video source (window)
        let mut data = ObsData::new();
        data.set_string("window", settings.window.get_libobs_window_id());
        unsafe { libobs_sys::obs_source_update(self.video_source.as_ptr(), data.as_ptr()) };

        // set audio sources
        let audio_setting = settings.audio_source.unwrap_or(AudioSource::APPLICATION);
        let separated_audio = audio_setting == AudioSource::SEPARATED;
        let applications3_audio = audio_setting == AudioSource::APPLICATIONS3;
        let app_tracks = settings.get_application_audio_tracks().cloned().unwrap_or_default();
        let (app1, app1_enabled, app1_volume_percent) = normalized_track(app_tracks.first());
        let (app2, app2_enabled, app2_volume_percent) = normalized_track(app_tracks.get(1));
        let (app3, app3_enabled, app3_volume_percent) = normalized_track(app_tracks.get(2));
        unsafe {
            libobs_sys::obs_output_set_audio_encoder(self.output.as_ptr(), self.audio_encoder1.as_ptr(), 0);
            libobs_sys::obs_output_set_audio_encoder(
                self.output.as_ptr(),
                if separated_audio || applications3_audio {
                    self.audio_encoder2.as_ptr()
                } else {
                    null_mut()
                },
                1,
            );
            libobs_sys::obs_output_set_audio_encoder(
                self.output.as_ptr(),
                if separated_audio || applications3_audio {
                    self.audio_encoder3.as_ptr()
                } else {
                    null_mut()
                },
                2,
            );
            libobs_sys::obs_output_set_audio_encoder(
                self.output.as_ptr(),
                if separated_audio || applications3_audio {
                    self.audio_encoder4.as_ptr()
                } else {
                    null_mut()
                },
                3,
            );
            libobs_sys::obs_output_set_mixers(
                self.output.as_ptr(),
                if separated_audio {
                    (AUDIO_MIX_FULL | AUDIO_MIX_GAME | AUDIO_MIX_SYSTEM | AUDIO_MIX_MIC) as usize
                } else if applications3_audio {
                    (AUDIO_MIX_FULL | AUDIO_MIX_GAME | AUDIO_MIX_SYSTEM | AUDIO_MIX_MIC) as usize
                } else {
                    AUDIO_MIX_FULL as usize
                },
            );
        }

        // audio source 1
        let audio_source1 = match audio_setting {
            AudioSource::APPLICATION | AudioSource::SEPARATED => {
                let mut data = ObsData::new();
                data.set_string("window", settings.window.get_libobs_window_id());
                unsafe { libobs_sys::obs_source_update(self.audio_source1.as_ptr(), data.as_ptr()) };
                unsafe {
                    libobs_sys::obs_source_set_audio_mixers(
                        self.audio_source1.as_ptr(),
                        if separated_audio {
                            AUDIO_MIX_GAME
                        } else {
                            AUDIO_MIX_FULL
                        },
                    )
                };

                self.audio_source1.as_ptr()
            }
            AudioSource::APPLICATIONS3 => match app1.as_deref().filter(|_| app1_enabled) {
                Some(process) => {
                    let mut data = ObsData::new();
                    data.set_string("window", format!("::{process}"));
                    unsafe { libobs_sys::obs_source_update(self.audio_source1.as_ptr(), data.as_ptr()) };
                    unsafe {
                        libobs_sys::obs_source_set_audio_mixers(
                            self.audio_source1.as_ptr(),
                            AUDIO_MIX_FULL | AUDIO_MIX_GAME,
                        )
                    };
                    unsafe {
                        libobs_sys::obs_source_set_volume(
                            self.audio_source1.as_ptr(),
                            f32::from(app1_volume_percent) / 100.0,
                        );
                    }
                    self.audio_source1.as_ptr()
                }
                None => null_mut(),
            },
            _ => null_mut(),
        };
        unsafe { libobs_sys::obs_set_output_source(AUDIO_CHANNEL1, audio_source1) };

        // audio source 2
        let audio_source2 = match audio_setting {
            AudioSource::SYSTEM | AudioSource::ALL | AudioSource::SEPARATED => {
                unsafe {
                    libobs_sys::obs_source_set_audio_mixers(
                        self.audio_source2.as_ptr(),
                        if separated_audio {
                            AUDIO_MIX_FULL | AUDIO_MIX_SYSTEM
                        } else {
                            AUDIO_MIX_FULL
                        },
                    )
                };
                self.audio_source2.as_ptr()
            }
            AudioSource::APPLICATIONS3 => match app2.as_deref().filter(|_| app2_enabled) {
                Some(process) => {
                    let mut data = ObsData::new();
                    data.set_string("window", format!("::{process}"));
                    unsafe { libobs_sys::obs_source_update(self.audio_source2.as_ptr(), data.as_ptr()) };
                    unsafe {
                        libobs_sys::obs_source_set_audio_mixers(
                            self.audio_source2.as_ptr(),
                            AUDIO_MIX_FULL | AUDIO_MIX_SYSTEM,
                        )
                    };
                    unsafe {
                        libobs_sys::obs_source_set_volume(
                            self.audio_source2.as_ptr(),
                            f32::from(app2_volume_percent) / 100.0,
                        );
                    }
                    self.audio_source2.as_ptr()
                }
                None => null_mut(),
            },
            _ => null_mut(),
        };
        unsafe { libobs_sys::obs_set_output_source(AUDIO_CHANNEL2, audio_source2) };

        // audio source 3
        let audio_source3 = match audio_setting {
            AudioSource::ALL | AudioSource::SEPARATED => {
                unsafe {
                    libobs_sys::obs_source_set_audio_mixers(
                        self.audio_source3.as_ptr(),
                        if separated_audio {
                            AUDIO_MIX_FULL | AUDIO_MIX_MIC
                        } else {
                            AUDIO_MIX_FULL
                        },
                    )
                };
                self.audio_source3.as_ptr()
            }
            AudioSource::APPLICATIONS3 => match app3.as_deref().filter(|_| app3_enabled) {
                Some(process) => {
                    let mut data = ObsData::new();
                    data.set_string("window", format!("::{process}"));
                    unsafe { libobs_sys::obs_source_update(self.audio_source3.as_ptr(), data.as_ptr()) };
                    unsafe {
                        libobs_sys::obs_source_set_audio_mixers(
                            self.audio_source3.as_ptr(),
                            AUDIO_MIX_FULL | AUDIO_MIX_MIC,
                        )
                    };
                    unsafe {
                        libobs_sys::obs_source_set_volume(
                            self.audio_source3.as_ptr(),
                            f32::from(app3_volume_percent) / 100.0,
                        );
                    }
                    self.audio_source3.as_ptr()
                }
                None => null_mut(),
            },
            _ => null_mut(),
        };
        unsafe { libobs_sys::obs_set_output_source(AUDIO_CHANNEL3, audio_source3) };

        // println!("configured");

        Ok(())
    }

    pub fn is_recording(&self) -> bool {
        unsafe { libobs_sys::obs_output_active(self.output.as_ptr()) }
    }

    pub fn capture_video_region(&mut self, x: f64, y: f64, width: f64, height: f64) -> Option<VideoRegionFrame> {
        if self
            .raw_video_frames
            .as_ref()
            .is_some_and(|frames| !frames.contains(x, y, width, height))
        {
            self.raw_video_frames = None;
        }
        if self.raw_video_frames.is_none() && self.is_recording() {
            let ovi = Self::get_video_info().ok()?;
            self.raw_video_frames = Some(RawVideoFrames::start(
                ovi.output_width,
                ovi.output_height,
                x,
                y,
                width,
                height,
            ));
        }
        self.raw_video_frames.as_ref()?.crop(x, y, width, height)
    }

    pub fn get_adapter_info(&self) -> Adapter {
        // public version of internal function that is only available after libobs is initialized
        // due to requiring &self
        Self::get_adapters_internal()
            .into_iter()
            .find(|e| e.id() == AdapterId::default())
            .expect("no adapters found?")
    }

    pub fn get_available_encoders(&self) -> Vec<Encoder> {
        // public version of internal function that is only available after libobs is initialized
        // due to requiring &self
        Self::get_available_encoders_internal()
    }

    // re-export function as only available through a reference to a Recorder
    pub fn selected_encoder(&self) -> Encoder {
        Self::get_current_encoder()
    }
}

impl Drop for InpRecorder {
    fn drop(&mut self) {
        unsafe {
            // output
            libobs_sys::obs_output_release(self.output.as_ptr());
            // video
            libobs_sys::obs_encoder_release(self.video_encoder.get().as_ptr());
            libobs_sys::obs_source_release(self.video_source.as_ptr());
            // audio
            libobs_sys::obs_encoder_release(self.audio_encoder1.as_ptr());
            libobs_sys::obs_encoder_release(self.audio_encoder2.as_ptr());
            libobs_sys::obs_encoder_release(self.audio_encoder3.as_ptr());
            libobs_sys::obs_encoder_release(self.audio_encoder4.as_ptr());
            libobs_sys::obs_source_release(self.audio_source1.as_ptr());
            libobs_sys::obs_source_release(self.audio_source2.as_ptr());
            libobs_sys::obs_source_release(self.audio_source3.as_ptr());

            // println!("drop bnum_allocs: {}", libobs_sys::bnum_allocs());
        }

        Self::decrement_refcount();
    }
}
