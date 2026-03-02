// node_modules/@tauri-apps/plugin-fs/node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}

// node_modules/@tauri-apps/plugin-fs/node_modules/@tauri-apps/api/core.js
var _Channel_onmessage;
var _Channel_nextMessageIndex;
var _Channel_pendingMessages;
var _Channel_messageEndIndex;
var _Resource_rid;
var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
function transformCallback(callback, once = false) {
  return window.__TAURI_INTERNALS__.transformCallback(callback, once);
}

class Channel {
  constructor(onmessage) {
    _Channel_onmessage.set(this, undefined);
    _Channel_nextMessageIndex.set(this, 0);
    _Channel_pendingMessages.set(this, []);
    _Channel_messageEndIndex.set(this, undefined);
    __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {}), "f");
    this.id = transformCallback((rawMessage) => {
      const index = rawMessage.index;
      if ("end" in rawMessage) {
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          this.cleanupCallback();
        } else {
          __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
        }
        return;
      }
      const message = rawMessage.message;
      if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
        __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
        __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
          const message2 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message2);
          delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        }
        if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
          this.cleanupCallback();
        }
      } else {
        __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
      }
    });
  }
  cleanupCallback() {
    window.__TAURI_INTERNALS__.unregisterCallback(this.id);
  }
  set onmessage(handler) {
    __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
  }
  get onmessage() {
    return __classPrivateFieldGet(this, _Channel_onmessage, "f");
  }
  [(_Channel_onmessage = new WeakMap, _Channel_nextMessageIndex = new WeakMap, _Channel_pendingMessages = new WeakMap, _Channel_messageEndIndex = new WeakMap, SERIALIZE_TO_IPC_FN)]() {
    return `__CHANNEL__:${this.id}`;
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
}
async function invoke(cmd, args = {}, options) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}
class Resource {
  get rid() {
    return __classPrivateFieldGet(this, _Resource_rid, "f");
  }
  constructor(rid) {
    _Resource_rid.set(this, undefined);
    __classPrivateFieldSet(this, _Resource_rid, rid, "f");
  }
  async close() {
    return invoke("plugin:resources|close", {
      rid: this.rid
    });
  }
}
_Resource_rid = new WeakMap;

// node_modules/@tauri-apps/plugin-fs/node_modules/@tauri-apps/api/path.js
var BaseDirectory;
(function(BaseDirectory2) {
  BaseDirectory2[BaseDirectory2["Audio"] = 1] = "Audio";
  BaseDirectory2[BaseDirectory2["Cache"] = 2] = "Cache";
  BaseDirectory2[BaseDirectory2["Config"] = 3] = "Config";
  BaseDirectory2[BaseDirectory2["Data"] = 4] = "Data";
  BaseDirectory2[BaseDirectory2["LocalData"] = 5] = "LocalData";
  BaseDirectory2[BaseDirectory2["Document"] = 6] = "Document";
  BaseDirectory2[BaseDirectory2["Download"] = 7] = "Download";
  BaseDirectory2[BaseDirectory2["Picture"] = 8] = "Picture";
  BaseDirectory2[BaseDirectory2["Public"] = 9] = "Public";
  BaseDirectory2[BaseDirectory2["Video"] = 10] = "Video";
  BaseDirectory2[BaseDirectory2["Resource"] = 11] = "Resource";
  BaseDirectory2[BaseDirectory2["Temp"] = 12] = "Temp";
  BaseDirectory2[BaseDirectory2["AppConfig"] = 13] = "AppConfig";
  BaseDirectory2[BaseDirectory2["AppData"] = 14] = "AppData";
  BaseDirectory2[BaseDirectory2["AppLocalData"] = 15] = "AppLocalData";
  BaseDirectory2[BaseDirectory2["AppCache"] = 16] = "AppCache";
  BaseDirectory2[BaseDirectory2["AppLog"] = 17] = "AppLog";
  BaseDirectory2[BaseDirectory2["Desktop"] = 18] = "Desktop";
  BaseDirectory2[BaseDirectory2["Executable"] = 19] = "Executable";
  BaseDirectory2[BaseDirectory2["Font"] = 20] = "Font";
  BaseDirectory2[BaseDirectory2["Home"] = 21] = "Home";
  BaseDirectory2[BaseDirectory2["Runtime"] = 22] = "Runtime";
  BaseDirectory2[BaseDirectory2["Template"] = 23] = "Template";
})(BaseDirectory || (BaseDirectory = {}));
// node_modules/@tauri-apps/plugin-fs/dist-js/index.js
var SeekMode;
(function(SeekMode2) {
  SeekMode2[SeekMode2["Start"] = 0] = "Start";
  SeekMode2[SeekMode2["Current"] = 1] = "Current";
  SeekMode2[SeekMode2["End"] = 2] = "End";
})(SeekMode || (SeekMode = {}));
function parseFileInfo(r) {
  return {
    isFile: r.isFile,
    isDirectory: r.isDirectory,
    isSymlink: r.isSymlink,
    size: r.size,
    mtime: r.mtime !== null ? new Date(r.mtime) : null,
    atime: r.atime !== null ? new Date(r.atime) : null,
    birthtime: r.birthtime !== null ? new Date(r.birthtime) : null,
    readonly: r.readonly,
    fileAttributes: r.fileAttributes,
    dev: r.dev,
    ino: r.ino,
    mode: r.mode,
    nlink: r.nlink,
    uid: r.uid,
    gid: r.gid,
    rdev: r.rdev,
    blksize: r.blksize,
    blocks: r.blocks
  };
}
function fromBytes(buffer) {
  const bytes = new Uint8ClampedArray(buffer);
  const size = bytes.byteLength;
  let x = 0;
  for (let i = 0;i < size; i++) {
    const byte = bytes[i];
    x *= 256;
    x += byte;
  }
  return x;
}

class FileHandle extends Resource {
  async read(buffer) {
    if (buffer.byteLength === 0) {
      return 0;
    }
    const data = await invoke("plugin:fs|read", {
      rid: this.rid,
      len: buffer.byteLength
    });
    const nread = fromBytes(data.slice(-8));
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    buffer.set(bytes.slice(0, bytes.length - 8));
    return nread === 0 ? null : nread;
  }
  async seek(offset, whence) {
    return await invoke("plugin:fs|seek", {
      rid: this.rid,
      offset,
      whence
    });
  }
  async stat() {
    const res = await invoke("plugin:fs|fstat", {
      rid: this.rid
    });
    return parseFileInfo(res);
  }
  async truncate(len) {
    await invoke("plugin:fs|ftruncate", {
      rid: this.rid,
      len
    });
  }
  async write(data) {
    return await invoke("plugin:fs|write", {
      rid: this.rid,
      data
    });
  }
}
async function open(path, options) {
  if (path instanceof URL && path.protocol !== "file:") {
    throw new TypeError("Must be a file URL.");
  }
  const rid = await invoke("plugin:fs|open", {
    path: path instanceof URL ? path.toString() : path,
    options
  });
  return new FileHandle(rid);
}
async function readFile(path, options) {
  if (path instanceof URL && path.protocol !== "file:") {
    throw new TypeError("Must be a file URL.");
  }
  const arr = await invoke("plugin:fs|read_file", {
    path: path instanceof URL ? path.toString() : path,
    options
  });
  return arr instanceof ArrayBuffer ? new Uint8Array(arr) : Uint8Array.from(arr);
}
async function writeFile(path, data, options) {
  if (path instanceof URL && path.protocol !== "file:") {
    throw new TypeError("Must be a file URL.");
  }
  if (data instanceof ReadableStream) {
    const file = await open(path, {
      read: false,
      create: true,
      write: true,
      ...options
    });
    const reader = data.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done)
          break;
        await file.write(value);
      }
    } finally {
      reader.releaseLock();
      await file.close();
    }
  } else {
    await invoke("plugin:fs|write_file", data, {
      headers: {
        path: encodeURIComponent(path instanceof URL ? path.toString() : path),
        options: JSON.stringify(options)
      }
    });
  }
}
async function exists(path, options) {
  if (path instanceof URL && path.protocol !== "file:") {
    throw new TypeError("Must be a file URL.");
  }
  return await invoke("plugin:fs|exists", {
    path: path instanceof URL ? path.toString() : path,
    options
  });
}

