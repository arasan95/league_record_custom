import { getCurrentWindow } from '@tauri-apps/api/window';

export class TitleBar {
    private appWindow = getCurrentWindow();

    constructor() {
        this.init();
    }

    private init() {
        document.getElementById('titlebar-minimize')?.addEventListener('click', () => {
            this.appWindow.minimize();
        });

        document.getElementById('titlebar-maximize')?.addEventListener('click', async () => {
             const isMaximized = await this.appWindow.isMaximized();
             if (isMaximized) {
                 this.appWindow.unmaximize();
             } else {
                 this.appWindow.maximize();
             }
        });

        document.getElementById('titlebar-close')?.addEventListener('click', () => {
            this.appWindow.close();
        });
    }
}
