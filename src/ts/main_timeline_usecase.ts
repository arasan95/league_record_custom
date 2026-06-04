import type { GameEvent, TftRoundMarker } from "./bindings";

export type TimelineRow = { timestamp: number; text: string };

export function formatTimestampLabel(timestamp: number): string {
    let secs = timestamp / 1000;
    let minutes = Math.floor(secs / 60);
    secs -= minutes * 60;
    const hours = Math.floor(minutes / 60);
    minutes -= hours * 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${Math.floor(secs).toString().padStart(2, "0")}`;
}

export function buildTimelineRows(input: {
    currentEvents: { participantId: number; events: GameEvent[] } | null;
    highlightEvents: { events: number[] } | null;
    tftRoundEvents?: { events: TftRoundMarker[] } | null;
    markerEventName: (event: GameEvent, participantId: number, teamId: number | null) => string | null;
}): TimelineRow[] {
    const rows: TimelineRow[] = [];
    const { currentEvents, highlightEvents, tftRoundEvents, markerEventName } = input;

    if (highlightEvents !== null) {
        for (const event of highlightEvents.events) {
            rows.push({ timestamp: event, text: `${formatTimestampLabel(event)} Highlight` });
        }
    }

    if (currentEvents !== null) {
        for (const event of currentEvents.events) {
            const name = markerEventName(event, currentEvents.participantId, null);
            if (name !== null) {
                rows.push({ timestamp: event.timestamp, text: `${formatTimestampLabel(event.timestamp)} ${name}` });
            }
        }
    }

    if (tftRoundEvents !== null && tftRoundEvents !== undefined) {
        for (const event of tftRoundEvents.events) {
            rows.push({ timestamp: event.timestamp, text: `${formatTimestampLabel(event.timestamp)} TFT ${event.round}` });
        }
    }

    return rows.toSorted((a, b) => a.timestamp - b.timestamp);
}
