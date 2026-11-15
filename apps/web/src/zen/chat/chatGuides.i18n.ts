// Zen Staff chat integrations: the guided install per platform, in English and Romanian. Each
// guide lists the exact admin clicks, then the platform's terms of use in plain words. Minimal
// scopes come from ZEN_CHAT_PLATFORM_INFO (contracts), so they are listed once.
import type { ZenChatPlatform } from "@t3tools/contracts/zenChat";

import { defineZenMessages, zenMessagesFor, type ZenLocale } from "../i18n/zenI18n";

export interface PlatformGuide {
  readonly intro: string;
  readonly steps: ReadonlyArray<string>;
  readonly tos: ReadonlyArray<string>;
}

const RELAY_EN =
  "This platform needs a public HTTPS address, so its webhook goes through the Zen hub relay to your company server. The hub sees the request metadata and the message payloads in transit (in memory, never stored); the server checks the platform's signature itself, so the hub cannot fake messages.";
const RELAY_RO =
  "Această platformă cere o adresă HTTPS publică, așa că webhook-ul trece prin releul hubului Zen spre serverul companiei. Hubul vede metadatele cererii și conținutul mesajelor în tranzit (doar în memorie, nu le stochează); serverul verifică singur semnătura platformei, deci hubul nu poate falsifica mesaje.";
const VAULT_EN =
  "Tokens are pasted once and kept encrypted in the company server's vault. They never reach the hub or the chat.";
const VAULT_RO =
  "Tokenurile se lipesc o singură dată și rămân criptate în seiful serverului companiei. Nu ajung niciodată în hub sau în chat.";
const OFFICIAL_EN =
  "Official APIs and bot accounts only: no personal user tokens, no browser automation, no scraping.";
const OFFICIAL_RO =
  "Doar API-uri oficiale și conturi de bot: fără tokenuri personale de utilizator, fără automatizare de browser, fără scraping.";

