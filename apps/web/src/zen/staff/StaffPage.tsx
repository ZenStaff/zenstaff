// Zen Staff AI staff: "Hire your AI staff", in the Registru look. One page per company with six
// areas for a manager (Echipa, Angajează, Aprobări, Tablou, Performanță, Setări) and an AI
// employee's own page (Sarcini, Instrucțiuni, Unelte, Program, Istoric).
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenHubCompanyDetail } from "@t3tools/contracts/zenHub";
import type { StaffHuman } from "@t3tools/contracts/zenStaff";
import { useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { Building2Icon, CheckIcon, TriangleAlertIcon, UnplugIcon } from "lucide-react";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import { useProjects } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { companyOfProject } from "../companies/companiesModel";
import { useActiveCompanyId, useCompanyIndex } from "../companies/companiesState";
import { useHubQuery } from "../hub/hubClient";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { OfficePageShell } from "../office/OfficePageShell";
import { staffText } from "./staff.i18n";
import { useStaffCall, useStaffCatalog, useStaffOverview } from "./staffClient";
import {
  mergeHubMembers,
  STAFF_AREAS,
  type StaffArea,
  type StaffProfileTab,
  type StaffSearch,
} from "./staffModel";
import { Section, useStaffDefaults, type StaffContext } from "./staffShared";
import { staffHomeText } from "./staffHome.i18n";
import { Bone, EmptyState, PageHeading, PenWord } from "../ui/Registru";
import { StaffPerformanceTab } from "./StaffPerformance";
import { StaffProfilePage } from "./StaffProfile";
import { StaffHubStatus } from "./StaffHubControls";
import { StaffHireTab, type StaffCatalog } from "./StaffHire";
import { StaffDiscoverTab, StaffSettingsTab } from "./StaffInsights";
import { StaffTeamGrid } from "./StaffTeam";
import { StaffApprovalsTab, StaffBoardTab } from "./StaffWork";
import { useIsInternalFolder } from "../office/useInternalFolders";

export { parseStaffSearch } from "./staffModel";

export function StaffPage(props: { readonly search: StaffSearch }) {
  const t = useZenText(staffText);
  const environmentId = usePrimaryEnvironmentId();
  const index = useCompanyIndex();
  const active = useActiveCompanyId(index);
  const companyId =
    props.search.company ??
    active ??
    index.companies.find((company) => company.id !== "personal")?.id ??
    "personal";
  return (
    <OfficePageShell title={t.title} registru>
      {environmentId === null ? (
        <EmptyState icon={UnplugIcon} title={t.noMachine} />
      ) : (
        <StaffBody
          key={`${environmentId}:${companyId}`}
          environmentId={environmentId}
          companyId={companyId}
          search={props.search}
        />
      )}
    </OfficePageShell>
  );
}

function StaffBody(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string;
  readonly search: StaffSearch;
}) {
  const h = useZenText(staffHomeText);
  const locale = useZenLocale();
  const navigate = useNavigate();
  const { environmentId, companyId } = props;
  const index = useCompanyIndex();
  const { data: overview, error, refresh } = useStaffOverview(environmentId, companyId, locale);
  const call = useStaffCall(environmentId, companyId);
  const catalog = useStaffCatalog<StaffCatalog>(environmentId);
  const defaultsFor = useStaffDefaults(environmentId);
  const [hirePreselect, setHirePreselect] = useState<string | null>(null);
  const isInternal = useIsInternalFolder();
  const projects = useProjects()
    .filter(
      (project) =>
        project.archivedAt == null &&
        !isInternal(project) &&
        project.environmentId === environmentId,
    )
    .filter((project) => companyOfProject(index, project.environmentId, project.id) === companyId);
  const tab: StaffArea = props.search.tab ?? "team";
  const go = (next: StaffArea) =>
    void navigate({ to: "/staff", search: { tab: next, company: companyId } });
  const openAgent = (agentId: string | null, profile?: StaffProfileTab) =>
    void navigate({
      to: "/staff",
      search: {
        company: companyId,
        ...(agentId ? { agent: agentId, ...(profile ? { profile } : {}) } : { tab: "team" }),
      },
    });

  const header = (
    <PageHeading
      title={
        <>
          {h.title[0]}{" "}
          <span className="zr-accent">
            <PenWord>{h.title[1]}</PenWord>
          </span>
        </>
      }
      subtitle={h.subtitle}
      actions={
        <CompanySwitch
          value={companyId}
          companies={index.companies}
          onChange={(next) => void navigate({ to: "/staff", search: { tab, company: next } })}
        />
      }
    />
  );

  if (overview === null) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        {error ? (
          <EmptyState icon={TriangleAlertIcon} title={error} />
        ) : (
          <StaffSkeleton label={h.loading} />
        )}
      </div>
    );
  }
  const context: StaffContext = {
    environmentId,
    companyId,
    overview,
    call,
    refresh,
    projects,
    defaultsFor,
  };
  const profileAgent = props.search.agent
    ? overview.agents.find((agent) => agent.id === props.search.agent)
    : undefined;
  const pending = overview.approvals.filter((approval) => approval.status === "pending").length;
  const content = (humans: ReadonlyArray<StaffHuman>): ReactNode => {
    if (profileAgent) {
      return (
        <StaffProfilePage
          context={context}
          agent={profileAgent}
          humans={humans}
          catalog={catalog?.roles ?? []}
          tab={props.search.profile ?? "tasks"}
          onTab={(next) => openAgent(profileAgent.id, next)}
          onBack={() => openAgent(null)}
        />
      );
    }
    switch (tab) {
      case "team":
        return (
          <StaffTeamGrid
            context={context}
            humans={humans}
            catalog={catalog?.roles ?? []}
            onHire={() => go("hire")}
            onOpen={(agentId) => openAgent(agentId)}
          />
        );
      case "hire":
        return (
          <div className="flex flex-col gap-12">
            <StaffHireTab context={context} catalog={catalog} preselect={hirePreselect} />
            <Section title={h.suggestions} intro={h.suggestionsIntro}>
              <StaffDiscoverTab
                context={context}
                onHire={(templateId) => {
                  setHirePreselect(templateId);
                  go("hire");
                }}
              />
            </Section>
          </div>
        );
      case "board":
        return <StaffBoardTab context={context} />;
      case "approvals":
        return <StaffApprovalsTab context={context} />;
      case "performance":
        return <StaffPerformanceTab context={context} />;
      case "settings":
        return <StaffSettingsTab context={context} />;
    }
  };
  return (
    <div className="flex flex-col gap-8">
      {header}
      <StaffHubStatus overview={overview} />
      {profileAgent ? null : (
        <nav className="zr-tabs" aria-label={h.title.join(" ")}>
          {STAFF_AREAS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => go(item)}
              className="zr-tab"
              aria-current={tab === item ? "page" : undefined}
              data-staff-tab={item}
            >
              {h.areas[item]}
              {item === "approvals" && pending > 0 ? (
                <span className="zr-count">{pending}</span>
              ) : null}
            </button>
          ))}
        </nav>
      )}
      {overview.runner.hubCompanyId !== null ? (
        <WithHubMembers
          environmentId={environmentId}
          hubCompanyId={overview.runner.hubCompanyId}
          humans={overview.humans}
        >
          {content}
        </WithHubMembers>
      ) : (
        content(overview.humans)
      )}
    </div>
  );
}

