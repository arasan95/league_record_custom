import { commands } from "../bindings";
import { toVideoId, toVideoName } from "../util";

export function showRenameRecordingModal(input: {
    videoId: string;
    videoIds: ReadonlyArray<string>;
    rename: (videoId: string, newVideoId: string) => void;
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => any;
    showModal: (content: any) => void;
    hideModal: () => void;
}): void {
    const { videoId, videoIds, rename, createEl, showModal, hideModal } = input;
    const videoName = toVideoName(videoId);
    const inputEl = createEl("input", {}, {
        type: "text",
        id: "new-name",
        value: videoName,
        placeholder: "new name",
        spellcheck: "false",
        autocomplete: "off",
    }) as HTMLInputElement;

    const getDir = (p: string) => {
        const last = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
        return last === -1 ? "" : p.substring(0, last + 1);
    };
    const currentDir = getDir(videoId);
    const validityChecker = () => {
        const newName = toVideoId(inputEl.value);
        const exists = videoIds.some((id) => {
            if (getDir(id) !== currentDir) return false;
            const name = id.split(/[/\\]/).pop();
            return name === newName;
        });
        if (exists) {
            inputEl.setCustomValidity("there is already a file with this name");
            saveButton.setAttribute("disabled", "true");
        } else {
            inputEl.setCustomValidity("");
            saveButton.removeAttribute("disabled");
        }
        inputEl.reportValidity();
    };
    inputEl.addEventListener("input", validityChecker);
    inputEl.setCustomValidity("there is already a file with this name");
    inputEl.reportValidity();

    const renameHandler = (e: KeyboardEvent | MouseEvent) => {
        const keyboardEvent = "key" in e;
        if (inputEl.checkValidity() && (!keyboardEvent || e.key === "Enter")) {
            e.preventDefault();
            hideModal();
            rename(videoId, toVideoId(inputEl.value));
            inputEl.removeEventListener("keydown", renameHandler);
            inputEl.removeEventListener("input", validityChecker);
        }
    };
    inputEl.addEventListener("keydown", renameHandler);

    const saveButton = createEl("button", { onclick: renameHandler }, { class: "btn", disabled: true }, "Save") as HTMLButtonElement;
    const cancelButton = createEl("button", { onclick: hideModal }, { class: "btn" }, "Cancel") as HTMLButtonElement;

    showModal([
        createEl("p", {}, {}, ["Change name of: ", createEl("u", {}, {}, videoName)]),
        createEl("p", {}, {}, inputEl),
        createEl("p", {}, {}, [saveButton, cancelButton]),
    ]);

    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    inputEl.focus();
}

export function showDeleteVideoOnlyRecordingModal(input: {
    videoId: string;
    deleteVideoOnly: (videoId: string) => void;
    isFavorite?: boolean;
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => any;
    showModal: (content: any) => void;
    hideModal: () => void;
}): void {
    const { videoId, deleteVideoOnly, isFavorite = false, createEl, showModal, hideModal } = input;
    let confirmDelete = true;
    const toggleDelete = () => {
        confirmDelete = !confirmDelete;
    };
    let videoName: string;
    if (videoId.includes("\\")) videoName = videoId.split("\\").pop()!;
    else if (videoId.includes("/")) videoName = videoId.split("/").pop()!;
    else videoName = videoId;

    const warningTexts = isFavorite
        ? [createEl("br"), createEl("br"), createEl("strong", { style: "color: orange;" }, {}, "Warning: This is a favorite recording!")]
        : [];

    const prompt = createEl("p", {}, {}, ["Delete Video Only (Keep JSON): ", createEl("u", {}, {}, videoName), "?", ...warningTexts]);
    const dontAskMeAgain = createEl("p", {}, { style: "font-size: 18px" }, [
        createEl("input", { onchange: toggleDelete }, { type: "checkbox", id: "dont-ask-again-vdo", style: "vertical-align: middle; margin: 0;" }, []),
        createEl("label", {}, { for: "dont-ask-again-vdo", style: "vertical-align: middle" }, "  don't ask again"),
    ]);

    const deleteFn = () => {
        hideModal();
        deleteVideoOnly(videoId);
        if (!confirmDelete && !isFavorite) {
            commands.disableConfirmDelete();
        }
    };
    const buttons = createEl("p", {}, {}, [
        createEl("button", { onclick: deleteFn }, { class: "btn" }, "Delete Video"),
        createEl("button", { onclick: hideModal }, { class: "btn" }, "Cancel"),
    ]);
    showModal([prompt, dontAskMeAgain, buttons]);
}

export function showDeleteRecordingModal(input: {
    videoId: string;
    deleteVideo: (videoId: string) => void;
    isFavorite?: boolean;
    createEl: (tagName: string, properties?: any, attributes?: any, content?: any) => any;
    showModal: (content: any) => void;
    hideModal: () => void;
}): void {
    const { videoId, deleteVideo, isFavorite = false, createEl, showModal, hideModal } = input;
    const videoName = toVideoName(videoId);
    let confirmDelete = true;
    const toggleDelete = () => {
        confirmDelete = !confirmDelete;
    };

    const warningTexts = isFavorite
        ? [createEl("br"), createEl("br"), createEl("strong", { style: "color: orange;" }, {}, "Warning: This is a favorite recording!")]
        : [];
    const prompt = createEl("p", {}, {}, ["Delete recording: ", createEl("u", {}, {}, videoName), "?", ...warningTexts]);
    const dontAskMeAgain = createEl("p", {}, { style: "font-size: 18px" }, [
        createEl("input", { onchange: toggleDelete }, { type: "checkbox", id: "dont-ask-again", style: "vertical-align: middle; margin: 0;" }, []),
        createEl("label", {}, { for: "dont-ask-again", style: "vertical-align: middle" }, "  don't ask again"),
    ]);
    const deleteFn = () => {
        hideModal();
        deleteVideo(videoId);
        if (!confirmDelete && !isFavorite) {
            commands.disableConfirmDelete();
        }
    };
    const buttons = createEl("p", {}, {}, [
        createEl("button", { onclick: deleteFn }, { class: "btn" }, "Delete"),
        createEl("button", { onclick: hideModal }, { class: "btn" }, "Cancel"),
    ]);
    showModal([prompt, dontAskMeAgain, buttons]);
}

