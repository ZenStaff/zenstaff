import type { ReactNode } from "react";

import { isElectron } from "~/env";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { SidebarInset } from "../../components/ui/sidebar";
import { cn } from "../../lib/utils";

/** The frame every Office page shares: header with a title and actions, scrolling body. */
export function OfficePageShell(props: {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  /** The Registru look (paper, serif titles, one loud color): Birou, Angajați AI, Academie. */
  readonly registru?: boolean;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          props.registru ? "zen-registru" : "bg-background",
        )}
      >
        <WorkspacePageHeader
          electron={isElectron}
          className={props.registru ? "bg-transparent" : "bg-background"}
        >
          <WorkspaceBreadcrumb ariaLabel={`${props.title} breadcrumb`}>
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">{props.title}</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          {props.actions}
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WorkspacePageContainer
            width={props.registru ? "expanded" : "wide"}
            className={props.registru ? "gap-10 pb-16" : "gap-6"}
          >
            {props.children}
          </WorkspacePageContainer>
        </div>
      </div>
    </SidebarInset>
  );
}
