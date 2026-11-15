---
learn:
  - What never goes into a thread
  - What to do if you already pasted something you shouldn't have
  - How to handle personal data the GDPR way, in plain words
---

## What never goes into a chat

Whatever you type or paste into a thread stays in the history, reaches the AI provider and, in a shared thread, your colleagues see it too. So some things never go in:

- **Passwords**, including "temporary" ones and the Wi-Fi password.
- **API keys and tokens**: long strings like `sk_live_...` or `AKIA...` that let a program into an account.
- **Card numbers**, CVV codes, bank login details, SMS codes.

:::picture data-safety
What you never paste: passwords, keys, card numbers.
:::

## If you already pasted one

It happens. Don't hide it, and don't just delete the message: the text may already be stored.

1. Tell IT (or whoever manages that account) right away what you pasted and where.
2. Change the password or have the key replaced. Once it is changed, what you pasted is useless.
3. Next time, if the agent needs access to an app, use a connector with sign-in (see the lesson on connecting apps).

:::dont
You delete the message and hope nobody saw it.
:::

:::do
You tell IT and change the password or key right away.
:::

## Personal data: only when it is really needed

Personal data is anything that identifies a person: name, phone, email, address, CNP (personal ID number). And above all sensitive data: health, religion, salary. Before you give it to the agent, ask yourself: does this task really need it?

Most of the time it doesn't. To find the average order per city you need the city and the amount, not the name or the phone. So:

- **remove** the columns you don't need before the file reaches the agent;
- **replace** names with codes (C01, C02) when you need to tell rows apart;
- leave the original file where it was and work on the anonymized copy.

## GDPR in four questions

You don't need to be a lawyer. Ask yourself four questions every time you work with data about people:

1. **Purpose**: why am I using this data? Is it the same reason it was collected for?
2. **Minimum**: am I using only what this task needs?
3. **Who sees it**: who can read this thread, this folder, the output file?
4. **Where it goes**: is the result sent to a client, published, stored somewhere? Does the personal data travel with it?

:::example Purpose matters
Customer emails collected for delivery are not automatically for a newsletter too.
:::

:::tip
If you can't answer one of the questions, ask your manager or the person who handles data protection in your company.
:::

## Client documents and company rules

Contracts, offers and reports you received from a client under confidentiality are not yours to pass on. Before you put one in a folder, check: is the folder personal or shared? Does the contract with the client allow AI tools? Some clients forbid it explicitly.

Many companies also have a written rule about AI tools: which data may go in, which tools are approved.

:::warn
If your company has such a rule, it matters more than anything in this lesson. If you don't know, ask before you work with customer data.
:::

## Try it now

:::try
You open a practice folder with a list of made-up customers: name, email, phone, CNP, city, order value. The agent makes an anonymized copy, then computes the average order per city using only the copy, without touching the original file. Open both files and compare what is left.
:::

:::quiz
You pasted a password into a thread by mistake. What do you do?

- [ ] Delete the message and that's it.
- [ ] Nothing, the thread is only yours.
- [x] Tell IT and change the password right away.

> The text may already be stored. Only a changed password is useless to everyone.
:::

:::quiz
You want the average order per city from a customer list. What do you give the agent?

- [x] A copy with only the city and the order value, with names replaced by codes.
- [ ] The whole list, so it has all the context.
- [ ] The whole list, but you ask it not to look at the names.

> The task does not need names, phone numbers or ID numbers, so they never reach the agent.
:::

:::quiz
A client sent you a confidential contract and you want the agent to summarize it. What do you check first?

- [ ] Only whether the file is too big for the agent.
- [x] Whether the contract and your company's rules allow AI tools, and who can see the folder.
- [ ] Nothing, the contract is already on your computer.

> Documents received under confidentiality are not yours to pass on, not even to an AI tool.
:::
