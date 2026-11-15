import { createFileRoute } from "@tanstack/react-router";

import { WorkflowEditorPage } from "../zen/office/WorkflowEditorPage";

interface WorkflowEditorSearch {
  readonly id?: string;
  /** "thread": open the draft "Save this as a workflow" prepared. */
  readonly zenDraft?: "thread";
}

function WorkflowEditorRoute() {
  const { id, zenDraft } = Route.useSearch();
  return (
    <WorkflowEditorPage key={id ?? zenDraft ?? "new"} id={id} fromDraft={zenDraft === "thread"} />
  );
}

export const Route = createFileRoute("/_chat/workflow-editor")({
  validateSearch: (search: Record<string, unknown>): WorkflowEditorSearch => ({
    ...(typeof search.id === "string" && search.id.length > 0 ? { id: search.id } : {}),
    ...(search.zenDraft === "thread" ? { zenDraft: "thread" as const } : {}),
  }),
  component: WorkflowEditorRoute,
});
