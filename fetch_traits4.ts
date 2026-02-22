const headers = { 'User-Agent': 'Mozilla/5.0' };
const res = await fetch('https://raw.communitydragon.org/latest/cdragon/tft/en_us.json', { headers });
const data = await res.json();
const traits = data.sets['16'].traits;
console.log('Trait keys from first item:', Object.keys(traits[0]));
console.log('Example trait 1:', traits[0]);
console.log('Example trait 2:', traits[1]);
