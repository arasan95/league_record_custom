/**
 * CDragon からチャンピオンスキルの生の説明（変数が含まれた状態）と
 * 使われている変数名の一覧を取得して表示するスクリプト。
 * 
 * 実行方法:
 *   bun run fetch_cd_tooltips.mjs [チャンピオン名/ID] [言語]
 * 
 * 例:
 *   bun run fetch_cd_tooltips.mjs varus         # ヴァルスの日本語データを表示
 *   bun run fetch_cd_tooltips.mjs 110 en_us     # ヴァルスの英語データを表示
 *   bun run fetch_cd_tooltips.mjs all           # 全チャンピオンの日本語データを表示
 */

const args = process.argv.slice(2);
const champTarget = args[0] || 'all';
let lang = args[1] || 'ja_jp';

if (lang.toLowerCase() === 'jp') lang = 'ja_jp';
lang = lang.toLowerCase();

import fs from 'fs';

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    return res.json();
}

async function main() {
    console.log(`🌐 CDragon 言語データ取得ツール`);
    console.log(`   言語: ${lang}`);
    console.log(`   対象: ${champTarget}\n`);

    // 1. チャンピオンのサマリー(IDと名前の紐付け)を取得
    let summaryUrl = `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/${lang}/v1/champion-summary.json`;
    console.log(`取得中: ${summaryUrl}`);
    const summaryList = await fetchJson(summaryUrl);
    
    // 対象を絞り込む
    let targets = [];
    if (champTarget.toLowerCase() === 'all') {
        targets = summaryList.filter(c => c.id !== -1); // -1はNone
    } else {
        const targetId = parseInt(champTarget);
        if (!isNaN(targetId)) {
            targets = summaryList.filter(c => c.id === targetId);
        } else {
            const lowerTarget = champTarget.toLowerCase();
            targets = summaryList.filter(c => 
                c.alias.toLowerCase() === lowerTarget || 
                c.name.toLowerCase() === lowerTarget
            );
        }
    }

    if (targets.length === 0) {
        console.error(`❌ チャンピオン "${champTarget}" が見つかりません。`);
        return;
    }

    console.log(`✅ ${targets.length} 体のチャンピオン情報を取得します。\n`);

    for (const champ of targets) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`📌 ${champ.name} (${champ.alias} / ID: ${champ.id})`);
        console.log(`${"=".repeat(60)}`);

        // all_tooltips_plain.txt から現在の表示内容を抽出
        let plainTooltips = {};
        try {
            const txt = fs.readFileSync('.vscode/all_tooltips_plain.txt', 'utf8');
            let isTargetChamp = false;
            
            for (const line of txt.split(/\r?\n/)) {
                if (line.match(new RegExp(`^=== ${champ.alias} ===$`, 'i'))) {
                    isTargetChamp = true;
                    continue;
                }
                
                if (isTargetChamp) {
                    if (line.trim() === '') continue;
                    if (line.startsWith('===')) break;
                    
                    // "[Q] name ... [W] name ..." の形式の1行から各スキルのテキストを抽出
                    ['Q', 'W', 'E', 'R'].forEach(slot => {
                        const regex = new RegExp(`\\[${slot}\\](.*?)(?=\\[[QWER]\\]|$)`);
                        const match = line.match(regex);
                        if (match) {
                            plainTooltips[slot] = match[1].trim();
                        }
                    });
                    break;
                }
            }
        } catch (e) {
            // ファイルがない場合は何もしない
        }

        // 各チャンピオンの詳細JSONを取得
        const detailUrl = `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/${lang}/v1/champions/${champ.id}.json`;
        try {
            const data = await fetchJson(detailUrl);
            const spells = data.spells || [];

            for (let i=0; i < spells.length; i++) {
                const spell = spells[i];
                const slot = ["Q", "W", "E", "R"][i] || `Spell${i}`;
                console.log(`\n▶ [${slot}] ${spell.name}`);
                
                // .vscode/all_tooltips_plain.txt にあるアプリ上の表示テキストを出力
                if (plainTooltips[slot]) {
                    console.log(`\n   【アプリ上の現在の表示】\n   ${plainTooltips[slot]}`);
                }

                // CDragonでは rawDescription や dynamicDescription などが
                // 変数を含んだ生のツールチップになっています。
                // CDragonのJSONの構造に合わせて取得:
                // spell.dynamicDescription は "@" や "{{" で括られた変数を含む
                const rawTooltip = spell.dynamicDescription || spell.description || "(説明なし)";
                
                console.log(`   【元テキスト】\n   ${rawTooltip}\n`);

                // "@変数名@" をすべて抽出する
                // 例: @TotalDamageMax@, @Cooldown@, {{ multiplier }} など
                const atMatches = [...rawTooltip.matchAll(/@([a-zA-Z0-9_]+)[^@]*@/g)].map(m => m[1]);
                const braceMatches = [...rawTooltip.matchAll(/\{\{([a-zA-Z0-9_*\s.|]+)\}\}/g)].map(m => m[1].trim());

                // 重複排除して表示
                const variables = [...new Set([...atMatches, ...braceMatches])];
                
                if (variables.length > 0) {
                    console.log(`   【タグ・変数名】`);
                    variables.forEach(v => console.log(`      - ${v}`));
                } else {
                    console.log(`   【タグ・変数名】: なし`);
                }
            }
        } catch (e) {
            console.error(`   ❌ 詳細データの取得に失敗: ${e.message}`);
        }
    }
}

main().catch(console.error);
