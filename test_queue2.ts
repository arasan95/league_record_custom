(global as any).localStorage = { getItem: () => 'latest' };
import { ensureQueuesDataLoaded } from "./src/ts/datadragon.ts";
import * as fs from "fs";

async function test() {
    const res = await fetch("https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/queues.json");
    const data = await res.json();
    let arr = Array.isArray(data) ? data : Object.values(data);
    fs.writeFileSync("queues_dump.json", JSON.stringify(arr, null, 2));
    console.log("Dumped", arr.length, "queues");
}

test();
