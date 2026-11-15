#!/usr/bin/env node
// Zen Staff "Outreach cu aprobare": the books of a cold e-mail sequence. Nothing is released
// without an approval of that exact batch (a hash of every recipient, subject and body), the
// daily cap holds and every e-mail carries the unsubscribe line. E-mail only, no WhatsApp/SMS.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { readTable } from "./tables.mjs";
import { classifyEmail } from "./web-rules.mjs";

const USAGE = `  init     --leads <leads.json|csv|xlsx> --from "Name <office@company.com>" [--cap 20]
           [--followups 4,7] [--optout <file>] [--exclude <file>] [--lang ro|en] [--dir outreach]
  lint     [--dir outreach]                         checks messages.json
  batch    [--date YYYY-MM-DD] [--cap N]            today's due messages -> batches/<date>.json + .md
  approve  --batch <file> --by "<name>" --said "<the person's exact words>" [--skip id,id]
  release  --batch <file>                           only an approved, unchanged batch; writes .eml
  sent     --batch <file> --id <lead> [--via gmail|outlook|eml|draft] [--message-id <id>]
  optout   --email <address or @domain> [--reason <text>]
  replies  --from <replies.json>                    who answered; stops their follow-ups
  status`;

export const DEFAULT_CAP = 20;
export const HARD_CAP = 50;
export const MAX_FOLLOWUPS = 2;

export const UNSUBSCRIBE = {
  ro: "Dacă nu vrei să mai primești mesaje de la noi, răspunde cu „dezabonare” și nu te mai contactăm.",
  en: "If you would rather not hear from us again, reply “unsubscribe” and we will not contact you again.",
};

/** Words that count as the person's approval of a batch (Romanian and English). */
export const APPROVAL =
  /^\s*(aprob[ăa]?|aprobat|approve[ds]?|approved|da,? trimite(-le)?|ok,? trimite(-le)?|trimite(-le)?|send (them|it)?)\b/i;

const fold = (text) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const val = (field) => (field && typeof field === "object" && "v" in field ? field.v : field);

export const sha256 = (text) => NodeCrypto.createHash("sha256").update(text).digest("hex");

export function paths(dir) {
  return {
    dir,
    state: NodePath.join(dir, "state.json"),
    messages: NodePath.join(dir, "messages.json"),
    optout: NodePath.join(dir, "optout.txt"),
    sent: NodePath.join(dir, "sent.csv"),
    approvals: NodePath.join(dir, "approvals.json"),
    batches: NodePath.join(dir, "batches"),
    outbox: NodePath.join(dir, "outbox"),
    replies: NodePath.join(dir, "replies-summary.md"),
  };
}

const readJson = (file, fallback) =>
  NodeFS.existsSync(file) ? JSON.parse(NodeFS.readFileSync(file, "utf8")) : fallback;
const writeJson = (file, value) => {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  NodeFS.writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
};

