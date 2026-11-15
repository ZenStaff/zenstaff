// Zen Staff first run, "Am primit o invitație": an invited employee pastes the link from the
// e-mail, signs in with the invited address (code by e-mail) and joins the company. No company
// interview: the company belongs to whoever invited them. The hub address comes from the link
// itself, so a person never types or reads a server address. ZEN.md, "First run".
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenHubStatus } from "@t3tools/contracts/zenHub";
import { CheckCircle2Icon, LoaderIcon, MailIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { hubErrorMessage, useHubCall, useHubQuery } from "../hub/hubClient";
import { useZenText } from "../i18n/zenI18n";
import { firstStepsText } from "./firstSteps.i18n";
import { hubOfInviteLink } from "./firstRunModel";

export function InviteJoin(props: {
  readonly environmentId: EnvironmentId;
  readonly onJoined: (company: { readonly hubCompanyId: string; readonly name: string }) => void;
}) {
  const t = useZenText(firstStepsText);
  const { call } = useHubCall();
  const { data: status, refresh } = useHubQuery<ZenHubStatus>(props.environmentId, "status");
  const [link, setLink] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hubUrl = hubOfInviteLink(link);
  const signedIn = status?.signedIn === true;

  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    // Promise chain, not try/finally: the React Compiler skips components with a finally.
    return work()
      .then(() => refresh())
      .catch((cause: unknown) => setError(hubErrorMessage(cause, t.failed)))
      .then(() => setBusy(false));
  };

  const join = (input: Record<string, unknown>, fallbackName: string) =>
    run(async () => {
      const joined = await call<{ companyId: string }>("invite.accept", input);
      props.onJoined({ hubCompanyId: joined.companyId, name: fallbackName });
    });

  const companyOfLink = status?.invites[0]?.companyName ?? "";

  return (
    <div className="flex flex-col gap-4" data-zen-welcome="invite">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">{t.inviteTitle}</h1>
        <p className="mt-2 text-muted-foreground text-sm">{t.inviteIntro}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="zen-invite-link">{t.inviteLink}</Label>
        <Input
          id="zen-invite-link"
          value={link}
          placeholder={t.inviteLinkPlaceholder}
          onChange={(event) => setLink(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          data-zen-invite-link
        />
        {link.trim() !== "" && hubUrl === null ? (
          <p className="text-destructive-foreground text-xs">{t.badLink}</p>
        ) : null}
      </div>
      {signedIn ? (
        <div className="flex flex-col gap-3">
          {status?.user ? (
            <p className="text-muted-foreground text-sm">{t.signedInAs(status.user.email)}</p>
          ) : null}
          {status?.invites.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <MailIcon className="size-4 text-muted-foreground" aria-hidden />
              <span className="flex-1">
                {t.pending(invite.companyName, t.roles[invite.role] ?? invite.role)}
              </span>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void join({ inviteId: invite.id }, invite.companyName)}
              >
                {t.join}
              </Button>
            </div>
          ))}
          {hubUrl !== null ? (
            <Button
              className="self-start"
              disabled={busy}
              onClick={() => void join({ token: link.trim() }, companyOfLink)}
              data-zen-invite-join
            >
              {busy ? <LoaderIcon className="animate-spin" /> : <CheckCircle2Icon />}
              {t.join}
            </Button>
          ) : null}
        </div>
      ) : status?.pendingEmail ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => call("signIn.verify", { code: code.trim() }));
          }}
        >
          <p className="text-sm">{t.codeSent(status.pendingEmail)}</p>
          <div className="flex gap-2">
            <Input
              aria-label={t.code}
              placeholder={t.code}
              inputMode="numeric"
              className="max-w-40"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <Button type="submit" disabled={busy || code.trim().length < 6}>
              {t.signIn}
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (hubUrl === null) return;
            void run(() => call("signIn.start", { hubUrl, email: email.trim() }));
          }}
        >
          <Label htmlFor="zen-invite-email">{t.email}</Label>
          <div className="flex gap-2">
            <Input
              id="zen-invite-email"
              type="email"
              value={email}
              placeholder={t.emailPlaceholder}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button
              type="submit"
              disabled={busy || hubUrl === null || email.trim() === ""}
              data-zen-invite-send-code
            >
              {t.sendCode}
            </Button>
          </div>
        </form>
      )}
      {error !== null ? (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
