
const fs = require("fs");
const data = JSON.parse(fs.readFileSync("C:/Users/fjnce/AppData/Local/com.leaguerecord.custom/items_cache/tft_data_en_us.json", "utf8"));
const bw = data.sets["16"].traits.find(t => t.apiName === "TFT16_Bilgewater");
console.log("Bilgewater:");
console.log(JSON.stringify(bw.effects, null, 2));

const lulu = data.sets["16"].champions.find(c => c.apiName === "TFT16_Lulu");
console.log("Lulu:", lulu.cost);
const nautilus = data.sets["16"].champions.find(c => c.apiName === "TFT16_Nautilus");
console.log("Nautilus:", nautilus.cost);

