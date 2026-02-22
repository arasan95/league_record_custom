const headers = { 'User-Agent': 'Mozilla/5.0' };
const res = await fetch('https://raw.communitydragon.org/latest/cdragon/tft/en_us.json', { headers });
const data = await res.json();
console.log('Sets keys:', Object.keys(data.sets));
const allTraits = [];
const allUnits = [];
for (const setKey of Object.keys(data.sets)) {
    if (data.sets[setKey].traits) {
        data.sets[setKey].traits.forEach(t => allTraits.push({set: setKey, name: t.name, icon: t.icon}));
    }
    if (data.sets[setKey].champions) {
        data.sets[setKey].champions.forEach(c => allUnits.push({set: setKey, id: c.apiName, icon: c.tileIcon}));
    }
}
const targetTraits = allTraits.filter(t => t.name.startsWith('TFT16_'));
console.log(`Found ${targetTraits.length} TFT16 traits.`);
targetTraits.slice(0, 10).forEach(t => console.log(t.name, '=>', t.icon));

const targetUnits = allUnits.filter(t => t.id && t.id.startsWith('TFT16_'));
console.log(`Found ${targetUnits.length} TFT16 units.`);
targetUnits.slice(0, 10).forEach(t => console.log(t.id, '=>', t.icon));
