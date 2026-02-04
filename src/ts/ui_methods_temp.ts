
    public createRecordingItem = (
        recording: Recording,
        onVideo: (videoId: string) => void,
        onFavorite: (videoId: string) => Promise<boolean | null>,
        onRename: (videoId: string) => void,
        onDelete: (videoId: string) => void,
    ) => {
        const videoName = toVideoName(recording.videoId);
        let displayContent: HTMLElement[] = [this.vjs.dom.createEl("span", {}, { class: "video-name" }, videoName) as HTMLElement];
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

            const dateEl = this.vjs.dom.createEl("div", {}, { class: "rec-date" }, dateStr);
            const champEl = this.vjs.dom.createEl("div", {}, { class: "rec-champ" }, champion);
            const kdaEl = this.vjs.dom.createEl("div", {}, { class: "rec-kda" }, kda);
            const resultEl = this.vjs.dom.createEl("div", {}, { class: `rec-result ${resultClass}` }, result);
            const queueEl = this.vjs.dom.createEl("div", {}, { class: "rec-queue" }, queueName);

            // Construct Row
            // Top Row: Result | KDA | Queue
            const topRow = this.vjs.dom.createEl("div", {}, { class: "rec-row-top" }, [resultEl, kdaEl, queueEl]);
            // Bottom Row: Champion | Date
            const botRow = this.vjs.dom.createEl("div", {}, { class: "rec-row-bot" }, [champEl, dateEl]);
            
            mainContent.append(topRow, botRow);

        } else {
                displayContent.push(this.vjs.dom.createEl("span", {}, { class: "rec-size" }, `(${formatBytes(recording.metadata?.NoData?.fav ? 0 : 0)})`)); 
        }
        
        // Buttons
        const favoriteBtn = this.vjs.dom.createEl("button", 
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
        
        const renameBtn = this.vjs.dom.createEl("button", 
            { onclick: (e: Event) => { e.stopPropagation(); onRename(recording.videoId); } }, 
            { class: "action-btn", title: "Rename" }, 
            "✎"
        );
        
        const deleteBtn = this.vjs.dom.createEl("button", 
            { onclick: (e: Event) => { e.stopPropagation(); onDelete(recording.videoId); } }, 
            { class: "action-btn del-btn", title: "Delete" }, 
            "🗑"
        );

        // Wrap buttons
        const actionsDiv = this.vjs.dom.createEl("div", {}, { class: "sidebar-actions" }, [favoriteBtn, renameBtn, deleteBtn]);

        // Append everything to LI
        const li = this.vjs.dom.createEl("li", { onclick: () => onVideo(recording.videoId) }, { id: recording.videoId, class: liClass });
        
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

    public updateRecordingItem = (recording: Recording) => {
        // Find existing element
        // We added id=recording.videoId to li in createRecordingItem
        // However, videoId might have characters invalid for ID?
        // Usually filenames are okay, but better to use querySelector with attribute
        // or getElementById if we are sure.
        // We added id={recording.videoId}
        
        const existingLi = document.getElementById(recording.videoId);
        
        if (existingLi && this.lastOnVideo) {
            // Check if we need to update?
            // User said "Only reload... the ones that haven't been loaded".
            // So if existingLi has metadata class, maybe skip?
            // "liClass += ' has-metadata'"
            if (existingLi.classList.contains("has-metadata")) {
                // Already has metadata. Should we update? 
                // MetadataChanged usually means NEW metadata.
                // But user said "Latest ones that haven't been loaded".
                // So if it already has metadata, maybe we don't need to touch it?
                // But what if metadata UPDATED (e.g. favorite toggle, or error correction)?
                // Safer to update.
            }
            
            const newLi = this.createRecordingItem(
                recording, 
                this.lastOnVideo, 
                this.lastOnFavorite, 
                this.lastOnRename, 
                this.lastOnDelete
            );
            
            existingLi.replaceWith(newLi);
            console.log(`Updated sidebar item: ${recording.videoId}`);
        } else {
            console.warn(`Could not find list item to update: ${recording.videoId}`);
            // If it's not in the list, maybe we should add it?
            // But updateSidebar usually handles the list. 
            // If it's a new file not in list, we might need full reload.
        }
    };
