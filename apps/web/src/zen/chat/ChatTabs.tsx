// Zen Staff chat integrations: the AI staff, Channels, People, Reports, Settings and Activity tabs.
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenHubCompanyDetail, ZenHubStatus } from "@t3tools/contracts/zenHub";
import {
  ZEN_CHAT_DEFAULT_MODEL,
  ZEN_CHAT_PLATFORM_INFO,
  ZEN_CHAT_PLATFORMS,
  type ZenChatAgent,
  type ZenChatAuditEntry,
  type ZenChatBinding,
  type ZenChatIdentity,
  type ZenChatMember,
  type ZenChatPlatform,
  type ZenChatReport,
  type ZenChatSettings,
  type ZenChatStatus,
} from "@t3tools/contracts/zenChat";
import {
  ActivityIcon,
  BotIcon,
  CalendarClockIcon,
  HashIcon,
  MoonIcon,
  PlayIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { useProjects } from "../../state/entities";
import { useHubCall } from "../hub/hubClient";
import { formatZenRelativeTime } from "../i18n/relativeTime";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { chatText } from "./chat.i18n";
import { useChatQuery, type ChatCall } from "./chatClient";
import {
  ORDERED_DAYS,
  identityLabel,
  isEmail,
  isTime,
  membersToImport,
  postingAgents,
  reportTargets,
  scheduleLabel,
  validateAgent,
  validateBinding,
  validateMember,
  validateReport,
  type ValidationProblem,
} from "./chatModel";
import { Field, NativeSelect, Problems, Section, notifyError, notifySuccess } from "./chatUi";

interface TabProps {
  readonly status: ZenChatStatus;
  readonly call: ChatCall;
  readonly refresh: () => void;
  readonly canManage: boolean;
}

function useSaver(props: TabProps) {
  const t = useZenText(chatText);
  const [busy, setBusy] = useState(false);
  const run = async (
    op: Parameters<ChatCall>[0],
    input: Record<string, unknown>,
    done?: string,
  ) => {
    setBusy(true);
    try {
      const result = await props.call(op, input);
      if (done) notifySuccess(done);
      props.refresh();
      setBusy(false);
      return { ok: true as const, result };
    } catch (error) {
      notifyError(t.failed, error);
      setBusy(false);
      return { ok: false as const };
    }
  };
  const remove = (op: Parameters<ChatCall>[0], id: string, name: string) => {
    if (window.confirm(t.confirmRemove(name))) void run(op, { id }, t.removed);
  };
  return { busy, run, remove };
}

function Row(props: { readonly children: ReactNode; readonly actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-2 border-t pt-2 first:border-t-0 first:pt-0">
      <div className="min-w-0 flex-1 text-sm">{props.children}</div>
      {props.actions ? <div className="flex gap-1.5">{props.actions}</div> : null}
    </div>
  );
}

function RowActions(props: {
  readonly canManage: boolean;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  const t = useZenText(chatText);
  return (
    <>
      <Button size="xs" variant="outline" disabled={!props.canManage} onClick={props.onEdit}>
        {t.edit}
      </Button>
      <Button size="xs" variant="ghost" disabled={!props.canManage} onClick={props.onRemove}>
        {t.remove}
      </Button>
    </>
  );
}

function FormButtons(props: {
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onSave: () => void;
  readonly onCancel?: () => void;
}) {
  const t = useZenText(chatText);
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={props.disabled || props.busy} onClick={props.onSave}>
        {props.busy ? t.saving : t.save}
      </Button>
      {props.onCancel ? (
        <Button size="sm" variant="outline" onClick={props.onCancel}>
          {t.cancel}
        </Button>
      ) : null}
    </div>
  );
}

const problemsText = (
  t: ReturnType<typeof useZenText<typeof chatText.en>>,
  items: ValidationProblem[],
) => items.map((item) => t.problems[item]);

type AgentDraft = Omit<ZenChatAgent, "id"> & { readonly id?: string };

const emptyAgent = (): AgentDraft => ({
  name: "",
  kind: "company",
  managerEmail: "",
  ownerEmail: null,
  projectId: "",
  model: ZEN_CHAT_DEFAULT_MODEL,
  runtimeMode: "auto-accept-edits",
  instructions: "",
});

export function AgentsTab(props: TabProps & { readonly environmentId: EnvironmentId }) {
  const t = useZenText(chatText);
  const { busy, run, remove } = useSaver(props);
  const projects = useProjects().filter(
    (project) =>
      project.environmentId === props.environmentId &&
      project.isScratch !== true &&
      project.archivedAt == null,
  );
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const projectTitle = (id: string) => projects.find((project) => project.id === id)?.title ?? id;

  const save = async () => {
    if (draft === null) return;
    const found = validateAgent(draft);
    setProblems(problemsText(t, found));
    if (found.length > 0) return;
    const saved = await run(
      "agent.save",
      {
        agent: { ...draft, ownerEmail: draft.kind === "personal" ? draft.ownerEmail : null },
      },
      t.saved,
    );
    if (saved.ok) setDraft(null);
  };

  return (
    <Section
      title={t.tabs.agents}
      icon={<BotIcon className="size-4" />}
      actions={
        <Button
          size="xs"
          variant="outline"
          disabled={!props.canManage}
          onClick={() => setDraft(emptyAgent())}
        >
          {t.addAgent}
        </Button>
      }
    >
      {draft !== null ? (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.agentName} htmlFor="chat-agent-name">
              <Input
                id="chat-agent-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </Field>
            <Field
              label={t.agentKind}
              htmlFor="chat-agent-kind"
              hint={draft.kind === "company" ? t.kindCompanyHint : t.kindPersonalHint}
            >
              <NativeSelect
                id="chat-agent-kind"
                label={t.agentKind}
                value={draft.kind}
                onChange={(value) =>
                  setDraft({ ...draft, kind: value === "personal" ? "personal" : "company" })
                }
              >
                <option value="company">{t.kindCompany}</option>
                <option value="personal">{t.kindPersonal}</option>
              </NativeSelect>
            </Field>
            <Field label={t.managerEmail} htmlFor="chat-agent-manager">
              <Input
                id="chat-agent-manager"
                type="email"
                value={draft.managerEmail}
                onChange={(event) => setDraft({ ...draft, managerEmail: event.target.value })}
              />
            </Field>
            {draft.kind === "personal" ? (
              <Field label={t.ownerEmail} htmlFor="chat-agent-owner">
                <Input
                  id="chat-agent-owner"
                  type="email"
                  value={draft.ownerEmail ?? ""}
                  onChange={(event) => setDraft({ ...draft, ownerEmail: event.target.value })}
                />
              </Field>
            ) : null}
            <Field label={t.project} htmlFor="chat-agent-project">
              <NativeSelect
                id="chat-agent-project"
                label={t.project}
                value={draft.projectId}
                onChange={(value) => setDraft({ ...draft, projectId: value })}
              >
                <option value="">{t.chooseProject}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t.runtimeMode} htmlFor="chat-agent-mode">
              <NativeSelect
                id="chat-agent-mode"
                label={t.runtimeMode}
                value={draft.runtimeMode}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    runtimeMode:
                      value === "approval-required" || value === "auto"
                        ? value
                        : "auto-accept-edits",
                  })
                }
              >
                {(["approval-required", "auto-accept-edits", "auto"] as const).map((mode) => (
                  <option key={mode} value={mode}>
                    {t.runtimeModes[mode]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t.model} htmlFor="chat-agent-model">
              <Input
                id="chat-agent-model"
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              />
            </Field>
          </div>
          <Field label={t.instructions} htmlFor="chat-agent-instructions">
            <Textarea
              id="chat-agent-instructions"
              value={draft.instructions}
              placeholder={t.instructionsPlaceholder}
              onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
            />
          </Field>
          <Problems items={problems} />
          <FormButtons
            busy={busy}
            disabled={!props.canManage}
            onSave={() => void save()}
            onCancel={() => setDraft(null)}
          />
        </div>
      ) : null}
      {props.status.agents.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.noAgents}</p>
      ) : (
        props.status.agents.map((agent) => (
          <Row
            key={agent.id}
            actions={
              <RowActions
                canManage={props.canManage}
                onEdit={() => {
                  setProblems([]);
                  setDraft(agent);
                }}
                onRemove={() => remove("agent.remove", agent.id, agent.name)}
              />
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{agent.name}</span>
              <Badge variant="outline">
                {agent.kind === "company" ? t.kindCompany : t.kindPersonal}
              </Badge>
              <span className="text-muted-foreground text-xs">{projectTitle(agent.projectId)}</span>
            </div>
            <p className="text-muted-foreground text-xs">
              {t.managedBy(agent.managerEmail)}
              {agent.ownerEmail ? ` · ${t.ownedBy(agent.ownerEmail)}` : ""} · {agent.model} ·{" "}
              {t.runtimeModes[agent.runtimeMode]}
            </p>
          </Row>
        ))
      )}
    </Section>
  );
}

