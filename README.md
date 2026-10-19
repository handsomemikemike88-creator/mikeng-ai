# mikeng_course — AI course website (front end, site-full)

Single working copy. Front end only; payments/DB/email to be added by the backend. Not deployed.

## Run
```
cd /workspace/ai-course-site/site-full
npm install          # first time only
PORT=3312 node server.js   # http://localhost:3312
```
- `BASE=http://localhost:3312 node scripts/check.js`: crawl, broken links, prices, banned words.
- `node scripts/shots-full.js` → `../site-full-shots/` (full-page, 1280 + 390).
- `npm test`: refund-deadline tests.

## Pages
`/`, `/courses`, `/courses/online-video` (HK$588), `/courses/online-1on1` (HK$1,288, 合共 6 小時), `/courses/in-person` (HK$2,200, 8 堂，合共 24 小時), `/services`, `/instructors`, `/seminar` (+ `/seminar/thanks`, `/seminar.ics`), `/contact`, `/terms`, `/refund`, `/privacy`, `/unsubscribe`, `/confirmation`, `/join/<token>` (demo stub, noindex), 404. `/sitemap.xml`, `/robots.txt`, favicons. `/online-course` → 301 `/courses/online-video`.

## Seminar flow
`/seminar`: ① pick a date + details → `POST /api/seminar` → ② review page (確認 / 返回修改, `step=confirm|edit`) → saves → `/seminar/thanks`. Sign-up closes at the session start time. Each date: `/seminar.ics?session=YYYY-MM-DD-zoom` (404 for skipped/cancelled).

## Env vars
- `PORT` (default 3000; use 3312 here)
- `SUBMISSIONS_FILE` — demo JSON store (default `data/submissions.json`)
- `OUTBOX_FILE` — notification stub log, nothing is sent (default `data/outbox.jsonl`)
- `SITE_INDEXABLE=1` — only at launch with Mikey's OK

## In-person course pages
`/courses/in-person` (catalogue) and `/courses/in-person/<slug>`: gemini, gemini-notebooklm-travel, stitch, flow, spark, claude-codex-investing, hermes-agent (product id `ip-<slug>`).

## Unpublished courses (launchReady flag)
Each course in `data/inperson-courses.json` has `launchReady` (and `launchBlockReason`). With `launchReady:false`:
- Locally it shows with a 「未公開：待確認香港供應」 banner.
- In production (`SITE_INDEXABLE=1` or `NODE_ENV=production`) it is hidden everywhere: no card, sitemap or JSON-LD, the page returns 404, and checkout rejects it. Course counts (「N 個課程」) follow the visible list.

Course 6 (`claude-codex-investing`) is false until Claude/Codex availability in Hong Kong is confirmed. Check production mode with `PORT=3313 NODE_ENV=production node server.js`, then `BASE=http://localhost:3313 PROD=1 node scripts/check.js`.

## Where to edit
- Prices/products: `data/products.json` (ONLY 0 / 588 / 1,288 / 2,200). In-person catalogue (7 courses, each HK$2,200, 8 堂，合共 24 小時): `data/inperson-courses.json` → `/courses/in-person/<slug>`, product id `ip-<slug>`.
- Seminar timetable: rule + overrides in `data/sessions.json`, generator `lib/sessions.js`. Notification stubs log to `data/outbox.jsonl` (nothing sent).
- HK holidays: `data/hk-holidays.json`.
- Language: `LANG` in `lib/pages.js` (「廣東話為主、夾雜英文」) — used by pages, JSON-LD, .ics and Google Calendar link.
- Refund wording: `REFUND_FEE` / `REFUND_ONE` / `REFUND_ALL` in `lib/pages.js` (no fee amounts).
- Socials and contact: `SOCIAL` / `CONTACT` in `lib/pages.js`.

