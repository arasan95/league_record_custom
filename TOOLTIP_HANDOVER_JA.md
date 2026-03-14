# Tooltip運用・引き継ぎドキュメント（ローカル完結版）

このドキュメントは、いまのTooltip修正の実運用を引き継ぐための手順書です。  
方針は「文言/変数名はDB、値はWADからローカル抽出」です。

## 1. 全体アーキテクチャ

Tooltip表示は次の2系統を合成して作っています。

1. 文言テンプレート（`@Var@`を含むHTML）
2. 変数の実値（WADから抽出した`resolvedValue`）

文言テンプレートの一次ソース:
- `%APPDATA%/com.leaguerecord.custom/tooltip_db/tooltip_data.db`
- テーブル: `champion_tooltips`
- カラム: `data_json`（`Passive/Q/W/E/R`のHTMLテンプレートを保持）

変数実値の一次ソース:
- `%LOCALAPPDATA%/com.leaguerecord.custom/tooltip_cache/tooltip_variable_fallback.json`
- `%LOCALAPPDATA%/com.leaguerecord.custom/tooltip_cache/all_calc_formulas.json`
- どちらもLoLローカルWADから抽出して生成

## 2. 実行時にどこを参照しているか

### 2.1 文言テンプレート（DB）

- フロントは `src/ts/datadragon.ts` の `getLocalChampionTooltips()` から `load_tooltip_locale_db` を呼びます。
- Rust側 `src-tauri/src/commands.rs` の `load_tooltip_locale_db()` が DB を返します。
- DBが未配置なら `ensure_tooltip_db_installed()` が `src-tauri/resources/tooltip_data.db` から `%APPDATA%` 側へコピーします。

### 2.2 変数実値（WAD抽出キャッシュ）

- `src/ts/tooltip.ts` の `initTooltipFallback()` でロード:
  - `tooltip_variable_fallback.json`
  - `all_calc_formulas.json`
- パッチバージョンが変わったとき、またはファイルが無いときだけ `invoke("update_champion_data")` で再抽出します。
- 追加の手動上書きは `src/assets/fallback_mappings.json` をマージします。

## 3. 生成方法（いまの出力設定）

### 3.1 WAD由来の変数値を生成

実行トリガー:
- 通常はアプリ起動時（`initTooltipFallback()`）に自動
- 手動は `update_champion_data` 相当を呼ぶ

出力先:
- `%LOCALAPPDATA%/com.leaguerecord.custom/tooltip_cache/tooltip_variable_fallback.json`
- `%LOCALAPPDATA%/com.leaguerecord.custom/tooltip_cache/all_calc_formulas.json`

生成ロジック本体:
- `src-tauri/src/wad/updater.rs`
- `src-tauri/src/wad/extractor.rs`

補足:
- `ByCharLevelBreakpointsCalculationPart` は `extractor.rs` でLv1-18へ展開する実装になっています（Yorick Q対策済み）。

### 3.2 文言DB（tooltip_data.db）を生成

元データ:
- `.vscode/wad_download/wad/all_champions_*.json`

生成コマンド:
```powershell
python scripts/build_tooltip_db.py
```

生成先:
- `src-tauri/resources/tooltip_data.db`

補足:
- `src/assets/tooltip_slot_overrides.json` を適用してDBを書き出します（Vayne/Briarなどのslot補正）。

既存の `%APPDATA%` DB に後から上書き適用する場合:
```powershell
python scripts/apply_tooltip_db_overrides.py
```

## 4. 不十分なTooltipの検出方法

### 4.1 表示崩れ/未解決変数の検出（DBベース）

```powershell
python scripts/find_tooltip_db_anomalies.py --locale ja_JP
```

検出対象:
- `@Var@` 未解決
- `{{ ... }}` 残存
- 変数欠損
- 明らかな文言崩れパターン

### 4.2 PassiveとQ/W/E/R取り違え検出

```powershell
python scripts/find_passive_slot_duplicates.py --locale ja_JP
```

検出対象:
- Passive本文がQ/W/E/Rと完全一致するケース

### 4.3 `resolvedValue=0` の不自然ケース検出

```powershell
python scripts/find_zero_resolved_calcs.py --health-only
```

検出対象:
- `%` を含む式なのに結果が `0` になる不自然ケース

### 4.4 Lv依存ブレークポイントの潰れ検出

```powershell
python scripts/find_char_level_breakpoint_anomalies.py
```

検出対象:
- `ByCharLevelBreakpoints` を使っているのに `resolvedValue` が短すぎる/単値化されるケース

入力:
- `tooltip_exports/all_spelldata.json`（WADエクスポート）
- `%LOCALAPPDATA%/.../all_calc_formulas.json`

## 5. 修正の基本フロー（実務）

1. 検出スクリプトで対象洗い出し
2. `tooltip_exports/all_spelldata.json` で対象spell/calcの生データ確認
3. 原因分類
   - 抽出ロジック不備: `src-tauri/src/wad/extractor.rs` 修正
   - 文言スロット誤り: `src/assets/tooltip_slot_overrides.json` 修正
   - 例外上書きが必要: `src/assets/fallback_mappings.json` 修正
4. 再生成
   - WAD値: `update_champion_data`（または抽出テスト）
   - DB: `python scripts/build_tooltip_db.py`
5. 再検出 + 実画面確認

## 6. ローカル完結方針（重要）

- 検証/表示はWAD抽出値を優先し、DDragon/CDragonの実値依存は避ける。
- `find_unresolved_tooltips.py` の `resolve_from_ddragon()` は無効化（`None`返却）で運用中。
- パッチや多言語変更に追従するため、「変数名はDBテンプレート」「値はWAD抽出」の分離を維持する。

## 7. 主要ファイル一覧

- 表示エンジン: `src/ts/tooltip.ts`
- DB読込: `src/ts/datadragon.ts`
- Tauriコマンド: `src-tauri/src/commands.rs`
- WAD抽出: `src-tauri/src/wad/extractor.rs`
- 抽出統合: `src-tauri/src/wad/updater.rs`
- 手動補正（値）: `src/assets/fallback_mappings.json`
- 手動補正（文言slot）: `src/assets/tooltip_slot_overrides.json`
- DB生成: `scripts/build_tooltip_db.py`
- DB上書き適用: `scripts/apply_tooltip_db_overrides.py`
- 検出:
  - `scripts/find_tooltip_db_anomalies.py`
  - `scripts/find_passive_slot_duplicates.py`
  - `scripts/find_zero_resolved_calcs.py`
  - `scripts/find_char_level_breakpoint_anomalies.py`

