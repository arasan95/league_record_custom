export function getActiveVideoIdFromSidebar(sidebar: HTMLElement): string | null {
    return sidebar.querySelector<HTMLLIElement>("li.active")?.id ?? null;
}

export function setActiveVideoIdInSidebar(sidebar: HTMLElement, videoId: string | null): boolean {
    sidebar.querySelector<HTMLLIElement>("li.active")?.classList.remove("active");
    if (videoId !== null) {
        const videoLi = document.getElementById(videoId) as HTMLLIElement | null;
        if (videoLi && sidebar.contains(videoLi)) {
            videoLi.classList.add("active");
            return true;
        }
        return false;
    }
    return true;
}

export function playAdjacentVisibleVideo(input: {
    sidebar: HTMLElement;
    direction: "next" | "prev";
}): void {
    const { sidebar, direction } = input;
    const activeLi = sidebar.querySelector<HTMLLIElement>("li.active");
    if (!activeLi) return;

    let cursor = (direction === "next"
        ? activeLi.nextElementSibling
        : activeLi.previousElementSibling) as HTMLLIElement | null;

    while (cursor) {
        if (cursor.style.display !== "none" && cursor.tagName === "LI" && cursor.id) {
            cursor.click();
            cursor.scrollIntoView({ block: "center", behavior: "smooth" });
            return;
        }
        cursor = (direction === "next"
            ? cursor.nextElementSibling
            : cursor.previousElementSibling) as HTMLLIElement | null;
    }
}

