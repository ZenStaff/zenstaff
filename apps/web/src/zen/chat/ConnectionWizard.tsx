// Zen Staff chat integrations: the guided install for one platform. 1 create the app in the
// company's own account (guide, manifest), 2 paste the tokens (sent once to this server's vault),
// 3 who may talk to it (allow-list, settings), 4 test.
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZEN_CHAT_PLATFORM_INFO,
  type ZenChatConnectionScope,
  type ZenChatConnectionView,
  type ZenChatPlatform,
} from "@t3tools/contracts/zenChat";
import {
  CheckCircle2Icon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "../../components/ui/badge";
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
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { chatText } from "./chat.i18n";
import { useChatQuery, type ChatCall } from "./chatClient";
import { platformGuide } from "./chatGuides.i18n";
import { formatList, parseList, stateTone, validateConnection, wizardStartStep } from "./chatModel";
import { Field, NativeSelect, Problems, notifyError, notifySuccess } from "./chatUi";

interface Manifest {
  readonly kind: "json" | "yaml" | "text" | "url";
  readonly fileName: string | null;
  readonly content: string;
  readonly openUrl: string | null;
}

const TOTAL_STEPS = 4;

export function ConnectionWizard(props: {
  readonly platform: ZenChatPlatform;
  readonly connection: ZenChatConnectionView | null;
  readonly environmentId: EnvironmentId;
  readonly canManage: boolean;
  readonly call: ChatCall;
  readonly onChanged: () => void;
  readonly onClose: () => void;
}) {
  const t = useZenText(chatText);
  const locale = useZenLocale();
  const info = ZEN_CHAT_PLATFORM_INFO[props.platform];
  const guide = platformGuide(props.platform, locale);
  const [connection, setConnection] = useState<ZenChatConnectionView | null>(props.connection);
  const [step, setStep] = useState<number>(wizardStartStep(props.connection));
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(props.connection?.name ?? info.name);
  const [scope, setScope] = useState<ZenChatConnectionScope>(props.connection?.scope ?? "company");
  const [language, setLanguage] = useState(props.connection?.settings.language ?? locale);
  const [settings, setSettings] = useState<Record<string, string>>({
    ...props.connection?.settings,
  });
  const [workspaces, setWorkspaces] = useState(
    formatList(props.connection?.workspaceAllowlist ?? []),
  );
  const [channels, setChannels] = useState(formatList(props.connection?.channelAllowlist ?? []));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [adminConfirmed, setAdminConfirmed] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; detail: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const { data: manifest } = useChatQuery<Manifest>(
    props.environmentId,
    "manifest",
    { platform: props.platform, ...(connection ? { connectionId: connection.id } : {}) },
    { live: false },
  );

  const saveConnection = async (enabled: boolean, full: boolean) => {
    const workspaceAllowlist = parseList(workspaces);
    const merged = { ...settings, language };
    if (full) {
      const found = validateConnection({
        platform: props.platform,
        name,
        workspaceAllowlist,
        settings: merged,
      });
      if (found.length > 0) {
        setProblems(found.map((problem) => t.problems[problem]));
        return null;
      }
    } else if (name.trim() === "") {
      setProblems([t.problems.name]);
      return null;
    }
    setProblems([]);
    setBusy(true);
    try {
      const saved = await props.call<ZenChatConnectionView>("connection.save", {
        connection: {
          ...(connection ? { id: connection.id } : {}),
          platform: props.platform,
          name: name.trim(),
          scope,
          enabled,
          workspaceAllowlist,
          channelAllowlist: parseList(channels),
          settings: merged,
        },
      });
      setConnection(saved);
      props.onChanged();
      setBusy(false);
      return saved;
    } catch (error) {
      notifyError(t.failed, error);
      setBusy(false);
      return null;
    }
  };

  const saveSecrets = async () => {
    if (connection === null) return;
    const entries = Object.entries(secrets).filter(([, value]) => value.trim() !== "");
    setBusy(true);
    try {
      for (const [secretId, value] of entries) {
        await props.call("connection.setSecret", {
          connectionId: connection.id,
          secretId,
          value: value.trim(),
          adminConfirmed: true,
        });
      }
      setSecrets({});
      if (entries.length > 0) notifySuccess(t.tokensSaved);
      const fresh = await props.call<{ connections: ReadonlyArray<ZenChatConnectionView> }>(
        "status",
      );
      setConnection(fresh.connections.find((item) => item.id === connection.id) ?? connection);
      props.onChanged();
      setStep(3);
      setBusy(false);
    } catch (error) {
      notifyError(t.failed, error);
      setBusy(false);
    }
  };

  const removeSecret = async (secretId: string) => {
    if (connection === null) return;
    try {
      await props.call("connection.removeSecret", { connectionId: connection.id, secretId });
      setConnection({
        ...connection,
        secretsStored: { ...connection.secretsStored, [secretId]: false },
      });
      props.onChanged();
    } catch (error) {
      notifyError(t.failed, error);
    }
  };

  const runTest = async () => {
    if (connection === null) return;
    setBusy(true);
    try {
      setTest(
        await props.call<{ ok: boolean; detail: string }>("connection.test", {
          connectionId: connection.id,
        }),
      );
      const fresh = await props.call<{ connections: ReadonlyArray<ZenChatConnectionView> }>(
        "status",
      );
      setConnection(fresh.connections.find((item) => item.id === connection.id) ?? connection);
      props.onChanged();
      setBusy(false);
    } catch (error) {
      setTest({ ok: false, detail: error instanceof Error ? error.message : String(error) });
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => notifySuccess(t.copied));
  };

  const download = (value: Manifest) => {
    const blob = new Blob([value.content], {
      type: value.kind === "json" ? "application/json" : "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download =
      value.fileName ?? `${props.platform}-manifest.${value.kind === "json" ? "json" : "txt"}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const disabled = !props.canManage || busy;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.wizardTitle(info.name)}</DialogTitle>
          <DialogDescription>
            {t.stepOf(step, TOTAL_STEPS)} · {t.stepNames[step - 1]}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ol
            className="mb-4 flex flex-wrap gap-2 text-xs"
            aria-label={t.stepOf(step, TOTAL_STEPS)}
          >
            {t.stepNames.map((label, index) => (
              <li key={label}>
                <button
                  type="button"
                  disabled={connection === null && index > 0}
                  onClick={() => setStep(index + 1)}
                  className={
                    index + 1 === step
                      ? "rounded-full bg-primary px-2.5 py-1 text-primary-foreground"
                      : "rounded-full border px-2.5 py-1 text-muted-foreground disabled:opacity-50"
                  }
                >
                  {index + 1}. {label}
                </button>
              </li>
            ))}
          </ol>

          {step === 1 ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">{guide.intro}</p>
              <ol className="list-decimal space-y-1 pl-5">
                {guide.steps.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  render={
                    <a
                      href={manifest?.openUrl ?? info.createUrl}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <ExternalLinkIcon className="size-4" />
                  {t.openPlatform(info.name)}
                </Button>
              </div>
              {manifest !== null && manifest.kind !== "url" ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-xs">{t.manifest}</span>
                    <span className="text-muted-foreground text-xs">{t.manifestHint}</span>
                    <div className="flex-1" />
                    <Button size="xs" variant="outline" onClick={() => copy(manifest.content)}>
                      <CopyIcon className="size-3.5" />
                      {t.copyManifest}
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => download(manifest)}>
                      <DownloadIcon className="size-3.5" />
                      {t.download}
                    </Button>
                  </div>
                  <pre
                    data-zen-no-translate
                    className="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-2 font-mono text-xs"
                  >
                    {manifest.content}
                  </pre>
                </div>
              ) : null}
              <div>
                <p className="font-medium text-xs">{t.scopesTitle}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {info.scopes.map((scopeName) => (
                    <Badge key={scopeName} variant="outline">
                      {scopeName}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="font-medium text-xs">{t.tosTitle}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground text-xs">
                  {guide.tos.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t.connectionName} htmlFor="chat-connection-name">
                  <Input
                    id="chat-connection-name"
                    value={name}
                    disabled={disabled}
                    placeholder={t.connectionNamePlaceholder}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <Field
                  label={t.scope}
                  htmlFor="chat-connection-scope"
                  hint={scope === "company" ? t.scopeCompanyHint : t.scopePersonalHint}
                >
                  <NativeSelect
                    id="chat-connection-scope"
                    label={t.scope}
                    value={scope}
                    disabled={disabled}
                    onChange={(value) => setScope(value === "personal" ? "personal" : "company")}
                  >
                    <option value="company">{t.scopeCompany}</option>
                    <option value="personal">{t.scopePersonal}</option>
                  </NativeSelect>
                </Field>
              </div>
              <Problems items={problems} />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground text-xs">{t.secretsHint}</p>
              {info.secrets.map((secret) => {
                const stored = connection?.secretsStored[secret.id] === true;
                return (
                  <Field
                    key={secret.id}
                    label={
                      t.secretLabels[`${props.platform}.${secret.id}`] ??
                      t.secretLabels[secret.id] ??
                      secret.label
                    }
                    htmlFor={`chat-secret-${secret.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      {secret.id === "serviceAccountKey" ? (
                        <Textarea
                          id={`chat-secret-${secret.id}`}
                          autoComplete="off"
                          spellCheck={false}
                          disabled={disabled}

                          placeholder={stored ? t.secretPlaceholderStored : secret.hint}
                          value={secrets[secret.id] ?? ""}
                          onChange={(event) =>
                            setSecrets({ ...secrets, [secret.id]: event.target.value })
                          }
                        />
                      ) : (
                        <Input
                          id={`chat-secret-${secret.id}`}
                          type="password"
                          autoComplete="off"
                          disabled={disabled}
                          placeholder={stored ? t.secretPlaceholderStored : secret.hint}
                          value={secrets[secret.id] ?? ""}
                          onChange={(event) =>
                            setSecrets({ ...secrets, [secret.id]: event.target.value })
                          }
                        />
                      )}
                      <Badge variant={stored ? "success" : "outline"} className="shrink-0">
                        {stored ? t.secretStored : t.secretMissing}
                      </Badge>
                      {stored ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={disabled}
                          onClick={() => void removeSecret(secret.id)}
                        >
                          {t.removeToken}
                        </Button>
                      ) : null}
                    </div>
                  </Field>
                );
              })}
              <Label>
                <Checkbox
                  checked={adminConfirmed}
                  disabled={disabled}
                  onCheckedChange={(value) => setAdminConfirmed(value === true)}
                />
                {t.adminConfirm}
              </Label>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col gap-3 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                {info.settings.map((setting) => (
                  <Field
                    key={setting.id}
                    label={`${t.settingLabels[`${props.platform}.${setting.id}`] ?? t.settingLabels[setting.id] ?? setting.label}${setting.required ? " *" : ""}`}
                    htmlFor={`chat-setting-${setting.id}`}
                  >
                    {setting.options ? (
                      <NativeSelect
                        id={`chat-setting-${setting.id}`}
                        label={t.settingLabels[`${props.platform}.${setting.id}`] ?? setting.label}
                        value={settings[setting.id] ?? setting.options[0] ?? ""}
                        disabled={disabled}
                        onChange={(value) => setSettings({ ...settings, [setting.id]: value })}
                      >
                        {setting.options.map((option) => (
                          <option key={option} value={option}>
                            {t.settingOptions[option] ?? option}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Input
                        id={`chat-setting-${setting.id}`}
                        value={settings[setting.id] ?? ""}
                        disabled={disabled}
                        onChange={(event) =>
                          setSettings({ ...settings, [setting.id]: event.target.value })
                        }
                      />
                    )}
                  </Field>
                ))}
                <Field label={t.botLanguage} htmlFor="chat-bot-language">
                  <NativeSelect
                    id="chat-bot-language"
                    label={t.botLanguage}
                    value={language}
                    disabled={disabled}
                    onChange={setLanguage}
                  >
                    <option value="ro">Română</option>
                    <option value="en">English</option>
                  </NativeSelect>
                </Field>
              </div>
              <Field
                label={props.platform === "email" ? t.senderAllowlist : t.workspaceAllowlist}
                hint={props.platform === "email" ? t.senderAllowlistHint : t.workspaceAllowlistHint}
                htmlFor="chat-workspaces"
              >
                <Textarea
                  id="chat-workspaces"

                  value={workspaces}
                  disabled={disabled}
                  onChange={(event) => setWorkspaces(event.target.value)}
                />
              </Field>
              <Field
                label={t.channelAllowlist}
                hint={t.channelAllowlistHint}
                htmlFor="chat-channels"
              >
                <Input
                  id="chat-channels"

                  value={channels}
                  disabled={disabled}
                  onChange={(event) => setChannels(event.target.value)}
                />
              </Field>
              <Problems items={problems} />
            </div>
          ) : null}

          {step === 4 && connection !== null ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground text-xs">
                {info.transport === "hub-relay" ? t.relayNote : t.outboundNote}{" "}
                {t.transport(info.transportName)}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    stateTone(connection.state) === "ok"
                      ? "success"
                      : stateTone(connection.state) === "error"
                        ? "error"
                        : stateTone(connection.state) === "wait"
                          ? "warning"
                          : "outline"
                  }
                >
                  {t.states[connection.state]}
                </Badge>
                {connection.detail ? (
                  <span className="text-muted-foreground text-xs">{connection.detail}</span>
                ) : null}
              </div>
              {connection.webhookUrl ? (
                <Field label={t.webhookUrl}>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={connection.webhookUrl} />
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => copy(connection.webhookUrl!)}
                    >
                      <CopyIcon className="size-3.5" />
                      {t.copy}
                    </Button>
                  </div>
                </Field>
              ) : null}
              <p className="text-muted-foreground text-xs">{t.testHint}</p>
              <div>
                <Button size="sm" disabled={busy} onClick={() => void runTest()}>
                  {busy ? t.testing : t.test}
                </Button>
              </div>
              {test !== null ? (
                <p
                  role="status"
                  className={
                    test.ok
                      ? "flex items-center gap-1 text-success-foreground"
                      : "text-destructive-foreground"
                  }
                >
                  {test.ok ? <CheckCircle2Icon className="size-4" /> : null}
                  {test.ok ? t.testOk : t.failed}
                  {test.detail ? `: ${test.detail}` : ""}
                </p>
              ) : null}
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          {step > 1 ? (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              {t.back}
            </Button>
          ) : null}
          <div className="flex-1" />
          {step === 1 ? (
            <Button
              disabled={disabled}
              onClick={() =>
                void saveConnection(connection?.enabled ?? false, false).then((saved) => {
                  if (saved) setStep(2);
                })
              }
            >
              {t.saveAndContinue}
            </Button>
          ) : null}
          {step === 2 ? (
            <Button disabled={disabled || !adminConfirmed} onClick={() => void saveSecrets()}>
              {t.saveTokens}
            </Button>
          ) : null}
          {step === 3 ? (
            <Button
              disabled={disabled}
              onClick={() =>
                void saveConnection(true, true).then((saved) => {
                  if (saved) setStep(4);
                })
              }
            >
              {t.saveAndContinue}
            </Button>
          ) : null}
          {step === 4 ? <Button onClick={props.onClose}>{t.close}</Button> : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
