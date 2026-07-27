// videojs-youtube is an old UMD side-effect package whose CommonJS factory
// exports undefined. Import its trusted package source as text and execute the
// browser branch against the application's existing Video.js instance. This
// keeps the YouTube and markers plugins on one shared registry.
import youtubeTechSource from "videojs-youtube/dist/Youtube.js" with { type: "text" };

type VideoJsRegistry = {
    getTech: (name: string) => unknown;
};

let registered = false;
let registrationPromise: Promise<void> | null = null;

export function registerYouTubeTech(videojs: VideoJsRegistry): Promise<void> {
    if (registered || videojs.getTech("Youtube")) {
        registered = true;
        return Promise.resolve();
    }
    if (registrationPromise) return registrationPromise;

    const browserWindow = window as Window & { videojs?: VideoJsRegistry };
    browserWindow.videojs = videojs;

    // The source is bundled from the installed dependency, not remote input.
    // Load it through a temporary blob script so the strict CSP does not need
    // unsafe-eval. The UMD browser branch uses the shared window.videojs above.
    registrationPromise = new Promise<void>((resolve, reject) => {
        const sourceUrl = URL.createObjectURL(new Blob([youtubeTechSource], { type: "text/javascript" }));
        const script = document.createElement("script");
        script.src = sourceUrl;
        script.onload = () => {
            script.remove();
            URL.revokeObjectURL(sourceUrl);
            if (!videojs.getTech("Youtube")) {
                registrationPromise = null;
                reject(new Error("YouTubeプレイヤーを初期化できませんでした。"));
                return;
            }
            registered = true;
            console.info("[youtube-replay] YouTube tech registered on application Video.js");
            resolve();
        };
        script.onerror = () => {
            script.remove();
            URL.revokeObjectURL(sourceUrl);
            registrationPromise = null;
            reject(new Error("YouTubeプレイヤーのコードを読み込めませんでした。"));
        };
        document.head.append(script);
    });
    return registrationPromise;
}
