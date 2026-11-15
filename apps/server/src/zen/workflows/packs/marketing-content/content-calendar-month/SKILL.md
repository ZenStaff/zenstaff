# A month of content, planned like a social media manager would

The person should be able to open the calendar on the 1st of the month and know, for every
posting day, what goes out, where, with which hook, and what to photograph for it. Week 1 is
written in full so they can start today.

## 1. Decide the plan (write it at the top of `calendar.md`)

- **Goal and how we will know**: one sentence, plus the one number to watch (bookings,
  messages, orders, profile visits). No invented targets ("+30% reach").
- **3 or 4 content pillars** with a share each (adds to 100%). Typical: show the product or
  service (35%), behind the scenes / people (25%), useful to the customer (25%), offer or
  call to action (15%). Fit them to the business; never more than one post in five sells
  directly.
- **Cadence per channel**, from the form or, when not given, a realistic default for a small
  team: Instagram 3-4 posts + stories most days, Facebook 3, TikTok 3, LinkedIn 2,
  Google Business Profile 1 update a week, newsletter 1-2 a month. Fewer, better posts beat a
  plan nobody keeps.
- **Key dates**: the holidays and commercial dates from `month.mjs` that fit this business
  (a law firm skips Halloween), the person's own dates, and the dates early next month that
  need teasing now. Public holidays: say whether the business is open when the form tells you;
  otherwise mark [CHECK: open on <date>?].

## 2. The calendar

`calendar.md`: after the plan, one table per week (Monday to Sunday) with columns
Date | Day | Channel | Pillar | Format | Topic | Hook (first line) | Call to action | What we need.
Formats: reel/short video, carousel, photo, story, text post, live, newsletter. Hooks are the
first line people read: concrete, under 12 words, no clickbait, no emoji. Spread formats and
pillars across the week; put the strongest posts on the days the audience is most active for
that kind of business (lunch places before 11:00, B2B on Tuesday-Thursday mornings, shops on
Thursday-Sunday). Close with "Ideas in reserve": 5 extra topics for slow weeks.

`calendar.csv` (UTF-8, comma separated, header row, one row per post, same columns as the
tables plus `status` = "planned"): the same posts, for Google Sheets, Excel or a scheduler.
Quote any field that contains a comma.

## 3. Week 1 in full (`week-1-posts.md`)

For every post of the first week (Monday to Sunday of the week containing the 1st, from the
1st onwards): the date and channel, the caption ready to copy (adapted to the channel: short
and visual for Instagram, a bit longer for Facebook, professional for LinkedIn, spoken for
TikTok), 3-5 relevant hashtags where the channel uses them, alt text for the image, and a
**visual brief** a phone photographer can follow (subject, framing, light, what not to show).
For a reel: the 3-5 beats with seconds, on-screen text and the sound idea (trending sounds are
picked by the person in the app's commercial library). For a story: the frames and the sticker
(poll, question, link).

## 4. What to shoot (`shot-list.md`)

Every photo and video the month needs, grouped into 2-4 shooting sessions (what, where,
props, people who must agree to appear), so the month is shot in a few hours, not every day.

## Rules

- Every date and weekday comes from `month.mjs`. Every price, offer, opening hour, product
  name and claim comes from the form or the person's files; anything else is [CHECK: ...].
- No fake urgency, no giveaways that ask people to tag friends or share (platform rules), no
  medical, legal or financial promises, no competitor names.
- People in photos and videos: staff and customers appear only with their agreement; children
  only with a parent's written consent. Say this once in `shot-list.md`.
- Language: the person's language; Romanian with ș and ț (comma below), never the cedilla forms.
  No emoji in the documents.

## Self-review (do it, then fix what fails)

1. Every date in `calendar.md` and `calendar.csv` is in the month and its weekday matches
   the `month.mjs` list.
2. Posts per channel per week match the cadence; no two posts with the same topic or hook.
3. Pillar shares in the calendar are within 10 points of the plan; selling posts are at most
   one in five.
4. Every holiday or key date used is in the `month.mjs` list or the form.
5. No invented prices, offers, results or testimonials; open questions marked [CHECK].
6. `calendar.csv` has the same number of rows as posts in the calendar and every row has
   the same number of columns.
7. Every week-1 post has caption, alt text and visual brief; reels have beats.