/** "Firma: Bistro Casa Verde · schimbă". */
function CompanySwitch(props: {
  readonly value: string;
  readonly companies: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly onChange: (companyId: string) => void;
}) {
  const h = useZenText(staffHomeText);
  const current = props.companies.find((company) => company.id === props.value);
  return (
    <div className="zr-soft flex items-center gap-1.5 text-sm" data-staff-company>
      <Building2Icon className="size-4" aria-hidden />
      <span>{h.company}:</span>
      <span className="font-semibold text-zr-ink">{current?.name ?? props.value}</span>
      {props.companies.length > 1 ? (
        <>
          <span aria-hidden>·</span>
          <Menu>
            <MenuTrigger
              render={<button type="button" className="zr-link" />}
              aria-label={h.company}
            >
              {h.companyChange}
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-56">
              {props.companies.map((company) => (
                <MenuItem key={company.id} onClick={() => props.onChange(company.id)}>
                  <span className="flex-1">{company.name}</span>
                  {company.id === props.value ? <CheckIcon className="size-4" aria-hidden /> : null}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        </>
      ) : null}
    </div>
  );
}

/** The team grid's shape while the overview loads. */
function StaffSkeleton(props: { readonly label: string }) {
  return (
    <div className="flex flex-col gap-6" aria-busy aria-label={props.label}>
      <Bone className="h-11 w-[28rem] max-w-full rounded-full" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="zr-card flex flex-col gap-4 p-5">
            <div className="flex items-center gap-3">
              <Bone className="size-12 rounded-xl" />
              <div className="flex flex-1 flex-col gap-2">
                <Bone className="h-4 w-1/2" />
                <Bone className="h-3 w-1/3" />
              </div>
            </div>
            <Bone className="h-3 w-full" />
            <Bone className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** People of a hub-linked company: the hub's members join the local list. */
function WithHubMembers(props: {
  readonly environmentId: EnvironmentId;
  readonly hubCompanyId: string;
  readonly humans: ReadonlyArray<StaffHuman>;
  readonly children: (humans: ReadonlyArray<StaffHuman>) => ReactNode;
}) {
  const { data } = useHubQuery<ZenHubCompanyDetail>(props.environmentId, "company.get", {
    companyId: props.hubCompanyId,
  });
  return <>{props.children(mergeHubMembers(props.humans, data?.members ?? []))}</>;
}
