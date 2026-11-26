# Responsibility Audit (Phase 1)

## Scope
- Frontend: `src/ts/*.ts`
- Backend: `src-tauri/src/**/*.rs`
- Goal: inventory responsibilities and identify boundary violations before refactoring.

## Current Responsibility Map

### Frontend
- `src/ts/main.ts`
  - Bootstrap, player lifecycle, event wiring, hotkeys, loop/clip orchestration.
- `src/ts/ui.ts`
  - Rendering, DOM creation, settings modal, updater UI, scoreboard rendering, command calls.
- `src/ts/ui/queue_helpers.ts`
  - Queue label normalization and queue-search matching logic (UI純粋ヘルパー)。
- `src/ts/ui/tooltip_debug.ts`
  - Tooltip perf debug flag resolution (`localStorage`) helper.
- `src/ts/ui/search_filters.ts`
  - Sidebar検索フィルタ（自分/味方/敵/ユーザー/キュー）の純粋判定ロジック。
- `src/ts/ui/settings_primitives.ts`
  - 設定モーダルで使う共通UI部品（group/switch/tab切替）の生成ロジック。
- `src/ts/ui/settings_about.ts`
  - 設定モーダルの About/Update タブ構築と更新チェック導線。
- `src/ts/ui/settings_hotkeys.ts`
  - 設定モーダルのホットキー/マウス操作タブ構築。
- `src/ts/ui/settings_options.ts`
  - マーカー・ゲームモード・各種スイッチ・スコアボードURL設定セクション構築。
- `src/ts/ui/settings_general_controls.ts`
  - 言語/保存先/録画品質など一般設定コントロール生成とUIイベント接続。
- `src/ts/ui/settings_save_payload.ts`
  - 設定フォーム入力から `Settings` への変換ロジック。
- `src/ts/ui/recordings_usecase.ts`
  - 録画リスト画面の容量バー計算とフィルタ統計表示用の集計ロジック。
- `src/ts/ui/scoreboard_usecase.ts`
  - スコアボードのゴールド差分行とチームリード表示の算出ロジック。
- `src/ts/ui/recording_filters_usecase.ts`
  - 録画リストの表示判定（Star/Clip/Ranked/Server/Role）ロジック。
- `src/ts/ui/recording_item_usecase.ts`
  - 録画リスト1行表示の補助ロジック（日付/勝敗/陣営/時間/CS計算/クリップアイコン生成）。
- `src/ts/datadragon.ts`
  - External data loading/caching (DataDragon/CDragon), asset URL resolution, queue classification.
- `src/ts/tooltip.ts`
  - Tooltip rendering engine, fallback cache loading, heavy string/formula normalization.
- `src/ts/version.ts`
  - Patch/version detection and related runtime values.
- `src/ts/keybinds.ts`
  - Keybind schema, persistence, conversions.
- `src/ts/assets.ts`
  - Cached asset downloading and local cache path usage.

### Backend
- `src-tauri/src/main.rs`
  - Tauri app composition, plugin wiring, command registration.
- `src-tauri/src/commands.rs`
  - Command entrypoint (module facade), domain modules are split under `src-tauri/src/commands/`.
- `src-tauri/src/commands/recordings.rs`
  - Recordings CRUD, settings commands, recordings/cache related command handlers.
- `src-tauri/src/commands/media.rs`
  - Clip/FFmpeg runtime commands.
- `src-tauri/src/commands/tooltip_db.rs`
  - Tooltip DB install/validation/query commands.
- `src-tauri/src/commands/path_guard.rs`
  - Path boundary checks used by command modules.
- `src-tauri/src/app/*`
  - App orchestration (`manager.rs`), events (`event.rs`), recording scans/cleanup (`recordings.rs`), tray/window.
- `src-tauri/src/recorder/*`
  - Game session listener, recording task lifecycle, metadata collection, LP helper.
- `src-tauri/src/state/*`
  - Global/shared runtime state (`settings`, `window`, `shutdown`, `recording flags`).
