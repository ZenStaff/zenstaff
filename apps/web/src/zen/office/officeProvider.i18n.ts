// Zen Staff: the Office line for an AI assistant that is not ready (OfficeProviderNotice.tsx).
import { defineZenMessages } from "../i18n/zenI18n";

export const officeProviderText = defineZenMessages({
  en: {
    problem: {
      "not-installed": (name: string) => `${name} is not installed on this computer`,
      "signed-out": (name: string) => `${name} is not signed in on this computer`,
      unavailable: (name: string) => `${name} is not working right now`,
    },
    action: { "not-installed": "Install", "signed-out": "Sign in", unavailable: "Open settings" },
    dismiss: "Hide",
  },
  ro: {
    problem: {
      "not-installed": (name: string) => `${name} nu e instalat pe acest calculator`,
      "signed-out": (name: string) => `${name} nu e conectat pe acest calculator`,
      unavailable: (name: string) => `${name} nu merge acum`,
    },
    action: {
      "not-installed": "Instalează",
      "signed-out": "Conectează",
      unavailable: "Deschide setările",
    },
    dismiss: "Ascunde",
  },
});