// node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
function __classPrivateFieldGet2(receiver, state, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet2(receiver, state, value, kind, f) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}

// node_modules/@tauri-apps/api/core.js
var _Channel_onmessage2;
var _Channel_nextMessageIndex2;
var _Channel_pendingMessages2;
var _Channel_messageEndIndex2;
var _Resource_rid2;
var SERIALIZE_TO_IPC_FN2 = "__TAURI_TO_IPC_KEY__";
function transformCallback2(callback, once = false) {
  return window.__TAURI_INTERNALS__.transformCallback(callback, once);
}

class Channel2 {
  constructor(onmessage) {
    _Channel_onmessage2.set(this, undefined);
    _Channel_nextMessageIndex2.set(this, 0);
    _Channel_pendingMessages2.set(this, []);
    _Channel_messageEndIndex2.set(this, undefined);
    __classPrivateFieldSet2(this, _Channel_onmessage2, onmessage || (() => {}), "f");
    this.id = transformCallback2((rawMessage) => {
      const index = rawMessage.index;
      if ("end" in rawMessage) {
        if (index == __classPrivateFieldGet2(this, _Channel_nextMessageIndex2, "f")) {
          this.cleanupCallback();
        } else {
          __classPrivateFieldSet2(this, _Channel_messageEndIndex2, index, "f");
        }
        return;
      }
      const message = rawMessage.message;
      if (index == __classPrivateFieldGet2(this, _Channel_nextMessageIndex2, "f")) {
        __classPrivateFieldGet2(this, _Channel_onmessage2, "f").call(this, message);
        __classPrivateFieldSet2(this, _Channel_nextMessageIndex2, __classPrivateFieldGet2(this, _Channel_nextMessageIndex2, "f") + 1, "f");
        while (__classPrivateFieldGet2(this, _Channel_nextMessageIndex2, "f") in __classPrivateFieldGet2(this, _Channel_pendingMessages2, "f")) {
          const message2 = __classPrivateFieldGet2(this, _Channel_pendingMessages2, "f")[__classPrivateFieldGet2(this, _Channel_nextMessageIndex2, "f")];
          __classPrivateFieldGet2(this, _Channel_onmessage2, "f").call(this, message2);
          delete __classPrivateFieldGet2(this, _Channel_pendingMessages2, "f")[__classPrivateFieldGet2(this, _Channel_nextMessageIndex2, "f")];
          __classPrivateFieldSet2(this, _Channel_nextMessageIndex2, __classPrivateFieldGet2(this, _Channel_nextMessageIndex2, "f") + 1, "f");
        }
        if (__classPrivateFieldGet2(this, _Channel_nextMessageIndex2, "f") === __classPrivateFieldGet2(this, _Channel_messageEndIndex2, "f")) {
          this.cleanupCallback();
        }
      } else {
        __classPrivateFieldGet2(this, _Channel_pendingMessages2, "f")[index] = message;
      }
    });
  }
  cleanupCallback() {
    window.__TAURI_INTERNALS__.unregisterCallback(this.id);
  }
  set onmessage(handler) {
    __classPrivateFieldSet2(this, _Channel_onmessage2, handler, "f");
  }
  get onmessage() {
    return __classPrivateFieldGet2(this, _Channel_onmessage2, "f");
  }
  [(_Channel_onmessage2 = new WeakMap, _Channel_nextMessageIndex2 = new WeakMap, _Channel_pendingMessages2 = new WeakMap, _Channel_messageEndIndex2 = new WeakMap, SERIALIZE_TO_IPC_FN2)]() {
    return `__CHANNEL__:${this.id}`;
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN2]();
  }
}
async function invoke2(cmd, args = {}, options) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}
_Resource_rid2 = new WeakMap;

