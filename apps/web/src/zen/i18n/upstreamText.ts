// Zen Staff: Office wording and Romanian for upstream strings, without editing upstream files.
// In Office, and in Code when the app speaks Romanian, a MutationObserver rewrites text nodes and
// attributes whose whole trimmed text matches an entry; React only sets nodeValue, so it stays in
// charge. A t() per upstream file would conflict daily. ZEN.md, "Languages".
import type { ZenEdition } from "@t3tools/contracts/zenOffice";

import { UPSTREAM_CODE_PATTERNS_RO, UPSTREAM_CODE_RO } from "./upstreamCodeText";
import {
  applyScreensPattern,
  UPSTREAM_OFFICE_RO,
  UPSTREAM_SCREENS_PATTERNS_RO,
  UPSTREAM_SCREENS_RO,
} from "./upstreamScreensText";
import { UPSTREAM_SETTINGS_RO } from "./upstreamSettingsText";
import { UPSTREAM_TOAST_PATTERNS_RO, UPSTREAM_TOAST_RO } from "./upstreamToastText";
import type { ZenLocale } from "./zenI18n";

interface UpstreamEntry {
  /** Office wording in English, when upstream's developer wording does not fit. */
  readonly en?: string;
  readonly ro: string;
}

/** Exact upstream strings (trimmed). */
const EXACT: Readonly<Record<string, UpstreamEntry>> = {
  // Sidebar and thread list
  Search: { ro: "Caută" },
  "New thread": { en: "New chat", ro: "Discuție nouă" },
  "New project": { en: "New folder", ro: "Dosar nou" },
  "Add project": { en: "Add folder", ro: "Adaugă un dosar" },
  "No projects yet": { en: "No folders yet", ro: "Încă nu ai dosare" },
  "No threads yet": { en: "No tasks yet", ro: "Încă nu ai sarcini" },
  "No threads in these projects yet": {
    en: "No tasks in these folders yet",
    ro: "Încă nu sunt sarcini în aceste dosare",
  },
  Settled: { en: "Finished", ro: "Terminate" },
  "Send a message to start the conversation.": {
    en: "Send a message to start.",
    ro: "Trimite un mesaj ca să începi.",
  },
  Active: { ro: "Active" },
  Snoozed: { en: "Later", ro: "Amânate" },
  Pinned: { ro: "Fixate" },
  Loading: { ro: "Se încarcă" },
  "Could not load older threads. Retry": {
    en: "Could not load older tasks. Retry",
    ro: "Nu am putut încărca sarcinile mai vechi. Reîncearcă",
  },
  "No threads found": { en: "No tasks found", ro: "Nu am găsit nicio sarcină" },
  "Clear thread search": { en: "Clear search", ro: "Șterge căutarea" },
  "Searching thread messages…": {
    en: "Searching task messages…",
    ro: "Caut în mesajele sarcinilor…",
  },
  "Thread search results": { en: "Search results", ro: "Rezultatele căutării" },
  "Thread title": { en: "Task title", ro: "Titlul sarcinii" },
  "Regenerating title": { ro: "Refac titlul" },
  Wake: { ro: "Reia acum" },
  "Wake thread now": { en: "Bring back now", ro: "Readu acum" },
  Woke: { en: "Back", ro: "Revenită" },
  Pin: { ro: "Fixează" },
  Unpin: { ro: "Scoate fixarea" },
  "Pin project": { en: "Pin folder", ro: "Fixează dosarul" },
  "Unpin project": { en: "Unpin folder", ro: "Scoate fixarea dosarului" },
  "Search projects": { en: "Search folders", ro: "Caută dosare" },
  "Search projects...": { en: "Search folders...", ro: "Caută dosare..." },
  "No matching projects.": { en: "No matching folders.", ro: "Niciun dosar potrivit." },
  "Copy path": { ro: "Copiază calea" },
  Later: { ro: "Mai târziu" },
  Retry: { ro: "Reîncearcă" },
  "Go back": { ro: "Înapoi" },
  "Go forward": { ro: "Înainte" },
  "Update available": { ro: "Actualizare disponibilă" },
  "Restart to update": { ro: "Repornește ca să actualizezi" },
  "Check for updates": { ro: "Caută actualizări" },
  "Checking for updates…": { ro: "Caut actualizări…" },
  "Usage limit reached": { ro: "Ai atins limita de folosire" },
  "Setting up": { ro: "Se pregătește" },
  Done: { ro: "Gata" },
  Failed: { en: "Stopped", ro: "Oprită" },
  Waiting: { ro: "Așteaptă" },
  Approval: { en: "Needs OK", ro: "Cere acordul" },
  Input: { en: "Question", ro: "Întrebare" },
  Working: { ro: "Lucrează" },
  Settings: { ro: "Setări" },
  Usage: { ro: "Consum" },
  "Unsent draft": { ro: "Mesaj netrimis" },
  "Unpin thread": { en: "Unpin task", ro: "Scoate fixarea" },
  "Pin thread": { en: "Pin task", ro: "Fixează sus" },
  "Rename thread": { en: "Rename task", ro: "Redenumește" },
  "Regenerate title": { ro: "Alt titlu" },
  "Mark unread": { ro: "Marchează necitit" },
  "Archive thread": { en: "Archive task", ro: "Arhivează" },
  Delete: { ro: "Șterge" },
  Copy: { ro: "Copiază" },
  Path: { en: "Folder path", ro: "Calea dosarului" },
  Thread: { en: "Task", ro: "Sarcina" },
  "Project settings": { en: "Folder settings", ro: "Setările dosarului" },
  "Settle thread": { en: "Mark finished", ro: "Marchează terminată" },
  "Un-settle thread": { en: "Mark not finished", ro: "Marchează neterminată" },
  Snooze: { en: "Remind me later", ro: "Amână" },
  "Wake thread": { en: "Bring back", ro: "Readu acum" },
  "Find in thread": { en: "Find in task", ro: "Caută în sarcină" },
  "Share with guest": { ro: "Trimite unui invitat" },
  "Turn into project": { en: "Turn into folder", ro: "Fă din ea un dosar" },
  "Discard draft": { ro: "Renunță la ciornă" },

  // Chat
  "Ask anything. @ files, $ skills, / commands": {
    en: "Ask anything, or describe the task",
    ro: "Întreabă orice sau descrie sarcina",
  },
  "Ask anything": { ro: "Întreabă orice" },
  "Show full message": { ro: "Arată tot mesajul" },
  // The Files panel (tab and tree search).
  Files: { ro: "Fișiere" },
  "Search files": { ro: "Caută fișiere" },
  "Scroll to end": { en: "Go to the end", ro: "Mergi la final" },
  // The screen-reader heading of the person's own messages.
  You: { ro: "Tu" },
  // Claude's reason on a command approval (the Office row explains the step above it).
  "This command requires approval": {
    en: "This step needs your OK",
    ro: "Pasul ăsta are nevoie de acordul tău",
  },
  "or start without a project": { en: "or start without a folder", ro: "sau începe fără dosar" },
  "Search...": { ro: "Caută..." },
  // Settings > Voice: dictionary counts ("0 entries").
  entries: { ro: "intrări" },
  entry: { ro: "intrare" },
  "Working for": { ro: "Lucrez de" },
  "Zen Staff restarted and resumed this turn": {
    en: "The app restarted and carried on",
    ro: "Aplicația a repornit și a continuat",
  },
  "Show less": { ro: "Arată mai puțin" },
  "Working...": { ro: "Lucrez..." },
  Thinking: { en: "Working…", ro: "Lucrez…" },
  "Context compacted": { en: "Memory tidied up", ro: "Am făcut ordine în memorie" },
  Stop: { ro: "Oprește" },
  Send: { ro: "Trimite" },
  "Attach files": { ro: "Atașează fișiere" },
  Copied: { ro: "Copiat" },
  "Copy message": { ro: "Copiază mesajul" },
  Allow: { ro: "Permite" },
  "Waiting for approval": { en: "Waiting for your OK", ro: "Așteaptă acordul tău" },
  Approve: { ro: "Aprobă" },
  "Always allow this session": {
    en: "Approve for the rest of this chat",
    ro: "Aprobă până la finalul discuției",
  },
  Decline: { ro: "Refuză" },
  More: { ro: "Mai mult" },
  "Send feedback to decline this request": {
    en: "Say why you decline",
    ro: "Scrie de ce refuzi",
  },
  Deny: { ro: "Refuză" },
  "Allow once": { ro: "Permite o dată" },
  Submit: { ro: "Trimite" },
  Skip: { ro: "Sari peste" },

  // Settings navigation
  General: { ro: "General" },
  Appearance: { ro: "Aspect" },
  Chat: { ro: "Conversație" },
  Providers: { en: "AI assistants", ro: "Asistenți AI" },
  Projects: { en: "Folders", ro: "Dosare" },
  Threads: { en: "Tasks", ro: "Sarcini" },
  Archived: { ro: "Arhivate" },
  Voice: { ro: "Voce" },
  Browser: { ro: "Browser" },
  Connections: { ro: "Conexiuni" },
  Access: { ro: "Acces" },
  Secrets: { en: "Passwords and keys", ro: "Parole și chei" },
  Storage: { ro: "Spațiu de stocare" },
  Maintenance: { ro: "Întreținere" },
  About: { ro: "Despre" },
  Privacy: { ro: "Confidențialitate" },
  Integrations: { ro: "Integrări" },
  "Scheduled tasks": { ro: "Sarcini programate" },
  "Back to app": { ro: "Înapoi în aplicație" },

  // Settings: shared chrome and General
  Agents: { en: "Assistants", ro: "Asistenți" },
  Code: { en: "Work", ro: "Lucru" },
  Environments: { en: "Computers", ro: "Calculatoare" },
  "Sharing & access": { ro: "Partajare și acces" },
  Archive: { ro: "Arhivă" },
  Notifications: { ro: "Notificări" },
  "Thread notifications": { en: "Task notifications", ro: "Notificări pentru sarcini" },
  "In-app notifications": { ro: "Notificări în aplicație" },
  Sidebar: { ro: "Bara laterală" },
  "Project grouping": { en: "Folder grouping", ro: "Gruparea dosarelor" },
  "Combine matching repositories across environments.": {
    en: "Show the same folder from several computers once.",
    ro: "Arată o singură dată același dosar de pe mai multe calculatoare.",
  },
  "Project order": { en: "Folder order", ro: "Ordinea dosarelor" },
  "Order of projects in the sidebar project picker and command palette.": {
    en: "Order of folders in the sidebar and the search.",
    ro: "Ordinea dosarelor în bara laterală și în căutare.",
  },
  "Last user message": { ro: "Ultimul mesaj trimis" },
  "Working section": { en: "In progress section", ro: "Secțiunea În lucru" },
  Off: { ro: "Oprit" },
  On: { ro: "Pornit" },
  "Restore device defaults": { ro: "Revino la setările inițiale" },
  "Applying settings for": { ro: "Setări pentru" },
  across: { ro: "pe" },
  on: { ro: "pe" },
  "All projects": { en: "All folders", ro: "Toate dosarele" },
  "All environments": { en: "All computers", ro: "Toate calculatoarele" },
  "Checked just now": { ro: "Verificat acum" },

  // Settings: Providers
  Status: { ro: "Stare" },
  "Not found": { ro: "Nu e instalat" },
  Available: { ro: "Disponibil" },
  "Display name": { ro: "Nume afișat" },
  Runtime: { en: "Advanced", ro: "Avansat" },
  Environment: { en: "Advanced environment", ro: "Mediu avansat" },
  "Binary path": { en: "Program location", ro: "Locul programului" },
  "Launch arguments": { en: "Extra start options", ro: "Opțiuni de pornire" },

  // Settings: Projects and Threads
  "Choose a project to manage its name, icon, checkouts and actions.": {
    en: "Choose a folder to change its name and icon.",
    ro: "Alege un dosar ca să-i schimbi numele și pictograma.",
  },
  "New projects": { en: "New folders", ro: "Dosare noi" },
  "Add project starts in": { en: "Folder picker starts in", ro: "Alegerea dosarului începe din" },
  "Clone into host folders": {
    en: "Sort downloaded folders by site",
    ro: "Ordonează dosarele descărcate după site",
  },
  "Fallback model": { en: "Backup model", ro: "Model de rezervă" },
  Permissions: { en: "What the assistant may do", ro: "Ce are voie asistentul" },
  "Default permissions for new threads. Projects can override them.": {
    en: "For new tasks. Each folder can choose otherwise.",
    ro: "Pentru sarcinile noi. Fiecare dosar poate alege altfel.",
  },
  "Default model for new threads, selected automatically. Projects can override it.": {
    en: "Used for new tasks. Each folder can choose another one.",
    ro: "Se folosește la sarcinile noi. Fiecare dosar poate alege altul.",
  },
  "Used for new threads when the default model's provider is out of usage.": {
    en: "Used when the main model has reached its limit.",
    ro: "Se folosește când modelul principal și-a atins limita.",
  },
  Workspace: { en: "Where tasks run", ro: "Unde lucrează sarcinile" },
  "Where new threads start. Projects and their t3.json can override it.": {
    en: "Where new tasks work. Leave it as it is.",
    ro: "Unde lucrează sarcinile noi. Las-o cum e.",
  },
  "Current checkout": { en: "The folder itself", ro: "Chiar în dosar" },
  "Snooze options": { en: "Remind me later options", ro: "Variante pentru Amână" },

  "Add provider": { en: "Add AI assistant", ro: "Adaugă un asistent AI" },
  "Provider instances": { en: "AI assistants", ro: "Asistenți AI" },
  Model: { ro: "Model" },
  Models: { ro: "Modele" },
  "Default model": { ro: "Modelul implicit" },
  Enabled: { ro: "Pornit" },
  Disabled: { ro: "Oprit" },
  "Signed in": { ro: "Conectat" },
  "Sign in": { ro: "Conectează-te" },
  "Sign out": { ro: "Deconectează-te" },
  "Not installed": { ro: "Neinstalat" },
  Ready: { ro: "Gata de lucru" },

  // Settings: Projects and Threads
  "Default runtime mode": { en: "What the assistant may do", ro: "Ce are voie asistentul" },
  "Runtime mode": { en: "What the assistant may do", ro: "Ce are voie asistentul" },
  // The trust model (zen/trust): "Automat" by default, full access only under "Avansat".
  "Full access": { en: "Full access, no questions", ro: "Acces complet, fără întrebări" },
  Supervised: { en: "Ask me at every step", ro: "Întreabă-mă la fiecare pas" },
  Auto: { en: "Automatic", ro: "Automat" },
  "Auto-accept edits": {
    en: "Edit files alone, ask about the rest",
    ro: "Editează singur fișierele, întreabă de rest",
  },
  "Ask before commands and file changes.": {
    en: "Waits for your Approve before every change.",
    ro: "Așteaptă „Aprobă” de la tine înainte de orice schimbare.",
  },
  "Auto-approve edits, ask before other actions.": {
    en: "Changes files in the folder on its own; commands wait for you.",
    ro: "Schimbă singur fișierele din dosar; comenzile te așteaptă.",
  },
  "Supported providers approve routine actions; others still ask.": {
    en: "Works on its own in the folder, asks you about anything that leaves the company.",
    ro: "Lucrează singur în dosar, te întreabă la ce iese din firmă.",
  },
  "Allow commands and edits without prompts.": {
    en: "May send, delete or pay without you. Only if you know why you need it.",
    ro: "Poate trimite, șterge sau plăti fără tine. Doar dacă știi de ce îți trebuie.",
  },
  "Workspace root": { en: "Folder", ro: "Dosar" },
  "Project name": { en: "Folder name", ro: "Numele dosarului" },
  "Archive project": { en: "Archive folder", ro: "Arhivează dosarul" },
  "Delete project": { en: "Delete folder from the list", ro: "Scoate dosarul din listă" },
  "New threads": { en: "New tasks", ro: "Sarcini noi" },
  "Auto-settle": { en: "Mark finished automatically", ro: "Marchează automat ca terminate" },
  "Archived threads": { en: "Archived tasks", ro: "Sarcini arhivate" },
  Save: { ro: "Salvează" },
  Cancel: { ro: "Anulează" },
  Reset: { ro: "Resetează" },
  Close: { ro: "Închide" },
  "Open settings": { ro: "Deschide setările" },
  "Open usage": { ro: "Deschide consumul" },
  "Go to file": { ro: "Deschide un fișier" },
  "New thread in...": { en: "New task in...", ro: "Sarcină nouă în..." },
  "New thread without a project": {
    en: "New task without a folder",
    ro: "Sarcină nouă fără dosar",
  },
  "Find in current thread": { en: "Find in this task", ro: "Caută în sarcina asta" },
  "Copy prompt link": { ro: "Copiază linkul mesajului" },
  "Change theme": { ro: "Schimbă tema" },
  "Search commands, projects, and threads": {
    en: "Search actions, folders and tasks",
    ro: "Caută acțiuni, dosare și sarcini",
  },
  "Search commands, projects, and threads...": {
    en: "Search actions, folders and tasks...",
    ro: "Caută acțiuni, dosare și sarcini...",
  },
  Actions: { ro: "Acțiuni" },
  Navigate: { ro: "Mută" },
  Select: { ro: "Alege" },
  "New thread in": { en: "New task in", ro: "Sarcină nouă în" },
  "Change appearance": { ro: "Schimbă aspectul" },
  "Toggle theme editor": { ro: "Editorul de teme" },
  "Recent threads": { en: "Recent tasks", ro: "Sarcini recente" },
  Suggestions: { ro: "Sugestii" },
  "In messages": { ro: "În mesaje" },
  "No project": { en: "No folder", ro: "Fără dosar" },
  "Local folder": { ro: "Dosar de pe calculator" },
};

