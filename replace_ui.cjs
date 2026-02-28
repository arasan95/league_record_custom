const fs = require('fs');
let code = fs.readFileSync('src/ts/ui.ts', 'utf-8');

// 1. Imports
const importStr = 'import { showGlobalTooltip, hideGlobalTooltip, buildChampionTooltipHtml, buildSummonerSpellTooltipHtml, buildItemTooltipHtml, buildTrinketTooltipHtml } from "./tooltip";\n';
code = code.replace('import { getText, type Language } from "./i18n";', importStr + 'import { getText, type Language } from "./i18n";');

// 2. Remove lines 40-120 exactly
let lines = code.split('\n');
let startIdx = lines.findIndex(l => l.includes('let globalTooltip: HTMLDivElement | null = null;'));
if (startIdx !== -1) {
    let endIdx = lines.findIndex((l, i) => i > startIdx && l.includes('function hideGlobalTooltip()'));
    while (lines[endIdx] !== '}') endIdx++;
    lines.splice(startIdx, endIdx - startIdx + 1);
    code = lines.join('\n');
}

// 3. Champion Tooltip block
let startChamp = code.indexOf('                    if (data && data.spells) {\n                        // === Header ===');
let endChampMatch = '                        showGlobalTooltip(img, html);\n                    }';
let endChamp = code.indexOf(endChampMatch, startChamp);
if (startChamp > -1 && endChamp > -1) {
    let replaceWith = '                    if (data && data.spells) {\n                        const html = buildChampionTooltipHtml(data);\n                        if (html) showGlobalTooltip(img, html);\n                    }';
    code = code.substring(0, startChamp) + replaceWith + code.substring(endChamp + endChampMatch.length); 
} else {
    console.log("Champ block not found...");
}

// 4. Summoner spells
let oldSum = '                        if (spellData) {\n                            let html = `<b style="color:#c8aa6e; font-size: 13px;">${spellData.name}</b><br>\n                            <span style="color:#aaa; font-size: 13px;">Cooldown: ${spellData.cooldownBurn}s</span><hr style="border-color:#333; margin:5px 0;">\n                            <div style="font-size: 13px; color:#ddd;">${spellData.description}</div>`;\n                            showGlobalTooltip(el, html);\n                        }';
code = code.replace(oldSum, '                        if (spellData) {\n                            showGlobalTooltip(el, buildSummonerSpellTooltipHtml(spellData));\n                        }');

// 5. Items
let oldItem = '                        if (itemData) {\n                            let html = `<b style="color:#c8aa6e; font-size: 13px;">${itemData.name}</b><br>\n                            <div style="color:#aaa; font-size: 13px; margin-bottom: 5px;">Cost: <span style="color:#e8d154">${itemData.gold?.total || 0}g</span></div>\n                            <div style="font-size: 13px; color:#ddd; max-width: 250px;">${itemData.description}</div>`;\n                            showGlobalTooltip(target, html);\n                        }';
code = code.replace(oldItem, '                        if (itemData) {\n                            showGlobalTooltip(target, buildItemTooltipHtml(itemData));\n                        }');

// 6. Trinket
let oldTrin = '                    if (itemData) {\n                        let html = `<b style="color:#c8aa6e; font-size: 13px;">${itemData.name}</b><br>\n                        <div style="font-size: 13px; color:#ddd; max-width: 250px;">${itemData.description}</div>`;\n                        showGlobalTooltip(target, html);\n                    }';
code = code.replace(oldTrin, '                    if (itemData) {\n                        showGlobalTooltip(target, buildTrinketTooltipHtml(itemData));\n                    }');

fs.writeFileSync('src/ts/ui.ts', code);
console.log("Replaced using Node");
