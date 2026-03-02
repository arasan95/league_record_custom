(global as any).localStorage = { getItem: () => 'latest' };
import { getGameModeByQueueId, ensureQueuesDataLoaded } from "./src/ts/datadragon.ts";

async function test() {
    await ensureQueuesDataLoaded();
    console.log("Queue 420 (Ranked Solo):", getGameModeByQueueId(420));
    console.log("Queue 440 (Ranked Flex):", getGameModeByQueueId(440));
    console.log("Queue 450 (ARAM):", getGameModeByQueueId(450));
    console.log("Queue 1220 (TFT):", getGameModeByQueueId(1220));
    console.log("Queue 430 (Normal Blind):", getGameModeByQueueId(430));
    console.log("Queue 400 (Normal Draft):", getGameModeByQueueId(400));
    console.log("Queue 490 (Quickplay):", getGameModeByQueueId(490));
    console.log("Queue 480 (Swiftplay):", getGameModeByQueueId(480));
}
test();