/** Upstream text with values in it. `$1` etc. are the captured groups. */
const PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly en?: string;
  readonly ro: string;
}> = [
  { pattern: /^Worked for (.+)$/, ro: "Am lucrat $1" },
  { pattern: /^Working for (.+)$/, ro: "Lucrez de $1" },
  {
    pattern: /^What should we build in (.+)\?$/,
    en: "What should we work on in $1?",
    ro: "La ce lucrăm în $1?",
  },
  // Sidebar empty state for one folder: "No threads in Acme yet".
  {
    pattern: /^No threads in (.+) yet$/,
    en: "No tasks in $1 yet",
    ro: "Încă nu sunt sarcini în $1",
  },
  { pattern: /^Mark unread \((\d+)\)$/, ro: "Marchează necitite ($1)" },
  { pattern: /^Show (\d+) more$/, ro: "Arată încă $1" },
  { pattern: /^Filter by (.+)$/, en: "Show only $1", ro: "Arată doar $1" },
  { pattern: /^(\d+) (?:minutes?|min) ago$/, ro: "acum $1 min" },
  // Settings > Scheduled tasks: "Next run in 1d", "Mon at 09:00", "Daily at 09:00".
  { pattern: /^in (\d+)([smhdw])$/, ro: "în $1$2" },
  { pattern: /^Daily at (\d{1,2}:\d{2})( ·)?$/, ro: "Zilnic la $1$2" },
  { pattern: /^Weekdays at (\d{1,2}:\d{2})( ·)?$/, ro: "Luni-vineri la $1$2" },
  { pattern: /^Every day at (\d{1,2}:\d{2})( ·)?$/, ro: "În fiecare zi la $1$2" },
  { pattern: /^Mon at (\d{1,2}:\d{2})( ·)?$/, ro: "luni la $1$2" },
  { pattern: /^Tue at (\d{1,2}:\d{2})( ·)?$/, ro: "marți la $1$2" },
  { pattern: /^Wed at (\d{1,2}:\d{2})( ·)?$/, ro: "miercuri la $1$2" },
  { pattern: /^Thu at (\d{1,2}:\d{2})( ·)?$/, ro: "joi la $1$2" },
  { pattern: /^Fri at (\d{1,2}:\d{2})( ·)?$/, ro: "vineri la $1$2" },
  { pattern: /^Sat at (\d{1,2}:\d{2})( ·)?$/, ro: "sâmbătă la $1$2" },
  { pattern: /^Sun at (\d{1,2}:\d{2})( ·)?$/, ro: "duminică la $1$2" },
  // Notices the Zen server writes into imported chats (zen/imports, zen/cliSessions).
  {
    pattern:
      /^Imported from (.+)\. This imported copy is read-only; use "Continue in a new chat" to keep working on it\.$/,
    ro: "Importat din $1. Această copie importată se poate doar citi; folosește „Continuă într-o conversație nouă” ca să lucrezi mai departe.",
  },
  {
    pattern:
      /^Continued from the imported (.+) chat "(.*)"\. The assistant gets the summary and the latest messages below as context\.$/,
    ro: "Continuare a conversației „$2” importate din $1. Asistentul primește ca context rezumatul și ultimele mesaje de mai jos.",
  },
  {
    pattern:
      /^Continued from a terminal session\. 1 earlier entry is not shown here; the agent still has the full conversation\.$/,
    ro: "Continuare a unei sesiuni de terminal. O intrare mai veche nu e afișată aici; agentul are în continuare toată conversația.",
  },
  {
    pattern:
      /^Continued from a terminal session\. (\d+) earlier entries are not shown here; the agent still has the full conversation\.$/,
    ro: "Continuare a unei sesiuni de terminal. $1 intrări mai vechi nu sunt afișate aici; agentul are în continuare toată conversația.",
  },
];

