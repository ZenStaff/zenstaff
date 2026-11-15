// Zen Staff sidebar "My workflows" strings (the section, the pin buttons, the command palette).
import { defineZenMessages } from "../i18n/zenI18n";

export const myWorkflowsText = defineZenMessages({
  en: {
    title: "My workflows",
    all: "All",
    allLabel: "All workflows, on the Office home",
    empty: "Pin a workflow to keep it here.",
    pin: "Pin to the sidebar",
    unpin: "Unpin from the sidebar",
    pinNamed: (name: string) => `Pin ${name} to the sidebar`,
    unpinNamed: (name: string) => `Unpin ${name} from the sidebar`,
    scheduled: "Repeats on a schedule",
    company: "Company workflow",
    startNamed: (name: string) => `Start ${name}`,
    paletteTitle: "Start a workflow...",
    paletteMine: "My workflows",
    paletteAll: "All workflows",
  },
  ro: {
    title: "Fluxurile mele",
    all: "Toate",
    allLabel: "Toate fluxurile, pe Birou",
    empty: "Fixează un flux ca să-l ai mereu aici.",
    pin: "Fixează în bara laterală",
    unpin: "Scoate din bara laterală",
    pinNamed: (name: string) => `Fixează ${name} în bara laterală`,
    unpinNamed: (name: string) => `Scoate ${name} din bara laterală`,
    scheduled: "Se repetă automat",
    company: "Flux al firmei",
    startNamed: (name: string) => `Pornește ${name}`,
    paletteTitle: "Pornește un flux...",
    paletteMine: "Fluxurile mele",
    paletteAll: "Toate fluxurile",
  },
});
