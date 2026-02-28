const fs = require('fs');
const d = require('./broken_tooltips.json');
const vars = new Set();
d.forEach(x => {
    if (x.missingVariables) {
        x.missingVariables.forEach(v => vars.add(v));
    }
});
fs.writeFileSync('missing_vars.txt', [...vars].sort().join('\n'));
console.log(`Saved ${vars.size} unique variables to missing_vars.txt`);
