import {
    connectReplayShareGoogle,
    createCommunityCommentInvite,
    deleteCommunityComment,
    getCommunityCommentContext,
    postCommunityComment,
    redeemCommunityCommentInvite,
    saveCommunityCommentSettings,
    subscribeCommunityComments,
    updateCommunityComment,
} from "./platform/firebase";
import { getYouTubeFirebaseIdToken, signInToYouTube, YOUTUBE_AUTH_CHANGED_EVENT } from "./platform/youtube";
import type { CommunityCommentContext, CommunityCommentRecord } from "./community_comments";
import { UI_LANGUAGE_CHANGED_EVENT, uiText } from "./ui_locale";

export type ReviewRating = "good" | "bad" | "question";
export type ReviewCommentSize = "small" | "medium" | "large";
export type ReviewCommentMode = "scroll" | "fixed";

export interface ReviewComment {
    id: string;
    videoId: string;
    text: string;
    timestamp: number;
    rating: ReviewRating | null;
    color: string;
    size: ReviewCommentSize;
    duration: number;
    mode: ReviewCommentMode;
    x?: number;
    y?: number;
    createdAt: number;
    source?: "local" | "community";
    authorUid?: string;
    authorName?: string;
    authorPublicId?: string;
    authorGroupIds?: string[];
    visibility?: "public" | "private";
}

type ReviewCommentDatabase = Record<string, ReviewComment[]>;
type CommentFilter = "all" | ReviewRating;

interface ReviewPlayer {
    currentTime(): number | undefined;
    currentTime(seconds: number): void;
    el(): Element;
    on(event: string, callback: () => void): void;
}

const STORAGE_KEY = "lr.reviewComments.v1";
const FLOW_ENABLED_STORAGE_KEY = "lr.reviewComments.flowEnabled.v1";
const COMMENTS_VISIBLE_STORAGE_KEY = "lr.reviewComments.visible.v1";
const SIDEBAR_WIDTH_STORAGE_KEY = "lr.reviewComments.sidebarWidth.v1";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "lr.reviewComments.sidebarCollapsed.v1";
const MAX_COMMENTS_PER_VIDEO = 1000;
const SIZE_VALUES = new Set<ReviewCommentSize>(["small", "medium", "large"]);

export function formatReviewTimestamp(totalSeconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;
    return hours > 0
        ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
        : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function isRating(value: unknown): value is ReviewRating {
    return value === "good" || value === "bad" || value === "question";
}

function normalizeComment(value: unknown, videoId: string): ReviewComment | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as Partial<ReviewComment>;
    if (typeof raw.id !== "string" || typeof raw.text !== "string" || !raw.text.trim()) return null;
    if (typeof raw.timestamp !== "number" || !Number.isFinite(raw.timestamp)) return null;
    const size = SIZE_VALUES.has(raw.size as ReviewCommentSize) ? raw.size as ReviewCommentSize : "medium";
    const duration = typeof raw.duration === "number" && Number.isFinite(raw.duration)
        ? Math.min(30, Math.max(1, raw.duration))
        : 5;
    const mode: ReviewCommentMode = raw.mode === "fixed" ? "fixed" : "scroll";
    return {
        id: raw.id,
        videoId,
        text: raw.text.slice(0, 280),
        timestamp: Math.max(0, raw.timestamp),
        rating: isRating(raw.rating) ? raw.rating : null,
        color: typeof raw.color === "string" && /^#[0-9a-f]{6}$/iu.test(raw.color) ? raw.color : "#ffffff",
        size,
        duration,
        mode,
        x: typeof raw.x === "number" ? Math.min(95, Math.max(5, raw.x)) : undefined,
        y: typeof raw.y === "number" ? Math.min(92, Math.max(5, raw.y)) : undefined,
        createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
        source: "local",
    };
}

function readDatabase(storage: Storage): ReviewCommentDatabase {
    try {
        const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const database: ReviewCommentDatabase = {};
        for (const [videoId, values] of Object.entries(parsed as Record<string, unknown>)) {
            if (!Array.isArray(values)) continue;
            database[videoId] = values
                .map((value) => normalizeComment(value, videoId))
                .filter((value): value is ReviewComment => value !== null)
                .slice(-MAX_COMMENTS_PER_VIDEO);
        }
        return database;
    } catch (error) {
        console.warn("[review-comments] 保存データを読み込めませんでした", error);
        return {};
    }
}