type BindingDraft = Omit<ZenChatBinding, "id"> & { readonly id?: string };

export function ChannelsTab(props: TabProps) {
  const t = useZenText(chatText);
  const { busy, run, remove } = useSaver(props);
  const { connections, agents, bindings } = props.status;
  const [draft, setDraft] = useState<BindingDraft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const ready = connections.length > 0 && agents.length > 0;

  const save = async () => {
    if (draft === null) return;
    const found = validateBinding(draft);
    setProblems(problemsText(t, found));
    if (found.length > 0) return;
    const saved = await run("binding.save", { binding: draft }, t.saved);
    if (saved.ok) setDraft(null);
  };

  const agentName = (id: string) => agents.find((agent) => agent.id === id)?.name ?? id;

  return (
    <Section
      title={t.tabs.channels}
      icon={<HashIcon className="size-4" />}
      actions={
        <Button
          size="xs"
          variant="outline"
          disabled={!props.canManage || !ready}
          onClick={() =>
            setDraft({
              connectionId: connections[0]?.id ?? "",
              channelId: "",
              channelName: "",
              agentId: agents[0]?.id ?? "",
              respondTo: "mention",
              posters: [],
            })
          }
        >
          {t.addBinding}
        </Button>
      }
    >
      {!ready ? <p className="text-muted-foreground text-sm">{t.needsConnectionAndAgent}</p> : null}
      {draft !== null ? (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.connection} htmlFor="chat-binding-connection">
              <NativeSelect
                id="chat-binding-connection"
                label={t.connection}
                value={draft.connectionId}
                onChange={(value) => setDraft({ ...draft, connectionId: value })}
              >
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name} ({ZEN_CHAT_PLATFORM_INFO[connection.platform].name})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t.answeringAgent} htmlFor="chat-binding-agent">
              <NativeSelect
                id="chat-binding-agent"
                label={t.answeringAgent}
                value={draft.agentId}
                onChange={(value) => setDraft({ ...draft, agentId: value })}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label>
                <Checkbox
                  checked={draft.channelId === "dm"}
                  onCheckedChange={(value) =>
                    setDraft({
                      ...draft,
                      channelId: value === true ? "dm" : "",
                      channelName: value === true ? t.directMessages : draft.channelName,
                    })
                  }
                />
                {t.directMessages}
              </Label>
            </div>
            {draft.channelId !== "dm" ? (
              <>
                <Field label={t.channelId} htmlFor="chat-binding-channel">
                  <Input
                    id="chat-binding-channel"
                    placeholder={t.channelIdPlaceholder}
                    value={draft.channelId}
                    onChange={(event) =>
                      setDraft({ ...draft, channelId: event.target.value.trim() })
                    }
                  />
                </Field>
                <Field label={t.channelName} htmlFor="chat-binding-name">
                  <Input
                    id="chat-binding-name"
                    value={draft.channelName}
                    placeholder="#general"
                    onChange={(event) => setDraft({ ...draft, channelName: event.target.value })}
                  />
                </Field>
                <Field label={t.respondTo} htmlFor="chat-binding-respond">
                  <NativeSelect
                    id="chat-binding-respond"
                    label={t.respondTo}
                    value={draft.respondTo}
                    onChange={(value) =>
                      setDraft({ ...draft, respondTo: value === "all" ? "all" : "mention" })
                    }
                  >
                    <option value="mention">{t.respondMention}</option>
                    <option value="all">{t.respondAll}</option>
                  </NativeSelect>
                </Field>
              </>
            ) : null}
          </div>
          {agents.length > 1 ? (
            <Field label={t.posters} hint={t.postersHint}>
              <div className="flex flex-wrap gap-3">
                {agents
                  .filter((agent) => agent.id !== draft.agentId)
                  .map((agent) => (
                    <Label key={agent.id}>
                      <Checkbox
                        checked={draft.posters.includes(agent.id)}
                        onCheckedChange={(value) =>
                          setDraft({
                            ...draft,
                            posters:
                              value === true
                                ? [...draft.posters, agent.id]
                                : draft.posters.filter((id) => id !== agent.id),
                          })
                        }
                      />
                      {agent.name}
                    </Label>
                  ))}
              </div>
            </Field>
          ) : null}
          <Problems items={problems} />
          <FormButtons
            busy={busy}
            disabled={!props.canManage}
            onSave={() => void save()}
            onCancel={() => setDraft(null)}
          />
        </div>
      ) : null}
      {bindings.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.noBindings}</p>
      ) : (
        connections.map((connection) => {
          const own = bindings.filter((binding) => binding.connectionId === connection.id);
          if (own.length === 0) return null;
          return (
            <div key={connection.id} className="flex flex-col gap-2">
              <p className="font-medium text-xs">
                {connection.name} · {ZEN_CHAT_PLATFORM_INFO[connection.platform].name}
              </p>
              {own.map((binding) => (
                <Row
                  key={binding.id}
                  actions={
                    <RowActions
                      canManage={props.canManage}
                      onEdit={() => {
                        setProblems([]);
                        setDraft(binding);
                      }}
                      onRemove={() =>
                        remove(
                          "binding.remove",
                          binding.id,
                          binding.channelName || binding.channelId,
                        )
                      }
                    />
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {binding.channelId === "dm"
                        ? t.directMessages
                        : binding.channelName || binding.channelId}
                    </span>
                    {binding.channelId !== "dm" ? (
                      <code className="text-muted-foreground text-xs">{binding.channelId}</code>
                    ) : null}
                    <Badge variant="outline">{agentName(binding.agentId)}</Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {binding.respondTo === "all" ? t.respondAll : t.respondMention} · {t.posters}:{" "}
                    {postingAgents(binding, agents)
                      .map((agent) => agent.name)
                      .join(", ")}
                  </p>
                </Row>
              ))}
            </div>
          );
        })
      )}
    </Section>
  );
}