- `src-tauri/src/wad/*`
  - WAD parsing/extraction/hash logic and LoL install discovery.

## Boundary Violations (Design Smells)

1. God modules (too many reasons to change)
- `src/ts/ui.ts` (~260KB)
- `src/ts/tooltip.ts` (~150KB)
- `src-tauri/src/commands.rs` (~45KB)
- `src-tauri/src/recorder/game_listener.rs` (~45KB)

2. UI layer mixes presentation + use-case orchestration + infra
- `ui.ts` directly calls command APIs, updater checks, persistence helpers, and renders complex views.

3. Command layer mixes unrelated bounded contexts
- `commands.rs` handles:
  - media operations (clip/ffmpeg),
  - recording metadata CRUD,
  - remote download/cache writes,
  - local WAD probing/extraction,
  - tooltip DB migration/validation.

4. Implicit coupling via cross-module globals
- `ui.ts` imports mutable runtime data from `main.ts` (`currentKeybinds`, `reloadKeybinds`), creating a high-coupling edge.

5. Weakly explicit data ownership
- Recording list, metadata, scoreboard cache, and tooltip cache have ownership spread across UI, commands, recorder, and app modules.

## Refactor Task Backlog (Derived from Inventory)

### A. Backend domain split (first)
1. Split `commands.rs` into domain command modules:
   - `commands/recordings.rs`
   - `commands/media.rs` (clip/ffmpeg/runtime info)
   - `commands/assets.rs` (download/cache)
   - `commands/tooltip_db.rs`
2. Keep `main.rs` registration flat, but grouped by domain.
3. Move non-command helper logic to services:
   - `services/media_service.rs`
   - `services/asset_service.rs`
   - `services/tooltip_service.rs`

### B. Frontend domain split
1. Split `ui.ts` into:
   - `ui/layout/*` (pure render + DOM composition)
   - `ui/scoreboard/*` (scoreboard-specific rendering)
   - `ui/settings/*` (settings modal and handlers)
   - `ui/actions/*` (side-effect orchestration only)
2. Remove `ui.ts -> main.ts` mutable import dependency.
   - introduce `runtime_store.ts` (single read/write interface for runtime shared values).
3. Split `tooltip.ts`:
   - cache loader,
   - formula resolver,
   - HTML renderer.

### C. Ownership and contracts
1. Define owner modules for each persistent artifact:
   - `settings.json` owner
   - recording metadata owner
   - scoreboard cache owner
   - tooltip cache owner
2. Expose narrow interfaces; ban direct file IO from UI presentation modules.

## How To Test This Inventory Is Accurate

### 1) Coverage test (inventory completeness)
- Rule: every `.ts` and `.rs` file must be assigned to exactly one primary responsibility area.
- Method:
  - keep this file as source-of-truth.
  - CI script compares repository file list with mapped list and fails on unmapped files.

### 2) Dependency rule test (boundary correctness)
- Rule examples:
  - `ui/layout/*` cannot import `@tauri-apps/*` directly.
  - `commands/*` cannot contain WAD parsing logic directly (must call services).
  - `recorder/*` cannot import UI-level modules.
- Method:
  - TypeScript: enforce with `dependency-cruiser` rules.
  - Rust: enforce with module-level grep checks in CI (or custom AST checks later).

### 3) Interface contract test
- For each split domain module, define command contract tests:
  - input validation
  - error shape
  - path scope checks
  - side effects restricted to owned storage.

### 4) Regression smoke test (runtime sanity)
- Minimal automated path:
  - app boot
  - list recordings
  - open video
  - create clip
  - toggle favorite
  - save/load scoreboard cache
  - tooltip load path.
- This catches boundary refactor breakage quickly.

## Exit Criteria for Phase 1
- Responsibility map agreed.
- Top-level domain/module cut lines approved.
- Automated rule checks defined (even if partially enforced at first).
- Refactor can proceed incrementally without ambiguity.
