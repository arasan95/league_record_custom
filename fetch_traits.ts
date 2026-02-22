const headers = { 'User-Agent': 'Mozilla/5.0' };
const res = await fetch('https://raw.communitydragon.org/latest/cdragon/tft/ja_jp.json', { headers });
const data = await res.json();
const traits = data.sets['16'].traits;
console.log('--- Set 16 Traits ---');
traits.filter(t => ['TFT16_Sorcerer', 'TFT16_Slayer', 'TFT16_TheBoss', 'TFT16_Longshot', 'TFT16_Yordle'].includes(t.name)).forEach(t => console.log(t.name, '=>', t.icon));
