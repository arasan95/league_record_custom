import { BaseDirectory, mkdir, writeFile } from "@tauri-apps/plugin-fs";

const SLOW_ASYNC_MS = 250;
const SLOW_SYNC_MS = 80;
const EVENT_LOOP_LAG_MS = 180;
const EVENT_LOOP_SAMPLE_MS = 250;
const LOG_DIR = "freeze_probe";
const MAX_ENTRIES = 2000;
const FLUSH_DELAY_MS = 1000;

type FreezeProbeDetails = Record<string, unknown>;
type FreezeProbeEntry = {
    ts: string;
    sessionId: string;
    label: string;
    warn: boolean;
    details: FreezeProbeDetails;
};

const sessionId = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");
const entries: FreezeProbeEntry[] = [];
const counters = new Map<string, number>();
const slowestByLabel = new Map<string, FreezeProbeEntry>();
let flushTimer: number | null = null;
let flushInFlight = false;
let fsReady = false;
let fsFailed = false;

function perfNowMs(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
    }
    return Date.now();
}

function isDevRuntime(): boolean {
    const host = window.location.hostname;
    return window.location.protocol === "http:" && (host === "localhost" || host === "127.0.0.1" || host === "::1");
}

function hasManualFlag(): boolean {
    try {
        return window.localStorage.getItem("lrFreezeProbe") === "1";
    } catch {
        return false;
    }
}

export function isFreezeProbeEnabled(): boolean {
    return isDevRuntime() || hasManualFlag();
}

function summarizeEntry(entry: FreezeProbeEntry): number {
    const durationRaw = entry.details.durationMs ?? entry.details.lagMs;
    return typeof durationRaw === "number" ? durationRaw : 0;
}

function rememberEntry(entry: FreezeProbeEntry): void {
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
        entries.splice(0, entries.length - MAX_ENTRIES);
    }

    counters.set(entry.label, (counters.get(entry.label) || 0) + 1);
    const previous = slowestByLabel.get(entry.label);
    if (!previous || summarizeEntry(entry) > summarizeEntry(previous)) {
        slowestByLabel.set(entry.label, entry);
    }
}

