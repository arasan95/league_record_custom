#[cfg_attr(feature = "specta", derive(specta::Type))]
#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Debug, PartialEq)]
pub enum AudioSource {
    /// no audio
    NONE,
    /// only the audio of the window that is being captured
    APPLICATION,
    /// the default audio output of the pc
    SYSTEM,
    /// the default audio input and output of the pc
    ALL,
    /// full audio on track 1, application/game audio on track 2, system on track 3, mic on track 4
    SEPARATED,
    /// full audio on track 1, selected app 1 on track 2, selected app 2 on track 3, selected app 3 on track 4
    APPLICATIONS3,
}
