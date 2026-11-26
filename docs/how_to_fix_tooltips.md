# 初心者向け：ツールチップの数値を手動で修正・追加する方法

ゲームのパッチアップデートでスキルダメージの計算式が変わったり、新しいチャンピオンが追加されたりした時に、ツールチップの「?」や「表示されない数値」を自分で修正するためのガイドです。

---

## 💡 基本的な仕組み

このアプリは、ゲームの内部データ（ベースダメージやAD/AP係数など）を組み合わせてツールチップの文章を作っています。しかし、ヴァルスのQのように「計算が複雑すぎるスキル」はアプリが自動で数式を組み立てられず、数値が消えたり「?」になったりします。

これを直すために **「この変数はこの計算式で作るんだよ」とアプリに教えてあげる** のがここでの作業です。

---

## 🛠️ 修正の３ステップ

今回は例として、今回修正した「ヴァルスのQの最大ダメージ」を例に解説します。

### ステップ 1: 欠けている変数名（タグ）を見つける
ツールチップの表示を見て「どこが欠けているか」を確認します。

出力ログファイル（[.vscode/all_tooltips_plain.txt](../.vscode/all_tooltips_plain.txt)）を開いて、ヴァルスのQを見ると：
`53.33/106.67/160/213.33/266.67` とだけ表示されていて、右側にあるはずの [(+100% AD)](../.vscode/dump_all_tooltips.ts#L667-L668) などの **()の部分が消えている** ことが分かります。
これを補う変数を探します。

### ステップ 2: 材料となるデータを探す
計算式を作るための「材料（ベースダメージやダメージ係数）」を探します。

1. `LeagueRecord_custom` フォルダ内にある [.vscode/tooltip_variable_fallback_generated.json](../.vscode/tooltip_variable_fallback_generated.json) を開きます。
2. その中で目的のスキル（例： `"VarusQ"`）を `Ctrl + F` で検索します。
3. なかを見ると、以下のような材料が並んでいます。
   ```json
   "VarusQ": {
     "basedamagemax": "80/160/240/320/400",
     "chargemultiplierinverse": "0.66667",
     "tadratiomax": "1.2/1.3/1.4/1.5/1.6/1.7"
   }
   ```
   *👉 これが「パッチごとに自動更新される最新の基礎データ」です。この名前（`basedamagemax` など）をメモします。*

### ステップ 3: 計算式を書いて登録する
ステップ2で見つけた材料を使って、計算式を書きます。
変更するファイルは **[src/assets/fallback_mappings.json](../src/assets/fallback_mappings.json)** です。

ファイルの適切な場所（アルファベット順に並んでいるので、Vのあたりがおすすめです）に以下のように書き足します。

```json
  "VarusQ": {
    "totaldamagemax": "=basedamagemax|tadratiomax:AD"
  }
```

これで完了です！ファイルを保存してアプリをリロード（または再起動）すると、正しい数値が表示されるようになります。

---

## 🧮 計算式の書き方ルール

計算式は必ず **`=`（イコール）から書き始めます**。書き方には独自の簡単な文法があります。

### 1. ベース値とスケーリング（AD/AP倍率）を並べる
ベースダメージとADスケーリングを並べて [(+◯% AD)](../.vscode/dump_all_tooltips.ts#L667-L668) のように表示したい場合は **`|`（縦線）** で区切ります。

* **書き方:** `=ベース変数|係数変数:ステータス名`
* **例:** `=basedamagemax|tadratiomax:AD`
* **結果:** `80/160/240/320/400 (+130/140/150/160/170% AD)` のようになります。
  *※ `tadratiomax` に入っている「1.2」のような小数の係数は、アプリが自動で `120` と変換して表示してくれます。*
  *※ `:AD` のように `:` の後ろに書いた文字が、そのまま（ADやAPなど）表示されます。*

### 2. 足し増や掛け算をしたい場合
ステータスやダメージ同士を掛け算したり、固定の数値を加算することもできます。

* **足し算の例:** `=(basedamage+10)`
* **掛け算の例:** `=basedamage*3`
  * ミス・フォーチュンのRのように「1発のダメージ × 波の数」なら `=basedamage*basewaves` と書けます。

### 3. ベースと係数の両方に掛け算をしたい場合
例えば、ヴァルスのQの場合、チャージしていない時の最小ダメージは「最大ダメージ × 0.66667」です。
この場合は、`|` の左側（ベース）と右側（係数）の両方に掛け算のタグ（今回なら `chargemultiplierinverse`）を書きます。

* **例:** `=basedamagemax*chargemultiplierinverse|tadratiomax*chargemultiplierinverse:AD`

### 4. 複数のスケーリング（ADとAP両方あるスキルなど）
ADとAPの両方の倍率がある場合は、さらに `|` で繋げます。

* **書き方:** `=ベース変数|AD変数:AD|AP変数:AP`
* **例:** `=basedamage|tadratio:AD|apratio:AP`
* **結果:** `100 (+50% AD +30% AP)` となります。

### 5. ベース値とスケーリングを別のキーで定義する（`_calc` サフィックス）

「ベースの数値」と「() の中のスケーリング」を**それぞれ別のキーで定義する**方法があります。CDragonでは数値の取得ができない変数で、表示形式だけ正しくしたいケースに使います。

* **書き方:** 変数名のキーにベース値、同じ変数名に `_calc` を付けたキーにスケーリング文字列を書く。
* **例（セトQの `MaxHealthDamageCalc` の修正）:**
  ```json
  "SettQ": {
    "maxhealthdamagecalc": "1%",
    "maxhealthdamagecalc_calc": "+1/1.5/2/2.5/3% {AD}"
  }
  ```
* **結果:** `1% (+1/1.5/2/2.5/3% {AD})` のように表示されます。

**なぜこうなるのか？** [`tooltip.ts`](../src/ts/tooltip.ts)（および `dump_all_tooltips.ts`）の内部ロジックには、変数を解決するとき `変数名_calc` キーが存在すれば、**自動的に括弧付きで末尾に追記する**仕組みが実装されています：

```typescript
// _calc キーがあれば括弧でつなげる
if (valStr && calcVal) valStr += ` (${calcVal})`;
// 結果: "1%" + " (+1/1.5/2/2.5/3% {AD})" = "1% (+1/1.5/2/2.5/3% {AD})"
```

> **⚠️ 注意:** `_calc` キーに書いた値は**パッチ更新時に自動で変わりません**。Riotがパッチでスケーリング数値を変更した場合は手動で更新が必要です。

---

## 🙋‍♂️ よくある質問とトラブルシューティング

**Q: [tooltip_variable_fallback_generated.json](../.vscode/tooltip_variable_fallback_generated.json) を見ても、使いたい材料（変数名）が見つかりません。**
A: アプリが抽出に失敗している隠しデータの可能性があります。その場合は、[fallback_mappings.json](../src/assets/fallback_mappings.json) に手書きで直接固定の数値を書くこともできます。（例: `"basedamage": "50/100/150"`）
ただし、この方法はパッチが変わった時に手動で書き直す必要があります。

**Q: JSONファイルに追記したら赤い波線（エラー）が出ました。**
A: カンマ（`,`）のつけ忘れ、または不要な場所についていることが多いです。JSONファイルでは、最後の行以外のすべての要素の末尾に `,` が必要です。

```json
  "ChampionA": {
    "skill": "=data"
  }, // ← ここにはカンマが必要
  "ChampionB": {
    "skill": "=data"
  }  // ← 最後のブロックにはカンマはつけない
```

---

## 🏗️ ツールチップシステムの全体仕様（開発・保守用）

後からこの仕組みを修正しやすいように、処理の流れと関与するファイルをまとめます。

### データの流れと役割

1. **WADデータ（内部データ）**
   ゲームの `.wad.client`（または CDragon の [.bin.json](../aatrox.bin.json)）には、各スキルの計算式（`mSpellCalculations`）や基礎データ（[DataValues](../.vscode/test_rust_extractor_sim.mjs#L52-L64)）が含まれています。

2. **Rust抽出器 ＆ Pythonスクリプト**
   * このアプリは起動時やビルド時に内部データを解析し、基礎データを抽出します。
   * 現在、複雑な数式（`mSpellCalculations` 内の入れ子構造など）は抽出器が完全に解析しきれないため、計算の「材料」だけを取り出しています。

3. **[tooltip_variable_fallback_generated.json](../.vscode/tooltip_variable_fallback_generated.json) (自動生成ファイル)**
   * `LeagueRecord_custom/.vscode/` 等に出力される中間ファイルです。
   * Rust抽出器が取り出した「計算の材料（`basedamagemax` や `tadratiomax` など）」が並んでいます。
   * **⚠️ 注意:** このファイルは抽出スクリプトによって上書きされるため、手動で書き換えても消えてしまいます。

4. **[fallback_mappings.json](../src/assets/fallback_mappings.json) (手動設定ファイル)**
   * `LeagueRecord_custom/src/assets/` にあるファイルです。
   * 今回作業したのがこのファイルです。自動抽出できなかった複雑な数式を、ステップ3の材料を使って手動で組み立てて記述します。（例：`=basedamagemax|tadratiomax:AD`）
   * このファイルはアプリ起動時に読み込まれ、自動生成データよりも**優先して適用**されます。

5. **[tooltip.ts](../src/ts/tooltip.ts) (計算エンジン)**
   * [LeagueRecord_custom/src/ts/tooltip.ts](../src/ts/tooltip.ts) にあるフロントエンド側のプログラムです。
   * ツールチップの文章（例: `@totaldamagemax@のダメージ`）を見つけると、以下の順で数値を探します。
     1. まず [fallback_mappings.json](../src/assets/fallback_mappings.json) を見る。
     2. なければ [tooltip_variable_fallback_generated.json](../.vscode/tooltip_variable_fallback_generated.json) を見る。
   * もし値が `=` で始まる数式だった場合、ここで指定された材料同士を掛けたり足したりして最終的な数値（例: `80 (+130% AD)`）を計算します。

---

## 🔍 参考：そもそも欠けている変数名（`totaldamagemintooltip` など）はどうやって探すの？

ステップ1で [.vscode/all_tooltips_plain.txt](../.vscode/all_tooltips_plain.txt) を見て欠けている場所を探すと説明しましたが、**「そもそもそこに本来何の変数名が入るはずだったのか」** を正確に知るには、公式のデータ（WAD/BIN）の元の文章（テンプレート）を見るのが一番確実です。

これを簡単に確認するための専用スクリプトを用意しています。

### 1. CDragonから公式テキストと変数名を直接見るスクリプト
ブラウザでデータを直接探す代わりに、以下のスクリプトを使うと、公式の原本テキストと、そこに含まれているすべての `@変数名@` を一覧で表示してくれます。

**ターミナルで実行するコマンド:**
```bash
bun run scripts/fetch_cd_tooltips.mjs varus
```
*(※ `varus` の部分を調べたいチャンピオンの英語名やIDに変えてください。)*

**出力例:**
```text
▶ [Q] 乾坤一擲

   【アプリ上の現在の表示】（.vscode/all_tooltips_plain.txt の内容）
   乾坤一擲 Range: 925 ... 矢を放ち、53.33/106.67/160/213.33/266.67 (+86.67/93.33% {AD})(最大 ...) の物理ダメージ を与える。

   【元テキスト】（CDragonの生データ）
   矢を放ち、<physicalDamage>@TotalDamageMinTooltip@の物理ダメージ</physicalDamage>を与える。
   ...最大<physicalDamage>@TotalDamageMax@</physicalDamage>。

   【タグ・変数名】
      - TotalDamageMinTooltip
      - TotalDamageMax
```

このスクリプトは **【アプリ上の現在の表示】と【元テキスト】を同時に出力** するため、次のことが一目でわかります：
* アプリが「どこで何の数値に変換しているか」
* 出力が正しいかどうかの確認
* どの `@変数名@` がまだ未解決（`?`のまま）なのか

👉 `【元テキスト】` に `@TotalDamageMinTooltip@` のような未解決タグが見えたら、それを小文字にして（`totaldamagemintooltip`）、ステップ3の [`fallback_mappings.json`](../src/assets/fallback_mappings.json) のキー名として使います。

### 2. 現在のアプリ上での表示を一覧出力するスクリプト
手動でアプリ画面を開いて確認しなくても、現在の設定（[fallback_mappings.json](../src/assets/fallback_mappings.json) の反映状態を含む）で、アプリ・スコアボード上にどう表示されるかをテキストとして全出力するスクリプトもあります。

**ターミナルで実行するコマンド:**
```bash
bun run scripts/dump_all_tooltips.ts
```

このコマンドを実行すると、以下の2つのファイルが更新されます。
* [.vscode/all_tooltips_plain.txt](../.vscode/all_tooltips_plain.txt) : 全チャンピオンの出力結果（「これらを直せばOK」と確認するために使うファイルです）
* [.vscode/unresolved_tooltips_bun.txt](../.vscode/unresolved_tooltips_bun.txt) : 「?」が残っていて、まだ修正が必要なスキルの一覧

### まとめ
1. スキルに「?」が出ているのを見つけたら、**`bun run scripts/fetch_cd_tooltips.mjs [チャンプ名]`** を実行して、足りない変数名（`@変数@`）を突き止める。
2. [.vscode/tooltip_variable_fallback_generated.json](../.vscode/tooltip_variable_fallback_generated.json) を見て、どのような基礎データ（材料）が抽出されているか確認する。
3. [src/assets/fallback_mappings.json](../src/assets/fallback_mappings.json) に手動で計算式を追記する。
4. **`bun run scripts/dump_all_tooltips.ts`** を実行して、[scripts/all_tooltips_plain.txt](../scripts/all_tooltips_plain.txt) を確認し、正しく数値が入ったかテストする。

---

### 💡 補足：`fallback_mappings.json` の固定値をすべて `{変数名}` に置き換えるべきですか？

**結論：すべてを置き換えることは推奨しません。**

`fallback_mappings.json` に手動で固定値（例：`"alldamagehit": "6/7/8"`）を書いている最大の理由は、**「公式のCDragon側の抽出データ内に、その数値を指し示す変数がそもそも存在しない」**ためです。（Riot側が変数を設定し忘れてテキストに直書きしているケースが多く存在します）

存在しない変数名を指定すると、ツールチップがパースできず「?」となってしまいます。

#### 基本的な運用方針
1. **既存の固定値はそのまま維持する:** 多くの固定値は「パッチで変わりにくい基本仕様」や「抽出データが存在しないもの」です。
2. **パッチアップデートでズレが生じた時に対応する:** アプリの表示数値と実際のゲーム内数値がズレているのを見つけた際に、`bun run scripts/fetch_cd_tooltips.mjs [チャンプ名]` を実行します。
3. **変数が存在すれば `{変数名}` に置き換える:** その際、もしCDragon側に新しく変数が追加されていたり、以前から存在していた変数（例：Sett Qの `MaxHealthTADRatioTOOLTIP` など）があれば、`{変数名}` の記述で自動追従させます。なければ、引き続き手動で固定値を更新します。