/**
 * Which language upstream text is rewritten to, or null to leave it alone: always in Office (its
 * English wording too), and in Code only when the app speaks Romanian, so Code in English keeps
 * upstream's developer English and Code in Romanian is not half English (the "Settled" shelf).
 */
export function upstreamRewriteLocale(
  edition: "office" | "code",
  locale: ZenLocale,
): ZenLocale | null {
  if (edition === "office") return locale;
  return locale === "ro" ? "ro" : null;
}

function replaced(text: string, key: string, value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === key) return null;
  return text.replace(key, value);
}

/** Code edition: Romanian only, developer wording (upstreamCodeText.ts) over the shared tables. */
function translateCodeText(text: string, key: string): string | null {
  const exact =
    UPSTREAM_CODE_RO[key] ??
    EXACT[key]?.ro ??
    UPSTREAM_SETTINGS_RO[key] ??
    UPSTREAM_SCREENS_RO[key] ??
    UPSTREAM_TOAST_RO[key];
  if (exact !== undefined) return replaced(text, key, exact);
  const code = applyScreensPattern(key, UPSTREAM_CODE_PATTERNS_RO);
  if (code !== null) return replaced(text, key, code);
  // Office patterns that only translate (no `en`) read the same in Code.
  for (const rule of PATTERNS) {
    if (rule.en === undefined && rule.pattern.test(key)) {
      return replaced(text, key, key.replace(rule.pattern, rule.ro));
    }
  }
  const screens = applyScreensPattern(key, UPSTREAM_SCREENS_PATTERNS_RO);
  if (screens !== null) return replaced(text, key, screens);
  for (const rule of UPSTREAM_TOAST_PATTERNS_RO) {
    if (rule.pattern.test(key)) return replaced(text, key, key.replace(rule.pattern, rule.ro));
  }
  return null;
}

