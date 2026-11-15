import { createFileRoute } from "@tanstack/react-router";

import { AcademyPage } from "../zen/academy/AcademyPage";

function AcademyRoute() {
  const { lesson } = Route.useSearch();
  return <AcademyPage lessonId={lesson} />;
}

export const Route = createFileRoute("/_chat/academy")({
  validateSearch: (search: Record<string, unknown>): { lesson?: string } =>
    typeof search.lesson === "string" && search.lesson.length > 0 ? { lesson: search.lesson } : {},
  component: AcademyRoute,
});
