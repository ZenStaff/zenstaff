---
learn:
  - What a connector is and what it is for
  - How you ask for one and who approves it
  - How to give the least access and how to take it back
---

## What a connector is

By default the agent sees only the files in your folder. A **connector** is a bridge that lets it also work in an app: read documents in Google Drive, draft emails in Gmail, look up a page in Notion, post a message in Slack.

Technically it is a small add-on (an "MCP server") that the agent can use. You don't need to know how it works. You only need to know what it can reach.

:::example With Drive connected
"Find last month's price list in Drive and compare it with this one." No more downloading and copying files by hand.
:::

## How you ask for one

Your team may have a "Connect an app" option, or you simply write in a thread: "Connect my Google Drive."

What happens next:

1. The agent tells you what the connector will be able to do and asks for approval.
2. **An admin approves it.** In most companies someone from IT or the account owner decides which apps may be connected. It is not bureaucracy, it is a safety net.
3. **You sign in yourself, in the app's own window.** A browser window from Google (or Microsoft, Slack...) opens. You check the address, log in there and see the list of what you are allowing.
4. You come back to the thread and the agent can use the app.

:::picture connect
You connect an app and see what the agent is allowed to do in it.
:::

## Your password never goes into the chat

No real connector asks you to type your password, an SMS code or an "API key" into the chat. The only right place for your password is the app's sign-in window.

:::warn
If you ever see such a request, stop and ask someone from IT. Anything you type in a thread stays in the history, others may see it, and it reaches the AI provider.
:::

## Give the least access that works

On the permissions screen, read what you are granting:

- If the agent only needs to **read** documents, choose read-only access, or a single folder instead of your whole Drive.
- Be careful with "send email on your behalf" or "delete files". Grant it only if the task really needs it.
- Use your work account, not your personal one.

:::dont
You grant full access to your whole Drive so it can read one document.
:::

:::do
You choose read-only, or a single folder.
:::

:::tip
Even when it is allowed to send, ask the agent to show you the draft before it sends.
:::

## Disconnect when you're done

A connector stays active until someone removes it. For a one-off task, for example moving an old archive, disconnect it afterwards from the settings, or ask the agent how. You can also check and revoke access from the app itself (in Google: Account, Security, Third-party connections).

Once connected, the agent can read and sometimes change real company data, not practice files. Everything you learned so far matters even more: say exactly which document, ask it to show you before it changes or sends anything, and check the result.

:::picture approval
Before it sends or changes something, the agent asks for your approval.
:::

## Try it now

:::try
You pick a folder, and the agent tells you in plain words which apps, tools and connectors it can use there right now. Then it explains step by step how you would connect Google Drive safely: who approves, where you sign in, what access to choose, what never to paste into the chat and how to disconnect it. It does not connect, install or change anything.
:::

:::quiz
While you connect an app, a request appears in the chat asking you to type your password. What do you do?

- [ ] Type the password, just this once.
- [x] Stop and ask someone from IT.
- [ ] Type the password and delete the message right after.

> A real connector never asks for your password in the chat. You sign in only in the app's own window.
:::

:::quiz
You need the agent to read the reports in one Drive folder. What access do you grant?

- [ ] Full access to the whole Drive, so you never need another approval.
- [ ] Access to Drive and Gmail, so it can also send the reports.
- [x] Read-only, for that one folder.

> Give the least access the task needs. What is not granted cannot be misused.
:::

:::quiz
You connected Drive to move an old archive, and you are done. What next?

- [x] Disconnect the connector from the settings or from the app's account page.
- [ ] Leave it on, you might need it again.
- [ ] Nothing, it disconnects by itself at the end of the day.

> A connector stays active until someone removes it, so you remove it when you no longer need it.
:::
