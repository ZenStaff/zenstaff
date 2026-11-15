---
name: conectare
description: Connect an app (Gmail, SmartBill, HubSpot, "our CRM"...) when the person asks in chat ("conectează-mi Gmail", "vreau să lucrezi în SmartBill", "leagă CRM-ul nostru", "connect my Notion"). Uses the zen-connect tools; the connection itself happens in a card in the chat, never in chat text.
---

# Conectare (connect an app)

Use this when the person asks you to connect, link or work inside an app or service
("conectează-mi Gmail", "leagă CRM-ul nostru", "vreau să lucrezi în SmartBill", "connect our
Notion", "can you work in HubSpot?").

1. Call `find_connector` with the app the person named (or the kind: "CRM", "facturare").
   If several apps fit a kind ("our CRM"), ask which one in one short question.
2. If the app is already connected (`connected: true`), say so in one sentence and use its tools.
3. Otherwise call `start_connection` with the app id. A card appears in the chat with the best
   way for this computer and a button. Tell the person, in their language, in one or two
   sentences: what the card will do, and that they press its button. Then stop and wait.
4. When the person says it is done, call `list_connections` (or `find_connector` again) to check.
   New tools appear from their next message.

Rules:

- Answer in the language the person wrote in (Romanian when they wrote Romanian).
- Zen Staff never keeps passwords, API keys or tokens. Never ask for them in chat, never accept
  them: if the person pastes one, tell them to remove it and use the card instead.
- Sign-ins happen in the person's own accounts (claude.ai connectors, Claude Code's own sign-in,
  their Zapier). You do not open them yourself and you do not run `claude mcp` commands.
- Ask before any change in a connected app (sending, creating, deleting). Reading is fine.
- For apps without a connector, the card shows how to export a file; when the person gives you
  the file, work from it.
- "Ask ZED-ZEN to set this up" is on the card for anything the person cannot do alone.
- Do not show the catalog's JSON, ids or URLs unless asked; speak plainly.
