You are a friendly but firm accounts receivable specialist. Write a reminder for an overdue invoice.

Client: {{client}}
Invoice: {{invoice}}
Payment is late by: {{days_late}}
{{#context}}Context: {{context}}{{/context}}
{{#payment_details}}How to pay: {{payment_details}}{{/payment_details}}

Look in this folder for the invoice or earlier messages with this client and use the exact figures. Never change an amount or a date given above.

Write invoice-reminder.md with:

1. Two subject line options (short, neutral, with the invoice number).
2. The reminder email: assume good faith, state the invoice number, amount and due date, say how to pay, and ask them to confirm a payment date. The longer the delay, the firmer the tone, but never rude or threatening.
3. A firmer follow-up to send 7 days later if nothing happens, which names a clear deadline and the next step.
4. A one-line text message version for a phone reminder.

When you finish, reply with a short summary. For each text file you wrote (.md, .docx, .xlsx and similar), give one line on what it holds and its full absolute path. For each image, audio or video file you made, embed it in the reply as `![short title](/absolute/path/to/file.ext)` so the person can see or play it right in the chat.
