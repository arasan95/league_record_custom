import type { Settings } from "../bindings";

type MarkerSwitchInputs = {
    kill: boolean;
    death: boolean;
    assist: boolean;
    structure: boolean;
    dragon: boolean;
    voidgrub: boolean;
    herald: boolean;
    baron: boolean;
};

type GameModeInputs = {
    ranked: { checked: boolean; modeId: string };
    normal: { checked: boolean; modeId: string };
    aram: { checked: boolean; modeId: string };
    arena: { checked: boolean; modeId: string };
    urf: { checked: boolean; modeId: string };
    practice: { checked: boolean; modeId: string };
    custom: { checked: boolean; modeId: string };
    coop: { checked: boolean; modeId: string };
    tft: { checked: boolean; modeId: string };
    swiftplay: { checked: boolean; modeId: string };
    other: { checked: boolean; modeId: string };
};

type OtherSwitchInputs = {
    autostart: boolean;
    autoplayVideo: boolean;
    autoStopPlayback: boolean;
    autoSelectRecording: boolean;
    confirmDelete: boolean;
    developerMode: boolean;
    playRecordingSounds: boolean;
    keepVideoJsonOnAutoDelete: boolean;
    autoDeleteClips: boolean;
};

export type BuildSettingsPayloadInput = {
    base: Settings;
    language: string;
    recordingsFolder: string;
    clipsFolder: string;
    filenameFormat: string;
    matchHistoryBaseUrl: string;
    matchHistorySubUrl: string;
    championWikiBaseUrl: string;
    championWikiSubUrl: string;
    championMatchupUrl: string;
    championMatchupSubUrl: string;
    championBuildUrl: string;
    championBuildSubUrl: string;
    encodingQuality: string;
    outputResolution: string;
    framerate: string;
    recordAudio: string;
    applicationAudioTracks: Array<{
        application: string | null;
        enabled: boolean;
        volumePercent: number;
    }>;
    maxRecordingAgeDays: string;
    maxRecordingsSizeGb: string;
    highlightHotkeyValue: string | null;
    startRecHotkeyValue: string | null;
    stopRecHotkeyValue: string | null;
    markerSwitches: MarkerSwitchInputs;
    gameModeSwitches: GameModeInputs;
    otherSwitches: OtherSwitchInputs;
};

export function buildSettingsPayload(input: BuildSettingsPayloadInput): Settings {
    const gameModes: string[] = [];
    const modeOrder = [
        input.gameModeSwitches.ranked,
        input.gameModeSwitches.normal,
        input.gameModeSwitches.aram,
        input.gameModeSwitches.arena,
        input.gameModeSwitches.urf,
        input.gameModeSwitches.practice,
        input.gameModeSwitches.custom,
        input.gameModeSwitches.coop,
        input.gameModeSwitches.tft,
        input.gameModeSwitches.swiftplay,
        input.gameModeSwitches.other,
    ];
    for (const m of modeOrder) {
        if (m.checked) gameModes.push(m.modeId);
    }

    const [framerateN, framerateD] = input.framerate.split("/");

    return {
        ...input.base,
        language: input.language as any,
        recordingsFolder: input.recordingsFolder,
        clipsFolder: input.clipsFolder,
        filenameFormat: input.filenameFormat,
        matchHistoryBaseUrl: input.matchHistoryBaseUrl.trim() || null,
        matchHistorySubUrl: input.matchHistorySubUrl.trim() || null,
        championWikiBaseUrl: input.championWikiBaseUrl.trim() || null,
        championWikiSubUrl: input.championWikiSubUrl.trim() || null,
        championMatchupUrl: input.championMatchupUrl.trim() || null,
        championMatchupSubUrl: input.championMatchupSubUrl.trim() || null,
        championBuildUrl: input.championBuildUrl.trim() || null,
        championBuildSubUrl: input.championBuildSubUrl.trim() || null,
        encodingQuality: parseInt(input.encodingQuality, 10),
        outputResolution: (input.outputResolution || null) as any,
        framerate: [parseInt(framerateN, 10), parseInt(framerateD, 10)],
        recordAudio: input.recordAudio as any,
        applicationAudioTracks: input.applicationAudioTracks.slice(0, 3).map((track) => ({
            application: (track.application || "").trim() || null,
            enabled: !!track.enabled,
            volumePercent: Math.max(0, Math.min(100, Math.round(track.volumePercent))),
        })),
        maxRecordingAgeDays: input.maxRecordingAgeDays === "" ? null : parseInt(input.maxRecordingAgeDays, 10),
        maxRecordingsSizeGb: input.maxRecordingsSizeGb === "" ? null : parseInt(input.maxRecordingsSizeGb, 10),
        hightlightHotkey: input.highlightHotkeyValue,
        startRecordingHotkey: input.startRecHotkeyValue,
        stopRecordingHotkey: input.stopRecHotkeyValue,
        markerFlags: {
            kill: input.markerSwitches.kill,
            death: input.markerSwitches.death,
            assist: input.markerSwitches.assist,
            structure: input.markerSwitches.structure,
            dragon: input.markerSwitches.dragon,
            voidgrub: input.markerSwitches.voidgrub,
            herald: input.markerSwitches.herald,
            baron: input.markerSwitches.baron,
        },
        gameModes,
        autostart: input.otherSwitches.autostart,
        autoplayVideo: input.otherSwitches.autoplayVideo,
        autoStopPlayback: input.otherSwitches.autoStopPlayback,
        autoSelectRecording: input.otherSwitches.autoSelectRecording,
        confirmDelete: input.otherSwitches.confirmDelete,
        developerMode: input.otherSwitches.developerMode,
        playRecordingSounds: input.otherSwitches.playRecordingSounds,
        keepVideoJsonOnAutoDelete: input.otherSwitches.keepVideoJsonOnAutoDelete,
        autoDeleteClips: input.otherSwitches.autoDeleteClips,
    };
}