// src/ts/version.ts
var VERSION_KEY = "lol_patch_version";
var FALLBACK_VERSION = "14.23.1";
function getCurrentPatchVersion() {
  return localStorage.getItem(VERSION_KEY) || FALLBACK_VERSION;
}
// src/assets/fallback_mappings.json
var fallback_mappings_default = {
  AkshanW: {
    "spell_akshanw_tooltip_{{ gamemodeinteger": "1"
  },
  AlistarE: {
    totaldamage: "80/110/140/170/200",
    attackbonusdamage: "50"
  },
  AmbessaW: {
    calc_shield: "50~320 (+150% AD)"
  },
  BandageToss: {
    totaldamage: "70/95/120/145/170"
  },
  Tantrum: {
    tantrumdamage: "5/7/9/11/13"
  },
  FlashFrost: {
    "spell.glacialstorm:slowamount": "20/30/40/50/60"
  },
  AnnieE: {
    movespeedcalc: "20~50"
  },
  ApheliosR: {
    "spell_apheliosr_weaponmod_{{ f1": ""
  },
  AsheQ: {
    empowereddamage: "4"
  },
  AsheSpiritOfTheHawk: {
    chargecooldown: "3"
  },
  AurelionSolQ: {
    burstbonustruedamagetochamps: "0.03%"
  },
  AzirQWrapper: {
    totaldamage: "60/80/100/120/140"
  },
  AzirW: {
    maxammo: "10"
  },
  BardW: {
    f1: "3",
    f2: "5"
  },
  BelvethQ: {
    f1: "10/15/20/25/30 (+100% AD)"
  },
  BelvethE: {
    "f2.0": "6"
  },
  PowerFist: {
    totaldamage: "175% AD"
  },
  BriarW: {
    totalaoedamage: "+60/70/80/90/100% AD",
    attackmaxhpheal: "+5% BonusHP"
  },
  BriarE: {
    percentmaxhpheal: "5/5.5/6/6.5/7"
  },
  BriarR: {
    totalresists: "+20% AD"
  },
  CaitlynW: {
    ammorechargetime: "2"
  },
  CamilleQ: {
    bonusdamage: "20/25/30/35/40 (+20/25/30/35/40% AD)",
    empoweredbonusdamage: "+20/25/30/35/40% AD",
    damageconversionpercentage: "40~504"
  },
  CassiopeiaQ: {
    tooltiptotaldamage: "75/110/145/180/215"
  },
  CassiopeiaW: {
    damagepersecond: "40/50/60/70/80"
  },
  CassiopeiaE: {
    basicdamage: "52~120 (+10% Stat)",
    healcalc: "+10/11.5/13/14.5/16% Stat",
    healcalcminion: "+10/11.5/13/14.5/16% Stat"
  },
  FeralScream: {
    totaldamagetooltip: "+70% Stat"
  },
  MissileBarrage: {
    attackrefund: "1"
  },
  DariusCleave: {
    bladedamage: "100/110/120/130/140",
    handledamage: "50/80/110/140/170"
  },
  DariusNoxianTacticsONH: {
    empoweredattackdamage: "141/152.5/164/175.5/187% AD"
  },
  DravenRCast: {
    rpassivetruedamage: "1"
  },
  DrMundoQ: {
    healthrestoreonhitchampionmonster: "40/50/60/70/80",
    healthrestoreonhitminion: "20/25/30/35/40"
  },
  DrMundoW: {
    grayhealthstorageinitial: "80~95%"
  },
  DrMundoE: {
    passivebonusad: "最大体力の1.7/2/2.3/2.6/2.9%"
  },
  EkkoW: {
    e0: "2.25",
    totalshield: "3"
  },
  EkkoE: {
    totaldamage: "50/75/100/125/150"
  },
  EliseHumanW: {
    "spell.elisehumanw:totaldamage": "4"
  },
  EvelynnR: {
    damage: "125/250/375",
    critdamage: "2.5"
  },
  EzrealR: {
    "damagereductionwaveclear.0*100": "0.5"
  },
  FioraR: {
    "spell.fiorapassive:rdamagetotal": "0.12"
  },
  FizzQ: {
    qdamage: "10/25/40/55/70"
  },
  GalioW: {
    passiveshieldooctimer: "25/30/35/40/45",
    totalpassiveshield: "2",
    magicdamagereduction: "15",
    physicaldamagereduction: "0.5"
  },
  GangplankQWrapper: {
    "spell_gangplankqwrapper_tooltip_{{ gamemodeinteger": "10/40/70/100/130"
  },
  GangplankW: {
    basehealth: "45/70/95/120/145"
  },
  GangplankE: {
    e0: "3/3/4/4/5",
    barreldecaytime: "2"
  },
  GarenW: {
    resistsfortooltip: "0.25"
  },
  GarenE: {
    f1: "25"
  },
  GnarQ: {
    "spell.gnarq:minitotaldamage": "5/45/85/125/165 (+125% AD)",
    "spell.gnarq:slowduration": "2",
    "spell.gnarq:slowamount*100": "0.15/0.2/0.25/0.3/0.35",
    "spell.gnarq:minicdrefund*100": "0.4"
  },
  GnarW: {
    "spell.gnarw:minitotaldamage": "0/10/20/30/40 (+100% Stat)",
    "spell.gnarw:minipercenthpdamage*100": "0.06/0.08/0.1/0.12/0.14",
    "spell.gnarr:rhypermovementspeedpercent": "40/60/80/100/120",
    "spell.gnarw:minihasteduration": "3"
  },
  GnarE: {
    "spell.gnare:miniasduration": "6",
    "spell.gnare:minibas*100": "0.4/0.45/0.5/0.55/0.6",
    "spell.gnare:minitotaldamage": "50/85/120/155/190 (+6% BonusHP)",
    "spell.gnare:movespeedmod*-100": "-0.8"
  },
  GragasQ: {
    "effect2amount*1.5": "80/120/160/200/240"
  },
  HeimerdingerE: {
    "slowpercent.0*100": "35"
  },
  HweiQ: {
    "spell.hweiqe:duration": "2.5",
    "spell.hweiqe:slowpercent": "30"
  },
  HweiW: {
    "spell.hweiww:tooltipallymod*100": "15"
  },
  IllaoiQ: {
    "spell.illaoiq:tentacledamageamp*100": "0.1/0.15/0.2/0.25/0.3",
    "spell.illaoiq:tentacledamagetotal": "9~180 (+110% AD +40% Stat)"
  },
  IllaoiE: {
    timebetweenvesseltentacleslams: "4"
  },
  IllaoiR: {
    "spell.illaoiw:cooldownduringr": "2"
  },
  IreliaQ: {
    healamount: "+9/10/11/12/13% AD"
  },
  IreliaW: {
    finalphysicaldr: "40~70",
    finalmagicdr: "7~12"
  },
  SowTheWind: {
    "spell.tailwindself:bonusdamage": "25/30/35/40/45% 増加移動速度"
  },
  JarvanIVGoldenAegis: {
    baseshield: "+70% AD",
    bonusshield: "+1.3% BonusHP"
  },
  JarvanIVDemacianStandard: {
    totaldamage: "80/120/160/200/240 (+80% AP)"
  },
  JayceToTheSkies: {
    "spell.jaycetotheskies:damage": "60/110/160/210/260 (+135% AD)",
    "spell.jaycetotheskies:slowduration": "-0.35/-0.4/-0.45/-0.5/-0.55",
    "spell.jaycetotheskies:slow*-100": "-0.35/-0.4/-0.45/-0.5/-0.55"
  },
  JayceStaticField: {
    "spell.jaycestaticfield:managain": "15/17/19/21/23",
    "spell.jaycestaticfield:duration": "4",
    "spell.jaycestaticfield:damage": "140/200/260/320/380"
  },
  JayceThunderingBlow: {
    "spell.jaycethunderingblow:flatdamage": "+100% AD",
    "spell.jaycethunderingblow:perchpdamage*100": "0.08/0.11/0.14/0.16/0.19"
  },
  JayceStanceHtG: {
    "spell.jaycestancehtg:shredduration": "5",
    "spell.jaycestancehtg:rangedformshred": "20~35"
  },
  JhinQ: {
    tooltipmaxtargetshit: "4"
  },
  JhinE: {
    ammorechargeratetooltip: "28/27/26/25/24"
  },
  JinxQ: {
    rocketdamage: "110% AD"
  },
  KaisaQ: {
    maxdamagedisplay: "90/123.75/157.5/191.25/225",
    "f11.1": "12/11/10/9/8"
  },
  KaisaW: {
    totaldamage: "30/55/80/105/130 (+130% AD +45% AP)",
    "spell.kaisapassive:pduration": "4"
  },
  KaisaE: {
    "f10.1": "8",
    totalmovespeed: "55/60/65/70/75"
  },
  KatarinaEWrapper: {
    daggercooldownreduction: "0.8~1",
    tooltipdaggerreduction: "78~96"
  },
  KatarinaR: {
    addamagecalc: "25/37.5/50/62.5/75",
    totaladdamagecalc: "25/37.5/50/62.5/75"
  },
  KayleE: {
    "spell.kaylepassive:levelforpassiverank2": "11"
  },
  KaynQ: {
    totaldamage: "75/105/135/165/195",
    darkinflatdamage: "5"
  },
  KaynW: {
    totaldamage: "1"
  },
  KaynE: {
    totalhealing: "40"
  },
  KennenShurikenHurlMissile1: {
    totaldamage: "75/125/175/225/275"
  },
  KhazixQ: {
    "spell.khazixq:basedamage": "+110% AD",
    "spell.khazixq:isodamage": "+110% AD"
  },
  KhazixW: {
    basedamage: "65/100/135/170/205"
  },
  KhazixE: {
    totaldamage: "65/100/135/170/205 (+20% AD)"
  },
  KhazixR: {
    "spell.khazixq:effect4amount": "10",
    "spell.khazixw:effect3amount": "4"
  },
  KindredQ: {
    totaldamage: "40/65/90/115/140",
    totalqattackspeed: "500"
  },
  KindredW: {
    attackheal: "1"
  },
  KSanteQ: {
    "rcooldownreduction.0*100": "33.3"
  },
  LeblancQ: {
    bonusminiondamage: "10~146"
  },
  LeonaShieldOfDaybreak: {
    totaldamagetooltip: "1"
  },
  LeonaSolarBarrier: {
    bonusarmortooltip: "55/85/115/145/175",
    bonusmrtooltip: "20/27.5/35/42.5/50",
    totaldamagetooltip: "3"
  },
  LeonaZenithBlade: {
    totaldamagetooltip: "50/90/130/170/210"
  },
  LissandraW: {
    totaldamage: "70/105/140/175/210"
  },
  LissandraE: {
    totaldamage: "70/105/140/175/210"
  },
  LucianR: {
    totalnumshots: "22 (+25% クリティカル率)",
    totaldamage: "330/660/990 (+550% AD +330% AP)"
  },
  LuluW: {
    totalms: "0.25"
  },
  LuxLightStrikeKugel: {
    totaldamagett: "25/30/35/40/45"
  },
  Obduracy: {
    f1: "+10% 物理防御",
    f2: "+30% 物理防御"
  },
  MalzaharQ: {
    totaldamagetooltip: "70/105/140/175/210"
  },
  MalzaharE: {
    manarestore: "8",
    minionexecutethreshold: "2"
  },
  AlphaStrike: {
    subesquentdamage: "25% AD"
  },
  Meditate: {
    initialdr: "90"
  },
  MelQ: {
    initialexplosiondamage: "5/6/7/8/9",
    alldamagehit: "6/7/8/9/10 -1"
  },
  MonkeyKingSpinToWin: {
    totaldamagett: "+137.5% AD"
  },
  MordekaiserW: {
    minhealthtooltip: "5/5.5/6/6.5/7",
    maxhealthtooltip: "17.5/20/22.5/25/27.5"
  },
  NaafiriQ: {
    "spell.naafiriq:totaldamagefirstcast": "35/40/45/50/55 (+20% AD)",
    "spell.naafiriq:bleedduration": "5",
    "spell.naafiriq:totalbleeddamage": "35/60/85/110/135 (+80% AD)",
    "spell.naafiriq:totalmindamagesecondcast": "30/45/60/75/90 (+40% AD)",
    "spell.naafiriq:totalmaxdamagesecondcast": "30/45/60/75/90 (+70% AD)",
    "spell.naafiriq:totalhealsecondcast": "45/60/75/90/105 (+40% AD)",
    "spell.naafirip:packmatetauntduration": "2"
  },
  NaafiriR: {
    bonusad: "+20% AD"
  },
  NasusE: {
    initialdamage: "10/16/22/28/34",
    totaldotdamage: "30/35/40/45/50"
  },
  Bushwhack: {
    damagepersecond: "4",
    maxtraps: "13/12/11/10/9"
  },
  NilahQ: {
    critlifesteal: "+20% CritDmg",
    bonusattackspeedcalc: "10~60"
  },
  NilahR: {
    champhealingpercent: "20 (+10% CritDmg)",
    "spell.nilahq:critlifesteal": "+20% CritDmg"
  },
  NocturneUnspeakableHorror: {
    totaldamage: "1.25/1.5/1.75/2/2.25"
  },
  NunuE: {
    rootduration: "0.5~1.5"
  },
  OlafRecklessStrike: {
    totaldamage: "70/115/160/205/250"
  },
  OrianaIzunaCommand: {
    totaldamagetooltip: "60/90/120/150/180"
  },
  OrianaRedactCommand: {
    totalshieldtooltip: "55/90/125/160/195",
    totaldamagetooltip: "6/12/18/24/30"
  },
  OrnnW: {
    brittlepercentmaxhpcalc: "10~18"
  },
  OrnnR: {
    minstun: "0.5"
  },
  PantheonQ: {
    empowereddamagecalc: "20~240",
    executedamagecalcmodified: "155% AD"
  },
  PantheonW: {
    empowereddamagemultcalcmodified: "+0.4~0.55% AD"
  },
  PantheonE: {
    resistscalc: "5~30 (+2.5% AD)"
  },
  PantheonR: {
    "spell.pantheonq:holddamagecalc": "300/500/700/900/1100 (+100% Stat)"
  },
  PoppyQ: {
    basedamage: "0.5"
  },
  PoppyW: {
    bonusarmor: "2",
    bonusmr: "40",
    interruptdamage: "10"
  },
  PoppyE: {
    tackledamage: "40/60/80/100/120"
  },
  PykeW: {
    movespeed: "45",
    e0: "80"
  },
  PykeR: {
    reduceddamagefinal: "250 (+80% AD +150% APFlat)"
  },
  QuinnE: {
    totaldamage: "50"
  },
  RakanQ: {
    totalheal: "40~210 (+55% Stat)"
  },
  RakanR: {
    totaldamagetooltip: "100/200/300"
  },
  PowerBall: {
    minimummovespeed: "25~39.1",
    maximummovespeed: "235~350"
  },
  DefensiveBallCurl: {
    bonusarmortooltip: "30 (+60% 物理防御)",
    bonusmrtooltip: "10 (+30% 魔法防御)",
    returndamagecalc: "10~30 (+10% 物理防御)"
  },
  Tremors2: {
    "spell.powerball:powerballdamage": "80/120/160/200/240"
  },
  RekSaiQ: {
    totaldamagetooltip: "75/112.5/150/187.5/225 (+50% AD)"
  },
  RekSaiE: {
    "spell.reksaie:basedamage": "100/135/170/205/240",
    "spell.reksaie:empowereddamage": "100/135/170/205/240"
  },
  RellW_Dismount: {
    "spell.rellw_dismount:mountedmovespeed": "20/25/30/35/40",
    "spell.rellw_dismount:dismountdamage": "60/90/120/150/180 (+60% Stat)",
    "spell.rellw_dismount:shield": "20/40/60/80/100 (+11% BonusHP)",
    "spell.rellw_dismount:resistanceincrease*100": "0.15",
    "spell.rellw_dismount:dismountedasboost*100": "0.2",
    "spell.rellw_dismount:dismountedrangeboost": "75"
  },
  RengarQ: {
    empoweredqtotaldamage: "35~290 (+100% AD +20% AD)",
    empoweredqas: "5000~10100"
  },
  RengarW: {
    totaldamageempowered: "+80% Stat"
  },
  RengarE: {
    totalempowereddamage: "50~305 (+80% AD)"
  },
  RengarR: {
    bonusdamage: "50% AD"
  },
  RivenMartyr: {
    totaldamage: "65/95/125/155/185"
  },
  RivenFeint: {
    totalshield: "70/95/120/145/170"
  },
  RumbleFlameThrower: {
    monstercap: "65~300"
  },
  RumbleShield: {
    "shieldduration.1": "10/15/20/25/30"
  },
  RyzeQWrapper: {
    "spell.ryzer:overloaddamagebonus": "2"
  },
  SejuaniR: {
    minordamagetooltip: "125/150/175",
    totaldamagetooltip: "1"
  },
  SettW: {
    f1: "最大25% (+100 増加ADごとに20%)",
    maxgrit: "最大25% (+増加AD100ごとに20%)"
  },
  Deceive: {
    qcritdamagemod: "100 +100% CDR -100"
  },
  JackInTheBox: {
    trapduration: "0.5/0.75/1/1.25/1.5"
  },
  ShenQ: {
    baseflatdamage: "3",
    basepercenthealth: "2/2.5/3/3.5/4",
    emppercenthealth: "25/30/35/40/45"
  },
  ShenE: {
    energyrefund: "30~50"
  },
  ShyvanaDoubleAttack: {
    secondhitdamagecalc: "0.2/0.4/0.6/0.8/1",
    firsthitdamagecalc: "100% AD"
  },
  ShyvanaFireball: {
    dragonexplosioncalc: "75 (+20% Stat +50% AD)",
    dragondamagetotalcalc: "40 (+20% Stat +30% AD)"
  },
  Fling: {
    basedamage: "50/60/70/80/90"
  },
  SionW: {
    totalshield: "60/75/90/105/120",
    totaldamage: "40/65/90/115/140"
  },
  SivirW: {
    bouncedamage: "+40/42.5/45/47.5/50% AD"
  },
  SivirE: {
    totalheal: "1.5"
  },
  SkarnerQ: {
    "spell.skarnerq:abilitydamage": "10/20/30/40/50",
    "spell.skarnerq:maxhppercent*100": "9",
    "spell.skarnerq:slowduration": "1",
    "spell.skarnerq:slowpercent*100": "40"
  },
  SmolderQ: {
    "spell.smolderp:passive_qdamageincrease": "0.4"
  },
  SmolderW: {
    "spell.smolderp:passive_wdamageincrease": "0.55"
  },
  SmolderE: {
    "spell.smolderp:ebonusdamage": "0.12"
  },
  SonaQ: {
    totalstaccatodamage: "30~285 (+30% Stat)"
  },
  SonaW: {
    totaldiminuendoweakenpercent: "25"
  },
  SonaE: {
    totaltempomovespeedslow: "50"
  },
  SorakaW: {
    "spell.sorakaq:hotduration": "2.5"
  },
  SylasR: {
    pertargetcooldown: "200"
  },
  SyndraQ: {
    "spell.syndrapassive:q1upgradethreshold": "40"
  },
  SyndraW: {
    "spell.syndrapassive:wupgradethreshold": "60",
    f2: "12/11/10/9/8",
    tooltiponlypassivebonuspercent: "1200"
  },
  SyndraE: {
    "spell.syndrapassive:eupgradethreshold": "80"
  },
  SyndraR: {
    "spell.syndrapassive:rupgradethreshold": "100"
  },
  TahmKenchQ: {
    "spell.tahmkenchpassive:totaldamage": "75/120/165/210/255 (+100% Stat)"
  },
  TahmKenchE: {
    greyhealthhealingratio: "45~100"
  },
  TalonQ: {
    totalhealing: "9~55"
  },
  TaricW: {
    bonusarmor: "2.5"
  },
  TaricE: {
    totaldamage: "90/130/170/210/250"
  },
  TeemoR: {
    ammorechargetime: "30/25/20"
  },
  ThreshE: {
    pattackdamagemin: "75/120/165/210/255",
    pattackdamagemax: "20/25/30/35/40",
    totaldamage: "1"
  },
  ThreshRPenta: {
    totaldamage: "250/400/550"
  },
  TwitchExpunge: {
    magicdamageperstack: "+35% Stat",
    maxmagicdamage: "+35% Stat"
  },
  UdyrQ: {
    empoweredlightningbonusmax: "1.5~3 × 100 600 -100 × 100"
  },
  UdyrW: {
    lifeonhitawakened: "+1.2% BonusHP +8% Stat"
  },
  UdyrE: {
    movespeedbonus: "30~40"
  },
  UdyrR: {
    pulsedamage: "10~40 (+35% Stat)",
    percenthpblast: "8~14",
    empoweredslow: "5%"
  },
  VayneTumble: {
    adratiobonus: "+75/85/95/105/115% AD +50% Stat"
  },
  VeigarBalefulStrike: {
    "spell.veigarpassive:dqkillstacks": "1",
    "spell.veigarpassive:dqkillstackslarge": "2"
  },
  VeigarDarkMatter: {
    "spell.veigarpassive:pstacksperdarkmattercdr": "1.2",
    "spell.veigarpassive:darkmattercdrincrement*100": "8"
  },
  VelkozW: {
    ammorechargetime: "1.5"
  },
  VelkozR: {
    totaldamage: "500/725/950 (+150% AP)"
  },
  VexR: {
    "spell.vexr:recastdamagecalc": "150/250/350/450/550",
    "spell.vexr:rdamagecalc": "75/125/175/225/275",
    "spell.vexr:takedownwindow": "6"
  },
  ViW: {
    "spell.vipassive:cdreductionon3hit": "4"
  },
  ViE: {
    ammorechargetime: "50"
  },
  ViegoQ: {
    secondattackdamage: "+20% AD +15% Stat"
  },
  ViegoR: {
    totaldamage: "120% AD"
  },
  ViktorQ: {
    shieldlevelscaling: "2.5",
    totalaugmentedshieldvalue: "30"
  },
  VladimirQ: {
    basedamagetooltip: "80/100/120/140/160",
    basehealtooltip: "20/25/30/35/40",
    movementspeedonq2: "5",
    empowereddamagetooltip: "85",
    empoweredhealtooltip: "2.5",
    empoweredhealpercenttooltip: "35"
  },
  VladimirE: {
    chargehealthtooltip: "8",
    mindamagetooltip: "30/45/60/75/90",
    maxdamagetooltip: "6"
  },
  VladimirHemoplague: {
    damage: "10",
    secondaryhealingtooltip: "100"
  },
  VolibearE: {
    shieldapratiotooltip: "+75% Stat"
  },
  WarwickQ: {
    basebitedamage: "25/37.5/50/62.5/75"
  },
  XerathMageSpear: {
    tooltiptotaldamage: "70/100/130/160/190"
  },
  XinZhaoQ: {
    bonusdamage: "16/25/34/43/52 (+40% AD)"
  },
  XinZhaoE: {
    chargedamage: "+60% Stat"
  },
  YorickE: {
    "spell.yorickpassive:yorickpassiveghoulmax": "4"
  },
  YorickR: {
    yorickbigghoulhealth: "1050"
  },
  YunaraQ: {
    calc_damage_spread: "5/10/15/20/25",
    "spell.yunarar:buff_duration": "5"
  },
  YunaraW: {
    "spell.yunarar:calc_rw_damage": "160/320/480/640/800",
    "spell.yunarar:rw_slow_duration": "1",
    "spell.yunarar:calc_rw_slow_amount": "0.99"
  },
  YuumiW: {
    ccattachlockout: "5"
  },
  ZaahenW: {
    secondarydamage: "+50% AD"
  },
  ZacE: {
    maxstun: "60/105/150/195/240",
    damage: "4"
  },
  ZedR: {
    rcalculateddamage: "100% AD"
  },
  ZeriR: {
    chainphysicaldamage: "10/15/20"
  },
  ZoeW: {
    e0: "60"
  },
  ZyraQ: {
    initialdamage: "60/100/140/180/220",
    "spell.zyrap:plantdamage": "15~75 (+20% Stat)",
    "spell.zyrap:plantduration": "8"
  },
  ZyraW: {
    ammorechargetime: "35"
  },
  ZyraE: {
    "spell.zyrap:plantdamage": "60/95/130/165/200",
    "spell.zyrap:plantduration": "30"
  },
  ZyraR: {
    totaldamage: "1"
  }
};