function createCommentId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return `comment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function allowReviewCommentDrop(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes("application/x-lr-review-comment")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
}

export class ReviewCommentsController {
    private readonly player: ReviewPlayer;
    private readonly storage: Storage;
    private readonly overlay: HTMLDivElement;
    private readonly list: HTMLOListElement;
    private readonly empty: HTMLDivElement;
    private readonly input: HTMLTextAreaElement;
    private readonly submit: HTMLButtonElement;
    private readonly count: HTMLElement;
    private readonly database: ReviewCommentDatabase;
    private activeVideoId: string | null = null;
    private filter: CommentFilter = "all";
    private rating: ReviewRating | null = "good";
    private flowEnabled = true;
    private commentsVisible = true;
    private readonly laneAssignments = new Map<string, number>();
    private sidebarCollapsed = false;
    private lastExpandedSidebarWidth = 330;
    private animationFrame = 0;
    private communityContext: CommunityCommentContext | null = null;
    private communityComments: ReviewComment[] = [];
    private communityUnsubscribe: (() => void) | null = null;
    private communityGroupFilter = "all";
    private communityLoadSerial = 0;
    private pendingScrollCommentId: string | null = null;

    constructor(player: ReviewPlayer, storage: Storage = window.localStorage) {
        this.player = player;
        this.storage = storage;
        this.database = readDatabase(storage);
        this.list = document.querySelector<HTMLOListElement>("#review-comment-list")!;
        this.empty = document.querySelector<HTMLDivElement>("#review-comment-empty")!;
        this.input = document.querySelector<HTMLTextAreaElement>("#review-comment-input")!;
        this.submit = document.querySelector<HTMLButtonElement>("#review-comment-submit")!;
        this.count = document.querySelector<HTMLElement>("#review-comment-count")!;
        this.overlay = document.createElement("div");
        this.overlay.className = "lr-comment-overlay";
        this.overlay.setAttribute("aria-hidden", "true");
        this.player.el().append(this.overlay);
        this.restoreDisplayPreference();
        this.restoreSidebarWidth();
        this.bindControls();
        this.bindCommunityControls();
        this.bindDropPlacement();
        this.bindSidebarResize();
        this.bindSidebarCollapseToggle();
        window.addEventListener(YOUTUBE_AUTH_CHANGED_EVENT, () => {
            if (this.activeVideoId?.startsWith("youtube:")) void this.reloadCommunityVideo();
        });
        window.addEventListener(UI_LANGUAGE_CHANGED_EVENT, () => {
            this.updateVisibilityButton();
            this.updateSidebarCollapseState();
            this.refreshCommunityGroupFilter();
            this.renderSidebar();
        });
        this.player.on("timeupdate", () => this.renderOverlay());
        this.player.on("seeked", () => this.renderOverlay());
        this.player.on("loadedmetadata", () => this.renderOverlay());
        new ResizeObserver(() => this.renderOverlay()).observe(this.player.el());
        this.renderSidebar();
        this.startAnimationLoop();
    }

    public setActiveVideo(videoId: string | null): void {
        this.communityLoadSerial++;
        this.communityUnsubscribe?.();
        this.communityUnsubscribe = null;
        this.communityContext = null;
        this.communityComments = [];
        this.activeVideoId = videoId;
        this.input.disabled = videoId === null;
        this.submit.disabled = videoId === null;
        this.overlay.replaceChildren();
        this.rebuildLaneAssignments();
        this.renderSidebar();
        this.renderOverlay();
        void this.activateCommunityVideo(videoId, this.communityLoadSerial);
    }

    private get comments(): ReviewComment[] {
        if (!this.activeVideoId) return [];
        return [...(this.database[this.activeVideoId] ?? []), ...this.communityComments];
    }

    private save(): void {
        try {
            this.storage.setItem(STORAGE_KEY, JSON.stringify(this.database));
        } catch (error) {
            console.error("[review-comments] コメントを保存できませんでした", error);
        }
    }

    private bindControls(): void {
        const form = document.querySelector<HTMLFormElement>("#review-comment-form")!;
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            void this.addComment();
        });
        this.input.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                void this.addComment();
            }
        });

        document.querySelectorAll<HTMLButtonElement>("[data-comment-filter]").forEach((button) => {
            button.addEventListener("click", () => {
                this.filter = (button.dataset.commentFilter ?? "all") as CommentFilter;
                document.querySelectorAll("[data-comment-filter]").forEach((item) => item.classList.toggle("active", item === button));
                this.renderSidebar();
            });
        });
        document.querySelectorAll<HTMLButtonElement>("[data-comment-rating]").forEach((button) => {
            button.addEventListener("click", () => {
                const selectedRating = button.dataset.commentRating as ReviewRating;
                this.rating = this.rating === selectedRating ? null : selectedRating;
                document.querySelectorAll<HTMLButtonElement>("[data-comment-rating]").forEach((item) => {
                    item.classList.toggle("active", item.dataset.commentRating === this.rating);
                });
            });
        });

        const flowToggle = document.querySelector<HTMLInputElement>("#review-comments-flow-enabled")!;
        flowToggle.checked = this.flowEnabled;
        flowToggle.addEventListener("change", () => {
            this.flowEnabled = flowToggle.checked;
            this.storage.setItem(FLOW_ENABLED_STORAGE_KEY, String(this.flowEnabled));
            this.renderOverlay();
        });
        const visibilityButton = document.querySelector<HTMLButtonElement>("#review-comments-visibility")!;
        visibilityButton.addEventListener("click", () => {
            this.commentsVisible = !this.commentsVisible;
            this.storage.setItem(COMMENTS_VISIBLE_STORAGE_KEY, String(this.commentsVisible));
            this.updateVisibilityButton();
            this.renderOverlay();
        });
        this.updateVisibilityButton();
    }

    private restoreDisplayPreference(): void {
        this.flowEnabled = this.storage.getItem(FLOW_ENABLED_STORAGE_KEY) !== "false";
        this.commentsVisible = this.storage.getItem(COMMENTS_VISIBLE_STORAGE_KEY) !== "false";
    }

    private bindCommunityControls(): void {
        document.querySelector<HTMLSelectElement>("#community-group-filter")!.addEventListener("change", (event) => {
            this.communityGroupFilter = (event.target as HTMLSelectElement).value;
            this.renderSidebar();
            this.renderOverlay();
        });
        document.querySelector<HTMLButtonElement>("#community-comments-signin")!.addEventListener("click", async () => {
            await this.runCommunityAction(async () => {
                const signedIn = await signInToYouTube();
                await connectReplayShareGoogle(signedIn.firebaseIdToken || await getYouTubeFirebaseIdToken());
                await this.reloadCommunityVideo();
            });
        });
        document.querySelector<HTMLButtonElement>("#community-settings-save")!.addEventListener("click", async () => {
            const videoId = this.communityContext?.videoId;
            if (!videoId) return;
            await this.runCommunityAction(async () => {
                await saveCommunityCommentSettings(videoId, {
                    writeAccess: document.querySelector<HTMLSelectElement>("#community-write-access")!.value as "public" | "invite_only",
                    readAccess: document.querySelector<HTMLSelectElement>("#community-read-access")!.value as "public" | "invite_only",
                });
                await this.reloadCommunityVideo();
            });
        });
        document.querySelector<HTMLButtonElement>("#community-invite-create")!.addEventListener("click", async () => {
            const videoId = this.communityContext?.videoId;
            if (!videoId) return;
            await this.runCommunityAction(async () => {
                const output = document.querySelector<HTMLInputElement>("#community-invite-output")!;
                output.value = await createCommunityCommentInvite(videoId);
                output.hidden = false;
                output.select();
            });
        });
        document.querySelector<HTMLButtonElement>("#community-invite-redeem")!.addEventListener("click", async () => {
            const videoId = this.communityContext?.videoId;
            const input = document.querySelector<HTMLInputElement>("#community-invite-code")!;
            if (!videoId || !input.value.trim()) return;
            await this.runCommunityAction(async () => {
                await redeemCommunityCommentInvite(videoId, input.value.trim());
                input.value = "";
                await this.reloadCommunityVideo();
            });
        });
    }

    private async runCommunityAction(action: () => Promise<void>): Promise<void> {
        const status = document.querySelector<HTMLElement>("#community-comments-status")!;
        try {
            status.textContent = uiText("処理中…", "Working…");
            await action();
        } catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error);
        }
    }

    private async reloadCommunityVideo(): Promise<void> {
        const videoId = this.activeVideoId;
        const serial = ++this.communityLoadSerial;
        this.communityUnsubscribe?.();
        this.communityUnsubscribe = null;
        await this.activateCommunityVideo(videoId, serial);
    }

    private async activateCommunityVideo(activeVideoId: string | null, serial: number): Promise<void> {
        const panel = document.querySelector<HTMLElement>("#community-comments-panel")!;
        const privateLabel = document.querySelector<HTMLElement>("#review-comment-private-label")!;
        if (!activeVideoId?.startsWith("youtube:")) {
            panel.hidden = true;
            privateLabel.hidden = true;
            return;
        }
        panel.hidden = false;
        privateLabel.hidden = false;
        const videoId = activeVideoId.slice("youtube:".length);
        const status = document.querySelector<HTMLElement>("#community-comments-status")!;
        status.textContent = uiText("権限を確認中…", "Checking permissions…");
        try {
            try {
                // Keep Firebase identity aligned with the account currently
                // connected to the desktop YouTube session.
                await connectReplayShareGoogle(await getYouTubeFirebaseIdToken());
            } catch (error) {
                console.info("[review-comments] YouTube account is not available for ownership sync", error);
            }
            const context = await getCommunityCommentContext(videoId);
            if (serial !== this.communityLoadSerial || this.activeVideoId !== activeVideoId) return;
            this.communityContext = context;
            this.input.disabled = !context.canWrite;
            this.submit.disabled = !context.canWrite;
            document.querySelector<HTMLButtonElement>("#community-comments-signin")!.hidden = context.currentUid !== null;
            const ownerControls = document.querySelector<HTMLElement>("#community-comments-owner-controls")!;
            ownerControls.hidden = !context.isOwner;
            document.querySelector<HTMLSelectElement>("#community-write-access")!.value = context.settings.writeAccess;
            document.querySelector<HTMLSelectElement>("#community-read-access")!.value = context.settings.readAccess;
            if (context.canRead && context.canWrite) {
                status.textContent = context.isOwner
                    ? uiText("所有者", "Owner")
                    : context.isMember ? uiText("招待メンバー", "Invited member") : uiText("投稿可能", "Can post");
            } else if (context.canRead) {
                status.textContent = uiText("閲覧のみ", "View only");
            } else {
                status.textContent = uiText("招待が必要です", "Invitation required");
            }
            this.communityUnsubscribe = await subscribeCommunityComments(context, (records) => {
                if (serial !== this.communityLoadSerial) return;
                this.communityComments = records.map((record) => this.toReviewComment(record, activeVideoId));
                this.refreshCommunityGroupFilter();
                this.rebuildLaneAssignments();
                this.renderSidebar();
                this.renderOverlay();
                this.scrollPendingCommentToTop();
            }, (error) => { status.textContent = error.message; });
        } catch (error) {
            if (serial !== this.communityLoadSerial) return;
            this.input.disabled = true;
            this.submit.disabled = true;
            status.textContent = error instanceof Error ? error.message : String(error);
        }
    }

    private toReviewComment(record: CommunityCommentRecord, activeVideoId: string): ReviewComment {
        return {
            id: `community:${record.id}`,
            videoId: activeVideoId,
            text: record.text,
            timestamp: record.videoTimeMs / 1000,
            rating: record.rating,
            color: record.color,
            size: record.size,
            duration: record.durationMs / 1000,
            mode: record.mode,
            x: record.x === null ? undefined : record.x / 100,
            y: record.y === null ? undefined : record.y / 100,
            createdAt: record.createdAtMs,
            source: "community",
            authorUid: record.authorUid,
            authorName: record.authorName,
            authorPublicId: record.authorPublicId ?? undefined,
            authorGroupIds: record.authorGroupIds,
            visibility: record.visibility,
        };
    }

    private refreshCommunityGroupFilter(): void {
        const select = document.querySelector<HTMLSelectElement>("#community-group-filter")!;
        const groups = [...new Set(this.communityComments.flatMap((comment) => comment.authorGroupIds ?? []))].toSorted();
        const previous = this.communityGroupFilter;
        select.replaceChildren(
            new Option(uiText("すべて", "All"), "all"),
            new Option(uiText("招待ユーザーのみ", "Invited users only"), "invited"),
            ...groups.map((group) => new Option(`${uiText("コード", "Code")} ${group.slice(0, 6)}`, group)),
        );
        select.value = Array.from(select.options).some((option) => option.value === previous) ? previous : "all";
        this.communityGroupFilter = select.value;
    }

    private updateVisibilityButton(): void {
        const button = document.querySelector<HTMLButtonElement>("#review-comments-visibility")!;
        button.classList.toggle("active", !this.commentsVisible);
        button.setAttribute("aria-pressed", String(!this.commentsVisible));
        button.textContent = this.commentsVisible
            ? uiText("◉ コメント非表示", "◉ Hide Comments")
            : uiText("◉ コメント表示", "◉ Show Comments");
    }

    private restoreSidebarWidth(): void {
        const savedWidth = Number(this.storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
        if (Number.isFinite(savedWidth) && savedWidth >= 220 && savedWidth <= 560) {
            this.lastExpandedSidebarWidth = savedWidth;
            document.documentElement.style.setProperty("--review-sidebar-width", `${savedWidth}px`);
        }
        this.sidebarCollapsed = this.storage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
    }

    private bindSidebarResize(): void {
        const handle = document.querySelector<HTMLElement>("#review-comments-resizer")!;
        const container = document.querySelector<HTMLElement>("#container")!;
        const resize = (clientX: number): boolean => {
            const leftSidebarWidth = Number.parseFloat(getComputedStyle(container).getPropertyValue("--sidebar-width")) || 325;
            const maximum = Math.max(220, Math.min(560, window.innerWidth - 72 - leftSidebarWidth - 320));
            const requestedWidth = window.innerWidth - clientX;
            if (requestedWidth < 175) {
                this.setSidebarCollapsed(true);
                return true;
            }
            const width = Math.round(Math.min(maximum, Math.max(220, requestedWidth)));
            this.lastExpandedSidebarWidth = width;
            document.documentElement.style.setProperty("--review-sidebar-width", `${width}px`);
            this.storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
            return false;
        };
        handle.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            handle.classList.add("dragging");
            handle.setPointerCapture(event.pointerId);
        });
        handle.addEventListener("pointermove", (event) => {
            if (!handle.hasPointerCapture(event.pointerId)) return;
            if (resize(event.clientX)) {
                handle.releasePointerCapture(event.pointerId);
                handle.classList.remove("dragging");
            }
        });
        const finish = (event: PointerEvent) => {
            if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
            handle.classList.remove("dragging");
        };
        handle.addEventListener("pointerup", finish);
        handle.addEventListener("pointercancel", finish);
        handle.addEventListener("keydown", (event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const current = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--review-sidebar-width")) || 330;
            const next = event.key === "ArrowLeft" ? current + 10 : current - 10;
            resize(window.innerWidth - next);
        });
    }

    private bindSidebarCollapseToggle(): void {
        const button = document.querySelector<HTMLButtonElement>("#review-comments-collapse-toggle")!;
        button.addEventListener("click", () => this.setSidebarCollapsed(!this.sidebarCollapsed));
        this.updateSidebarCollapseState();
    }

    private setSidebarCollapsed(collapsed: boolean): void {
        this.sidebarCollapsed = collapsed;
        if (!collapsed) {
            document.documentElement.style.setProperty("--review-sidebar-width", `${this.lastExpandedSidebarWidth}px`);
        }
        this.storage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
        this.updateSidebarCollapseState();
    }

    private updateSidebarCollapseState(): void {
        const container = document.querySelector<HTMLElement>("#container")!;
        const button = document.querySelector<HTMLButtonElement>("#review-comments-collapse-toggle")!;
        container.classList.toggle("review-comments-collapsed", this.sidebarCollapsed);
        button.textContent = this.sidebarCollapsed ? "‹" : "›";
        button.title = this.sidebarCollapsed
            ? uiText("コメント欄を展開", "Expand comments")
            : uiText("コメント欄を格納", "Collapse comments");
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-expanded", String(!this.sidebarCollapsed));
        requestAnimationFrame(() => this.renderOverlay());
    }

    private bindDropPlacement(): void {
        const playerElement = this.player.el() as HTMLElement;
        playerElement.addEventListener("dragenter", allowReviewCommentDrop, true);
        playerElement.addEventListener("dragover", allowReviewCommentDrop, true);
        playerElement.addEventListener("drop", (event) => {
            event.preventDefault();
            const id = event.dataTransfer?.getData("application/x-lr-review-comment");
            const comment = this.comments.find((item) => item.id === id);
            if (!comment) return;
            const rect = this.overlay.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            comment.mode = "fixed";
            comment.timestamp = Math.max(0, this.player.currentTime() ?? 0);
            comment.x = Math.min(95, Math.max(5, ((event.clientX - rect.left) / rect.width) * 100));
            comment.y = Math.min(92, Math.max(5, ((event.clientY - rect.top) / rect.height) * 100));
            if (comment.source === "community") {
                void this.persistCommunityComment(comment);
            }
            this.save();
            this.rebuildLaneAssignments();
            this.renderSidebar();
            this.renderOverlay();
        }, true);
    }

    private async addComment(): Promise<void> {
        const text = this.input.value.trim();
        if (!this.activeVideoId || !text) return;
        const color = document.querySelector<HTMLInputElement>("#review-comment-color")!.value;
        const size = document.querySelector<HTMLSelectElement>("#review-comment-size")!.value as ReviewCommentSize;
        const duration = Number(document.querySelector<HTMLSelectElement>("#review-comment-duration")!.value);
        const comment: ReviewComment = {
            id: createCommentId(),
            videoId: this.activeVideoId,
            text: text.slice(0, 280),
            timestamp: Math.max(0, this.player.currentTime() ?? 0),
            rating: this.rating,
            color,
            size,
            duration,
            mode: "scroll",
            createdAt: Date.now(),
            source: "local",
        };
        if (this.communityContext && this.activeVideoId.startsWith("youtube:")) {
            const status = document.querySelector<HTMLElement>("#community-comments-status")!;
            if (!this.communityContext.canWrite) {
                status.textContent = uiText("コメントを投稿する権限がありません。", "You do not have permission to post comments.");
                return;
            }
            this.submit.disabled = true;
            this.pendingScrollCommentId = `community:${comment.id}`;
            try {
                const visibility = document.querySelector<HTMLInputElement>("#review-comment-private")!.checked ? "private" : "public";
                await postCommunityComment(this.communityContext.videoId, {
                    text: comment.text,
                    videoTimeMs: Math.round(comment.timestamp * 1000),
                    rating: comment.rating,
                    color: comment.color,
                    size: comment.size,
                    durationMs: Math.round(comment.duration * 1000),
                    mode: comment.mode,
                    x: null,
                    y: null,
                    visibility,
                    clientRequestId: comment.id,
                });
                this.input.value = "";
                status.textContent = visibility === "private"
                    ? uiText("非公開コメントを投稿しました", "Private comment posted")
                    : uiText("コメントを投稿しました", "Comment posted");
            } catch (error) {
                this.pendingScrollCommentId = null;
                status.textContent = error instanceof Error ? error.message : String(error);
            } finally {
                this.submit.disabled = !this.communityContext?.canWrite;
            }
            return;
        }
        const comments = this.database[this.activeVideoId] ?? [];
        comments.push(comment);
        this.database[this.activeVideoId] = comments.slice(-MAX_COMMENTS_PER_VIDEO);
        this.rebuildLaneAssignments();
        this.input.value = "";
        this.save();
        this.pendingScrollCommentId = comment.id;
        this.renderSidebar();
        this.renderOverlay();
        this.scrollPendingCommentToTop();
    }

    private updateRating(comment: ReviewComment, rating: ReviewRating): void {
        comment.rating = comment.rating === rating ? null : rating;
        if (comment.source === "community") {
            void this.persistCommunityComment(comment);
            return;
        }
        this.save();
        this.renderSidebar();
        this.renderOverlay();
    }

    private deleteComment(comment: ReviewComment): void {
        if (!this.activeVideoId) return;
        if (comment.source === "community" && this.communityContext) {
            const commentId = comment.id.replace(/^community:/u, "");
            void this.runCommunityAction(async () => {
                await deleteCommunityComment(this.communityContext!.videoId, commentId);
            });
            return;
        }
        this.database[this.activeVideoId] = (this.database[this.activeVideoId] ?? []).filter((item) => item.id !== comment.id);
        this.rebuildLaneAssignments();
        this.save();
        this.renderSidebar();
        this.renderOverlay();
    }

    private releaseFixedPosition(comment: ReviewComment): void {
        comment.mode = "scroll";
        delete comment.x;
        delete comment.y;
        if (comment.source === "community") {
            void this.persistCommunityComment(comment);
            return;
        }
        this.rebuildLaneAssignments();
        this.save();
        this.renderSidebar();
        this.renderOverlay();
    }

    private renderSidebar(): void {
        this.list.style.setProperty("--review-comment-scroll-tail", "0px");
        const comments = this.comments.toSorted((a, b) => a.timestamp - b.timestamp || a.createdAt - b.createdAt);
        const ratingFiltered = this.filter === "all" ? comments : comments.filter((comment) => comment.rating === this.filter);
        const visible = ratingFiltered.filter((comment) => this.matchesCommunityGroupFilter(comment));
        this.count.textContent = this.filter === "all" ? String(comments.length) : `${visible.length}/${comments.length}`;
        this.list.replaceChildren(...visible.map((comment) => this.createListItem(comment)));
        this.list.hidden = visible.length === 0;
        this.empty.hidden = visible.length > 0;
        if (!this.activeVideoId) {
            this.empty.textContent = uiText("動画を選ぶと、その動画のコメントが表示されます。", "Select a video to show its comments.");
        } else if (comments.length === 0) {
            this.empty.textContent = uiText(
                "まだコメントはありません。\n気になった場面でコメントを残しましょう。",
                "No comments yet.\nLeave a comment at a moment you want to review.",
            );
        } else {
            this.empty.textContent = uiText("この条件に一致するコメントはありません。", "No comments match these filters.");
        }
    }

    private scrollPendingCommentToTop(): void {
        const commentId = this.pendingScrollCommentId;
        if (!commentId) return;
        requestAnimationFrame(() => {
            const item = Array.from(this.list.querySelectorAll<HTMLLIElement>(".review-comment-item"))
                .find((candidate) => candidate.dataset.commentId === commentId);
            if (!item) {
                this.pendingScrollCommentId = null;
                return;
            }
            const desiredScrollTop = this.list.scrollTop
                + item.getBoundingClientRect().top
                - this.list.getBoundingClientRect().top;
            const currentMaxScroll = this.list.scrollHeight - this.list.clientHeight;
            const requiredTail = Math.max(0, desiredScrollTop - currentMaxScroll);
            this.list.style.setProperty("--review-comment-scroll-tail", `${requiredTail}px`);
            this.list.scrollTop = desiredScrollTop;
            this.pendingScrollCommentId = null;
        });
    }

    private createListItem(comment: ReviewComment): HTMLLIElement {
        const item = document.createElement("li");
        const ratingClass = comment.rating ? `is-${comment.rating}` : "is-unrated";
        item.className = `review-comment-item ${ratingClass}`;
        item.dataset.commentId = comment.id;
        const ownsCommunityComment = comment.source === "community"
            && ((comment.authorPublicId && comment.authorPublicId === this.communityContext?.currentPublicId)
                || (comment.authorUid && comment.authorUid === this.communityContext?.currentUid));
        item.draggable = comment.source !== "community" || ownsCommunityComment;
        item.addEventListener("click", (event) => {
            if ((event.target as HTMLElement).closest("button")) return;
            this.player.currentTime(comment.timestamp);
        });
        item.addEventListener("dragstart", (event) => {
            item.classList.add("dragging");
            event.dataTransfer?.setData("application/x-lr-review-comment", comment.id);
            event.dataTransfer?.setData("text/plain", comment.text);
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                const preview = this.createDragPreview(comment);
                event.dataTransfer.setDragImage(preview, 24, Math.min(20, preview.offsetHeight / 2));
                requestAnimationFrame(() => preview.remove());
            }
        });
        item.addEventListener("dragend", () => {
            item.classList.remove("dragging");
        });

        const body = document.createElement("div");
        body.className = "review-comment-body";
        const meta = document.createElement("div");
        meta.className = "review-comment-meta";
        const time = document.createElement("button");
        time.type = "button";
        time.className = "review-comment-time";
        time.textContent = formatReviewTimestamp(comment.timestamp);
        time.title = uiText("この時刻へ移動", "Seek to this time");
        time.addEventListener("click", () => this.player.currentTime(comment.timestamp));
        const mode = document.createElement("span");
        mode.className = "review-comment-mode";
        mode.textContent = comment.mode === "fixed"
            ? uiText(`固定 ${comment.duration}秒`, `Pinned ${comment.duration}s`)
            : uiText(`${comment.duration}秒`, `${comment.duration}s`);
        meta.append(time, mode);
        if (comment.authorName) {
            const author = document.createElement("span");
            author.className = "review-comment-author";
            author.textContent = comment.authorName;
            author.title = comment.authorPublicId
                ? uiText(`投稿者ID: ${comment.authorPublicId}`, `Author ID: ${comment.authorPublicId}`)
                : uiText("投稿者", "Author");
            meta.append(author);
        }
        if (comment.visibility === "private") {
            const privacy = document.createElement("span");
            privacy.className = "review-comment-private-badge";
            privacy.textContent = uiText("非公開", "Private");
            meta.append(privacy);
        }
        const text = document.createElement("div");
        text.className = "review-comment-text";
        text.textContent = comment.text;
        body.append(meta, text);

        const actions = document.createElement("div");
        actions.className = "review-comment-actions";
        if (comment.source !== "community" || ownsCommunityComment) {
            const good = this.createActionButton("●", uiText("GOODにする", "Set GOOD"), `set-good${comment.rating === "good" ? " active" : ""}`, () => this.updateRating(comment, "good"));
            const bad = this.createActionButton("▲", uiText("BADにする", "Set BAD"), `set-bad${comment.rating === "bad" ? " active" : ""}`, () => this.updateRating(comment, "bad"));
            const question = this.createActionButton("?", uiText("確認にする", "Mark for review"), `set-question${comment.rating === "question" ? " active" : ""}`, () => this.updateRating(comment, "question"));
            actions.append(good, bad, question);
            if (comment.mode === "fixed") {
                actions.append(this.createActionButton("◎", uiText("固定を解除", "Unpin"), "release-fixed", () => this.releaseFixedPosition(comment)));
            }
        }
        if (comment.source !== "community" || ownsCommunityComment || this.communityContext?.isOwner) {
            actions.append(this.createActionButton("×", uiText("削除", "Delete"), "delete-comment", () => this.deleteComment(comment)));
        }
        item.append(body, actions);
        return item;
    }

    private createActionButton(label: string, title: string, className: string, onClick: () => void): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.title = title;
        button.className = className;
        button.addEventListener("click", onClick);
        return button;
    }

    private async persistCommunityComment(comment: ReviewComment): Promise<void> {
        const context = this.communityContext;
        if (!context || comment.source !== "community") return;
        const commentId = comment.id.replace(/^community:/u, "");
        await this.runCommunityAction(async () => {
            await updateCommunityComment(context.videoId, commentId, {
                text: comment.text,
                videoTimeMs: Math.round(comment.timestamp * 1000),
                rating: comment.rating,
                color: comment.color,
                size: comment.size,
                durationMs: Math.round(comment.duration * 1000),
                mode: comment.mode,
                x: comment.mode === "fixed" ? Math.round((comment.x ?? 50) * 100) : null,
                y: comment.mode === "fixed" ? Math.round((comment.y ?? 45) * 100) : null,
                visibility: comment.visibility ?? "public",
                clientRequestId: commentId,
            });
        });
    }

    private createDragPreview(comment: ReviewComment): HTMLElement {
        const preview = document.createElement("div");
        const ratingClass = comment.rating ? `is-${comment.rating}` : "is-unrated";
        preview.className = `lr-video-comment ${ratingClass} size-${comment.size} lr-comment-drag-preview`;
        preview.style.color = comment.color;
        preview.textContent = comment.text;
        document.body.append(preview);
        return preview;
    }

    private renderOverlay(): void {
        this.syncOverlayToVideoBounds();
        const currentTime = this.player.currentTime() ?? 0;
        const active = this.comments.filter((comment) =>
            this.commentsVisible
            && currentTime >= comment.timestamp
            && currentTime < comment.timestamp + comment.duration
            && (comment.mode === "fixed" || this.flowEnabled)
            && this.matchesCommunityGroupFilter(comment)
        );
        const activeIds = new Set(active.map((comment) => comment.id));
        this.overlay.querySelectorAll<HTMLElement>(".lr-video-comment").forEach((element) => {
            if (!activeIds.has(element.dataset.commentId ?? "")) element.remove();
        });
        for (const comment of active) {
            let element = this.overlay.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(comment.id)}"]`);
            if (!element) {
                element = document.createElement("div");
                element.dataset.commentId = comment.id;
                element.textContent = comment.text;
                this.overlay.append(element);
            }
            const ratingClass = comment.rating ? `is-${comment.rating}` : "is-unrated";
            element.className = `lr-video-comment ${ratingClass} size-${comment.size}${comment.mode === "fixed" ? " is-fixed" : ""}`;
            element.style.color = comment.color;
            const progress = Math.min(1, Math.max(0, (currentTime - comment.timestamp) / comment.duration));
            if (comment.mode === "fixed") {
                element.style.left = `${comment.x ?? 50}%`;
                element.style.top = `${comment.y ?? 45}%`;
                element.style.transform = "translate(-50%, -50%)";
            } else {
                const lane = this.laneAssignments.get(comment.id) ?? 0;
                element.style.left = "0";
                element.style.top = `${2 + lane * 11}%`;
                const distance = this.overlay.clientWidth + element.offsetWidth;
                element.style.transform = `translateX(${this.overlay.clientWidth - progress * distance}px)`;
            }
        }
    }

    private matchesCommunityGroupFilter(comment: ReviewComment): boolean {
        if (this.communityGroupFilter === "all") return true;
        if (comment.source !== "community") return false;
        if (this.communityGroupFilter === "invited") return (comment.authorGroupIds?.length ?? 0) > 0;
        return comment.authorGroupIds?.includes(this.communityGroupFilter) === true;
    }

    private rebuildLaneAssignments(): void {
        this.laneAssignments.clear();
        const laneEndTimes = Array.from({ length: 8 }, () => Number.NEGATIVE_INFINITY);
        const scrollingComments = this.comments
            .filter((comment) => comment.mode === "scroll")
            .toSorted((a, b) => a.timestamp - b.timestamp || a.createdAt - b.createdAt);
        for (const comment of scrollingComments) {
            let lane = laneEndTimes.findIndex((endTime) => endTime <= comment.timestamp);
            if (lane < 0) {
                lane = laneEndTimes.indexOf(Math.min(...laneEndTimes));
            }
            this.laneAssignments.set(comment.id, lane);
            laneEndTimes[lane] = comment.timestamp + comment.duration;
        }
    }

    private syncOverlayToVideoBounds(): void {
        const playerElement = this.player.el() as HTMLElement;
        const playerRect = playerElement.getBoundingClientRect();
        const youtubeWrapper = playerElement.querySelector<HTMLElement>(".lr-youtube-tech-wrapper");
        const videoElement = playerElement.querySelector<HTMLVideoElement>("video.vjs-tech");
        const mediaElement = youtubeWrapper ?? videoElement;
        if (!mediaElement || playerRect.width <= 0 || playerRect.height <= 0) return;

        const elementRect = mediaElement.getBoundingClientRect();
        let left = elementRect.left;
        let top = elementRect.top;
        let width = elementRect.width;
        let height = elementRect.height;

        if (videoElement && !youtubeWrapper && videoElement.videoWidth > 0 && videoElement.videoHeight > 0 && width > 0 && height > 0) {
            const mediaAspect = videoElement.videoWidth / videoElement.videoHeight;
            const elementAspect = width / height;
            if (elementAspect > mediaAspect) {
                const contentWidth = height * mediaAspect;
                left += (width - contentWidth) / 2;
                width = contentWidth;
            } else {
                const contentHeight = width / mediaAspect;
                top += (height - contentHeight) / 2;
                height = contentHeight;
            }
        }

        this.overlay.style.left = `${left - playerRect.left}px`;
        this.overlay.style.top = `${top - playerRect.top}px`;
        this.overlay.style.width = `${width}px`;
        this.overlay.style.height = `${height}px`;
    }

    private startAnimationLoop(): void {
        const tick = () => {
            this.renderOverlay();
            this.animationFrame = requestAnimationFrame(tick);
        };
        this.animationFrame = requestAnimationFrame(tick);
    }
}