type MemberDraft = Omit<ZenChatMember, "id"> & { readonly id?: string };

export function PeopleTab(props: TabProps) {
  const t = useZenText(chatText);
  const { busy, run, remove } = useSaver(props);
  const hub = useHubCall();
  const [draft, setDraft] = useState<MemberDraft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  // Stable row keys for the identity editor (identities have no id of their own).
  const [identityKeys, setIdentityKeys] = useState<string[]>([]);
  const nextKey = useRef(0);
  const freshKey = () => `identity-${nextKey.current++}`;
  const edit = (member: MemberDraft) => {
    setIdentityKeys(member.identities.map(() => freshKey()));
    setDraft(member);
  };

  const save = async () => {
    if (draft === null) return;
    const found = validateMember(draft);
    setProblems(problemsText(t, found));
    if (found.length > 0) return;
    const saved = await run(
      "member.save",
      { member: { ...draft, email: draft.email.trim().toLowerCase() } },
      t.saved,
    );
    if (saved.ok) setDraft(null);
  };

  const importFromTeam = async () => {
    setImporting(true);
    try {
      const status = await hub.call<ZenHubStatus>("status");
      if (!status.signedIn) {
        notifyError(t.failed, new Error(t.notSignedIn));
        setImporting(false);
        return;
      }
      const linked = [...new Set(Object.values(status.links))];
      const companyIds = linked.length > 0 ? linked : status.companies.map((company) => company.id);
      const found: Array<{ email: string; name: string; role: ZenChatMember["role"] }> = [];
      for (const companyId of companyIds) {
        const detail = await hub.call<ZenHubCompanyDetail>("company.get", { companyId });
        found.push(
          ...detail.members.map((member) => ({
            email: member.email,
            name: member.name,
            role: member.role,
          })),
        );
      }
      const fresh = membersToImport(props.status.members, found);
      for (const member of fresh) await props.call("member.save", { member });
      notifySuccess(fresh.length === 0 ? t.nothingToImport : t.imported(fresh.length));
      props.refresh();
      setImporting(false);
    } catch (error) {
      notifyError(t.failed, error);
      setImporting(false);
    }
  };

  const setIdentity = (index: number, change: Partial<ZenChatIdentity>) => {
    if (draft === null) return;
    setDraft({
      ...draft,
      identities: draft.identities.map((identity, at) =>
        at === index ? { ...identity, ...change } : identity,
      ),
    });
  };

  return (
    <Section
      title={t.tabs.people}
      icon={<UsersIcon className="size-4" />}
      actions={
        <div className="flex gap-1.5">
          <Button
            size="xs"
            variant="outline"
            disabled={!props.canManage || importing}
            onClick={() => void importFromTeam()}
          >
            <UserPlusIcon className="size-3.5" />
            {importing ? t.importing : t.importFromTeam}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={!props.canManage}
            onClick={() => edit({ email: "", name: "", role: "member", identities: [] })}
          >
            {t.addMember}
          </Button>
        </div>
      }
    >
      <p className="text-muted-foreground text-xs">{t.identitiesHint}</p>
      {draft !== null ? (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t.email} htmlFor="chat-member-email">
              <Input
                id="chat-member-email"
                type="email"
                value={draft.email}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })}
              />
            </Field>
            <Field label={t.name} htmlFor="chat-member-name">
              <Input
                id="chat-member-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </Field>
            <Field label={t.role} htmlFor="chat-member-role">
              <NativeSelect
                id="chat-member-role"
                label={t.role}
                value={draft.role}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    role:
                      value === "owner" || value === "admin" || value === "guest"
                        ? value
                        : "member",
                  })
                }
              >
                {(["owner", "admin", "member", "guest"] as const).map((role) => (
                  <option key={role} value={role}>
                    {t.roles[role]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label={t.identities}>
            <div className="flex flex-col gap-2">
              {draft.identities.map((identity, index) => (
                <div
                  key={identityKeys[index] ?? identity.userId}
                  className="flex flex-wrap items-center gap-2"
                >
                  <NativeSelect
                    label={t.platform}
                    value={identity.platform}
                    onChange={(value) => setIdentity(index, { platform: value as ZenChatPlatform })}
                  >
                    {ZEN_CHAT_PLATFORMS.map((platform) => (
                      <option key={platform} value={platform}>
                        {ZEN_CHAT_PLATFORM_INFO[platform].name}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input
                    aria-label={t.workspaceId}
                    placeholder={t.workspaceId}
                    className="w-48"
                    value={identity.workspaceId}
                    onChange={(event) =>
                      setIdentity(index, { workspaceId: event.target.value.trim() })
                    }
                  />
                  <Input
                    aria-label={t.userId}
                    placeholder={t.userId}
                    className="w-48"
                    value={identity.userId}
                    onChange={(event) => setIdentity(index, { userId: event.target.value.trim() })}
                  />
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setIdentityKeys(identityKeys.filter((_, at) => at !== index));
                      setDraft({
                        ...draft,
                        identities: draft.identities.filter((_, at) => at !== index),
                      });
                    }}
                  >
                    {t.remove}
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setIdentityKeys([...identityKeys, freshKey()]);
                    setDraft({
                      ...draft,
                      identities: [
                        ...draft.identities,
                        {
                          platform: props.status.connections[0]?.platform ?? "slack",
                          workspaceId: "",
                          userId: "",
                        },
                      ],
                    });
                  }}
                >
                  {t.addIdentity}
                </Button>
              </div>
            </div>
          </Field>
          <Problems items={problems} />
          <FormButtons
            busy={busy}
            disabled={!props.canManage}
            onSave={() => void save()}
            onCancel={() => setDraft(null)}
          />
        </div>
      ) : null}
      {props.status.members.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.noMembers}</p>
      ) : (
        props.status.members.map((member) => (
          <Row
            key={member.id}
            actions={
              <RowActions
                canManage={props.canManage}
                onEdit={() => {
                  setProblems([]);
                  edit(member);
                }}
                onRemove={() => remove("member.remove", member.id, member.name || member.email)}
              />
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{member.name || member.email}</span>
              <span className="text-muted-foreground text-xs">{member.email}</span>
              <Badge variant="outline">{t.roles[member.role]}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {member.identities.map((identity) => (
                <Badge
                  key={`${identity.platform}:${identity.workspaceId}:${identity.userId}`}
                  variant="secondary"
                >
                  {identityLabel(identity)}
                </Badge>
              ))}
            </div>
          </Row>
        ))
      )}
    </Section>
  );
}

type ReportDraft = Pick<
  ZenChatReport,
  "name" | "agentId" | "bindingId" | "prompt" | "days" | "time" | "enabled"
> & {
  readonly id?: string;
};

export function ReportsTab(props: TabProps) {
  const t = useZenText(chatText);
  const locale = useZenLocale();
  const { busy, run, remove } = useSaver(props);
  const { agents, bindings, reports } = props.status;
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const names = { days: t.dayNames, everyDay: t.everyDay, weekdays: t.weekdays };
  const targets = draft === null ? [] : reportTargets(bindings, draft.agentId);

  const save = async () => {
    if (draft === null) return;
    const found = validateReport(draft);
    setProblems(problemsText(t, found));
    if (found.length > 0) return;
    const saved = await run("report.save", { report: draft }, t.saved);
    if (saved.ok) setDraft(null);
  };

  const runNow = async (report: ZenChatReport) => {
    const result = await run("report.runNow", { id: report.id });
    if (result.ok) {
      const status = (result.result as { status?: unknown } | null)?.status;
      notifySuccess(t.started(typeof status === "string" ? status : "ok"));
    }
  };

  const channelLabel = (bindingId: string) => {
    const binding = bindings.find((item) => item.id === bindingId);
    return binding ? binding.channelName || binding.channelId : bindingId;
  };

  return (
    <Section
      title={t.tabs.reports}
      icon={<CalendarClockIcon className="size-4" />}
      actions={
        <Button
          size="xs"
          variant="outline"
          disabled={!props.canManage || agents.length === 0}
          onClick={() => {
            const agentId = agents[0]?.id ?? "";
            setDraft({
              name: "",
              agentId,
              bindingId: reportTargets(bindings, agentId)[0]?.id ?? "",
              prompt: "",
              days: [1, 2, 3, 4, 5],
              time: "09:00",
              enabled: true,
            });
          }}
        >
          {t.addReport}
        </Button>
      }
    >
      {draft !== null ? (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.reportName} htmlFor="chat-report-name">
              <Input
                id="chat-report-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </Field>
            <Field label={t.reportAgent} htmlFor="chat-report-agent">
              <NativeSelect
                id="chat-report-agent"
                label={t.reportAgent}
                value={draft.agentId}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    agentId: value,
                    bindingId: reportTargets(bindings, value)[0]?.id ?? "",
                  })
                }
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label={t.reportChannel}
              htmlFor="chat-report-channel"
              hint={targets.length === 0 ? t.noReportTargets : undefined}
            >
              <NativeSelect
                id="chat-report-channel"
                label={t.reportChannel}
                value={draft.bindingId}
                onChange={(value) => setDraft({ ...draft, bindingId: value })}
              >
                {targets.map((binding) => (
                  <option key={binding.id} value={binding.id}>
                    {binding.channelName || binding.channelId}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t.time} htmlFor="chat-report-time">
              <Input
                id="chat-report-time"
                type="time"
                value={draft.time}
                onChange={(event) => setDraft({ ...draft, time: event.target.value })}
              />
            </Field>
          </div>
          <Field label={t.days}>
            <div className="flex flex-wrap gap-3">
              {ORDERED_DAYS.map((day) => (
                <Label key={day}>
                  <Checkbox
                    checked={draft.days.includes(day)}
                    onCheckedChange={(value) =>
                      setDraft({
                        ...draft,
                        days:
                          value === true
                            ? [...draft.days, day]
                            : draft.days.filter((item) => item !== day),
                      })
                    }
                  />
                  {t.dayNames[day]}
                </Label>
              ))}
            </div>
          </Field>
          <Field label={t.reportPrompt} htmlFor="chat-report-prompt">
            <Textarea
              id="chat-report-prompt"
              value={draft.prompt}
              placeholder={t.reportPromptPlaceholder}
              onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
            />
          </Field>
          <Label>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(value) => setDraft({ ...draft, enabled: value })}
            />
            {draft.enabled ? t.enabled : t.disabled}
          </Label>
          <Problems items={problems} />
          <FormButtons
            busy={busy}
            disabled={!props.canManage}
            onSave={() => void save()}
            onCancel={() => setDraft(null)}
          />
        </div>
      ) : null}
      {reports.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.noReports}</p>
      ) : (
        reports.map((report) => (
          <Row
            key={report.id}
            actions={
              <>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!props.canManage || busy}
                  onClick={() => void runNow(report)}
                >
                  <PlayIcon className="size-3.5" />
                  {t.runNow}
                </Button>
                <RowActions
                  canManage={props.canManage}
                  onEdit={() => {
                    setProblems([]);
                    setDraft(report);
                  }}
                  onRemove={() => remove("report.remove", report.id, report.name)}
                />
              </>
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{report.name}</span>
              <Badge variant={report.enabled ? "success" : "outline"}>
                {report.enabled ? t.enabled : t.disabled}
              </Badge>
              <span className="text-muted-foreground text-xs">
                {scheduleLabel(report.days, report.time, names)}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {agents.find((agent) => agent.id === report.agentId)?.name ?? report.agentId} ·{" "}
              {channelLabel(report.bindingId)} ·{" "}
              {report.lastRunAt
                ? t.lastRun(
                    formatZenRelativeTime(locale, report.lastRunAt),
                    report.lastStatus ?? "",
                  )
                : t.neverRun}
            </p>
          </Row>
        ))
      )}
    </Section>
  );
}

