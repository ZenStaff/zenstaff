// Zen Staff: strings of the pinned projects strip (ZEN.md, "Pinned projects strip").
import { countLabel, defineZenMessages } from "../i18n/zenI18n";

export const pinnedText = defineZenMessages({
  en: {
    toolbar: "Pinned projects",
    allProjects: "All projects",
    all: "All",
    unpin: "Unpin project",
    shiftClick: "Shift+click to add to the filter",
    counts: (name: string, open: number, working: number) =>
      `${name}: ${working > 0 ? `${open} open, ${working} working` : `${open} open`} threads`,
    hiddenMore: (count: number) => `${count} more pinned projects`,
  },
  ro: {
    toolbar: "Dosare fixate",
    allProjects: "Toate dosarele",
    all: "Toate",
    unpin: "Scoate fixarea",
    shiftClick: "Shift+clic ca să-l adaugi la filtru",
    counts: (name, open, working) =>
      `${name}: ${countLabel("ro", open, { one: "sarcină deschisă", other: "sarcini deschise" })}${working > 0 ? `, ${working} în lucru` : ""}`,
    hiddenMore: (count) =>
      `încă ${countLabel("ro", count, { one: "dosar fixat", other: "dosare fixate" })}`,
  },
});
