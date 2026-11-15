# FAQ and support macros from real messages

The best FAQ answers what customers actually ask, in their words, and the best macro sounds
like a person who read the message. Build both from the messages, ranked by how often each
question comes up.

## 1. Topics

Read all messages and list topics with a count: "Where is my order (23)", "Change delivery
address (9)", "Invoice on company name (7)". Merge duplicates; keep the customer's wording for
the question. Note the emotion that comes with each topic (worried, angry, in a hurry).

## 2. faq.md (public, for the website or the help page)

The top 10-20 questions, most frequent first, grouped under 3-6 headings. Each: the question
as a customer would type it, an answer in 2-5 sentences that starts with the direct answer,
then the detail, then where to go next. Only facts from the form or the business's own
documents; a policy that is not given becomes [CHECK: ...] and goes to `gaps.md`. End with how
to contact a person.

## 3. macros.md (internal)

For every frequent topic one macro, plus: "we are looking into it", "we need more details",
an apology for a mistake on our side, "we cannot do that, here is what we can do", a refund
or return answer (only if the policy was given), and closing a ticket. Each macro:

- **Name** (short, the way the team will search for it) and **when to use it**;
- **The reply**, ready to paste, with fields in double braces the agent fills in:
  `{{prenume}}`, `{{numar_comanda}}`, `{{data_livrare}}`, `{{semnatura}}`;
- **Personalise** (one line: what to change for this customer, e.g. mention what they wrote);
- **Do not** (one line: e.g. never promise a delivery date the courier did not confirm).

Variants per channel when the form names them: email (greeting, full sentences, signature),
chat/WhatsApp (shorter, no signature), public comments (no personal data, move to private).

## 4. macros.csv

Header `name,topic,channel,subject,body,when_to_use`; one row per macro and channel; UTF-8;
quote every field; new lines inside `body` kept as real line breaks inside the quotes.

## 5. gaps.md

What customers ask that the business has no clear answer to (missing policies, unclear prices,
pages to add to the site), the topics that signal a product or process problem (the same
complaint over and over), and 3 concrete fixes that would remove the most messages.

## Rules

- No personal data from the messages in any file; examples are rewritten generically.
- Never promise refunds, compensation, dates or exceptions the facts do not allow.
- Apologise for the experience when the business is at fault; never blame the customer.
- Tone from the form; Romanian with ș and ț (comma below); no emoji.

## Self-review (do it, then fix what fails)

1. Topics are ranked by the real counts, and the FAQ follows that order.
2. Every answer and macro uses only given facts; unknowns are [CHECK] and in gaps.md.
3. No customer name, email, phone, address or order number appears anywhere.
4. Every macro has fields in double braces instead of invented specifics.
5. macros.csv has the header and one complete row per macro and channel.
