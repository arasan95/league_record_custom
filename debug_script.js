const fs = require('fs');
const data = JSON.parse(fs.readFileSync('tooltip_exports/heuristic_resolution.json', 'utf8'));
let output = '';
for (const x of data) {
    if (x.hasQuestionMark && ['Gnar', 'Aatrox', 'Sivir'].includes(x.champion)) {
        output += `${x.champion} ${x.spell} - missing: ${JSON.stringify(x.missingVariables)} - resolved: ${JSON.stringify(x.resolved)} - candidates: ${JSON.stringify(x.candidates_found)}\n`;
    }
}
fs.writeFileSync('debug_resolver.txt', output);
