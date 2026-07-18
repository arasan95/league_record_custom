// videojs-youtube is an old UMD side-effect package whose CommonJS factory
// exports undefined. Import its trusted package source as text and execute the
// browser branch against the application's existing Video.js instance. This
// keeps the YouTube and markers plugins on one shared registry.
import youtubeTechSource from "videojs-youtube/dist/Youtube.js" with { type: "text" };

type VideoJsRegistry = {
    getTech: (name: string) => unknown;
};

let registered = false;

export function registerYouTubeTech(videojs: VideoJsRegistry): void {
    if (registered || videojs.getTech("Youtube")) {
        registered = true;
        return;
    }

    const browserWindow = window as Window & { videojs?: VideoJsRegistry };
    browserWindow.videojs = videojs;

    // The source is bundled from the installed dependency, not remote input.
    // Running it as a browser script selects the UMD global branch and calls
    // videojs.registerTech("Youtube", ... ) on the registry above.
    new Function(youtubeTechSource).call(browserWindow);

    if (!videojs.getTech("Youtube")) {
        throw new Error("YouTubeプレイヤーを初期化できませんでした。");
    }
    registered = true;
    console.info("[youtube-replay] YouTube tech registered on application Video.js");
}
