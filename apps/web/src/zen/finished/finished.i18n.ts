// Zen Staff: the finished tasks list (sidebar "Finished" shelf).
import { defineZenMessages } from "../i18n/zenI18n";

export const finishedText = defineZenMessages({
  en: {
    openAll: (count: number) => `All ${count} finished tasks, by day`,
    title: "Finished tasks",
    description: "Grouped by the day they were finished. Search by title.",
    search: "Search finished tasks",
    today: "Today",
    yesterday: "Yesterday",
    noResults: (query: string) => `No finished task matches "${query}".`,
    empty: "No finished tasks yet.",
    loadingOlder: "Loading older tasks…",
    loadOlderFailed: "Could not load older tasks.",
    retry: "Try again",
  },
  ro: {
    openAll: (count: number) => `Toate cele ${count} sarcini terminate, pe zile`,
    title: "Sarcini terminate",
    description: "Grupate pe ziua în care s-au terminat. Caută după titlu.",
    search: "Caută în sarcinile terminate",
    today: "Azi",
    yesterday: "Ieri",
    noResults: (query: string) => `Nicio sarcină terminată nu se potrivește cu „${query}”.`,
    empty: "Încă nu ai sarcini terminate.",
    loadingOlder: "Se încarcă sarcinile mai vechi…",
    loadOlderFailed: "Nu am putut încărca sarcinile mai vechi.",
    retry: "Încearcă din nou",
  },
});