export function readOptouts(file) {
  if (!NodeFS.existsSync(file)) return new Set();
  return new Set(
    NodeFS.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*$/, "").trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Opted out by address or by its whole domain (`@company.com`). */
export function isOptedOut(optouts, email) {
  const address = String(email ?? "")
    .trim()
    .toLowerCase();
  const domain = address.split("@")[1];
  return optouts.has(address) || (domain ? optouts.has(`@${domain}`) : false);
}

/** Leads from a client-radar leads.json or any CSV/XLSX with a name and an e-mail column. */
export function importLeads(file) {
  if (/\.json$/i.test(file)) {
    const data = readJson(file, { leads: [] });
    return (data.leads ?? []).map((lead) => ({
      id: lead.id,
      name: val(lead.name),
      email: val(lead.email),
      emailSource: lead.email?.src ?? null,
      website: val(lead.website) ?? null,
      city: val(lead.city) ?? null,
      score: lead.score ?? null,
      facts: {
        category: val(lead.category) ?? null,
        opportunities: (lead.opportunities ?? []).map((item) => ({
          text: item.text,
          src: item.src,
        })),
        signals: (lead.dossier?.signals ?? []).map((signal) => signal.ro ?? signal.en),
        socials: Object.fromEntries(
          Object.entries(lead.socials ?? {}).map(([key, item]) => [key, val(item)]),
        ),
        notes: lead.notes ?? null,
      },
    }));
  }
  const rows = readTable(file).sheets[0]?.rows ?? [];
  if (rows.length < 2) return [];
  const header = rows[0].map(fold);
  const col = (...names) => header.findIndex((cell) => names.some((name) => cell.includes(name)));
  const c = {
    name: col("nume", "name", "denumire", "firma", "company"),
    email: col("email", "e-mail", "mail"),
    site: col("site", "web", "url"),
    city: col("oras", "city", "localitate"),
    notes: col("nevoie", "oportunitate", "opportunity", "note", "notes"),
    score: col("scor", "score", "prioritate", "priority"),
  };
  return rows.slice(1).map((row, i) => ({
    id: `row-${i + 2}`,
    name: row[c.name] ?? "",
    email: String(row[c.email] ?? "").trim(),
    emailSource: null,
    website: row[c.site] ?? null,
    city: row[c.city] ?? null,
    score: row[c.score] ?? null,
    facts: {
      opportunities: c.notes >= 0 && row[c.notes] ? [{ text: row[c.notes], src: null }] : [],
      signals: [],
      socials: {},
    },
  }));
}

/** Who may be written to: a valid business e-mail, not opted out, not excluded, once. */
export function selectRecipients(leads, { optouts = new Set(), exclude = new Set() } = {}) {
  const kept = [];
  const left = [];
  const seen = new Set();
  for (const lead of leads) {
    const email = String(lead.email ?? "")
      .trim()
      .toLowerCase();
    const why = (reason) =>
      left.push({ id: lead.id, name: lead.name, email: email || null, reason });
    if (!email) {
      why("no business e-mail");
      continue;
    }
    const kind = classifyEmail(email);
    if (kind === "invalid") {
      why("not an e-mail address");
      continue;
    }
    if (kind === "person") {
      why("looks like a private person's address (B2B only)");
      continue;
    }
    if (isOptedOut(optouts, email)) {
      why("on the opt-out list");
      continue;
    }
    const domain = email.split("@")[1];
    if (exclude.has(email) || exclude.has(`@${domain}`) || exclude.has(fold(lead.name))) {
      why("on the do-not-contact list (customers, partners)");
      continue;
    }
    if (seen.has(email)) {
      why("the same address is already in the list");
      continue;
    }
    seen.add(email);
    kept.push({ ...lead, email });
  }
  return { kept, left };
}

const PLACEHOLDER = /(\[[^\]\n]{1,60}\]|\{\{|\}\}|<[A-Z_ ]{3,}>|\bTODO\b|\bXXX\b|lorem ipsum)/i;
const PUSHY =
  /(garantat|garantăm|100\s?%|ofertă limitată|ultima șansă|guaranteed|act now|last chance|risk[- ]free)/i;

/** Problems in the agent's messages for the leads in the plan. */
export function lintMessages(state, messages) {
  const problems = [];
  const followups = Math.min(MAX_FOLLOWUPS, state.settings.followupDays.length);
  for (const lead of Object.values(state.leads)) {
    if (lead.status !== "new" && lead.status !== "in-sequence") continue;
    const entry = messages[lead.id];
    const where = `${lead.name} <${lead.email}>`;
    if (!entry?.steps?.length) {
      problems.push(`${where}: no messages written`);
      continue;
    }
    if (entry.steps.length < 1 + followups)
      problems.push(
        `${where}: ${1 + followups} messages expected (first + ${followups} follow-ups), found ${entry.steps.length}`,
      );
    if (entry.steps.length > 1 + MAX_FOLLOWUPS)
      problems.push(`${where}: at most ${MAX_FOLLOWUPS} follow-ups`);
    entry.steps.forEach((step, i) => {
      const label = i === 0 ? "first message" : `follow-up ${i}`;
      if (i === 0 && !String(step.subject ?? "").trim())
        problems.push(`${where}, ${label}: no subject`);
      if (String(step.subject ?? "").length > 90)
        problems.push(`${where}, ${label}: subject longer than 90 characters`);
      const body = String(step.body ?? "");
      if (!body.trim()) problems.push(`${where}, ${label}: empty`);
      if (body.length > (i === 0 ? 1400 : 800))
        problems.push(`${where}, ${label}: too long (${body.length} characters)`);
      if (PLACEHOLDER.test(`${step.subject ?? ""}\n${body}`))
        problems.push(
          `${where}, ${label}: still has a placeholder (${PLACEHOLDER.exec(`${step.subject ?? ""}\n${body}`)[0]})`,
        );
      if (PUSHY.test(body))
        problems.push(`${where}, ${label}: pushy or unprovable claim ("${PUSHY.exec(body)[0]}")`);
      if (/whats ?app|\bsms\b/i.test(body) && /(trimit|send|scriu|write)/i.test(body))
        problems.push(
          `${where}, ${label}: promises WhatsApp/SMS messages; this workflow sends e-mail only`,
        );
    });
    const first = `${entry.steps[0]?.subject ?? ""} ${entry.steps[0]?.body ?? ""}`;
    if (!isPersonal(first, lead))
      problems.push(
        `${where}: the first message does not mention the business or anything from its dossier`,
      );
  }
  return problems;
}

