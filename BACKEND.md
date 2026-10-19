# mikeng_course backend — admin, CRM, seminar calendar, reminder drafts, courses, customer area

**LOCAL ONLY.** Nothing is deployed, nothing is sent (WhatsApp/email are drafts + `outbox` stubs), nothing is charged (Stripe not connected; TEST-mode config only).

## Run
```
cd site-full && npm install
cp .env.example .env            # fill locally; never commit
ADMIN_PASSWORD='…' npm run admin:create -- --email you@domain --name Mikey   # first admin (or ADMIN_EMAIL+ADMIN_PASSWORD env at start-up)
PORT=3100 npm run dev:backend   # = node scripts/admin-dev.js -> server.js with the BACKEND HOOK; prints the dev staff invite code
npm run seed:demo               # SAMPLE data only (is_demo=1); refused if NODE_ENV=production or SITE_INDEXABLE=1
npm run demo:wipe               # remove all demo data (also: /admin/demo, admin role)
npm test                        # refund tests + backend tests
BASE=http://localhost:3100 node scripts/check.js
ADMIN_EMAIL=… ADMIN_PASSWORD=… DEMO_CUSTOMER_PASSWORD=… npm run shots:backend   # -> shots/backend/ (local only, may show personal data — never export)
```
Staff join by invite only: per-person codes from `/admin/staff` (single use, 7 days, active immediately) or the shared `STAFF_INVITE_CODE` (account waits for admin approval). In dev without `STAFF_INVITE_CODE` a code is generated and printed. There is no open staff sign-up.

## Files (all new unless noted)
- `lib/db.js` — schema (staff, invites, customers, sessions, products, seminars, leads, bookings, orders, courses, notes, stage_history, reminders, imports).
- `lib/backend/index.js` (mount), `security.js` (bcrypt, DB sessions, httpOnly+SameSite=Lax cookies, Secure in production, CSRF, login rate limit, HMAC-signed expiring media URLs), `seminars.js` (DB timetable, replaces `S.upcoming/flagged/byId` at runtime — no change to lib/sessions.js), `crm.js` (leads, stages, orders, JSON import), `reminders.js` (draft rules), `courses.js` (seed, price guard, 1-year access, safe markdown, video sniffing), `media.js` (signed video/download), `public.js` (/online-course, admin-course checkout, seminar capacity guard), `stripe-config.js`, `demo.js`.
- `lib/admin/*` (auth, views, crm, seminars, reminders, courses, staff), `lib/account/index.js`, `assets/admin/admin.css|admin.js|vendor/chart.umd.min.js` (Chart.js 4, MIT, vendored).
- `scripts/admin-dev.js`, `seed-demo.js`, `create-admin.js`, `shots-backend.js`; `test/backend.test.js`; `.env.example`; `.gitignore`.
- Hooks in existing files (backups in `../backups/*.pre-backend.*`): `server.js` (mount + robots `/account`, `/media/`), `lib/pages.js` (export `layout`; footer link 「學員登入」), `package.json` (deps + scripts), `README.md` (Backend section).

## Rules implemented
- **Seminars**: DB seeded from `data/sessions.json` rule (identical public output — tested); admin-added dates show on `/seminar` and in the form at once; sign-up closes at start time; demo seminars never public; capacity enforced in `/account` and on the public form.
- **Reminder drafts** per booking: WhatsApp ≤ 3 (確認 / D-1「明天」/ H-1「1 小時後」+ join link, per whatsapp-templates.md §16.3); email: confirmation + personal Zoom link + .ics + Google Calendar, D-1, day-of 09:00, H-1, replay (next day 12:00); marketing follow-up email only with consent. 「停止」 skips WhatsApp, email continues. Statuses 草稿/已複製/已手動發送/已略過; copy, wa.me and mailto buttons. Real drafts are appended to `OUTBOX_FILE` with `sent:false`.
- **CRM**: exactly 7 stages; drag or select; full history (who, how, when). Auto-advance (forward only): reminder manually sent → 已發送提醒, attended → 已出席, paid course → 已售出課程.
- **Courses**: seeded from `data/products.json` (online) and `data/inperson-courses.json` (in-person); seeded titles/prices are read-only. Price not in 0/588/1288/2200 → 「新價錢，需 Mikey 確認」, stays draft until an admin ticks the box. Videos: mp4/webm, extension + MIME + magic bytes, size limit, stored in `UPLOAD_DIR`, streamed (Range) only via signed URLs to staff or verified customers with a paid order inside the access window.
- **Customers**: no HKID; PICS link; marketing consent separate and unticked; records linked by email only after email verification (verification link is an outbox stub; shown on screen in dev).
- Test/e2e submissions with `@example.com` / `.test` emails are imported as demo rows.

## Needs a decision (Mikey)
Real WhatsApp Cloud API + webhook for 「停止」; email provider (Brevo) for confirmations/verification; Stripe TEST Checkout + webhook (then real Price IDs); where to host uploads (VPS disk vs object storage, backup, size); real Zoom links/capacity; exact last day of 「由付款日起 1 年」 (implemented: day before the anniversary, 23:59 HKT; 29 Feb → 27 Feb); whether to show 「學員登入」 in the main nav (now footer only).

## Personal data — never export
`data/app.db*`, `data/submissions.json`, `data/outbox*.jsonl`, `uploads/`, `shots/backend/` (admin screenshots taken from the local DB) and `../backups/*.db` can contain personal data. They are git-ignored and listed in `scripts/export-exclude.txt`; any zip/export must use that list (`zip -r … -x@scripts/export-exclude.txt`). Don't attach them to hand-offs.