const en: Record<ZenChatPlatform, PlatformGuide> = {
  slack: {
    intro:
      "The Slack app is created and installed in your own workspace, by a workspace admin. It connects out through Socket Mode: no public address needed.",
    steps: [
      'Open api.slack.com/apps and click "Create New App", then "From an app manifest".',
      "Pick your workspace, paste the manifest below (YAML or JSON) and click Next, then Create.",
      'Click "Install to Workspace" and Allow (an admin approves if your workspace requires it).',
      'Open "OAuth & Permissions" and copy the Bot User OAuth Token (xoxb-...). Paste it below.',
      'Open "Basic Information" > "App-Level Tokens" > "Generate Token and Scopes", add the scope connections:write, generate, and paste the xapp-... token below.',
      'Copy your workspace ID (starts with T; Slack: workspace name > "Tools & settings" > "Workspace settings", or the URL of app.slack.com/client/T...). Add it to the allow-list.',
      "Invite the bot to a channel (/invite @Zen Staff), bind the channel to an AI staff member, then Test.",
    ],
    tos: [
      OFFICIAL_EN,
      "The app uses only the bot scopes listed here; it reads channels only where it is invited.",
      VAULT_EN,
    ],
  },
  teams: {
    intro:
      "The bot is registered in your own Microsoft 365 tenant and approved by your Teams admin. Teams delivers messages to a webhook, which goes through the Zen hub relay.",
    steps: [
      'In the Azure portal create an "Azure Bot" (or in the Teams Developer Portal: Tools > Bot management > New bot), type: Single tenant.',
      'Under "Configuration" set the Messaging endpoint to the webhook address shown below, and Save.',
      'Copy the Microsoft App ID and your Directory (tenant) ID. Under "Manage Password" create a client secret and paste its value below.',
      'Under "Channels" add Microsoft Teams and accept the terms.',
      "Download the Teams app package manifest below, zip it with two icons (color 192x192, outline 32x32) and upload it in Teams admin center > Teams apps > Manage apps > Upload new app.",
      "Your Teams admin approves the app (Allow) and adds it to the team; add the tenant ID to the allow-list, then Test.",
    ],
    tos: [OFFICIAL_EN, RELAY_EN, VAULT_EN],
  },
  discord: {
    intro:
      "A bot application in your own Discord server. It connects out through the Discord gateway: no public address needed.",
    steps: [
      'Open discord.com/developers/applications and click "New Application".',
      'Under "Bot" click "Reset Token", copy the token and paste it below. Leave "Message Content Intent" off: the bot only reads messages that mention it and direct messages.',
      'Copy the Application ID from "General Information".',
      'Under "OAuth2" > "URL Generator" choose bot and applications.commands, with the permissions listed here; open the URL and add the bot to your server.',
      "Copy your server ID (Developer Mode on, right-click the server > Copy Server ID) and add it to the allow-list. The /zen command is registered for that server when the bot starts.",
      "Bind a channel to an AI staff member, then Test.",
    ],
    tos: [OFFICIAL_EN, VAULT_EN],
  },
  telegram: {
    intro:
      "A Telegram bot created with @BotFather. It fetches messages by long polling: no public address needed.",
    steps: [
      "Open @BotFather in Telegram and send /newbot; choose a name and a username ending in bot.",
      "Copy the token BotFather gives you and paste it below.",
      "Send /setcommands, pick the bot and send: zen - Give a task to the AI staff",
      "Keep privacy mode on (/setprivacy > Enable): in groups the bot sees only /zen commands, mentions and replies to it.",
      "Send /setjoingroups to allow adding it to your groups, add it to the group, then turn it off again so nobody else can add it.",
      "Add the group's chat ID (and, for direct messages, each person's user ID) to the allow-list and link people under People. A person who writes to the bot is told their Telegram ID. Then Test.",
    ],
    tos: [OFFICIAL_EN, VAULT_EN],
  },
  googlechat: {
    intro:
      "A Google Chat app in your own Google Cloud project, for your Workspace domain. Google calls an HTTPS endpoint, which goes through the Zen hub relay.",
    steps: [
      "In Google Cloud console create (or pick) a project and enable the Google Chat API.",
      'Open Google Chat API > "Configuration": app name, avatar, description; turn on "Receive 1:1 messages" and "Join spaces and group conversations".',
      'Connection settings: "HTTP endpoint URL" = the webhook address shown below; Authentication audience: "Project number".',
      'Slash commands: add /zen (ID 1, "Give a task to the AI staff").',
      "Visibility: only people in your domain. Save.",
      "Create a service account (IAM > Service accounts), add a JSON key, and paste the whole JSON below. Copy the project number from the project dashboard.",
      "Add your Workspace customer ID or domain to the allow-list, then Test.",
    ],
    tos: [OFFICIAL_EN, RELAY_EN, VAULT_EN],
  },
  whatsapp: {
    intro:
      "Only through the official WhatsApp Business Cloud API (Meta), with your own business number. Meta calls a webhook, which goes through the Zen hub relay.",
    steps: [
      'In developers.facebook.com create an app of type "Business" and add the WhatsApp product.',
      "In Business settings create a system user, give it the app and your WhatsApp account, and generate a permanent token with whatsapp_business_messaging and whatsapp_business_management. Paste it below.",
      'Copy the Phone number ID from WhatsApp > "API Setup".',
      "Under App settings > Basic copy the App secret and paste it below; choose a verify token and paste it too.",
      'WhatsApp > Configuration > Webhook: callback URL = the webhook address shown below, verify token = the one you chose; subscribe to the "messages" field.',
      "For scheduled reports, create a message template (category Utility) with one body variable and wait for Meta's approval; write it as name:language under Settings.",
      "Add your WhatsApp Business account ID to the allow-list and link people's phone numbers under People, then Test.",
    ],
    tos: [
      "Only the official WhatsApp Business Cloud API: no WhatsApp Web automation, no unofficial libraries.",
      "The bot answers freely within 24 hours of a person's last message; after that only approved templates may be sent (scheduled reports use your template).",
      "People must have agreed to receive messages from your business (opt-in).",
      RELAY_EN,
      VAULT_EN,
    ],
  },
  email: {
    intro:
      "The company's OWN mailbox becomes a channel for its AI staff: mail sent to an alias (ana@firma.example) or filed under a label (Zen/Ana) reaches that agent, who writes a draft reply. Nothing is sent until the agent's manager approves it. The company server reads the mailbox itself; no mail goes through the hub.",
    steps: [
      "Pick the mailbox type. Gmail (Google Workspace): a Workspace admin opens console.cloud.google.com in the company's own Google Cloud project, enables the Gmail API, sets the OAuth consent screen to Internal and adds the scopes gmail.modify and gmail.send.",
      'Gmail: Credentials > Create credentials > OAuth client ID > Web application, redirect URI https://developers.google.com/oauthplayground. In the OAuth Playground (gear icon > "Use your own OAuth credentials"), authorize the two scopes signed in as the mailbox, exchange the code and copy the refresh token. Paste the client ID below, and the client secret and refresh token as tokens.',
      'Microsoft 365: an admin opens entra.microsoft.com > App registrations > New registration (single tenant), adds the redirect URI https://localhost, then API permissions > Microsoft Graph > Delegated: Mail.ReadWrite, Mail.Send, offline_access, and clicks "Grant admin consent". Under Certificates & secrets create a client secret.',
      "Microsoft 365: sign in once as the mailbox through the authorization code flow of that app (scope offline_access Mail.ReadWrite Mail.Send) to get a refresh token. Paste the client ID and tenant ID below, and the client secret and refresh token as tokens.",
      "Any other mailbox (IMAP/SMTP): create an app password in the mail provider's security settings (never the account password). Fill in the IMAP and SMTP servers and paste the app password as a token.",
      "Routing: create aliases for the agents (ana@firma.example delivered to this mailbox) or a label / folder per agent (Zen/Ana, with a filter that files the mail there). Bind each alias or label to an AI staff member under Channels; inbox takes the rest.",
      "Add the allowed senders (addresses or @domains of your customers and suppliers), link the manager under People, then Test.",
    ],
    tos: [
      "Your own Google Cloud project or Microsoft tenant: the tokens belong to your company, are kept encrypted in the company server's vault and can be revoked there any time.",
      "Every mail is treated as untrusted: requests for passwords, codes, payments, new bank details or sending data out are flagged for the manager and never followed.",
      "Replies go only to the sender (and allow-listed people in Cc), in the original thread, after the manager approves them. Outgoing text is checked for secrets first.",
      "Automatic mail (bounces, auto-replies, newsletters, mailing lists) never gets an answer.",
    ],
  },
};