/**
 * The wording of an upstream string in `locale` for `edition`, or null to leave it as it is.
 * Office: Office wording in English and Romanian. Code: Romanian only, English stays upstream's.
 */
export function translateUpstreamText(
  text: string,
  locale: ZenLocale,
  edition: ZenEdition = "office",
): string | null {
  const key = text.trim();
  if (key.length === 0 || key.length > 400) return null;
  if (edition === "code") return locale === "ro" ? translateCodeText(text, key) : null;
  const entry = EXACT[key];
  if (entry) return replaced(text, key, locale === "ro" ? entry.ro : entry.en);
  if (locale === "ro") {
    // Settings pages, other screens and toasts: Romanian only (their English fits Office).
    const value =
      UPSTREAM_OFFICE_RO[key] ??
      UPSTREAM_SETTINGS_RO[key] ??
      UPSTREAM_SCREENS_RO[key] ??
      UPSTREAM_TOAST_RO[key];
    if (value !== undefined) return replaced(text, key, value);
  }
  for (const rule of PATTERNS) {
    if (!rule.pattern.test(key)) continue;
    const template = locale === "ro" ? rule.ro : rule.en;
    if (template === undefined) return null;
    return text.replace(key, key.replace(rule.pattern, template));
  }
  if (locale === "ro") {
    const screens = applyScreensPattern(key, UPSTREAM_SCREENS_PATTERNS_RO);
    if (screens !== null) return replaced(text, key, screens);
    for (const rule of UPSTREAM_TOAST_PATTERNS_RO) {
      if (rule.pattern.test(key)) return text.replace(key, key.replace(rule.pattern, rule.ro));
    }
  }
  return null;
}