/** The first message names the business, its site or one fact from its dossier. */
export function isPersonal(text, lead) {
  const hay = fold(text);
  const name = fold(lead.name).replace(/\s+/g, " ").trim();
  if (name.length >= 3 && hay.includes(name)) return true;
  const host = String(lead.website ?? "")
    .replace(/^https?:\/\/(www\.)?/i, "")
    .split("/")[0];
  if (host && hay.includes(fold(host))) return true;
  const GENERIC = new Set([
    "club",
    "clubul",
    "firma",
    "societatea",
    "asociatia",
    "sportiv",
    "restaurant",
    "studio",
    "company",
    "the",
    "srl",
    "acs",
  ]);
  const nameWords = name
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !GENERIC.has(word));
  const factWords = (lead.facts?.opportunities ?? [])
    .flatMap((item) => fold(item.text).split(/[^a-z0-9]+/))
    .filter((word) => word.length >= 5 && !GENERIC.has(word));
  return [...nameWords, ...factWords].some((word) => hay.includes(word));
}

/** The body as it goes out: the agent's text, the signature, and the unsubscribe line. */
export function finalBody(body, settings) {
  const line = settings.unsubscribeLine ?? UNSUBSCRIBE[settings.lang] ?? UNSUBSCRIBE.ro;
  let text = String(body ?? "").trimEnd();
  if (settings.signature && !text.includes(settings.signature.trim()))
    text += `\n\n${settings.signature.trim()}`;
  if (!hasUnsubscribeLine(text, settings)) text += `\n\n--\n${line}`;
  return text;
}

export function hasUnsubscribeLine(text, settings = {}) {
  const line = settings.unsubscribeLine ?? UNSUBSCRIBE[settings.lang] ?? UNSUBSCRIBE.ro;
  return String(text).includes(line);
}

const DAY = 24 * 60 * 60 * 1000;
const isoDay = (date) => new Date(date).toISOString().slice(0, 10);

export function sentOn(log, day) {
  return log.filter((row) => row.at.slice(0, 10) === day && row.via !== "draft-only").length;
}

/** The messages due on `day`, capped: first messages for new leads, follow-ups after their wait. */
export function dueItems(state, messages, day, { cap, alreadyToday = 0 } = {}) {
  const limit = Math.max(0, Math.min(HARD_CAP, cap ?? state.settings.cap) - alreadyToday);
  const followups = Math.min(MAX_FOLLOWUPS, state.settings.followupDays.length);
  const items = [];
  const waiting = [];
  const leads = Object.values(state.leads).sort(
    (a, b) => (a.score ?? "Z").localeCompare(b.score ?? "Z") || a.order - b.order,
  );
  // Follow-ups first (they keep a started conversation), then new leads by score.
  const ordered = [
    ...leads.filter((lead) => lead.step > 0),
    ...leads.filter((lead) => lead.step === 0),
  ];
  for (const lead of ordered) {
    if (
      lead.status === "replied" ||
      lead.status === "opted-out" ||
      lead.status === "done" ||
      lead.status === "bounced"
    )
      continue;
    const step = lead.step; // messages already sent
    if (step > followups) continue;
    if (step > 0) {
      const wait = state.settings.followupDays[step - 1] ?? 7;
      if (Date.parse(day) < Date.parse(isoDay(lead.lastSentAt)) + wait * DAY) continue;
    }
    const message = messages[lead.id]?.steps?.[step];
    if (!message) continue;
    if (items.length >= limit) {
      waiting.push(lead.id);
      continue;
    }
    const subject =
      step === 0 ? message.subject : message.subject || `Re: ${messages[lead.id].steps[0].subject}`;
    items.push({
      leadId: lead.id,
      name: lead.name,
      to: lead.email,
      step: step + 1,
      subject,
      body: finalBody(message.body, state.settings),
    });
  }
  return { items, waiting, limit };
}

