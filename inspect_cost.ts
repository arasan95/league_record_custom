const res = await fetch('https://raw.communitydragon.org/latest/cdragon/tft/en_us.json');
const data = await res.json();
const champs = data.sets['16'].champions.filter(c => c.apiName && c.apiName.startsWith('TFT16_'));
champs.slice(0, 5).forEach(c => console.log(c.apiName, 'cost:', c.cost, 'rarity:', c.traits.length)); 