export function SettingsTab(props: TabProps) {
  const t = useZenText(chatText);
  const locale = useZenLocale();
  const { busy, run } = useSaver(props);
  const [settings, setSettings] = useState<ZenChatSettings>(props.status.settings);
  const [grantUser, setGrantUser] = useState("");
  const [adminConfirmed, setAdminConfirmed] = useState(false);
  const timesValid =
    !settings.quietHours.enabled ||
    (isTime(settings.quietHours.start) && isTime(settings.quietHours.end));
  const sizeValid =
    Number.isFinite(settings.maxAttachmentMb) &&
    settings.maxAttachmentMb >= 1 &&
    settings.maxAttachmentMb <= 100;

  return (
    <>
      <Section title={t.quietHours} icon={<MoonIcon className="size-4" />}>
        <p className="text-muted-foreground text-xs">{t.quietHoursHint}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Label>
            <Switch
              checked={settings.quietHours.enabled}
              disabled={!props.canManage}
              onCheckedChange={(value) =>
                setSettings({ ...settings, quietHours: { ...settings.quietHours, enabled: value } })
              }
            />
            {t.quietHours}
          </Label>
          <Field label={t.from} htmlFor="chat-quiet-start">
            <Input
              id="chat-quiet-start"
              type="time"
              className="w-32"
              disabled={!props.canManage || !settings.quietHours.enabled}
              value={settings.quietHours.start}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  quietHours: { ...settings.quietHours, start: event.target.value },
                })
              }
            />
          </Field>
          <Field label={t.to} htmlFor="chat-quiet-end">
            <Input
              id="chat-quiet-end"
              type="time"
              className="w-32"
              disabled={!props.canManage || !settings.quietHours.enabled}
              value={settings.quietHours.end}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  quietHours: { ...settings.quietHours, end: event.target.value },
                })
              }
            />
          </Field>
        </div>
        <Label>
          <Switch
            checked={settings.logContent}
            disabled={!props.canManage}
            onCheckedChange={(value) => setSettings({ ...settings, logContent: value })}
          />
          {t.logContent}
        </Label>
        <p className="text-muted-foreground text-xs">{t.logContentHint}</p>
        <Field label={t.maxAttachmentMb} htmlFor="chat-max-mb">
          <Input
            id="chat-max-mb"
            type="number"
            min={1}
            max={100}
            className="w-32"
            disabled={!props.canManage}
            value={String(settings.maxAttachmentMb)}
            onChange={(event) =>
              setSettings({ ...settings, maxAttachmentMb: Number(event.target.value) })
            }
          />
        </Field>
        <Problems items={timesValid ? [] : [t.problems.time]} />
        <FormButtons
          busy={busy}
          disabled={!props.canManage || !timesValid || !sizeValid}
          onSave={() => void run("settings.save", { settings }, t.saved)}
        />
      </Section>
      <Section title={t.access} icon={<ShieldCheckIcon className="size-4" />}>
        <p className="text-muted-foreground text-xs">{t.accessHint}</p>
        {props.status.access.grants.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.none}</p>
        ) : (
          props.status.access.grants.map((grant) => (
            <Row
              key={grant.user}
              actions={
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={!props.canManage}
                  onClick={() => void run("access.revoke", { user: grant.user }, t.saved)}
                >
                  {t.revoke}
                </Button>
              }
            >
              <span className="font-medium">{grant.user}</span>{" "}
              <span className="text-muted-foreground text-xs">
                {t.grantedBy(grant.grantedBy, formatZenRelativeTime(locale, grant.at))}
              </span>
            </Row>
          ))
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t.grantUser} htmlFor="chat-grant-user">
            <Input
              id="chat-grant-user"
              type="email"
              className="w-64"
              value={grantUser}
              onChange={(event) => setGrantUser(event.target.value)}
            />
          </Field>
          <Label>
            <Checkbox
              checked={adminConfirmed}
              onCheckedChange={(value) => setAdminConfirmed(value === true)}
            />
            {t.adminConfirm}
          </Label>
          <Button
            size="sm"
            disabled={!isEmail(grantUser) || !adminConfirmed || busy}
            onClick={() =>
              void run(
                "access.grant",
                { user: grantUser.trim().toLowerCase(), adminConfirmed: true },
                t.saved,
              ).then((done) => {
                if (done.ok) setGrantUser("");
              })
            }
          >
            {t.grant}
          </Button>
        </div>
      </Section>
    </>
  );
}

