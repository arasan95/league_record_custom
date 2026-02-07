import type videojs from "video.js";
import { Recording } from "./bindings";
import { toVideoName, isFavorite } from "./util";

function formatBytes(bytes: number, decimals = 2) {
    if (!bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export const createRecordingItem = (
    vjs: typeof videojs,
    recording: Recording,
    onVideo: (videoId: string) => void,
    onFavorite: (videoId: string) => Promise<boolean | null>,
    onRename: (videoId: string) => void,
    onDelete: (videoId: string) => void,
) => {
    const videoName = toVideoName(recording.videoId);
    let displayContent: HTMLElement[] = [vjs.dom.createEl("span", {}, { class: "video-name" }, videoName) as HTMLElement];
    let liClass = "recording-item";
    
    // Layout Elements
    const mainContent = document.createElement("div");
    mainContent.className = "recording-content";

    if (recording.metadata && "Metadata" in recording.metadata) {
        liClass += " has-metadata";
        const meta = recording.metadata.Metadata;
        const parts = videoName.split("_");
        
        // Date Formatting
        let dateStr = videoName;
        if (parts.length === 2) {
            const dParts = parts[0].split("-"); // YYYY-MM-DD
            const tParts = parts[1].split("-"); // HH-MM-SS
            if (dParts.length === 3 && tParts.length >= 2) {
                    // YYYY/MM/DD HH:MM
                    dateStr = `${dParts[0]}/${parseInt(dParts[1])}/${parseInt(dParts[2])} ${tParts[0]}:${tParts[1]}`;
            }
        }

        const champion = meta.championName;
        const kda = `${meta.stats.kills}/${meta.stats.deaths}/${meta.stats.assists}`;
        const result = meta.stats.gameEndedInEarlySurrender 
            ? "Remake" 
            : meta.stats.win ? "Victory" : "Defeat";
        
        const resultClass = meta.stats.gameEndedInEarlySurrender 
            ? "remake-text" 
            : meta.stats.win ? "win-text" : "loss-text";
        
        let queueName = meta.queue?.name ?? "Custom";
        // Shorten Names
        const qLower = queueName.toLowerCase();
        if (qLower.includes("practice") || qLower.includes("プラクティス")) {
            queueName = "Practice";
        } else if (qLower.includes("custom") || qLower.includes("カスタム")) {
            queueName = "Custom";
        } else if (qLower.includes("bot") || qLower.includes("ai") || qLower.includes("intro") || qLower.includes("intermediate") || qLower.includes("入門") || qLower.includes("初級") || qLower.includes("中級")) {
            queueName = "vs AI";
        } else if (qLower.includes("aram")) {
            queueName = "ARAM";
        } else if (qLower.includes("flex")) {
            queueName = "Flex";
        } else if (qLower.includes("solo")) {
            queueName = "Solo/Duo";
        } else if (qLower.includes("arena")) {
            queueName = "Arena";
        } else if (qLower.includes("draft")) {
            queueName = "Draft";
        } else if (qLower.includes("blind")) {
            queueName = "Blind";
        } else if (qLower.includes("quick")) {
            queueName = "Quick";
        } else if (qLower.includes("clash")) {
            queueName = "Clash";
        } else if (qLower.includes("ranked") || qLower.includes("rank")) {
            queueName = "Ranked";
        } else if (qLower.includes("normal") || qLower.includes("draft") || qLower.includes("blind")) {
            queueName = "Normal";
        }

        const dateEl = vjs.dom.createEl("div", {}, { class: "rec-date" }, dateStr);
        const champEl = vjs.dom.createEl("div", {}, { class: "rec-champ" }, champion);
        const kdaEl = vjs.dom.createEl("div", {}, { class: "rec-kda" }, kda);
        const resultEl = vjs.dom.createEl("div", {}, { class: `rec-result ${resultClass}` }, result);
        const queueEl = vjs.dom.createEl("div", {}, { class: "rec-queue" }, queueName);

        // Construct Row
        // Top Row: Result | KDA | Queue
        const topRow = vjs.dom.createEl("div", {}, { class: "rec-row-top" }, [resultEl, kdaEl, queueEl]);
        // Bottom Row: Champion | Date
        const botRow = vjs.dom.createEl("div", {}, { class: "rec-row-bot" }, [champEl, dateEl]);
        
        mainContent.append(topRow, botRow);

            displayContent.push(vjs.dom.createEl("span", {}, { class: "rec-size" }, `(${formatBytes(0)})`) as HTMLElement); 
    }
    
    // Buttons
    const favoriteBtn = vjs.dom.createEl("button", 
        { 
            onclick: async (e: Event) => {
                e.stopPropagation();
                // Optimistic UI update
                const newFavState = await onFavorite(recording.videoId);
                if (newFavState !== null) {
                    if (newFavState) favoriteBtn.classList.add("is-favorite");
                    else favoriteBtn.classList.remove("is-favorite");
                }
            } 
        }, 
        { 
            class: `action-btn fav-btn ${isFavorite(recording.metadata) ? "is-favorite" : ""}`,
            title: "Favorite"
        },
        "★"
    );
    
    const renameBtn = vjs.dom.createEl("button", 
        { onclick: (e: Event) => { e.stopPropagation(); onRename(recording.videoId); } }, 
        { class: "action-btn", title: "Rename" }, 
        "✎"
    );
    
    const deleteBtn = vjs.dom.createEl("button", 
        { onclick: (e: Event) => { e.stopPropagation(); onDelete(recording.videoId); } }, 
        { class: "action-btn del-btn", title: "Delete" }, 
        "🗑"
    );

    // Wrap buttons
    const actionsDiv = vjs.dom.createEl("div", {}, { class: "sidebar-actions" }, [favoriteBtn, renameBtn, deleteBtn]);

    // Append everything to LI
    const li = vjs.dom.createEl("li", { onclick: () => onVideo(recording.videoId) }, { id: recording.videoId, class: liClass }) as HTMLElement;
    
    // Add Dataset for ID lookup
    li.dataset.videoId = recording.videoId;

    if (recording.metadata && "Metadata" in recording.metadata) {
        li.append(mainContent);
    } else {
            // Fallback for non-metadata
            li.append(...displayContent);
    }
    li.append(actionsDiv);
    
    return li;
};

export const updateRecordingItem = (
    vjs: typeof videojs,
    recording: Recording,
    onVideo: (videoId: string) => void,
    onFavorite: (videoId: string) => Promise<boolean | null>,
    onRename: (videoId: string) => void,
    onDelete: (videoId: string) => void,
) => {
    
    const existingLi = document.getElementById(recording.videoId);
    
    if (existingLi) {
        
        const newLi = createRecordingItem(
            vjs,
            recording, 
            onVideo, 
            onFavorite, 
            onRename, 
            onDelete
        );
        
        existingLi.replaceWith(newLi);
        console.log(`Updated sidebar item: ${recording.videoId}`);
    } else {
        console.warn(`Could not find list item to update: ${recording.videoId}`);
    }
};