/** The approval covers exactly these recipients, subjects and bodies. */
export function batchHash(items) {
  return sha256(
    JSON.stringify(items.map((item) => [item.leadId, item.to, item.step, item.subject, item.body])),
  );
}

export function batchPreview(batch, settings) {
  const ro = settings.lang !== "en";
  const lines = [
    ro
      ? `# Lotul din ${batch.date}: ${batch.items.length} e-mailuri`
      : `# Batch of ${batch.date}: ${batch.items.length} e-mails`,
    "",
    ro
      ? `De la: ${settings.from}. Limita zilnică: ${settings.cap}. Nimic nu pleacă până nu scrii „Aprobă”.`
      : `From: ${settings.from}. Daily limit: ${settings.cap}. Nothing goes out until you say “Approve”.`,
    "",
  ];
  for (const [i, item] of batch.items.entries()) {
    lines.push(
      `## ${i + 1}. ${item.name} <${item.to}> · ${ro ? (item.step === 1 ? "primul mesaj" : `revenirea ${item.step - 1}`) : item.step === 1 ? "first message" : `follow-up ${item.step - 1}`}`,
    );
    lines.push("", `**${ro ? "Subiect" : "Subject"}:** ${item.subject}`, "", item.body, "");
  }
  if (batch.waiting.length) {
    lines.push(
      ro
        ? `Rămân pentru zilele următoare (limita zilnică): ${batch.waiting.length}.`
        : `Left for the next days (daily limit): ${batch.waiting.length}.`,
    );
  }
  lines.push("", `<!-- batch ${batch.hash} -->`);
  return lines.join("\n");
}

export function readBatch(file) {
  const batch = readJson(file, null);
  if (!batch) throw new Error(`No batch at ${file}.`);
  return batch;
}

/** Records the person's approval of exactly this batch (minus skipped leads). */
export function approveBatch(batch, { by, said, skip = [], at = new Date().toISOString() }) {
  if (batch.released) throw new Error("This batch was already released.");
  if (batchHash(batch.items) !== batch.hash)
    throw new Error(
      "The batch was changed after it was written; run batch again and show it to the person.",
    );
  if (!APPROVAL.test(String(said ?? ""))) {
    throw new Error(
      `"${said ?? ""}" is not an approval. The person has to say "Aprobă" (or "Approve") for this batch.`,
    );
  }
  if (!String(by ?? "").trim()) throw new Error("Say who approved (--by).");
  const items = batch.items.filter((item) => !skip.includes(item.leadId));
  const hash = batchHash(items);
  return {
    batch: { ...batch, items, hash, skippedByPerson: skip },
    approval: { date: batch.date, hash, by, said, at, count: items.length },
  };
}

/** Throws unless this exact batch was approved and fits today's cap. */
export function assertReleasable(batch, approvals, { sentToday = 0, cap }) {
  const hash = batchHash(batch.items);
  if (hash !== batch.hash)
    throw new Error(
      "NOT SENDING: the batch was changed after it was written; run batch again and ask for approval.",
    );
  const approval = approvals.find((entry) => entry.hash === hash);
  if (!approval)
    throw new Error(
      "NOT SENDING: this batch has not been approved. Show it to the person and wait for “Aprobă”.",
    );
  const limit = Math.min(HARD_CAP, cap);
  if (sentToday + batch.items.length > limit) {
    throw new Error(
      `NOT SENDING: ${batch.items.length} more would pass today's limit of ${limit} (already ${sentToday}).`,
    );
  }
  return approval;
}

const encodeHeader = (text) =>
  /^[\x20-\x7e]*$/.test(text)
    ? text
    : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;

function mailbox(value) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(String(value ?? ""));
  return match
    ? { name: match[1].replace(/^"|"$/g, ""), address: match[2] }
    : { name: "", address: String(value ?? "").trim() };
}

