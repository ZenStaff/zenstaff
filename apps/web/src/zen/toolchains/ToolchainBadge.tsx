// Zen Staff: badges on Office workflow cards (ready / setup needed / not supported here, the
// Enterprise tier and its lock) and the requirements of marketplace packs before install.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { formatBytes, type ZenAccessView } from "@t3tools/contracts/zenToolchains";
import { AsyncResult } from "effect/reactivity";
import { LockIcon } from "lucide-react";

import { Badge } from "../../components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { useOfficeCompany } from "../office/useOfficeCompany";
import { toolchainsText } from "./toolchains.i18n";
import {
  STATUS_BADGES,
  toolchainCheck,
  toolchainStatuses,
  useZenRequester,
} from "./toolchainsState";

/** One shared request per company; nothing for plain workflows. */
export function ZenToolchainBadge({
  workflowId,
  hideReady = false,
}: {
  readonly workflowId: string;
  /** The Birou cards say nothing when a task is ready; only setup, limits and locks show. */
  readonly hideReady?: boolean;
}) {
  const environmentId = usePrimaryEnvironmentId();
  const { companyId } = useOfficeCompany();
  if (environmentId === null) return null;
  return (
    <CardBadges
      environmentId={environmentId}
      companyId={companyId}
      workflowId={workflowId}
      hideReady={hideReady}
    />
  );
}

function CardBadges(props: {
  readonly environmentId: EnvironmentId;
  readonly companyId: string | null;
  readonly workflowId: string;
  readonly hideReady: boolean;
}) {
  const t = useZenText(toolchainsText);
  const requester = useZenRequester();
  const locale = useZenLocale();
  const result = useAtomValue(
    toolchainStatuses({
      environmentId: props.environmentId,
      input: { companyId: props.companyId, requester, locale },
    }),
  );
  if (!AsyncResult.isSuccess(result)) return null;
  const summary = result.value.find((item) => item.workflowId === props.workflowId);
  if (!summary) return null;
  const badge = STATUS_BADGES[summary.status];
  return (
    <>
      <AccessBadges access={summary.access} />
      {summary.hasRequirements &&
      summary.access.lock === null &&
      !(props.hideReady && summary.status === "ready") ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge variant={badge.variant} size="sm" data-zen-toolchain-status={summary.status}>
                {t.status[summary.status]}
              </Badge>
            }
          />
          <TooltipPopup>{summary.headline}</TooltipPopup>
        </Tooltip>
      ) : null}
    </>
  );
}

/** Enterprise (with its lock reason) and Beta badges. Standard is shown only when asked. */
function AccessBadges(props: { readonly access: ZenAccessView; readonly showStandard?: boolean }) {
  const t = useZenText(toolchainsText);
  const { access } = props;
  return (
    <>
      {access.stability === "beta" ? (
        <Badge variant="info" size="sm">
          {t.tier.beta}
        </Badge>
      ) : null}
      {access.tier === "enterprise" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge
                variant={access.lock ? "warning" : "secondary"}
                size="sm"
                data-zen-tier="enterprise"
              >
                {access.lock ? <LockIcon /> : null}
                {t.tier.enterprise}
              </Badge>
            }
          />
          <TooltipPopup>{access.lock ? t.lock[access.lock.code] : t.enterpriseHint}</TooltipPopup>
        </Tooltip>
      ) : props.showStandard ? (
        <Badge variant="outline" size="sm" data-zen-tier="standard">
          {t.tier.standard}
        </Badge>
      ) : null}
    </>
  );
}

/** A pack's access (tier, beta) for the marketplace, or null while it loads. */
export function usePackAccess(environmentId: EnvironmentId, packId: string): ZenAccessView | null {
  const requester = useZenRequester();
  const locale = useZenLocale();
  const result = useAtomValue(
    toolchainCheck({ environmentId, input: { workflowId: packId, packId, requester, locale } }),
  );
  return AsyncResult.isSuccess(result) ? result.value.access : null;
}

/** Requirements, access and license notes of a marketplace pack, before it is installed. */
export function ZenPackRequirements({ packId }: { readonly packId: string }) {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) return null;
  return <PackRequirements environmentId={environmentId} packId={packId} />;
}

function PackRequirements(props: {
  readonly environmentId: EnvironmentId;
  readonly packId: string;
}) {
  const t = useZenText(toolchainsText);
  const requester = useZenRequester();
  const locale = useZenLocale();
  const result = useAtomValue(
    toolchainCheck({
      environmentId: props.environmentId,
      input: { workflowId: props.packId, packId: props.packId, requester, locale },
    }),
  );
  if (!AsyncResult.isSuccess(result)) return null;
  const compatibility = result.value;
  const access = compatibility.access;
  return (
    <div className="flex flex-col gap-1.5 text-xs" aria-label={t.requirements}>
      <div className="flex flex-wrap items-center gap-1.5">
        <AccessBadges access={access} showStandard />
        {access.tier === "enterprise" ? (
          <span className="text-muted-foreground">{t.enterpriseHint}</span>
        ) : null}
      </div>
      {compatibility.hasRequirements ? (
        <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <span className="font-medium">{t.needs}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {compatibility.tools
                .filter((tool) => !tool.optional)
                .map((tool) => tool.name)
                .join(", ")}
            </span>
            <Badge variant={STATUS_BADGES[compatibility.status].variant} size="sm">
              {t.status[compatibility.status]}
            </Badge>
          </div>
          {compatibility.downloadBytes > 0 ? (
            <p className="text-muted-foreground">
              {t.oneTimeSetup(formatBytes(compatibility.downloadBytes))}
            </p>
          ) : null}
          {compatibility.status === "not-compatible" ? (
            <p className="text-destructive-foreground">{compatibility.headline}</p>
          ) : null}
          {compatibility.licenseNotes
            .filter((note) => note.commercialUse === "paid")
            .map((note) => (
              <p key={note.toolId} className="text-warning-foreground">
                {note.name}: {note.note}
              </p>
            ))}
        </div>
      ) : null}
      {access.secrets.length > 0 ? (
        <p className="text-muted-foreground">
          {t.secretsNeeded}{" "}
          {access.secrets
            .map((secret) => `${secret.label} (${secret.readOnly ? t.readOnly : t.canChange})`)
            .join(", ")}
        </p>
      ) : null}
    </div>
  );
}
