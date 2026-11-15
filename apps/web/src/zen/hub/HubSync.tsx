// Zen Staff hub: while signed in, edition and language follow the person (the hub's choice is
// applied once per session, later changes here are saved there), and Academy lessons marked done
// are reported to every hub company the person belongs to. Without a hub both stay per device.
import type { ZenHubStatus } from "@t3tools/contracts/zenHub";
import { useEffect, useRef } from "react";

import { setAcademyProgressSink } from "../academy/progress";
import { setZenLocalePreference, useZenLocalePreference } from "../i18n/zenI18n";
import { applyDeviceEdition, getDeviceEdition } from "../office/editionStore";
import { useZenEdition } from "../office/useZenEdition";
import { useHubCall, useHubQuery } from "./hubClient";

export function decidePreferenceSync(input: {
  readonly hub: {
    readonly edition: "office" | "code" | null;
    readonly language: "en" | "ro" | null;
  };
  readonly local: { readonly edition: "office" | "code"; readonly language: string };
}): {
  readonly applyEdition: "office" | "code" | null;
  readonly applyLanguage: "en" | "ro" | null;
} {
  return {
    applyEdition:
      input.hub.edition !== null && input.hub.edition !== input.local.edition
        ? input.hub.edition
        : null,
    applyLanguage:
      input.hub.language !== null && input.hub.language !== input.local.language
        ? input.hub.language
        : null,
  };
}

export function HubSync() {
  const { environmentId, call } = useHubCall();
  return environmentId === null ? null : <HubSyncFor environmentId={environmentId} call={call} />;
}

function HubSyncFor(props: {
  readonly environmentId: NonNullable<ReturnType<typeof useHubCall>["environmentId"]>;
  readonly call: ReturnType<typeof useHubCall>["call"];
}) {
  const { data: status } = useHubQuery<ZenHubStatus>(props.environmentId, "status");
  const edition = useZenEdition();
  const language = useZenLocalePreference();
  const applied = useRef(false);
  const ready =
    status !== null &&
    status.signedIn &&
    status.twoFactor?.gate !== "enroll" &&
    status.twoFactor?.gate !== "verify";
  const { call } = props;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies the person's hub preferences to this device once per session
  useEffect(() => {
    if (!ready || applied.current || status?.preferences == null) return;
    applied.current = true;
    const decision = decidePreferenceSync({
      hub: status.preferences,
      local: { edition: getDeviceEdition() ?? edition, language },
    });
    if (decision.applyEdition !== null) applyDeviceEdition(decision.applyEdition);
    if (decision.applyLanguage !== null) setZenLocalePreference(decision.applyLanguage);
  }, [ready, status, edition, language]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- saves this device's edition and language to the person's hub profile
  useEffect(() => {
    if (!ready || !applied.current) return;
    void call("preferences.set", {
      edition,
      ...(language === "en" || language === "ro" ? { language } : {}),
    }).catch(() => undefined);
  }, [ready, call, edition, language]);

  const companies = status?.companies;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports Academy lessons to the hub while signed in
  useEffect(() => {
    if (!ready || companies === undefined || companies.length === 0) return;
    setAcademyProgressSink((event) => {
      for (const company of companies) {
        void call("academy.progress.set", {
          companyId: company.id,
          lessonId: event.lessonId,
          done: event.done,
        }).catch(() => undefined);
      }
    });
    return () => setAcademyProgressSink(null);
  }, [ready, call, companies]);

  return null;
}
