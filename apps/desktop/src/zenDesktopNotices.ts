// Zen Staff: desktop notices shown once the app is ready (Electron side of zenLinuxKeyring.ts).
import * as Electron from "electron";

import { showZenKeyringNoticeOnce } from "./zenLinuxKeyring.ts";

/** Tells the person when Linux startup fell back to the basic password store. */
export function showZenKeyringNotice(userDataPath: string): void {
  showZenKeyringNoticeOnce({
    userDataPath,
    // The OS language list includes the region language even on an English desktop.
    locale: Electron.app.getPreferredSystemLanguages()[0] ?? Electron.app.getLocale(),
    notify: (title, body) => {
      if (Electron.Notification.isSupported()) new Electron.Notification({ title, body }).show();
    },
  });
}
