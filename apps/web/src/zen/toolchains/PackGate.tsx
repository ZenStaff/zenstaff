// Zen Staff: marketplace rules from a pack's `access` block. Beta packs stay hidden unless
// "Show beta" is on; an Enterprise pack needs a company admin's approval (recorded on this
// machine; the hub role check is a seam) before ZenOffice installs it.
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenMarketplaceEntry } from "@t3tools/contracts/zenOffice";
import { ShieldCheckIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { Label } from "../../components/ui/label";
import { useZenText } from "../i18n/zenI18n";
import { useOfficeCompany } from "../office/useOfficeCompany";
import { usePackAccess } from "./ToolchainBadge";
import { toolchainsText } from "./toolchains.i18n";
import { callToolchains } from "./toolchainsState";

export function ZenShowBetaToggle(props: {
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  const t = useZenText(toolchainsText);
  return (
    <Button
      size="xs"
      variant={props.value ? "default" : "outline"}
      aria-pressed={props.value}
      onClick={() => props.onChange(!props.value)}
    >
      {t.showBeta}
    </Button>
  );
}

export function ZenPackGate(props: {
  readonly environmentId: EnvironmentId;
  readonly item: ZenMarketplaceEntry;
  readonly showBeta: boolean;
  readonly onInstall: () => void;
  readonly children: (onInstall: () => void) => ReactNode;
}) {
  if (props.item.entry.kind !== "pack") return props.children(props.onInstall);
  return <PackGate {...props} />;
}

function PackGate(props: {
  readonly environmentId: EnvironmentId;
  readonly item: ZenMarketplaceEntry;
  readonly showBeta: boolean;
  readonly onInstall: () => void;
  readonly children: (onInstall: () => void) => ReactNode;
}) {
  const t = useZenText(toolchainsText);
  const access = usePackAccess(props.environmentId, props.item.entry.id);
  // The approval is the active company's: on a server for several companies another one's never counts.
  const { companyId } = useOfficeCompany();
  const [asking, setAsking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (access?.stability === "beta" && !props.showBeta && !props.item.installed) return null;
  const enterprise = access?.tier === "enterprise";
  const approve = async () => {
    const result = await callToolchains("approveInstall", props.environmentId, {
      packId: props.item.entry.id,
      adminConfirmed: confirmed,
      ...(companyId ? { localCompanyId: companyId } : {}),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAsking(false);
    props.onInstall();
  };
  return (
    <>
      {props.children(enterprise ? () => setAsking(true) : props.onInstall)}
      {asking ? (
        <Dialog open onOpenChange={(open) => !open && setAsking(false)}>
          <DialogPopup className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                <span className="flex items-center gap-2">
                  <ShieldCheckIcon className="size-4.5 text-primary" />
                  {t.approveTitle}
                </span>
              </DialogTitle>
              <DialogDescription>{t.approveBody(props.item.entry.name)}</DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <div className="flex flex-col gap-3 text-sm">
                {(access?.secrets.length ?? 0) > 0 ? (
                  <p className="text-muted-foreground">
                    {t.secretsNeeded}{" "}
                    {access!.secrets
                      .map(
                        (secret) =>
                          `${secret.label} (${secret.readOnly ? t.readOnly : t.canChange})`,
                      )
                      .join(", ")}
                  </p>
                ) : null}
                <Label>
                  <Checkbox
                    checked={confirmed}
                    onCheckedChange={(value) => setConfirmed(value === true)}
                  />
                  {t.approveCheck}
                </Label>
                {error ? (
                  <p role="alert" className="text-destructive-foreground">
                    {error}
                  </p>
                ) : null}
              </div>
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAsking(false)}>
                {t.cancel}
              </Button>
              <Button disabled={!confirmed} onClick={() => void approve()}>
                {t.approveButton}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}
