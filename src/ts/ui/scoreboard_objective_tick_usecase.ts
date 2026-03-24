import type { GameEvent } from "../bindings";
import { getObjectiveConfig } from "../objectives";
import { applyObjectiveTimers, toGameClockLabel } from "./scoreboard_timer_usecase";

export function applyScoreboardObjectiveTick(params: {
    playerCurrentTimeSec: number;
    recordingOffset: number;
    currentQueueId: number;
    events: GameEvent[];
    headerTimeText: HTMLElement | null;
    baronTimerText: HTMLElement | null;
    baronTimerIcon: HTMLImageElement | null;
    baronTimerGroup2: HTMLElement | null;
    baronTimerText2: HTMLElement | null;
    baronTimerIcon2: HTMLImageElement | null;
    dragonTimerText: HTMLElement | null;
    dragonTimerIcon: HTMLImageElement | null;
    monoVoidgrub: string;
    monoHerald: string;
    monoBaron: string;
    monoDrake: string;
}): void {
    const {
        playerCurrentTimeSec,
        recordingOffset,
        currentQueueId,
        events,
        headerTimeText,
        baronTimerText,
        baronTimerIcon,
        baronTimerGroup2,
        baronTimerText2,
        baronTimerIcon2,
        dragonTimerText,
        dragonTimerIcon,
        monoVoidgrub,
        monoHerald,
        monoBaron,
        monoDrake,
    } = params;

    const gameTimeFloat = playerCurrentTimeSec + recordingOffset;
    const now = Math.floor(gameTimeFloat);

    if (headerTimeText) {
        headerTimeText.textContent = toGameClockLabel(now);
    }

    const config = getObjectiveConfig(currentQueueId);

    applyObjectiveTimers({
        events,
        nowSec: now,
        config,
        refs: {
            baronTimerText,
            baronTimerIcon,
            baronTimerGroup2,
            baronTimerText2,
            baronTimerIcon2,
            dragonTimerText,
            dragonTimerIcon,
        },
        icons: {
            voidgrub: monoVoidgrub,
            herald: monoHerald,
            baron: monoBaron,
            dragon: monoDrake,
        },
    });
}
