const fs = require('fs');
const d = JSON.parse(fs.readFileSync('darius_cdragon.json'));
const q = d['Characters/Darius/Spells/DariusCleaveAbility/DariusCleave'].mSpell;
const out = {
  BladeDamage: q.mSpellCalculations.BladeDamage,
  HandleDamage: q.mSpellCalculations.HandleDamage,
};
fs.writeFileSync('calc.json', JSON.stringify(out, null, 2));
console.log('Done');