const ATTRIBUTES = ["placeholder", "aria-label", "title"] as const;

/** Never rewrite what people or agents wrote: messages, editors, code. */
const SKIP_SELECTOR = [
  "[contenteditable]",
  "textarea",
  "input",
  "pre",
  "code",
  "[data-message-role]",
  ".chat-markdown",
  "[data-zen-no-translate]",
].join(",");

/** Code also shows files, diffs, terminals and plan cards, which hold people's own words. */
const CODE_SKIP_SELECTOR = [
  SKIP_SELECTOR,
  ".xterm",
  "[data-right-panel-surface-content]",
  "[data-thread-terminal-drawer]",
  "[data-thread-find-text]",
  "[data-diff]",
  "[data-file]",
].join(",");

/**
 * App chrome inside a message row (the "Show full message" button, the screen-reader "You"
 * heading): upstream text, not what someone wrote, so it is rewritten even there.
 */
const MESSAGE_CHROME_SELECTOR = "[data-user-message-footer], h3.sr-only";

function skippedBy(selector: string, element: Element | null): boolean {
  if (element === null) return true;
  if (element.closest(MESSAGE_CHROME_SELECTOR) !== null) {
    return (
      element.closest("[contenteditable], textarea, input, pre, code, [data-zen-no-translate]") !==
      null
    );
  }
  return element.closest(selector) !== null;
}