export function ActivityTab(props: { readonly environmentId: EnvironmentId }) {
  const t = useZenText(chatText);
  const locale = useZenLocale();
  const { data, error, refresh } = useChatQuery<ReadonlyArray<ZenChatAuditEntry>>(
    props.environmentId,
    "audit.list",
    { limit: 200 },
  );
  return (
    <Section
      title={t.tabs.activity}
      icon={<ActivityIcon className="size-4" />}
      actions={
        <Button size="xs" variant="outline" onClick={refresh}>
          {t.refresh}
        </Button>
      }
    >
      <p className="text-muted-foreground text-xs">{t.activityHint}</p>
      {error !== null ? <p className="text-destructive-foreground text-sm">{error}</p> : null}
      {data === null || data.length === 0 ? (
        <p className="text-muted-foreground text-sm">{data === null ? t.loading : t.noActivity}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">{t.columns.at}</th>
                <th className="py-1 pr-3 font-medium">{t.columns.direction}</th>
                <th className="py-1 pr-3 font-medium">{t.columns.platform}</th>
                <th className="py-1 pr-3 font-medium">{t.columns.kind}</th>
                <th className="py-1 pr-3 font-medium">{t.columns.channel}</th>
                <th className="py-1 pr-3 font-medium">{t.columns.who}</th>
                <th className="py-1 pr-3 font-medium">{t.columns.agent}</th>
                <th className="py-1 pr-3 font-medium">{t.columns.outcome}</th>
                <th className="py-1 font-medium">{t.columns.size}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((entry) => (
                <tr
                  key={`${entry.at}:${entry.direction}:${entry.kind}:${entry.userId ?? ""}:${entry.channelId ?? ""}:${entry.outcome}:${entry.chars}`}
                  className="border-t align-top"
                >
                  <td className="py-1 pr-3 whitespace-nowrap">
                    {formatZenRelativeTime(locale, entry.at)}
                  </td>
                  <td className="py-1 pr-3">{t.directions[entry.direction] ?? entry.direction}</td>
                  <td className="py-1 pr-3">
                    {ZEN_CHAT_PLATFORM_INFO[entry.platform]?.name ?? entry.platform}
                  </td>
                  <td className="py-1 pr-3">{entry.kind}</td>
                  <td className="py-1 pr-3 font-mono">{entry.channelId ?? "-"}</td>
                  <td className="py-1 pr-3">{entry.memberEmail ?? entry.userId ?? "-"}</td>
                  <td className="py-1 pr-3">{entry.agentId ?? "-"}</td>
                  <td className="py-1 pr-3">
                    {entry.outcome}
                    {entry.redacted && entry.redacted.length > 0
                      ? ` (redacted: ${entry.redacted.join(", ")})`
                      : ""}
                    {entry.text ? (
                      <span className="block text-muted-foreground">{entry.text}</span>
                    ) : null}
                  </td>
                  <td className="py-1 whitespace-nowrap">
                    {entry.chars}
                    {entry.attachments > 0 ? ` +${entry.attachments}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