/** An RFC 5322 message, unsent (Outlook opens X-Unsent: 1 as a draft), with List-Unsubscribe. */
export function emlFor(item, settings, { date = new Date() } = {}) {
  const from = mailbox(settings.from);
  const fromHeader = from.name ? `${encodeHeader(from.name)} <${from.address}>` : from.address;
  const domain = from.address.split("@")[1] ?? "localhost";
  const body = Buffer.from(item.body.replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${fromHeader}`,
    `To: ${item.to}`,
    `Subject: ${encodeHeader(item.subject)}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${sha256(`${item.leadId}:${item.step}:${item.to}`).slice(0, 24)}@${domain}>`,
    `List-Unsubscribe: <mailto:${from.address}?subject=${encodeURIComponent(settings.lang === "en" ? "unsubscribe" : "dezabonare")}>`,
    "X-Unsent: 1",
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
    "",
  ].join("\r\n");
}

const UNSUB =
  /(dezabon|unsubscribe|nu ma mai contact|nu mai trimite|stergeti|scoateti|remove me|stop\b|opt[- ]?out|nu mai vreau)/;
const NEGATIVE =
  /(nu suntem interesat|nu sunt interesat|nu avem nevoie|nu, multum|not interested|no thanks|no, thank|nu este cazul|nu e cazul)/;
const POSITIVE =
  /(interesat|interested|da,|sure|let's talk|hai sa|putem discuta|discutam|programa|meeting|call|suna|sunati|oferta|offer|pret|price|cat costa|how much|detalii|details)/;

export function classifyReply(text) {
  const plain = fold(text);
  if (UNSUB.test(plain)) return "unsubscribe";
  if (NEGATIVE.test(plain)) return "negative";
  if (POSITIVE.test(plain)) return "positive";
  return "other";
}

export function applyReplies(state, replies, optouts) {
  const rows = [];
  for (const reply of replies) {
    const from = mailbox(reply.from).address.toLowerCase();
    const domain = from.split("@")[1];
    const lead =
      Object.values(state.leads).find((item) => item.email === from) ??
      Object.values(state.leads).find(
        (item) =>
          item.email.split("@")[1] === domain && !/(gmail|yahoo|outlook|hotmail)\./.test(domain),
      );
    const kind = classifyReply(`${reply.subject ?? ""} ${reply.snippet ?? reply.text ?? ""}`);
    if (!lead) {
      rows.push({ from, kind, lead: null, date: reply.date ?? null });
      continue;
    }
    lead.status = kind === "unsubscribe" ? "opted-out" : "replied";
    lead.reply = {
      kind,
      date: reply.date ?? null,
      snippet: String(reply.snippet ?? reply.text ?? "").slice(0, 200),
    };
    if (kind === "unsubscribe") optouts.add(lead.email);
    rows.push({ from, kind, lead: lead.id, name: lead.name, date: reply.date ?? null });
  }
  return rows;
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const next = argv[i + 1];
    args[item.slice(2)] = next === undefined || next.startsWith("--") ? true : (i++, next);
  }
  return args;
}

function readSentLog(file) {
  if (!NodeFS.existsSync(file)) return [];
  return NodeFS.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [at, leadId, to, step, via, messageId, batchDate] = line.split(",");
      return { at, leadId, to, step: Number(step), via, messageId, batchDate };
    });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const p = paths(NodePath.resolve(args.dir ?? "outreach"));
  const command = args._[0];
  const state = readJson(p.state, null);
  const need = () => {
    if (!state) throw new Error(`Run init first (no ${p.state}).`);
    return state;
  };
  switch (command) {
    case "init": {
      if (!args.leads || !args.from)
        throw new Error('Give --leads <file> and --from "Name <office@company.com>".');
      const lang = args.lang === "en" ? "en" : "ro";
      const cap = Math.max(1, Math.min(HARD_CAP, Number(args.cap ?? DEFAULT_CAP)));
      const followupDays = String(args.followups ?? "4,7")
        .split(",")
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0)
        .slice(0, MAX_FOLLOWUPS);
      const optouts = readOptouts(p.optout);
      if (args.optout)
        for (const entry of readOptouts(NodePath.resolve(args.optout))) optouts.add(entry);
      const exclude = args.exclude ? readOptouts(NodePath.resolve(args.exclude)) : new Set();
      const { kept, left } = selectRecipients(importLeads(NodePath.resolve(args.leads)), {
        optouts,
        exclude: new Set([...exclude].map(fold)),
      });
      const previous = state?.leads ?? {};
      const leads = {};
      kept.forEach((lead, order) => {
        leads[lead.id] = previous[lead.id] ?? {
          ...lead,
          order,
          status: "new",
          step: 0,
          lastSentAt: null,
          history: [],
        };
      });
      const next = {
        settings: {
          from: args.from,
          cap,
          followupDays,
          lang,
          unsubscribeLine: UNSUBSCRIBE[lang],
          signature:
            typeof args.signature === "string"
              ? args.signature
              : (state?.settings?.signature ?? null),
        },
        leads,
        left,
        createdAt: state?.createdAt ?? new Date().toISOString(),
      };
      writeJson(p.state, next);
      NodeFS.writeFileSync(p.optout, `${[...optouts].sort().join("\n")}\n`);
      if (!NodeFS.existsSync(p.messages)) writeJson(p.messages, {});
      writeJson(
        NodePath.join(p.dir, "facts.json"),
        Object.fromEntries(
          kept.map((lead) => [
            lead.id,
            {
              name: lead.name,
              email: lead.email,
              website: lead.website,
              city: lead.city,
              score: lead.score,
              ...lead.facts,
            },
          ]),
        ),
      );
      return console.log(
        JSON.stringify(
          {
            recipients: kept.length,
            leftOut: left.length,
            reasons: countBy(left, "reason"),
            cap,
            followupDays,
          },
          null,
          1,
        ),
      );
    }
    case "lint": {
      const problems = lintMessages(need(), readJson(p.messages, {}));
      console.log(JSON.stringify({ problems }, null, 1));
      if (problems.length) process.exitCode = 2;
      return;
    }
    case "batch": {
      const s = need();
      const messages = readJson(p.messages, {});
      const problems = lintMessages(s, messages);
      if (problems.length) {
        console.log(JSON.stringify({ problems }, null, 1));
        throw new Error("Fix the messages first (lint).");
      }
      const day = args.date ?? isoDay(Date.now());
      const file = NodePath.join(p.batches, `${day}.json`);
      const old = readJson(file, null);
      if (old?.released)
        throw new Error(
          `The batch of ${day} was already released; tomorrow's batch comes tomorrow.`,
        );
      const sentToday = sentOn(readSentLog(p.sent), day);
      const { items, waiting, limit } = dueItems(s, messages, day, {
        cap: args.cap ? Number(args.cap) : s.settings.cap,
        alreadyToday: sentToday,
      });
      const batch = {
        date: day,
        items,
        waiting,
        hash: batchHash(items),
        createdAt: new Date().toISOString(),
        released: false,
      };
      writeJson(file, batch);
      NodeFS.writeFileSync(file.replace(/\.json$/, ".md"), batchPreview(batch, s.settings));
      return console.log(
        JSON.stringify(
          {
            batch: file,
            preview: file.replace(/\.json$/, ".md"),
            count: items.length,
            waiting: waiting.length,
            limitLeftToday: limit,
          },
          null,
          1,
        ),
      );
    }
    case "approve": {
      const s = need();
      const file = NodePath.resolve(args.batch);
      const { batch, approval } = approveBatch(readBatch(file), {
        by: args.by,
        said: args.said,
        skip: typeof args.skip === "string" ? args.skip.split(",") : [],
      });
      writeJson(file, batch);
      NodeFS.writeFileSync(file.replace(/\.json$/, ".md"), batchPreview(batch, s.settings));
      writeJson(p.approvals, [...readJson(p.approvals, []), approval]);
      return console.log(
        JSON.stringify({ approved: approval.count, hash: approval.hash }, null, 1),
      );
    }
    case "release": {
      const s = need();
      const file = NodePath.resolve(args.batch);
      const batch = readBatch(file);
      assertReleasable(batch, readJson(p.approvals, []), {
        sentToday: sentOn(readSentLog(p.sent), batch.date),
        cap: s.settings.cap,
      });
      const box = NodePath.join(p.outbox, batch.date);
      NodeFS.mkdirSync(box, { recursive: true });
      const list = batch.items.map((item, i) => {
        const eml = NodePath.join(box, `${String(i + 1).padStart(2, "0")}-${item.leadId}.eml`);
        NodeFS.writeFileSync(eml, emlFor(item, s.settings));
        return { ...item, eml };
      });
      writeJson(file, { ...batch, released: true, releasedAt: new Date().toISOString() });
      return console.log(JSON.stringify({ send: list }, null, 1));
    }
    case "sent": {
      const s = need();
      const file = NodePath.resolve(args.batch);
      const batch = readBatch(file);
      if (!batch.released)
        throw new Error("NOT LOGGED: this batch was not released (approved and released) yet.");
      const item = batch.items.find((entry) => entry.leadId === args.id);
      if (!item) throw new Error(`${args.id} is not in this batch.`);
      const log = readSentLog(p.sent);
      if (log.some((row) => row.leadId === item.leadId && row.step === item.step))
        throw new Error(`${item.to} already got message ${item.step}.`);
      const via = ["gmail", "outlook", "eml", "draft"].includes(args.via) ? args.via : "eml";
      const at = new Date().toISOString();
      if (!NodeFS.existsSync(p.sent))
        NodeFS.writeFileSync(p.sent, "at,lead,to,step,via,message_id,batch\n");
      NodeFS.appendFileSync(
        p.sent,
        `${[at, item.leadId, item.to, item.step, via, String(args["message-id"] ?? "").replace(/,/g, " "), batch.date].join(",")}\n`,
      );
      const lead = s.leads[item.leadId];
      lead.step = item.step;
      lead.lastSentAt = at;
      lead.status =
        item.step > Math.min(MAX_FOLLOWUPS, s.settings.followupDays.length)
          ? "done"
          : "in-sequence";
      lead.history.push({ step: item.step, at, via });
      writeJson(p.state, s);
      return console.log(JSON.stringify({ logged: item.to, step: item.step, via }, null, 1));
    }
    case "optout": {
      const s = need();
      const optouts = readOptouts(p.optout);
      const entry = String(args.email ?? "")
        .trim()
        .toLowerCase();
      if (!entry) throw new Error("Give --email.");
      optouts.add(entry);
      NodeFS.writeFileSync(p.optout, `${[...optouts].sort().join("\n")}\n`);
      for (const lead of Object.values(s.leads))
        if (isOptedOut(optouts, lead.email)) lead.status = "opted-out";
      writeJson(p.state, s);
      return console.log(JSON.stringify({ optedOut: entry }, null, 1));
    }
    case "replies": {
      const s = need();
      const optouts = readOptouts(p.optout);
      const rows = applyReplies(s, readJson(NodePath.resolve(args.from), []), optouts);
      writeJson(p.state, s);
      NodeFS.writeFileSync(p.optout, `${[...optouts].sort().join("\n")}\n`);
      const ro = s.settings.lang !== "en";
      const label = ro
        ? {
            positive: "vor să discute",
            negative: "nu sunt interesați",
            unsubscribe: "s-au dezabonat",
            other: "alt răspuns",
          }
        : {
            positive: "want to talk",
            negative: "not interested",
            unsubscribe: "unsubscribed",
            other: "other reply",
          };
      const md = [
        ro
          ? `# Răspunsuri (${new Date().toISOString().slice(0, 10)})`
          : `# Replies (${new Date().toISOString().slice(0, 10)})`,
        "",
        ...Object.entries(countBy(rows, "kind")).map(
          ([kind, n]) => `- ${label[kind] ?? kind}: ${n}`,
        ),
        "",
        ...rows.map(
          (row) =>
            `- ${row.name ?? row.from} (${row.from}): ${label[row.kind]}${row.lead ? "" : ro ? " · nu e în listă" : " · not in the list"}`,
        ),
        "",
        ro
          ? "Cine a răspuns nu mai primește reveniri automate."
          : "Whoever replied gets no more automatic follow-ups.",
      ].join("\n");
      NodeFS.writeFileSync(p.replies, `${md}\n`);
      return console.log(
        JSON.stringify(
          { replies: rows.length, ...countBy(rows, "kind"), summary: p.replies },
          null,
          1,
        ),
      );
    }
    case "status": {
      const s = need();
      const leads = Object.values(s.leads);
      return console.log(
        JSON.stringify(
          {
            recipients: leads.length,
            ...countBy(leads, "status"),
            sentToday: sentOn(readSentLog(p.sent), isoDay(Date.now())),
            cap: s.settings.cap,
          },
          null,
          1,
        ),
      );
    }
    default:
      console.log(USAGE);
  }
}

function countBy(list, key) {
  const out = {};
  for (const item of list) out[item[key]] = (out[item[key]] ?? 0) + 1;
  return out;
}

if (process.argv[1] && NodePath.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}
