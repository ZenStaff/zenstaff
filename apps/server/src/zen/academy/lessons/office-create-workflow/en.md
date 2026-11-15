---
learn:
  - When your request deserves to become a card
  - How to write a card's questions and instructions
  - How to test it before you share it with colleagues
---

## When a task deserves a card

If you have written roughly the same request three times, it is time for a card. Clear signs:

- you copy an old message from another thread and change two details;
- colleagues ask you "how did you get the agent to write like that?";
- the result is good only when you remember to add five specific instructions.

A card keeps the good instructions in one place. That way everyone gets the same quality without having to remember them. You make one from **Create workflow** on the Office home.

:::picture office-cards
Your card shows up on the Office home, next to the ready-made ones.
:::

## The two parts of a card

**Questions** are what changes from one time to the next. Each one has an id (a short name, like `client_name`), a label people see, and can be required or optional. Use three to six. Every extra field is one more reason for people to skip the card.

**Instructions** are what stays the same. You write them once, like a very good request. Where the answers go, you put placeholders: `{{client_name}}` is replaced with what the person typed.

:::tip
For something that is only filled in sometimes, use an optional section. The text between `{{#order_number}}` and `{{/order_number}}` appears only when that field has a value.
:::

:::picture workflow
The workflow editor: the name, the questions and the instructions.
:::

## Example: reply to a complaint

The card's questions:

- `complaint` (required): paste the customer's message
- `customer_name` (required)
- `what_happened` (required): what you found out inside the company
- `offer`: what you can offer (refund, voucher, replacement)
- `order_number`

:::example The card's instructions
```text
You write replies to customer complaints for our company.
Customer: {{customer_name}}
Their message: {{complaint}}
What we found out: {{what_happened}}
{{#order_number}}Order number: {{order_number}}.{{/order_number}}
{{#offer}}We can offer: {{offer}}. Offer only this, nothing more.{{/offer}}

Write a reply of at most 150 words. Apologise once, explain plainly
what happened, say what we do next and by when. Do not promise
anything that is not written above. Do not blame the customer.
Save it as reply-{{customer_name}}.md.
```
:::

Notice the limits: "offer only this", "do not promise anything that is not written above". Those lines keep you away from the most expensive mistakes.

## Test it before you share it

1. Run the card yourself on two real cases: one easy, one messy.
2. Give it to a colleague without explaining anything. Watch where they stop to think. Usually it is a field with an unclear name, so you rename it ("What did we find out?" instead of "Internal").
3. Fix the instructions, not the result.

:::dont
Every reply comes out too long, and you shorten each one by hand.
:::

:::do
You add the length limit to the card's instructions, once.
:::

## Keep it short

A card with 15 questions and two pages of instructions is a form nobody fills in. One card, one job.

:::example Two jobs, two cards
You need both "complaint reply" and "complaint report for the manager"? Make two cards, not one that does both.
:::

## Try it now

:::try
The workflow editor opens. Build the complaint card from the example above, or one for a task you repeat every week. Then start it once with a made-up complaint and see what comes out.
:::

:::quiz
Every Monday you copy the same old message and change only the date and the client's name. What do you do?

- [ ] Keep doing it, it works.
- [x] Turn it into a card, with the date and the client's name as questions.
- [ ] Ask the agent to remember the message for next week.

> When you repeat the same request, a card keeps the good instructions in one place and gives everyone the same quality.
:::

:::quiz
Your card's results always come out too long. What do you fix?

- [ ] Shorten each result by hand.
- [ ] Add five more questions to the card.
- [x] Put a length limit in the card's instructions.

> Fix the instructions, not the result. That solves it for everyone who uses the card.
:::

:::quiz
A colleague stops at a field called "Internal" and doesn't know what to write. What do you do?

- [x] Rename the field to a clear question, like "What did we find out?".
- [ ] Explain it to them once and leave the field as it is.
- [ ] Remove all the questions from the card.

> Testing with a colleague shows exactly what is unclear. A good field name needs no explanation.
:::
