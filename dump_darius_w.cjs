const fs = require('fs');
const d = JSON.parse(fs.readFileSync('tooltip_exports/ddragon_all_champions.json', 'utf8'));
const s = d.Darius.spells.find(x => x.id === 'DariusNoxianTacticsONH');
fs.writeFileSync('darius_w_cd.json', JSON.stringify({
    vars: s.vars,
    cd_dataValuesMap: s.cd_dataValuesMap,
    cd_baseMap: s.cd_baseMap
}, null, 2));
console.log('Saved to darius_w_cd.json');
