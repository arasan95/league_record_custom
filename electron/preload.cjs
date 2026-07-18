const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Map();

function onEvent(event, cb) {
  const channel = `lr:event:${event}`;
  const wrapped = (_e, payload) => cb({ payload });
  ipcRenderer.on(channel, wrapped);
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel).add(wrapped);
  return Promise.resolve(() => {
    ipcRenderer.off(channel, wrapped);
    listeners.get(channel)?.delete(wrapped);
  });
}

contextBridge.exposeInMainWorld("__TAURI_INTERNALS__", {});
contextBridge.exposeInMainWorld("leagueRecord", {
  devConfig: Object.freeze({
    isDevelopment: process.env.LR_ELECTRON_DEV === "1",
    replayShareBackendUrl: process.env.VITE_REPLAY_SHARE_BACKEND_URL || "",
    firestoreEmulatorHost: process.env.VITE_FIRESTORE_EMULATOR_HOST || "",
  }),
  invoke: (command, args) => ipcRenderer.invoke("tauri:invoke", { command, args }),
  event: {
    listen: (name, cb) => onEvent(name, cb),
    once: (name, cb) => {
      const channel = `lr:event:${name}`;
      ipcRenderer.once(channel, (_e, payload) => cb({ payload }));
      return Promise.resolve(() => {});
    },
    emit: (_name, _payload) => Promise.resolve(),
  },
  window: {
    minimize: () => ipcRenderer.send("lr:window:minimize"),
    maximize: () => ipcRenderer.send("lr:window:maximize"),
    unmaximize: () => ipcRenderer.send("lr:window:unmaximize"),
    isMaximized: () => ipcRenderer.invoke("lr:window:isMaximized"),
    close: () => ipcRenderer.send("lr:window:close"),
    show: () => ipcRenderer.send("lr:window:show"),
    setFocus: () => ipcRenderer.send("lr:window:focus"),
    unminimize: () => ipcRenderer.send("lr:window:unminimize"),
    setFullscreen: (value) => ipcRenderer.send("lr:window:fullscreen", Boolean(value)),
  },
  path: {
    join: (...parts) => ipcRenderer.invoke("lr:path:join", ...parts),
    appLocalDataDir: () => ipcRenderer.invoke("lr:path:appLocalDataDir"),
    sep: "\\",
  },
  shell: {
    open: (url) => ipcRenderer.invoke("lr:shell:open", url),
  },
  drag: {
    startDrag: (options) => ipcRenderer.invoke("lr:drag:start", options),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke("lr:clipboard:writeText", text),
  },
  youtubeComparison: {
    setEnabled: (enabled) => ipcRenderer.invoke("lr:youtube-ui-comparison:setEnabled", Boolean(enabled)),
  },
  app: {
    getVersion: () => ipcRenderer.invoke("lr:app:getVersion"),
  },
  updater: {
    check: async () => {
      const update = await ipcRenderer.invoke("lr:updater:check");
      if (!update) return null;
      return {
        ...update,
        downloadAndInstall: () => ipcRenderer.invoke("lr:updater:downloadAndInstall", update),
      };
    },
  },
  process: {
    relaunch: () => ipcRenderer.invoke("lr:process:relaunch"),
  },
  fs: {
    exists: (path, options) => ipcRenderer.invoke("lr:fs:exists", path, options),
    mkdir: (path, options) => ipcRenderer.invoke("lr:fs:mkdir", path, options),
    readFile: (path, options) => ipcRenderer.invoke("lr:fs:readFile", path, options),
    writeFile: (path, data, options) => ipcRenderer.invoke("lr:fs:writeFile", path, data, options),
  },
});
