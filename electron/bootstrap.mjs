import electronMain from "electron/main";

globalThis.__leagueRecordElectronMain = electronMain;
await import("./main.cjs");