/**
 * Starts rewriting upstream text under `root` for `locale`. Returns a stop function. The original
 * text is not restored on stop; callers re-render (the edition switch reloads the shell).
 */
export function startUpstreamTextRewriter(
  root: HTMLElement,
  locale: ZenLocale,
  edition: ZenEdition = "office",
): () => void {
  const selector = edition === "code" ? CODE_SKIP_SELECTOR : SKIP_SELECTOR;
  const skipped = (element: Element | null) => skippedBy(selector, element);
  const rewriteText = (node: Text) => {
    if (skipped(node.parentElement)) return;
    const value = node.nodeValue;
    if (!value) return;
    const next = translateUpstreamText(value, locale, edition);
    if (next !== null && next !== value) node.nodeValue = next;
  };
  const rewriteAttributes = (element: Element) => {
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (!value) continue;
      // Inputs keep their own value, but their placeholder is upstream text.
      if (name !== "placeholder" && skipped(element)) continue;
      const next = translateUpstreamText(value, locale, edition);
      if (next !== null && next !== value) element.setAttribute(name, next);
    }
  };
  const walk = (start: Node) => {
    if (start.nodeType === Node.TEXT_NODE) {
      rewriteText(start as Text);
      return;
    }
    if (start.nodeType !== Node.ELEMENT_NODE) return;
    rewriteAttributes(start as Element);
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) rewriteText(node as Text);
      else rewriteAttributes(node as Element);
    }
  };
  walk(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") rewriteText(record.target as Text);
      else if (record.type === "attributes") rewriteAttributes(record.target as Element);
      else for (const node of record.addedNodes) walk(node);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRIBUTES],
  });
  return () => observer.disconnect();
}
