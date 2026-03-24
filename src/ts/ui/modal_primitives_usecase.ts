import type { ContentDescriptor } from "video.js/dist/types/utils/dom";

export function showModalView(params: {
    modal: HTMLElement;
    modalContent: HTMLElement;
    insertContent: (parent: Element, content: ContentDescriptor) => void;
    content: ContentDescriptor;
}): void {
    const { modal, modalContent, insertContent, content } = params;
    insertContent(modalContent, content);
    modal.style.display = "block";
}

export function hideModalView(params: {
    modal: HTMLElement;
    modalContent: HTMLElement;
    emptyEl: (el: Element) => void;
}): void {
    const { modal, modalContent, emptyEl } = params;
    emptyEl(modalContent);
    modalContent.classList.remove("settings-mode");
    modal.style.display = "none";
}

export function isModalOpen(modal: HTMLElement): boolean {
    return modal.style.display === "block";
}

export function buildErrorModalContent(params: {
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => Element;
    text: string;
    onClose: () => void;
}): ContentDescriptor {
    const { createEl, text, onClose } = params;
    return [
        createEl("p", {}, {}, text),
        createEl("p", {}, {}, createEl("button", { onclick: onClose }, { class: "btn" }, "Close")),
    ];
}