## Backend hook points
- `POST /api/checkout` (server.js, "CHECKOUT HOOK"): DEMO, stores stub order. Replace with Stripe Checkout Session + verified webhook.
- `GET /join/:token`: DEMO stub. Replace with hashed-token lookup → 302 Zoom from T−15 min, 410 after expiry.
- `/api/seminar`, `/api/enquiry`, `/api/unsubscribe` write `data/submissions.json` (demo JSON store). Swap for the DB.
- SEO: noindex everywhere until `SITE_INDEXABLE=1` at launch (Mikey's OK).

See CHANGES.md for the change list and all remaining placeholders.

## Backend (admin / CRM / customer area) — section maintained by the backend agent
LOCAL ONLY, nothing is sent or charged. Full notes: `BACKEND.md`. Settings come from env (see `.env.example`; names only here):
- **DB**: `APP_DB` (default `data/app.db`, SQLite via better-sqlite3; imports `SUBMISSIONS_FILE` JSON on start and on each admin/account request).
- **Uploads**: `UPLOAD_DIR` (default `uploads/`, outside the public `assets/`), `MAX_UPLOAD_MB` (default 500), `MEDIA_URL_TTL_MIN` (signed media URL lifetime).
- **Secrets / login**: `APP_SECRET` (required in production), `STAFF_INVITE_CODE`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `BCRYPT_ROUNDS`, `DEMO_CUSTOMER_PASSWORD` (demo login only; no default), `OUTBOX_FILE`. Stripe (TEST only, not connected): `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MAP` or `STRIPE_PRICE_<PRODUCT>` / `STRIPE_PRICE_INPERSON_<SLUG>`.
- **Run**: `npm run admin:create -- --email <email> --name <name>` (password from `ADMIN_PASSWORD` or prompt), `PORT=3100 npm run dev:backend`, `npm run seed:demo` / `npm run demo:wipe` (refused when `NODE_ENV=production` or `SITE_INDEXABLE=1`). `BACKEND=off` disables the backend hook in server.js.
- **Admin routes** (staff login, noindex, robots-disallowed): `/admin` (dashboard), `/admin/login`, `/admin/register` (invite only), `/admin/leads` (+ `.csv`, `/:id`), `/admin/pipeline`, `/admin/seminars` (+ `/new`, `/:id`), `/admin/reminders`, `/admin/courses` (+ `/new`, `/:id`, video upload), `/admin/orders`, `/admin/staff` and `/admin/demo` (admin role).
- **Stripe TEST-mode sample order (CRM 已售出課程)**: moving a lead to 已售出課程 (drag or select) does NOT change the stage; it opens a sample order 「完成課程實體堂購買」 (launch-ready in-person course, price from `data/inperson-courses.json`, labelled 「樣本／測試數據 — Stripe 測試模式，非真實交易」) in 待付款（測試）. Staff click 「建立 Stripe 測試 Checkout」 and open/copy the URL. Only `POST /api/stripe/webhook` (raw body, `stripe.webhooks.constructEvent`, `livemode:false`, `payment_status:paid`, session re-fetched from the API, idempotent by event + session id) marks it paid and moves the lead (actor 「Stripe 測試模式 webhook」); `checkout.session.expired` → 過期. `/pay/test-return` only shows 「等待 Stripe 確認」. Dashboard card 「Stripe 測試付款」 is labelled 「Stripe 測試模式 — 非真實交易／收益」 and is separate from demo data and real orders.
  Env: `STRIPE_SECRET_KEY=sk_test_...` (server refuses to start with `sk_live_`/`rk_live_`; missing → admin warning, button disabled), `STRIPE_WEBHOOK_SECRET=whsec_...`, optional `STRIPE_PRICE_INPERSON_<SLUG>` (else HKD 220000 price_data), optional `PUBLIC_BASE_URL` (success/cancel URLs). Real test: `stripe login`, then `stripe listen --forward-to localhost:3100/api/stripe/webhook` (copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`), start `PORT=3100 npm run dev:backend`, create the checkout in the panel and pay with card 4242 4242 4242 4242. Offline: `node scripts/stripe-mock.js` + `STRIPE_API_BASE=http://127.0.0.1:12111` (dev only, ignored in production) and `node scripts/stripe-sim-webhook.js <cs_test_id>` (simulated, signed event — not Stripe).
- **Customer / public**: `/account` (+ `/login`, `/register`, `/verify`, `/courses/:slug`), `/media/v|d/:courseId` (signed, expiring), `/online-course` (+ `/:slug` for admin-added courses).
