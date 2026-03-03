const d = await fetch('https://raw.communitydragon.org/latest/game/data/characters/fiddlesticks/fiddlesticks.bin.json').then(r=>r.json());
const q = Object.entries(d).find(([k,v]) => k.includes('FiddleSticksQAbility/FiddleSticksQ') && v.mSpell);
console.log(JSON.stringify(q[1].mSpell.mSpellCalculations, null, 2));
