// Zen Staff: the list of my tasks on the company server (MyRunnerTasks.tsx).
import { defineZenMessages } from "../i18n/zenI18n";

export const myRunnerTasksText = defineZenMessages({
  en: {
    title: "Your tasks on the company server",
    byAgent: (name: string) => `Given to ${name}`,
  },
  ro: {
    title: "Sarcinile tale pe serverul firmei",
    byAgent: (name: string) => `Dată lui ${name}`,
  },
});
