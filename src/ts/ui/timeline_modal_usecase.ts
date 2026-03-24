import * as clipboard from "@tauri-apps/plugin-clipboard-manager";

export function showTimelineModalView(input: {
    timelineEvents: Array<{ timestamp: number; text: string }>;
    setTime: (secs: number) => void;
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => any;
    hideModal: () => void;
    showModal: (content: any) => void;
}): void {
    const { timelineEvents, setTime, createEl, hideModal, showModal } = input;
    const closeButton = createEl("span", { onclick: hideModal }, { class: "timeline-event-close-button" }, "×");
    const timelineList = createEl(
        "ul",
        {},
        { class: "timeline-event-list" },
        timelineEvents.map(({ timestamp, text }) =>
            createEl(
                "li",
                {
                    onclick: () => {
                        setTime(timestamp);
                        hideModal();
                    },
                },
                { class: "timeline-event-list-item" },
                text,
            ),
        ),
    );
    const copyToClipboardButton = createEl(
        "button",
        { onclick: () => clipboard.writeText(timelineEvents.map((e) => e.text).join("\n")) },
        { class: "btn" },
        "Copy to Clipboard",
    );
    showModal([closeButton, timelineList, copyToClipboardButton]);
}

