const headers = { 'User-Agent': 'Mozilla/5.0' };
const res = await fetch('https://raw.communitydragon.org/latest/cdragon/tft/en_us.json', { headers });
const data = await res.json();
console.log('Sets keys:', Object.keys(data.sets));
const allTraits = [];
for (const setKey of Object.keys(data.sets)) {
    if (data.sets[setKey].traits) {
        data.sets[setKey].traits.forEach(t => allTraits.push({set: setKey, name: t.name, icon: t.icon}));
    }
}
const targets = allTraits.filter(t => t.name.startsWith('TFT16_'));
console.log(Found  TFT16 traits.);
targets.slice(0, 10).forEach(t => console.log(t.name, '=>', t.icon));
