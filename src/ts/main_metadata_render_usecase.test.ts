import { expect, test } from "bun:test";
import { createMetadataController, LatestRequest, renderMetadataState } from "./main_metadata_render_usecase";
import { videoIdsMatch } from "./main_video_id_usecase";

test("a delayed metadata render cannot overwrite the newly selected recording", async () => {
    const selection = new LatestRequest();
    const markerStates: boolean[] = [];
    const scoreboards: string[] = [];
    let releaseOld!: () => void;
    const oldData = new Promise<void>(resolve => { releaseOld = resolve; });
    const old = renderMetadataState({
        data: { Deferred: {
            favorite: false,
            matchId: { platformId: "NA1", gameId: 1 },
            ingameTimeRecStartOffset: 15,
            events: [],
            highlights: [],
            tftRoundMarkers: [],
            participants: [{} as NonNullable<import("./bindings").Deferred["participants"]>[number]],
        } },
        requestedVideoId: "old",
        resolvedVideoId: "old",
        isCurrent: selection.begin(),
        ui: {
            showMarkerFlags: show => markerStates.push(show),
            setRecordingOffset() {},
            setTftMode() {},
            clearVideoMetadata() {},
            async setVideoDescriptionMetadata(_, isCurrent) {
                await oldData;
                if (isCurrent()) scoreboards.push("old");
            },
        },
    });

    await renderMetadataState({
        data: null,
        requestedVideoId: "new",
        resolvedVideoId: "new",
        isCurrent: selection.begin(),
        ui: {
            showMarkerFlags: show => markerStates.push(show),
            setRecordingOffset() {},
            setTftMode() {},
            clearVideoMetadata: () => { scoreboards.push("new"); },
            async setVideoDescriptionMetadata() {},
        },
    });
    releaseOld();
    await old;

    expect(scoreboards).toEqual(["new"]);
    expect(markerStates).toEqual([false]);
});

test("recordings and clips with the same basename are distinct selections", () => {
    expect(videoIdsMatch("C:/recordings/game", "C:/clips/game")).toBe(false);
    expect(videoIdsMatch("C:/recordings/game", "game.mp4")).toBe(true);
});

test("the metadata controller discards a previous recording's delayed lookup", async () => {
    let selected = "old";
    let releaseOld!: () => void;
    const pending = new Promise<void>(resolve => { releaseOld = resolve; });
    const rendered: string[] = [];
    const controller = createMetadataController({
        getActiveVideoId: () => selected,
        getMetadata: async (videoId) => {
            if (videoId === "old") await pending;
            return { NoData: { favorite: false } };
        },
        getVisibleRecordings: async () => [],
        onRender: () => { rendered.push(selected); },
        ui: {
            showMarkerFlags() {},
            setRecordingOffset() {},
            setTftMode() {},
            clearVideoMetadata() {},
            async setVideoDescriptionMetadata() {},
        },
    });

    const olderLoad = controller.load(selected);
    selected = "new";
    controller.selectionChanged();
    await controller.load(selected);
    releaseOld();
    await olderLoad;

    expect(rendered).toEqual(["new"]);
});