function buildSummary() {
    const warningEntries = entries.filter((entry) => entry.warn);
    const recentWarnings = warningEntries.slice(-50);
    const topSlow = [...slowestByLabel.values()]
        .sort((a, b) => summarizeEntry(b) - summarizeEntry(a))
        .slice(0, 25);

    return {
        schemaVersion: 1,
        sessionId,
        generatedAt: new Date().toISOString(),
        entryCount: entries.length,
        warningCount: warningEntries.length,
        counters: Object.fromEntries([...counters.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
        topSlow,
        recentWarnings,
        files: {
            sessionJsonl: `${LOG_DIR}/session-${sessionId}.jsonl`,
            latestJsonl: `${LOG_DIR}/latest.jsonl`,
            latestSummary: `${LOG_DIR}/latest-summary.json`,
        },
    };
}

async function ensureLogDir(): Promise<void> {
    if (fsReady || fsFailed) return;
    try {
        await mkdir(LOG_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
        fsReady = true;
    } catch (error) {
        fsFailed = true;
        console.warn("[freeze-probe] failed to create log directory", error);
    }
}

async function flushFreezeProbeLogs(): Promise<void> {
    if (!isFreezeProbeEnabled() || fsFailed || flushInFlight) return;
    flushInFlight = true;
    try {
        await ensureLogDir();
        if (!fsReady) return;

        const jsonl = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
        const summary = JSON.stringify(buildSummary(), null, 2);
        const encoder = new TextEncoder();

        await Promise.all([
            writeFile(`${LOG_DIR}/session-${sessionId}.jsonl`, encoder.encode(jsonl), { baseDir: BaseDirectory.AppLocalData }),
            writeFile(`${LOG_DIR}/latest.jsonl`, encoder.encode(jsonl), { baseDir: BaseDirectory.AppLocalData }),
            writeFile(`${LOG_DIR}/latest-summary.json`, encoder.encode(summary), { baseDir: BaseDirectory.AppLocalData }),
        ]);
    } catch (error) {
        fsFailed = true;
        console.warn("[freeze-probe] failed to write logs", error);
    } finally {
        flushInFlight = false;
    }
}

function scheduleFlush(immediate: boolean = false): void {
    if (!isFreezeProbeEnabled() || fsFailed) return;
    if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
    }
    flushTimer = window.setTimeout(() => {
        flushTimer = null;
        void flushFreezeProbeLogs();
    }, immediate ? 0 : FLUSH_DELAY_MS);
}

export function freezeProbeLog(label: string, details: FreezeProbeDetails = {}, warn: boolean = false): void {
    if (!isFreezeProbeEnabled()) return;
    const payload = {
        t: Math.round(perfNowMs()),
        ...details,
    };
    rememberEntry({
        ts: new Date().toISOString(),
        sessionId,
        label,
        warn,
        details: payload,
    });
    scheduleFlush(warn);

    const line = `[freeze-probe] ${label}`;
    if (warn) {
        console.warn(line, payload);
    } else {
        console.info(line, payload);
    }
}

export async function measureFreezeProbe<T>(
    label: string,
    work: () => Promise<T>,
    details: FreezeProbeDetails = {},
    slowMs: number = SLOW_ASYNC_MS,
): Promise<T> {
    const startedAt = perfNowMs();
    try {
        return await work();
    } finally {
        const durationMs = perfNowMs() - startedAt;
        freezeProbeLog(
            label,
            {
                ...details,
                durationMs: Number(durationMs.toFixed(1)),
                slowMs,
            },
            durationMs >= slowMs,
        );
    }
}

export function measureFreezeProbeSync<T>(
    label: string,
    work: () => T,
    details: FreezeProbeDetails = {},
    slowMs: number = SLOW_SYNC_MS,
): T {
    const startedAt = perfNowMs();
    try {
        return work();
    } finally {
        const durationMs = perfNowMs() - startedAt;
        freezeProbeLog(
            label,
            {
                ...details,
                durationMs: Number(durationMs.toFixed(1)),
                slowMs,
            },
            durationMs >= slowMs,
        );
    }
}

export function installFreezeProbe(): void {
    if (!isFreezeProbeEnabled()) return;
    if ((window as any).__leagueRecordFreezeProbeInstalled) return;
    (window as any).__leagueRecordFreezeProbeInstalled = true;

    freezeProbeLog("installed", {
        href: window.location.href,
        userAgent: navigator.userAgent,
        sessionId,
        logDir: `${LOG_DIR}/`,
    });

    window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            scheduleFlush(true);
        }
    });
    window.addEventListener("beforeunload", () => {
        scheduleFlush(true);
    });

    if ("PerformanceObserver" in window) {
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    freezeProbeLog(
                        "longtask",
                        {
                            name: entry.name,
                            startTimeMs: Number(entry.startTime.toFixed(1)),
                            durationMs: Number(entry.duration.toFixed(1)),
                        },
                        true,
                    );
                }
            });
            observer.observe({ entryTypes: ["longtask"] });
        } catch (error) {
            freezeProbeLog("longtask-observer-unavailable", { error: String(error) });
        }
    }

    let expectedAt = perfNowMs() + EVENT_LOOP_SAMPLE_MS;
    window.setInterval(() => {
        const now = perfNowMs();
        const lagMs = now - expectedAt;
        if (lagMs >= EVENT_LOOP_LAG_MS) {
            freezeProbeLog(
                "event-loop-lag",
                {
                    lagMs: Number(lagMs.toFixed(1)),
                    thresholdMs: EVENT_LOOP_LAG_MS,
                },
                true,
            );
        }
        expectedAt = now + EVENT_LOOP_SAMPLE_MS;
    }, EVENT_LOOP_SAMPLE_MS);
}
