// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalConsole:off globalFetch:off -- Dev end-to-end driver, plain Node.
// Zen Staff chat integrations: end-to-end run against the fake platforms (fakePlatforms.ts).
//
// 1. `setup <zenHome> <projectId>` writes a chat configuration (Slack + Telegram connections,
//    an agent on Haiku 5.5 in auto-accept-edits, members, bindings) and the bot tokens into the
//    runner's vault of a throwaway Zen home, and marks the machine as the company server.
// 2. Start the fake platforms and the Zen server with ZEN_CHAT_*_API_URL pointing at them.
// 3. `run <fakeBaseUrl> slack|telegram` mentions the bot, waits for the answer in the thread, waits
//    for the approval card sent to the manager, approves it as the manager (after a refused click
//    by the requester) and waits for the agent to finish the action.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { SecretVault } from "../../toolchains/vault.ts";

const [command, ...args] = process.argv.slice(2);

function setup(zenHome: string, projectId: string) {
  const chatDir = NodePath.join(zenHome, "userdata", "zen", "chat");
  NodeFS.mkdirSync(chatDir, { recursive: true });
  const agent = {
    id: "agent-ana",
    name: "Ana (office)",
    kind: "company",
    managerEmail: "ion@acme.test",
    ownerEmail: null,
    projectId,
    model: "claude-haiku-5-5",
    runtimeMode: "auto-accept-edits",
    instructions: "You work for Acme. Sending things to customers is done with `node send.js`.",
  };
  const config = {
    connections: [
      {
        id: "slack-acme",
        platform: "slack",
        name: "Acme Slack",
        scope: "company",
        enabled: true,
        workspaceAllowlist: ["T0ACME"],
        channelAllowlist: [],
        settings: { teamId: "T0ACME", language: "en" },
      },
      {
        id: "telegram-acme",
        platform: "telegram",
        name: "Acme Telegram",
        scope: "company",
        enabled: true,
        workspaceAllowlist: ["telegram"],
        channelAllowlist: [],
        settings: { botUsername: "ZenStaffTestBot", language: "ro" },
      },
    ],
    agents: [agent],
    bindings: [
      {
        id: "binding-sales",
        connectionId: "slack-acme",
        channelId: "C0SALES",
        channelName: "sales",
        agentId: agent.id,
        respondTo: "mention",
        posters: [],
      },
      {
        id: "binding-tg-group",
        connectionId: "telegram-acme",
        channelId: "-1002233",
        channelName: "Echipa vânzări",
        agentId: agent.id,
        respondTo: "mention",
        posters: [],
      },
      {
        id: "binding-tg-dm",
        connectionId: "telegram-acme",
        channelId: "dm",
        channelName: "",
        agentId: agent.id,
        respondTo: "mention",
        posters: [],
      },
    ],
    members: [
      {
        id: "member-maria",
        email: "maria@acme.test",
        name: "Maria Pop",
        role: "member",
        identities: [{ platform: "telegram", workspaceId: "telegram", userId: "7001" }],
      },
      {
        id: "member-ion",
        email: "ion@acme.test",
        name: "Ion Ionescu",
        role: "admin",
        identities: [
          { platform: "slack", workspaceId: "T0ACME", userId: "UION" },
          { platform: "telegram", workspaceId: "telegram", userId: "7002" },
        ],
      },
    ],
    reports: [
      {
        id: "report-daily",
        name: "Daily summary",
        agentId: agent.id,
        bindingId: "binding-sales",
        prompt: "List the files in your folder in one short sentence.",
        days: [1, 2, 3, 4, 5],
        time: "09:00",
        enabled: true,
        lastRunAt: null,
        lastStatus: null,
      },
    ],
    settings: {
      quietHours: { enabled: true, start: "21:00", end: "07:30" },
      logContent: false,
      maxAttachmentMb: 20,
    },
  };
  NodeFS.writeFileSync(NodePath.join(chatDir, "chat.json"), JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
  // Without a hub, the local "company's always-on server" switch makes this machine the runner.
  const toolchainsDir = NodePath.join(zenHome, "toolchains");
  NodeFS.mkdirSync(toolchainsDir, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(toolchainsDir, "state.json"),
    JSON.stringify({ settings: { companyRunner: true } }),
  );
  const vault = new SecretVault(NodePath.join(toolchainsDir, "access"), "linux", true);
  vault.set("chat:slack-acme", "botToken", "xoxb-fake-bot-token");
  vault.set("chat:slack-acme", "appToken", "xapp-fake-app-token");
  vault.set("chat:telegram-acme", "botToken", "6000:fake-telegram-token");
  console.log(`configured ${chatDir} (vault key store: ${vault.keyStore})`);
}

interface Entry {
  readonly platform: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
}

async function run(base: string, platform: "slack" | "telegram") {
  const post = async (path: string, body: unknown) =>
    (await (
      await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json()) as Record<string, unknown>;
  const entries = async () =>
    ((await (await fetch(`${base}/control/log`)).json()) as { log: Entry[] }).log;
  const waitFor = async (label: string, test: (entry: Entry) => boolean, timeoutMs = 240_000) => {
    const started = Date.now();
    for (;;) {
      const found = (await entries()).find(test);
      if (found) {
        console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${label}`);
        return found;
      }
      if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };
  const textOf = (entry: Entry) => String(entry.body.text ?? "");
  if (platform === "slack") {
    const mention = await post("/control/slack/mention", {
      user: "UION",
      channel: "C0SALES",
      text: "<@UZENBOT> Please send this week's newsletter to our customers.",
    });
    console.log(
      `mention ts=${String(mention.ts)} delivered to ${String(mention.delivered)} socket(s)`,
    );
    const rootTs = String(mention.ts);
    await waitFor(
      "working placeholder in the thread",
      (entry) => entry.method === "chat.postMessage" && entry.body.thread_ts === rootTs,
    );
    const card = await waitFor(
      "approval card sent to the manager (DM to UION)",
      (entry) =>
        entry.method === "chat.postMessage" &&
        entry.body.channel === "UION" &&
        JSON.stringify(entry.body.blocks ?? "").includes("zenapr:"),
    );
    console.log(`card: ${textOf(card).slice(0, 300)}`);
    const value = JSON.stringify(card.body.blocks).match(/zenapr:[a-f0-9]{16}:accept/)![0];
    await post("/control/slack/click", {
      user: "UMARIA",
      channel: "DION",
      message_ts: card.result?.ts,
      value,
    });
    await waitFor(
      "refused click from a non-manager",
      (entry) =>
        entry.method === "response_url" && String(entry.body.text).includes("Only ion@acme.test"),
    );
    await post("/control/slack/click", {
      user: "UION",
      channel: "DION",
      message_ts: card.result?.ts,
      value,
    });
    await waitFor(
      "card updated: approved by the manager",
      (entry) => entry.method === "chat.update" && textOf(entry).includes("Approved by Ion"),
    );
    const answer = await waitFor(
      "final answer in the thread after the action",
      (entry) =>
        (entry.method === "chat.update" || entry.method === "chat.postMessage") &&
        (entry.body.thread_ts === rootTs || entry.body.channel === "C0SALES") &&
        /sent|trimis|newsletter/i.test(textOf(entry)) &&
        !textOf(entry).includes("Working") &&
        !textOf(entry).includes("approval"),
    );
    console.log(`answer: ${textOf(answer).slice(0, 400)}`);
  } else {
    const message = await post("/control/telegram/message", {
      from: { id: 7002, first_name: "Ion", last_name: "Ionescu" },
      chat: { id: -1002233, type: "supergroup", title: "Echipa vânzări" },
      text: "@ZenStaffTestBot trimite te rog newsletter-ul săptămânii către clienți.",
    });
    console.log(`telegram message ${String(message.message_id)}`);
    await waitFor("typing indicator", (entry) => entry.method === "sendChatAction");
    const card = await waitFor(
      "approval card sent to the manager (DM chat 7002)",
      (entry) =>
        entry.method === "sendMessage" &&
        String(entry.body.chat_id) === "7002" &&
        JSON.stringify(entry.body.reply_markup ?? "").includes("zenapr:"),
    );
    console.log(`card: ${textOf(card).slice(0, 300)}`);
    const data = JSON.stringify(card.body.reply_markup).match(/zenapr:[a-f0-9]{16}:accept/)![0];
    await post("/control/telegram/click", {
      from: { id: 7001, first_name: "Maria" },
      chat: { id: 7002, type: "private" },
      message_id: card.result?.message_id,
      data,
    });
    await waitFor(
      "refused click from a non-manager",
      (entry) =>
        entry.method === "answerCallbackQuery" &&
        String(entry.body.text ?? "").includes("Doar ion@acme.test"),
    );
    await post("/control/telegram/click", {
      from: { id: 7002, first_name: "Ion" },
      chat: { id: 7002, type: "private" },
      message_id: card.result?.message_id,
      data,
    });
    await waitFor(
      "card updated: approved",
      (entry) => entry.method === "editMessageText" && textOf(entry).includes("Aprobat de Ion"),
    );
    const answer = await waitFor(
      "final answer in the group, replying to the message",
      (entry) =>
        entry.method === "sendMessage" &&
        String(entry.body.chat_id) === "-1002233" &&
        /trimis|sent|newsletter/i.test(textOf(entry)) &&
        !textOf(entry).includes("Aștept"),
    );
    console.log(`answer: ${textOf(answer).slice(0, 400)}`);
  }
}

if (command === "setup") setup(args[0]!, args[1]!);
else if (command === "run") {
  run(args[0]!, args[1] === "telegram" ? "telegram" : "slack").then(
    () => console.log("END TO END OK"),
    (error) => {
      console.error(String(error));
      process.exitCode = 1;
    },
  );
} else
  console.log("usage: e2eChat.ts setup <zenHome> <projectId> | run <fakeBaseUrl> slack|telegram");