// src/ts/tooltip.ts
var dynamicTooltipFallback = {};
async function initTooltipFallback() {
  try {
    const cacheDir = "tooltip_cache";
    const filePath = `${cacheDir}/tooltip_variable_fallback.json`;
    const verPath = `${cacheDir}/tooltip_version.txt`;
    const currentVersion = getCurrentPatchVersion();
    let shouldExtract = false;
    if (!await exists(verPath, { baseDir: BaseDirectory.AppLocalData })) {
      shouldExtract = true;
    } else {
      const rawVer = await readFile(verPath, { baseDir: BaseDirectory.AppLocalData });
      const savedVersion = new TextDecoder().decode(rawVer);
      if (savedVersion !== currentVersion) {
        console.log("Patch version changed. Re-extracting WADs...");
        shouldExtract = true;
      }
    }
    if (!await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
      shouldExtract = true;
    }
    if (shouldExtract) {
      console.log("Starting background WAD extraction...");
      await invoke2("update_champion_data");
      await writeFile(verPath, new TextEncoder().encode(currentVersion), { baseDir: BaseDirectory.AppLocalData });
    }
    if (await exists(filePath, { baseDir: BaseDirectory.AppLocalData })) {
      const raw = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
      const str = new TextDecoder().decode(raw);
      const generated = JSON.parse(str);
      dynamicTooltipFallback = { ...generated };
      const manualFallbackMappings = fallback_mappings_default;
      for (const spellId of Object.keys(manualFallbackMappings)) {
        if (!dynamicTooltipFallback[spellId]) {
          dynamicTooltipFallback[spellId] = {};
        }
        for (const k of Object.keys(manualFallbackMappings[spellId])) {
          dynamicTooltipFallback[spellId][k] = manualFallbackMappings[spellId][k];
        }
      }
      console.log("Loaded dynamic tooltip fallbacks:", Object.keys(dynamicTooltipFallback).length, "spells");
    }
  } catch (e) {
    console.error("Failed to init tooltip fallbacks:", e);
  }
}
var globalTooltip = null;
var currentTooltipTarget = null;
var globalTooltipObserver = null;
var globalTooltipMoveListener = null;
function showGlobalTooltip(target, html) {
  if (!globalTooltip) {
    globalTooltip = document.createElement("div");
    globalTooltip.className = "league-tooltip";
    globalTooltip.style.position = "fixed";
    globalTooltip.style.background = "rgba(10, 20, 30, 0.95)";
    globalTooltip.style.color = "#eee";
    globalTooltip.style.padding = "10px";
    globalTooltip.style.borderRadius = "4px";
    globalTooltip.style.border = "1px solid #c8aa6e";
    globalTooltip.style.zIndex = "999999";
    globalTooltip.style.width = "max-content";
    globalTooltip.style.maxWidth = "min(800px, 90vw)";
    globalTooltip.style.fontSize = "16px";
    globalTooltip.style.lineHeight = "1.4";
    globalTooltip.style.pointerEvents = "none";
    document.body.appendChild(globalTooltip);
  }
  currentTooltipTarget = target;
  globalTooltip.innerHTML = html;
  globalTooltip.style.display = "block";
  const rect = target.getBoundingClientRect();
  let left = rect.left + rect.width / 2;
  let top = rect.top - 10;
  globalTooltip.style.bottom = "";
  globalTooltip.style.overflowY = "hidden";
  globalTooltip.style.left = `${left}px`;
  globalTooltip.style.top = `${top}px`;
  globalTooltip.style.transform = "translate(-50%, -100%)";
  requestAnimationFrame(() => {
    if (!globalTooltip)
      return;
    const tooltipRect = globalTooltip.getBoundingClientRect();
    if (tooltipRect.top < 10) {
      globalTooltip.style.top = `${rect.bottom + 10}px`;
      globalTooltip.style.transform = "translate(-50%, 0)";
      const newTooltipRect = globalTooltip.getBoundingClientRect();
      if (newTooltipRect.bottom > window.innerHeight - 10) {
        globalTooltip.style.top = "auto";
        globalTooltip.style.bottom = "10px";
        globalTooltip.style.transform = "translate(-50%, 0)";
      }
    }
    if (tooltipRect.left < 10) {
      globalTooltip.style.left = `10px`;
      globalTooltip.style.transform = globalTooltip.style.transform.replace("-50%", "0");
    } else if (tooltipRect.right > window.innerWidth - 10) {
      globalTooltip.style.left = `${window.innerWidth - tooltipRect.width - 10}px`;
      globalTooltip.style.transform = globalTooltip.style.transform.replace("-50%", "0");
    }
  });
  if (globalTooltipObserver)
    globalTooltipObserver.disconnect();
  const observeRoot = target.parentElement ?? document.body;
  globalTooltipObserver = new MutationObserver(() => {
    if (currentTooltipTarget && !document.contains(currentTooltipTarget)) {
      hideGlobalTooltip();
    }
  });
  globalTooltipObserver.observe(observeRoot, { childList: true, subtree: true });
  if (globalTooltipMoveListener) {
    document.removeEventListener("mousemove", globalTooltipMoveListener);
  }
  let lastMoveCheck = Date.now();
  globalTooltipMoveListener = (e) => {
    const now = Date.now();
    if (now - lastMoveCheck < 100)
      return;
    lastMoveCheck = now;
    if (!currentTooltipTarget)
      return;
    const r = currentTooltipTarget.getBoundingClientRect();
    if (e.clientX < r.left - 5 || e.clientX > r.right + 5 || e.clientY < r.top - 5 || e.clientY > r.bottom + 5) {
      hideGlobalTooltip();
    }
  };
  document.addEventListener("mousemove", globalTooltipMoveListener, { passive: true });
}
function hideGlobalTooltip() {
  if (globalTooltip) {
    globalTooltip.style.display = "none";
    currentTooltipTarget = null;
    if (globalTooltipObserver) {
      globalTooltipObserver.disconnect();
      globalTooltipObserver = null;
    }
    if (globalTooltipMoveListener) {
      document.removeEventListener("mousemove", globalTooltipMoveListener);
      globalTooltipMoveListener = null;
    }
  }
}
function buildSummonerSpellTooltipHtml(spellData) {
  return `<b style="color:#c8aa6e; font-size: 13px;">${spellData.name}</b><br>
    <span style="color:#aaa; font-size: 13px;">Cooldown: ${spellData.cooldownBurn}s</span><hr style="border-color:#333; margin:5px 0;">
    <div style="font-size: 13px; color:#ddd;">${spellData.description}</div>`;
}
function buildItemTooltipHtml(itemData) {
  return `<b style="color:#c8aa6e; font-size: 13px;">${itemData.name}</b><br>
    <div style="color:#aaa; font-size: 13px; margin-bottom: 5px;">Cost: <span style="color:#e8d154">${itemData.gold?.total || 0}g</span></div>
    <div style="font-size: 13px; color:#ddd; max-width: 250px;">${itemData.description}</div>`;
}
function buildTrinketTooltipHtml(itemData) {
  return `<b style="color:#c8aa6e; font-size: 13px;">${itemData.name}</b><br>
    <div style="font-size: 13px; color:#ddd; max-width: 250px;">${itemData.description}</div>`;
}
function buildRuneTooltipHtml(runeData) {
  if (!runeData)
    return "";
  let desc = runeData.longDesc || runeData.shortDesc || "";
  desc = desc.replace(/<lol-uikit-tooltipped-keyword[^>]*>/gi, '<span style="color:#00bcd4; font-weight:bold; border-bottom: 1px dotted #00bcd4;">');
  desc = desc.replace(/<\/lol-uikit-tooltipped-keyword>/gi, "</span>");
  desc = desc.replace(/<font color='([^']*)'>/gi, '<span style="color:$1;">');
  desc = desc.replace(/<\/font>/gi, "</span>");
  return `
    <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <img src="https://ddragon.leagueoflegends.com/cdn/img/${runeData.icon}" style="width: 32px; height: 32px; margin-right: 10px; border-radius: 50%;">
        <b style="color:#c8aa6e; font-size: 15px;">${runeData.name}</b>
    </div>
    <div style="font-size: 13px; color:#ddd; max-width: 300px; line-height: 1.4;">${desc}</div>
    `;
}
function buildChampionTooltipHtml(data, lang = "ja") {
  if (!data || !data.spells)
    return "";
  let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 5px; margin-bottom: 8px;">
            <div>
                <b style="color:#c8aa6e; font-size: 16px;">${data.name}</b> 
                <span style="color:#aaa; font-size: 12px; margin-left: 5px;">${data.title}</span>
            </div>
            <div style="color: #888; font-size: 11px;">${(data.tags || []).join(", ")}</div>
        </div>`;
  if (data.passive) {
    html += `
        <div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px dashed #333;">
            <b style="color:#ffeb3b; font-size: 13px;">[Passive] ${data.passive.name}</b><br>
            <div style="font-size: 12px; margin-top:2px; color:#ccc; line-height: 1.3;">${data.passive.description}</div>
        </div>`;
  }
  for (let i = 0;i < data.spells.length; i++) {
    const spell = data.spells[i];
    const key = ["Q", "W", "E", "R"][i];
    const costText = spell.costBurn && spell.costBurn !== "0" ? `Cost: ${spell.costBurn}` : "No Cost";
    let detailItems = [];
    const cleanStat = (val) => {
      if (typeof val === "number")
        return Math.round(val * 100) / 100;
      if (typeof val === "string" && !isNaN(Number(val)))
        return Math.round(Number(val) * 100) / 100;
      return val;
    };
    if (spell.cd_castRange)
      detailItems.push(`Range: ${cleanStat(spell.cd_castRange)}`);
    if (spell.cd_castTime)
      detailItems.push(`Cast: ${cleanStat(spell.cd_castTime)}s`);
    if (spell.cd_lineWidth)
      detailItems.push(`Width: ${cleanStat(spell.cd_lineWidth)}`);
    if (spell.cd_missileSpeed)
      detailItems.push(`Speed: ${cleanStat(spell.cd_missileSpeed)}`);
    const detailsHtml = detailItems.length > 0 ? `<span style="margin-left: 10px; font-weight: normal; font-size: 11px; color:#888;">${detailItems.join("&nbsp; ")}</span>` : "";
    html += `
        <div style="margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
                <div>
                    <b style="color:#00d2ff; font-size: 13px;">[${key}]</b> 
                    <span style="color:#eee; font-size: 13px; font-weight: bold;">${spell.name}</span>${detailsHtml}
                </div>
                <div style="color:#aaa; font-size: 11px; text-align: right;">
                    <span style="color:#ffb74d;">${costText}</span> | CD: ${spell.cooldownBurn}s
                </div>
            </div>`;
    let descriptionHtml = spell.tooltip || spell.description;
    if (spell.id === "GangplankQWrapper") {
      descriptionHtml = (spell.description || "") + "<br><br><physicalDamage>{{ e1 }} (+100% AD)</physicalDamage> <gold>(+{{ e2 }} Gold)</gold>";
    }
    const originalHasTemplate = /\{\{.*?\}\}/.test(descriptionHtml);
    const resolveVar = (key2) => {
      key2 = key2.toLowerCase();
      if (key2.startsWith("e")) {
        const idx = parseInt(key2.substring(1), 10);
        if (!isNaN(idx) && spell.effectBurn && spell.effectBurn[idx]) {
          return [spell.effectBurn[idx]];
        }
      }
      if (spell.vars) {
        for (const v of spell.vars) {
          if (v.key && v.key.toLowerCase() === key2) {
            return v.coeff;
          }
        }
      }
      if (spell.cd_dataValuesMap) {
        if (spell.cd_dataValuesMap[key2])
          return spell.cd_dataValuesMap[key2];
        for (const k of Object.keys(spell.cd_dataValuesMap)) {
          if (k === `m${key2}` || k.includes(key2))
            return spell.cd_dataValuesMap[k];
        }
      }
      if (spell.cd_baseMap) {
        if (spell.cd_baseMap[key2])
          return spell.cd_baseMap[key2];
        for (const k of Object.keys(spell.cd_baseMap)) {
          if (k === `m${key2}` || k.includes(key2))
            return spell.cd_baseMap[k];
        }
      }
      if (key2.length > 2 && /^[qwer]/i.test(key2)) {
        const noPrefix = key2.substring(1);
        if (spell.cd_dataValuesMap) {
          if (spell.cd_dataValuesMap[noPrefix])
            return spell.cd_dataValuesMap[noPrefix];
          for (const k of Object.keys(spell.cd_dataValuesMap)) {
            if (k === `m${noPrefix}` || k.includes(noPrefix))
              return spell.cd_dataValuesMap[k];
          }
        }
        if (spell.cd_baseMap) {
          if (spell.cd_baseMap[noPrefix])
            return spell.cd_baseMap[noPrefix];
          for (const k of Object.keys(spell.cd_baseMap)) {
            if (k === `m${noPrefix}` || k.includes(noPrefix))
              return spell.cd_baseMap[k];
          }
        }
      }
      if (key2 === "cost")
        return [spell.costBurn];
      if (key2 === "cooldown")
        return [spell.cooldownBurn];
      if (spell.id === "DariusCleave") {
        if (key2 === "bladedamage" && spell.effect && spell.effect[2] && spell.effect[1]) {
          const base = spell.effect[2].join("/");
          const adRatio = spell.effect[1].join("/");
          return [`${base} + (${adRatio})AD%`];
        }
        if (key2 === "handledamage" && spell.effect && spell.effect[2] && spell.effect[1]) {
          const pctMult = spell.effect[6] && typeof spell.effect[6][0] === "number" ? spell.effect[6][0] / 100 : 0.35;
          const cleanNum = (n) => Math.round(n * 10) / 10;
          const handleBase = spell.effect[2].map((v) => cleanNum(v * pctMult)).join("/");
          const handleRatio = spell.effect[1].map((v) => cleanNum(v * pctMult)).join("/");
          return [`${handleBase} + (${handleRatio}%AD)`];
        }
      }
      if (spell.id === "DariusNoxianTacticsONH") {
        if (key2 === "empoweredattackdamage" && spell.effect && spell.effect[4]) {
          const adPct = spell.effect[4].map((v) => Math.round((v - 1) * 100)).join("/");
          return [`${adPct}%AD`];
        }
      }
      return null;
    };
    const evalMath = (expression, varsMap) => {
      try {
        let expr = expression;
        for (const [k, v] of Object.entries(varsMap)) {
          expr = expr.replace(new RegExp(`\\\\b${k}\\\\b`, "gi"), v);
        }
        if (!/^[0-9\\.\\+\\-\\*\\/\\(\\)\\s]+$/.test(expr))
          return null;
        const result = Function(`'use strict'; return (${expr})`)();
        return typeof result === "number" && !isNaN(result) ? result : null;
      } catch (e) {
        return null;
      }
    };
    const formatArrayObj = (ranks) => {
      if (!ranks || ranks.length === 0)
        return "?";
      let actualRanks = ranks;
      if (ranks.length > 5) {
        const maxRank = spell.maxrank || 5;
        actualRanks = ranks.slice(1, maxRank + 1);
      }
      if (actualRanks.length === 0)
        return "?";
      const cleanNum = (n) => {
        if (typeof n !== "number")
          return n;
        return Math.round(n * 100) / 100;
      };
      const cleanedRanks = actualRanks.map(cleanNum);
      const allSame = cleanedRanks.every((v) => v === cleanedRanks[0]);
      if (allSame)
        return cleanedRanks[0].toString();
      return cleanedRanks.join("/");
    };
    const fnv1a_32 = (s) => {
      let h = 2166136261;
      const lower = s.toLowerCase();
      for (let i2 = 0;i2 < lower.length; i2++) {
        h ^= lower.charCodeAt(i2);
        h = Math.imul(h, 16777619);
        h >>>= 0;
      }
      return "{" + h.toString(16).padStart(8, "0") + "}";
    };
    descriptionHtml = descriptionHtml.replace(/\{\{\s*(.*?)\s*\}\}/gi, (match, p1, offset, fullStr) => {
      const expr = p1.trim().toLowerCase();
      if (expr === "spellmodifierdescriptionappend")
        return "";
      const fbMap = dynamicTooltipFallback[spell.id] || {};
      if (fbMap && Object.keys(fbMap).length > 0) {
        const rawExpr = p1.trim();
        let directVal = undefined;
        const fnvHash = fnv1a_32(expr);
        if (fbMap[rawExpr] !== undefined)
          directVal = fbMap[rawExpr];
        else if (fbMap[expr] !== undefined)
          directVal = fbMap[expr];
        else if (fbMap[fnvHash] !== undefined)
          directVal = fbMap[fnvHash];
        else {
          const key2 = expr.split(/\s*[\*\/\+\-]\s*/)[0];
          const keyHash = fnv1a_32(key2);
          if (fbMap[key2] !== undefined)
            directVal = fbMap[key2];
          else if (fbMap[keyHash] !== undefined)
            directVal = fbMap[keyHash];
          else {
            const noSuffix = key2.split(".")[0];
            const noSuffixHash = fnv1a_32(noSuffix);
            if (fbMap[noSuffix] !== undefined)
              directVal = fbMap[noSuffix];
            else if (fbMap[noSuffixHash] !== undefined)
              directVal = fbMap[noSuffixHash];
          }
        }
        if (directVal !== undefined) {
          let valStr = directVal ? String(directVal) : "";
          const matchMath = p1.match(/\s*([\*\/\+\-])\s*([\d\.]+)/);
          if (matchMath) {
            const op = matchMath[1];
            const num = parseFloat(matchMath[2]);
            if (!isNaN(num)) {
              valStr = valStr.split("/").map((s) => {
                const v = parseFloat(s);
                if (isNaN(v))
                  return s;
                let res = v;
                if (op === "*")
                  res *= num;
                else if (op === "/")
                  res /= num;
                else if (op === "+")
                  res += num;
                else if (op === "-")
                  res -= num;
                const suffix = s.replace(/^[\-\d\.]+/, "");
                return String(Math.round(res * 100) / 100) + suffix;
              }).join("/");
            }
          } else {
            const nextCharStr = fullStr.substring(offset + match.length).trimStart();
            const hasPercentNext = nextCharStr.startsWith("%");
            const parts = valStr.split("/");
            const allSmallDecimals = parts.every((s) => {
              const v = parseFloat(s);
              if (isNaN(v))
                return false;
              if (v === 0)
                return true;
              return Math.abs(v) < 5 && (s.includes(".") || hasPercentNext);
            });
            if (allSmallDecimals && parts.length > 0) {
              valStr = parts.map((s) => {
                const v = parseFloat(s);
                let res = v * 100;
                const suffix = s.replace(/^[\-\d\.]+/, "");
                return String(Math.round(res * 100) / 100) + suffix;
              }).join("/");
              if (!hasPercentNext && !valStr.includes("%")) {
                valStr += "%";
              }
            }
          }
          const calcExpr = expr + "_calc";
          const calcHash = fnvHash + "_calc";
          let calcVal = fbMap[calcExpr] !== undefined ? fbMap[calcExpr] : fbMap[calcHash];
          if (valStr && calcVal) {
            valStr += ` (${calcVal})`;
          } else if (!valStr && calcVal) {
            valStr = calcVal;
          }
          return valStr;
        }
      }
      const nextChar = fullStr.charAt(offset + match.length);
      const isPercentFlagged = spell.cd_isPercentMap && spell.cd_isPercentMap[expr];
      if (/^[a-z0-9_]+$/.test(expr)) {
        const resolvedArr = resolveVar(expr);
        let valStr = "?";
        if (resolvedArr) {
          valStr = formatArrayObj(resolvedArr);
          if (isPercentFlagged && nextChar !== "%") {
            valStr += "%";
          }
        }
        const calcExpr = expr + "_calc";
        const calcHash = fnv1a_32(expr) + "_calc";
        const fbMap2 = dynamicTooltipFallback[spell.id] || {};
        const calcVal = fbMap2[calcExpr] !== undefined ? fbMap2[calcExpr] : fbMap2[calcHash];
        if (calcVal) {
          if (valStr === "?") {
            valStr = `(${calcVal})`;
          } else {
            valStr += ` (${calcVal})`;
          }
        }
        return valStr;
      }
      const varNames = expr.match(/[a-z_]+/gi);
      if (!varNames)
        return "?";
      const valStrMap = {};
      const calcStrMap = {};
      let allResolved = true;
      for (const vName of varNames) {
        const resolvedArr = resolveVar(vName);
        if (!resolvedArr) {
          allResolved = false;
          break;
        }
        valStrMap[vName] = formatArrayObj(resolvedArr);
        if (spell.cd_calcMap && spell.cd_calcMap[vName]) {
          calcStrMap[vName] = spell.cd_calcMap[vName];
        }
      }
      if (!allResolved)
        return "?";
      const ranksCount = spell.maxrank || 5;
      const results = [];
      for (let i2 = 0;i2 < ranksCount; i2++) {
        const iterMap = {};
        for (const vName of varNames) {
          const arrStr = valStrMap[vName];
          const parts = arrStr.split("/");
          iterMap[vName] = parts.length > 1 ? parts[i2] || parts[parts.length - 1] : parts[0];
        }
        const evaluated = evalMath(expr, iterMap);
        results.push(evaluated !== null ? evaluated : "?");
      }
      const allSame = results.every((v) => v === results[0]);
      let finalEvalStr = allSame ? results[0].toString() : results.join("/");
      const calcsToAppend = Object.values(calcStrMap);
      if (calcsToAppend.length > 0) {
        finalEvalStr += ` (${calcsToAppend.join(" ")})`;
      }
    });
    descriptionHtml = descriptionHtml.replace(/\?\s*\}\}/g, "").replace(/\{\{\s*[^}]*\?\s*[^}]*\}\}/g, "").replace(/\{\{[^}]*$/gm, "");
    descriptionHtml = descriptionHtml.replace(new RegExp("<physicalDamage>", "gi"), '<span style="color:#ffb74d">').replace(new RegExp("</physicalDamage>", "gi"), "</span>").replace(new RegExp("<magicDamage>", "gi"), '<span style="color:#00d2ff">').replace(new RegExp("</magicDamage>", "gi"), "</span>").replace(new RegExp("<status>", "gi"), '<span style="color:#ff4d4d">').replace(new RegExp("</status>", "gi"), "</span>").replace(new RegExp("<keyword[^>]*>", "gi"), '<span style="color:#c8aa6e; font-weight:bold;">').replace(new RegExp("</keyword[^>]*>", "gi"), "</span>").replace(new RegExp("<rules>", "gi"), '<i style="color:#aaa">').replace(new RegExp("</rules>", "gi"), "</i>").replace(new RegExp("<spellName>", "gi"), '<span style="color:#ffd700">').replace(new RegExp("</spellName>", "gi"), "</span>").replace(new RegExp("<trueDamage>", "gi"), '<span style="color:#fff">').replace(new RegExp("</trueDamage>", "gi"), "</span>").replace(new RegExp("<healing>", "gi"), '<span style="color:#11ff11">').replace(new RegExp("</healing>", "gi"), "</span>").replace(new RegExp("<shield>", "gi"), '<span style="color:#e8e8e8; font-weight:bold;">').replace(new RegExp("</shield>", "gi"), "</span>").replace(new RegExp("<speed>", "gi"), '<span style="color:#f5f55a">').replace(new RegExp("</speed>", "gi"), "</span>").replace(new RegExp("<attackSpeed>", "gi"), '<span style="color:#ffcc00">').replace(new RegExp("</attackSpeed>", "gi"), "</span>").replace(new RegExp("<scaleArmor>", "gi"), '<span style="color:#ff9900">').replace(new RegExp("</scaleArmor>", "gi"), "</span>").replace(new RegExp("<scaleMR>", "gi"), '<span style="color:#cc77ff">').replace(new RegExp("</scaleMR>", "gi"), "</span>").replace(new RegExp("<scaleMana>", "gi"), '<span style="color:#5599ff">').replace(new RegExp("</scaleMana>", "gi"), "</span>").replace(new RegExp("<scaleHealth>", "gi"), '<span style="color:#11ff11">').replace(new RegExp("</scaleHealth>", "gi"), "</span>").replace(new RegExp("<scaleAD>", "gi"), '<span style="color:#ffb74d">').replace(new RegExp("</scaleAD>", "gi"), "</span>").replace(new RegExp("<scaleAP>", "gi"), '<span style="color:#7b68ee">').replace(new RegExp("</scaleAP>", "gi"), "</span>").replace(new RegExp("<scaleLv>", "gi"), '<span style="color:#c89b3c">').replace(new RegExp("</scaleLv>", "gi"), "</span>").replace(new RegExp("<attention>", "gi"), '<span style="color:#fff; font-weight:bold;">').replace(new RegExp("</attention>", "gi"), "</span>").replace(new RegExp("<OnHit>", "gi"), '<span style="color:#ffdd44">').replace(new RegExp("</OnHit>", "gi"), "</span>").replace(new RegExp("<passive>", "gi"), '<span style="color:#ddd">').replace(new RegExp("</passive>", "gi"), "</span>").replace(new RegExp("<spellPassive>", "gi"), '<span style="color:#ffeb3b; font-weight:bold;">').replace(new RegExp("</spellPassive>", "gi"), "</span>").replace(new RegExp("<spellActive>", "gi"), '<span style="color:#00d2ff; font-weight:bold;">').replace(new RegExp("</spellActive>", "gi"), "</span>").replace(new RegExp("<recast>", "gi"), '<span style="color:#00bcd4; font-weight:bold;">').replace(new RegExp("</recast>", "gi"), "</span>").replace(new RegExp("<lifeSteal>", "gi"), '<span style="color:#ff5555">').replace(new RegExp("</lifeSteal>", "gi"), "</span>").replace(new RegExp("<keywordStealth>", "gi"), '<span style="color:#c8aa6e;">').replace(new RegExp("</keywordStealth>", "gi"), "</span>").replace(new RegExp("<flavorText>", "gi"), '<span style="color:#999; font-style:italic;">').replace(new RegExp("</flavorText>", "gi"), "</span>").replace(new RegExp("<keywordMajor>", "gi"), '<span style="color:#c8aa6e; font-weight:bold;">').replace(new RegExp("</keywordMajor>", "gi"), "</span>");
    html += `<div style="font-size: 12px; margin-top:5px; color:#ddd; line-height: 1.4;">${descriptionHtml}</div>`;
    html += `</div>`;
  }
  return html;
}
export {
  showGlobalTooltip,
  initTooltipFallback,
  hideGlobalTooltip,
  buildTrinketTooltipHtml,
  buildSummonerSpellTooltipHtml,
  buildRuneTooltipHtml,
  buildItemTooltipHtml,
  buildChampionTooltipHtml
};
