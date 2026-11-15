// Zen Staff: a small card once an update has downloaded in the background: "New version X
// available, restart to install it". The default ("Install on close") just closes the card; the
// desktop installs the update when the app quits. Mounted in routes/_chat.tsx.
import { DownloadIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { installLocalUpdate } from "../../components/sidebar/SidebarUpdatePill";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { useZenText } from "../i18n/zenI18n";
import { updatesText } from "./updates.i18n";
import {
  readDismissedUpdateVersion,
  writeDismissedUpdateVersion,
  zenPromptVersion,
} from "./zenUpdates";

export function ZenUpdatePrompt() {
  const state = useDesktopUpdateState();
  const t = useZenText(updatesText);
  const [dismissed, setDismissed] = useState(readDismissedUpdateVersion);
  const [installing, setInstalling] = useState(false);
  const version = zenPromptVersion(state, dismissed);
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  if (!version || !bridge) return null;

  const dismiss = () => {
    writeDismissedUpdateVersion(version);
    setDismissed(version);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] gap-3 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <DownloadIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{t.promptTitle(version)}</div>
        <div className="text-xs text-muted-foreground">{t.promptBody}</div>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={installing}
            onClick={() => {
              setInstalling(true);
              void installLocalUpdate(bridge, undefined, version).finally(() =>
                setInstalling(false),
              );
            }}
          >
            {t.restartNow}
          </Button>
          <Button size="sm" disabled={installing} onClick={dismiss}>
            {t.installOnClose}
          </Button>
        </div>
      </div>
    </div>
  );
}
