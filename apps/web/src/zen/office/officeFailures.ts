// Zen Staff: a failed Office action (install, uninstall, save, delete) shows the server's reason
// in the app language. Upstream's atom commands only log failures to the console.
import type * as Cause from "effect/Cause";

import { toastManager } from "../../components/ui/toast";
import { zenErrorMessage } from "../i18n/serverText";
import { defineZenMessages, zenText } from "../i18n/zenI18n";

const failureText = defineZenMessages({
  en: {
    install: "Could not install the workflow",
    uninstall: "Could not remove the workflow",
    save: "Could not save the workflow",
    delete: "Could not delete the workflow",
    tryAgain: "Try again in a moment.",
  },
  ro: {
    install: "Nu am putut instala fluxul de lucru",
    uninstall: "Nu am putut scoate fluxul de lucru",
    save: "Nu am putut salva fluxul de lucru",
    delete: "Nu am putut șterge fluxul de lucru",
    tryAgain: "Încearcă din nou peste puțin timp.",
  },
});

export function showOfficeFailure(
  action: "install" | "uninstall" | "save" | "delete",
  cause: Cause.Cause<unknown>,
): void {
  const t = zenText(failureText);
  toastManager.add({
    type: "error",
    title: t[action],
    description: zenErrorMessage(cause, t.tryAgain),
  });
}