const ro: Record<ZenChatPlatform, PlatformGuide> = {
  slack: {
    intro:
      "Aplicația Slack se creează și se instalează în workspace-ul vostru, de un administrator. Se conectează spre exterior prin Socket Mode: nu e nevoie de adresă publică.",
    steps: [
      'Deschide api.slack.com/apps și apasă "Create New App", apoi "From an app manifest".',
      "Alege workspace-ul, lipește manifestul de mai jos (YAML sau JSON), apasă Next, apoi Create.",
      'Apasă "Install to Workspace" și Allow (aprobă un administrator, dacă workspace-ul cere asta).',
      'Deschide "OAuth & Permissions" și copiază Bot User OAuth Token (xoxb-...). Lipește-l mai jos.',
      'Deschide "Basic Information" > "App-Level Tokens" > "Generate Token and Scopes", adaugă permisiunea connections:write, generează și lipește tokenul xapp-... mai jos.',
      'Copiază ID-ul workspace-ului (începe cu T; în Slack: numele workspace-ului > "Tools & settings" > "Workspace settings", sau adresa app.slack.com/client/T...). Adaugă-l în lista permisă.',
      "Invită botul într-un canal (/invite @Zen Staff), alocă un angajat AI canalului, apoi apasă Testează.",
    ],
    tos: [
      OFFICIAL_RO,
      "Aplicația folosește doar permisiunile de bot listate aici; citește doar canalele în care e invitată.",
      VAULT_RO,
    ],
  },
  teams: {
    intro:
      "Botul se înregistrează în tenantul Microsoft 365 al companiei și îl aprobă administratorul Teams. Teams livrează mesajele la un webhook, care trece prin releul hubului Zen.",
    steps: [
      'În portalul Azure creează un "Azure Bot" (sau în Teams Developer Portal: Tools > Bot management > New bot), tip: Single tenant.',
      'La "Configuration" pune ca Messaging endpoint adresa de webhook afișată mai jos și salvează.',
      'Copiază Microsoft App ID și Directory (tenant) ID. La "Manage Password" creează un client secret și lipește valoarea lui mai jos.',
      'La "Channels" adaugă Microsoft Teams și acceptă termenii.',
      "Descarcă manifestul pachetului de aplicație Teams de mai jos, pune-l într-o arhivă zip cu două iconițe (color 192x192, contur 32x32) și încarcă-l în Teams admin center > Teams apps > Manage apps > Upload new app.",
      "Administratorul Teams aprobă aplicația (Allow) și o adaugă în echipă; adaugă ID-ul tenantului în lista permisă, apoi Testează.",
    ],
    tos: [OFFICIAL_RO, RELAY_RO, VAULT_RO],
  },
  discord: {
    intro:
      "O aplicație bot în serverul vostru de Discord. Se conectează spre exterior prin gateway-ul Discord: nu e nevoie de adresă publică.",
    steps: [
      'Deschide discord.com/developers/applications și apasă "New Application".',
      'La "Bot" apasă "Reset Token", copiază tokenul și lipește-l mai jos. Lasă "Message Content Intent" oprit: botul citește doar mesajele care îl menționează și mesajele directe.',
      'Copiază Application ID din "General Information".',
      'La "OAuth2" > "URL Generator" alege bot și applications.commands, cu permisiunile listate aici; deschide adresa și adaugă botul în server.',
      "Copiază ID-ul serverului (Developer Mode pornit, clic dreapta pe server > Copy Server ID) și adaugă-l în lista permisă. Comanda /zen se înregistrează pentru acel server când pornește botul.",
      "Alocă un angajat AI unui canal, apoi Testează.",
    ],
    tos: [OFFICIAL_RO, VAULT_RO],
  },
  telegram: {
    intro:
      "Un bot Telegram creat cu @BotFather. Preia mesajele prin long polling: nu e nevoie de adresă publică.",
    steps: [
      "Deschide @BotFather în Telegram și trimite /newbot; alege un nume și un username care se termină în bot.",
      "Copiază tokenul primit de la BotFather și lipește-l mai jos.",
      "Trimite /setcommands, alege botul și trimite: zen - Dă o sarcină angajaților AI",
      "Lasă modul de confidențialitate pornit (/setprivacy > Enable): în grupuri botul vede doar comenzile /zen, mențiunile și răspunsurile la mesajele lui.",
      "Trimite /setjoingroups ca să-l poți adăuga în grupurile voastre, adaugă-l în grup, apoi oprește din nou opțiunea ca să nu-l mai poată adăuga altcineva.",
      "Adaugă ID-ul de chat al grupului (și, pentru mesaje directe, ID-ul fiecărei persoane) în lista permisă și leagă persoanele la Oameni. Cine îi scrie botului își află ID-ul de Telegram din răspuns. Apoi Testează.",
    ],
    tos: [OFFICIAL_RO, VAULT_RO],
  },
  googlechat: {
    intro:
      "O aplicație Google Chat în proiectul vostru Google Cloud, pentru domeniul Workspace al companiei. Google apelează o adresă HTTPS, care trece prin releul hubului Zen.",
    steps: [
      "În Google Cloud console creează (sau alege) un proiect și activează Google Chat API.",
      'Deschide Google Chat API > "Configuration": nume, avatar, descriere; pornește "Receive 1:1 messages" și "Join spaces and group conversations".',
      'Setări de conexiune: "HTTP endpoint URL" = adresa de webhook afișată mai jos; Authentication audience: "Project number".',
      'Comenzi slash: adaugă /zen (ID 1, "Dă o sarcină angajaților AI").',
      "Vizibilitate: doar persoanele din domeniul vostru. Salvează.",
      "Creează un cont de serviciu (IAM > Service accounts), adaugă o cheie JSON și lipește tot JSON-ul mai jos. Copiază numărul proiectului din panoul proiectului.",
      "Adaugă ID-ul de client Workspace sau domeniul în lista permisă, apoi Testează.",
    ],
    tos: [OFFICIAL_RO, RELAY_RO, VAULT_RO],
  },
  whatsapp: {
    intro:
      "Doar prin API-ul oficial WhatsApp Business Cloud (Meta), cu numărul de business al companiei. Meta apelează un webhook, care trece prin releul hubului Zen.",
    steps: [
      'În developers.facebook.com creează o aplicație de tip "Business" și adaugă produsul WhatsApp.',
      "În Business settings creează un system user, dă-i acces la aplicație și la contul WhatsApp și generează un token permanent cu whatsapp_business_messaging și whatsapp_business_management. Lipește-l mai jos.",
      'Copiază Phone number ID din WhatsApp > "API Setup".',
      "La App settings > Basic copiază App secret și lipește-l mai jos; alege un verify token și lipește-l și pe el.",
      'WhatsApp > Configuration > Webhook: callback URL = adresa de webhook afișată mai jos, verify token = cel ales de tine; abonează-te la câmpul "messages".',
      "Pentru rapoartele programate creează un șablon de mesaj (categoria Utility) cu o variabilă în corp și așteaptă aprobarea Meta; scrie-l ca nume:limbă la Setări.",
      "Adaugă ID-ul contului WhatsApp Business în lista permisă și leagă numerele de telefon ale persoanelor la Oameni, apoi Testează.",
    ],
    tos: [
      "Doar API-ul oficial WhatsApp Business Cloud: fără automatizarea WhatsApp Web, fără biblioteci neoficiale.",
      "Botul răspunde liber în 24 de ore de la ultimul mesaj al persoanei; după aceea se pot trimite doar șabloane aprobate (rapoartele programate folosesc șablonul vostru).",
      "Persoanele trebuie să fi acceptat să primească mesaje de la compania voastră (opt-in).",
      RELAY_RO,
      VAULT_RO,
    ],
  },
  email: {
    intro:
      "Căsuța de e-mail PROPRIE a companiei devine un canal pentru angajații AI: mailurile trimise la un alias (ana@firma.example) sau puse sub o etichetă (Zen/Ana) ajung la acel agent, care scrie o ciornă de răspuns. Nimic nu pleacă până nu aprobă managerul agentului. Serverul companiei citește singur căsuța; niciun mail nu trece prin hub.",
    steps: [
      "Alegeți tipul căsuței. Gmail (Google Workspace): un administrator Workspace deschide console.cloud.google.com în proiectul Google Cloud al companiei, activează Gmail API, setează ecranul de consimțământ OAuth pe Internal și adaugă scopurile gmail.modify și gmail.send.",
      "Gmail: Credentials > Create credentials > OAuth client ID > Web application, redirect URI https://developers.google.com/oauthplayground. În OAuth Playground (rotița > „Use your own OAuth credentials”) autorizați cele două scopuri autentificat ca acea căsuță, schimbați codul și copiați refresh token-ul. Lipiți client ID-ul mai jos, iar client secret-ul și refresh token-ul ca tokenuri.",
      "Microsoft 365: un administrator deschide entra.microsoft.com > App registrations > New registration (single tenant), adaugă redirect URI https://localhost, apoi API permissions > Microsoft Graph > Delegated: Mail.ReadWrite, Mail.Send, offline_access și apasă „Grant admin consent”. La Certificates & secrets creează un client secret.",
      "Microsoft 365: autentificați-vă o dată ca acea căsuță prin fluxul authorization code al aplicației (scope offline_access Mail.ReadWrite Mail.Send) ca să obțineți un refresh token. Lipiți client ID-ul și tenant ID-ul mai jos, iar client secret-ul și refresh token-ul ca tokenuri.",
      "Orice altă căsuță (IMAP/SMTP): creați o parolă de aplicație din setările de securitate ale furnizorului de e-mail (niciodată parola contului). Completați serverele IMAP și SMTP și lipiți parola de aplicație ca token.",
      "Rutare: creați aliasuri pentru agenți (ana@firma.example livrat în această căsuță) sau o etichetă / un dosar pe agent (Zen/Ana, cu un filtru care mută mailul acolo). Legați fiecare alias sau etichetă de un angajat AI la Canale; inbox preia restul.",
      "Adăugați expeditorii permiși (adresele sau @domeniile clienților și furnizorilor), legați managerul la Oameni, apoi Testați.",
    ],
    tos: [
      "Proiectul Google Cloud sau tenantul Microsoft sunt ale companiei: tokenurile vă aparțin, stau criptate în seiful serverului companiei și pot fi revocate oricând.",
      "Orice mail e tratat ca nesigur: cererile de parole, coduri, plăți, conturi bancare noi sau de trimitere a datelor în afară sunt semnalate managerului și nu sunt urmate niciodată.",
      "Răspunsurile pleacă doar către expeditor (și persoanele permise din Cc), în firul original, după ce le aprobă managerul. Textul trimis e verificat întâi de secrete.",
      "Mailurile automate (returnări, răspunsuri automate, newslettere, liste de discuții) nu primesc niciodată răspuns.",
    ],
  },
};

const chatGuidesText = defineZenMessages({ en, ro });

export function platformGuide(platform: ZenChatPlatform, locale: ZenLocale): PlatformGuide {
  return zenMessagesFor(chatGuidesText, locale)[platform];
}
