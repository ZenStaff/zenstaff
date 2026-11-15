# Data protection checks ("Are we OK with GDPR?")

An outside look at what the website shows and loads, against the GDPR, the ePrivacy cookie rules and, for Romania, the national rules. Say in the report that this is a practical check, not legal advice, and that a lawyer or data protection officer confirms the final texts. Set `UA="Mozilla/5.0 (compatible; owner-website-check)"`, `SITE`, `HOST`.

## 1. What the first visit loads, before anyone clicks "Accept"

From the home page HTML (`curl -s -A "$UA" "$SITE"`) and its headers (`curl -sI`):

- Cookies set by the server on the first answer (`Set-Cookie`): technical ones (session, cart, language, load balancer, security) are fine; analytics or marketing ones (`_ga`, `_gid`, `_fbp`, `_gcl_au`, `_hj*`, `_clck`, `__utm*`, `MUID`) without consent are high.
- Trackers in the HTML: Google Analytics or Tag Manager (`gtag(`, `googletagmanager.com`), Meta Pixel (`fbq(`, `connect.facebook.net`), TikTok (`analytics.tiktok.com`), LinkedIn Insight (`snap.licdn.com`), Hotjar, Microsoft Clarity, Yandex, Pinterest. For each: is it loaded only after consent? Signs that it waits: the script has `type="text/plain"` with a consent category (`data-cookieconsent`, `data-category`, `data-cookie-category`), it is injected by the consent tool, or Google Consent Mode sets `ad_storage` and `analytics_storage` to `denied` by default before the tag. A tracker in a plain `<script>` tag with no such sign most likely fires before consent: high.
- Raw HTML cannot show what JavaScript does later. Say so, and suggest the manual test: open the site in a private window, open the browser's developer tools, Network tab, reload, and look for calls to the tracker domains before clicking anything.
- Embedded third parties that send visitor data on load: YouTube (prefer `youtube-nocookie.com` or a click-to-load preview), Google Maps (click-to-load), Google Fonts loaded from `fonts.googleapis.com` (a German court fined a site in 2022 for sending visitors' IP addresses this way; hosting the fonts locally fixes it), chat widgets, social share buttons. Medium to low.

## 2. The cookie banner

- A consent tool present? Signs: Cookiebot, OneTrust, CookieYes, Complianz, Iubenda, Usercentrics, Didomi, Axeptio, Termly, Klaro, CookieScript, Borlabs, GDPR Cookie Consent, or the site's own banner text ("cookie", "accept"). None while trackers are present: high.
- The rules a banner must meet: "Reject all" as easy and visible as "Accept all" (same layer, same prominence), choices per category, nothing non-essential before consent, a way to change one's mind later (a link or icon), and no "by continuing to browse you agree" (not valid consent; in Romania the data protection authority ANSPDCP requires explicit consent). Check what the HTML and the banner's text show; list the rest for the manual test.

## 3. The privacy policy

Find it from the footer links (privacy, confidentialitate, prelucrarea datelor, GDPR, cookies). Missing while the site has forms, accounts, a shop or trackers: high. Read it and check it names (GDPR articles 13 and 14):

- who is responsible: company name, address, contact (and the data protection officer if they have one);
- what data, for what purpose, on what legal basis (consent, contract, legal obligation, legitimate interest), for each purpose;
- who receives the data: named services (hosting, email, newsletter, payments, analytics, couriers), not just "partners";
- transfers outside the EU (Google, Meta, US tools) and the safeguard used;
- how long each kind of data is kept;
- people's rights (access, correction, deletion, restriction, portability, objection, withdrawing consent) and how to use them;
- the right to complain to the authority (in Romania: ANSPDCP, www.dataprotection.ro);
- a date of the last update.
  A separate cookie policy (or section) listing the cookies, their purpose and duration. A generic template that names tools the site does not use, or misses ones it does use, is medium.

## 4. Forms

Contact, booking, newsletter and account forms: a short notice next to the form with a link to the policy; any marketing checkbox unticked by default and separate from the terms; the newsletter confirms by email (double opt-in, recommended). A pre-ticked marketing box: high. Forms sent over http: high.

## 5. Company details and shop rules

- Romania: the site should identify the company (name, registered office, CUI/VAT and trade register number), usually in the footer or the terms. Missing: medium (high for a shop).
- Online shops in Romania: terms and conditions with the 14-day withdrawal right (OUG 34/2014), prices with VAT, delivery and return costs, and the ANPC consumer dispute links (the SAL page: https://anpc.ro/ce-este-sal/). The EU ODR platform closed on 20 July 2025: a leftover ODR link or clause should go (low).
- Other EU countries: the same principles (identity of the trader, withdrawal right, the national dispute body).

## 6. Other signals

- AI chat on the site: since 2 August 2026 (EU AI Act, article 50) people must be told they are talking to an AI: missing is medium.
- HTTPS everywhere personal data is entered.
- Newsletter or marketing emails: a working unsubscribe link in each one (ask; do not test).

## Code folder (only when given)

Where personal data is stored (database tables, form handlers, logs), whether trackers are loaded conditionally, personal data in logs or analytics events, how deletion requests could be handled.

## Who fixes what

Banner settings and tracker gating: the web developer (or whoever set up Google Tag Manager). Policy texts and company details: the owner with a lawyer or a GDPR consultant; the report lists what is missing so the lawyer's time is spent well. Forms: the web developer.

## Regulatory notes (as of November 2026; check before citing)

The EU "Digital Omnibus" changes to GDPR and cookie rules are proposals, not law yet: judge against the current GDPR (72-hour breach notice) and ePrivacy rules.

## Severity guide

High: trackers firing before consent, no banner with trackers present, no privacy policy with forms or a shop, pre-ticked marketing boxes. Medium: incomplete policy, no company details, third-party embeds loading on arrival, AI chat without notice. Low: Google Fonts, missing update date, leftover ODR link.
