const express = require('express');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const pages = require('./lib/pages');
const app = express();
const PORT = process.env.PORT || 3000;
const DB = process.env.SUBMISSIONS_FILE || path.join(__dirname, 'data', 'submissions.json');

const load = () => { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return []; } };
const save = rec => { const all = load(); all.push(rec); fs.writeFileSync(DB + '.tmp', JSON.stringify(all, null, 2)); fs.renameSync(DB + '.tmp', DB); };
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const clean = s => String(s ?? '').trim();

// Pre-launch everything is noindex. At launch (Mikey's OK) set SITE_INDEXABLE=1.
const INDEXABLE = process.env.SITE_INDEXABLE === '1';
const SITE = 'https://mikeng-ai.com';
app.disable('x-powered-by');
// Behind Traefik (HTTPS terminates there): trust X-Forwarded-Proto/For so req.secure, req.ip and rate limits are right.
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.use((req, res, next) => { if (!INDEXABLE) res.set('X-Robots-Tag', 'noindex, nofollow'); res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' }); next(); });
// ===== BACKEND HOOK (lib/backend, see BACKEND.md) =====
// Adds /admin, /account, /media, /online-course and the DB-backed seminar timetable. Mounted before the public routes so
// it can serve /online-course and admin-added course checkouts; everything else falls through unchanged. BACKEND=off disables it.
if (process.env.BACKEND !== 'off') require('./lib/backend').mount(app);
// ===== END BACKEND HOOK =====
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '7d' }));
app.get('/robots.txt', (q, r) => r.type('text/plain').send(INDEXABLE
  ? `User-agent: *\nDisallow: /join/\nDisallow: /admin\nDisallow: /account\nDisallow: /media/\nDisallow: /api/\nDisallow: /pay/\nDisallow: /confirmation\nDisallow: /seminar/thanks\n\nSitemap: ${SITE}/sitemap.xml\n`
  : 'User-agent: *\nDisallow: /\n# pre-launch preview; at launch: Disallow /join/, /admin, /account, /media/, /api/, /pay/\n'));
const SITEMAP = ['/', '/courses', '/courses/online-video', '/courses/online-1on1', '/courses/in-person', ...pages.IP_SLUGS.map(slug => '/courses/in-person/' + slug) /* launchReady-gated in production */, '/seminar', '/services', '/instructors', '/contact', '/terms', '/refund', '/privacy'];
app.get('/sitemap.xml', (q, r) => r.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${SITEMAP.map(u => `  <url><loc>${SITE}${u}</loc><lastmod>2026-10-19</lastmod></url>`).join('\n')}\n</urlset>\n`));
app.get(['/favicon.svg', '/favicon.ico'], (q, r) => r.sendFile(path.join(__dirname, 'assets', 'img', q.path === '/favicon.ico' ? 'favicon.ico' : 'favicon.svg'), { maxAge: '7d' }));

const send = fn => (req, res) => res.type('html').send(fn());
app.get('/', send(pages.home));
app.get('/services', send(pages.services));
app.get('/instructors', send(pages.instructors));
app.get('/seminar', send(() => pages.seminar()));
app.get('/courses', send(pages.courses));
app.get('/courses/in-person/:slug', (req, res, next) => pages.IP_SLUGS.includes(req.params.slug) ? res.type('html').send(pages.ipCourse(req.params.slug)) : next());
app.get('/courses/:slug', (req, res, next) => pages.COURSE_SLUGS.includes(req.params.slug) ? res.type('html').send(pages.coursePage(req.params.slug)) : next());
app.get('/online-course', (req, res) => res.redirect(301, '/courses/online-video')); // old draft URL; fallback only — BACKEND HOOK serves the /online-course list first
app.get('/terms', send(pages.terms));
// /join/<token>: DEMO STUB, always noindex + robots Disallow. Backend: look up sha256(token), 302 to Zoom from T-15min, 410 after expiry.
app.get('/join/:token', (req, res) => res.set('X-Robots-Tag', 'noindex, nofollow').type('html').send(pages.joinStub()));
app.get('/privacy', send(pages.privacy));
app.get('/refund', send(pages.refund));
app.get('/contact', (req, res) => res.type('html').send(pages.contact({ values: { interest: String(req.query.interest || '') }, sent: req.query.sent === '1' })));
app.get('/unsubscribe', send(() => pages.unsubscribe(false)));

// simple per-IP rate limit for POSTs
const hits = new Map();
const limit = (req, res, next) => { const k = req.ip, now = Date.now(); const a = (hits.get(k) || []).filter(t => now - t < 60000); a.push(now); hits.set(k, a); if (a.length > 20) return res.status(429).type('html').send('你提交得太快，請等一陣再試。'); next(); };

// Seminar sign-up: ① pick date + details → ② review (修改/確認) → confirm saves.
// Confirmation email + WhatsApp and D-1/H-1 reminders are STUBS: logged to data/outbox.jsonl, nothing is sent.
const OUTBOX = process.env.OUTBOX_FILE || path.join(__dirname, 'data', 'outbox.jsonl');
const logOut = rec => fs.appendFileSync(OUTBOX, JSON.stringify({ at: new Date().toISOString(), sent: false, ...rec }) + '\n');
app.post('/api/seminar', limit, (req, res) => {
  const b = req.body, errors = {};
  const v = { session: clean(b.session), name: clean(b.name), email: clean(b.email).toLowerCase(), phone: clean(b.phone), marketing: b.marketing === 'yes' };
  const s = pages.confirmed().find(x => x.id === v.session);
  if (!s) errors.session = v.session ? '呢個日期已經唔可以報名，請揀另一個日期。' : '請先揀一個日期。';
  if (!v.name) errors.name = '請填寫你嘅名稱或稱呼。'; else if (v.name.length > 60) errors.name = '名稱最多 60 個字。';
  if (!v.email) errors.email = '請填寫電郵，我哋要用嚟寄 Zoom 連結俾你。'; else if (!EMAIL.test(v.email) || v.email.length > 120) errors.email = '呢個電郵格式好似唔啱，請再檢查（例如 name@example.com）。';
  let digits = v.phone.replace(/[\s-]/g, '').replace(/^\+?852/, '');
  if (!digits) errors.phone = '請填寫 WhatsApp 電話，我哋要用嚟發講座提示。'; else if (!/^[2-9]\d{7}$/.test(digits)) errors.phone = '電話號碼格式唔正確。香港號碼請填 8 位數字。';
  if (!errors.email && s && load().some(r => r.type === 'seminar' && r.session === s.id && r.email === v.email)) errors.email = '呢個電郵已經報咗呢一場。搵唔到確認電郵？請睇吓垃圾郵件匣。';
  if (b.step === 'edit') return res.type('html').send(pages.seminar({ values: { ...b, marketing: v.marketing } }));
  if (Object.keys(errors).length) return res.status(400).type('html').send(pages.seminar({ values: { ...b, marketing: v.marketing }, errors }));
  if (b.step !== 'confirm') return res.type('html').send(pages.seminarReview({ ...v, phone: '+852 ' + digits.slice(0, 4) + ' ' + digits.slice(4) }, s));
  const token = crypto.randomBytes(32).toString('base64url');
  const rec = { id: crypto.randomUUID(), type: 'seminar', createdAt: new Date().toISOString(), session: s.id, sessionStart: s.start, name: v.name, email: v.email,
    phone: '+852' + digits, reminderChannels: ['whatsapp', 'email'], marketing: v.marketing,
    joinTokenHash: crypto.createHash('sha256').update(token).digest('hex'), reminders: s.reminders,
    marketingConsent: v.marketing ? { channel: 'email', textVersion: 'v1-2026-10-19', at: new Date().toISOString(), source: '/seminar' } : null };
  save(rec);
  const join = `https://mikeng-ai.com/join/${token}`;
  logOut({ kind: 'email', template: 'seminar-confirmation', to: v.email, session: s.id, join, ics: `/seminar.ics?session=${s.id}` });
  logOut({ kind: 'whatsapp', template: 'seminar_confirmation', to: rec.phone, session: s.id, sender: 'mikeng_course', urlButtonSuffix: token });
  for (const [k, at] of Object.entries(s.reminders)) for (const ch of ['email', 'whatsapp']) logOut({ kind: 'scheduled-reminder', reminder: k, channel: ch, sendAt: at, to: ch === 'email' ? v.email : rec.phone, session: s.id, signup: rec.id,
    ...(ch === 'whatsapp' && k === 'H-1' ? { template: 'seminar_reminder_1h', urlButtonSuffix: token, join } : {}), ...(ch === 'email' ? { join } : {}) }); // H-1 WhatsApp template has a dynamic URL button /join/{{1}} (QA v4 m7)
  res.redirect(303, '/seminar/thanks?id=' + rec.id);
});

// ===== CHECKOUT HOOK (backend goes here) =====
// Product ids (each = its own Stripe TEST Price later): online-video, online-1on1, ip-<slug> x7 (see data/inperson-courses.json).
// Currently DEMO: validates name/email/refund-agreement and stores a stub order (paymentStatus 'stub-not-charged'), no charge.
// Backend: replace the save()+redirect with Stripe Checkout Session creation (whitelisted Price ID per product,
// customer_email, client_reference_id=order id, success_url=/courses/<slug>/thanks?session_id={CHECKOUT_SESSION_ID},
// cancel_url=/courses/<slug>) then 303 to session.url. Fulfil only from the verified webhook. See tech-plan §3.
app.post('/api/checkout', limit, (req, res) => {
  const b = req.body, errors = {};
  const v = { product: clean(b.product), name: clean(b.name), email: clean(b.email).toLowerCase(), agree: b.agree === 'yes' };
  const p = pages.P[v.product];
  if (!p || !p.buyable) errors.product = '呢個項目暫時唔可以網上購買，請查詢。';
  if (!v.name || v.name.length > 60) errors.name = '請填寫你嘅名稱（最多 60 個字）。';
  if (!EMAIL.test(v.email)) errors.email = '請填寫正確電郵。';
  if (!v.agree) errors.agree = '請先閱讀並同意退款條款。';
  if (Object.keys(errors).length) return res.status(400).type('html').send(pages.coursePage(p && p.buyable ? v.product : 'online-video', { values: { ...v, product: p && p.buyable ? v.product : 'online-video' }, errors }));
  // DEPLOY: in production the public checkout isn't wired to Stripe yet, so show a friendly 「即將開放」 page (nothing is saved or charged).
  // CHECKOUT HOOK: when Stripe TEST/live Checkout is wired here, gate it on STRIPE_SECRET_KEY + price ids instead.
  if (process.env.NODE_ENV === 'production' || process.env.SITE_INDEXABLE === '1') return res.status(200).type('html').send(pages.layout({ title:'網上付款即將開放｜mikeng_course', desc:'網上付款即將開放', path:'/api/checkout', canonical:false, noindex:true,
    body:`<section class="page-hero"><div class="wrap"><p class="section-kicker">${p.course || p.name}｜${p.priceLabel || ''}</p><h1>網上付款即將開放</h1><p class="lead">多謝你有興趣！網上付款暫時未開放，今次冇收取任何費用，亦冇記錄你嘅付款。想報名或者有問題，可以電郵 <a href="mailto:admin@mikeng-ai.com">admin@mikeng-ai.com</a> 或 WhatsApp <a href="https://wa.me/85264059475">6405 9475</a> 搵我哋。</p><p><a class="btn" href="/courses">返回課程</a> <a class="btn ghost" href="/contact">查詢</a></p></div></section>` }));
  const rec = { id: crypto.randomUUID(), type: 'purchase', stub: true, createdAt: new Date().toISOString(), product: p.id, priceHKD: p.price, name: v.name, email: v.email, refundTermsAccepted: true, paymentStatus: 'stub-not-charged' };
  save(rec);
  res.redirect(303, '/confirmation?id=' + rec.id);
});

app.post('/api/enquiry', limit, (req, res) => {
  const b = req.body, errors = {};
  const v = { name: clean(b.name), email: clean(b.email).toLowerCase(), phone: clean(b.phone), interest: clean(b.interest), message: clean(b.message) };
  if (!v.name || v.name.length > 60) errors.name = '請填寫你嘅名稱（最多 60 個字）。';
  if (!EMAIL.test(v.email) || v.email.length > 120) errors.email = '請填寫正確電郵。';
  if (v.phone && !/^\+?[\d\s-]{8,20}$/.test(v.phone)) errors.phone = '電話號碼格式唔正確。';
  if (!['online-video', 'online-1on1', 'in-person', 'seminar', 'other', ...pages.IP_SLUGS.map(x => 'ip-' + x)].includes(v.interest)) errors.interest = '請揀查詢項目。';
  if (!v.message || v.message.length > 2000) errors.message = '請寫低你嘅問題（最多 2000 字）。';
  if (Object.keys(errors).length) return res.status(400).type('html').send(pages.contact({ values: v, errors }));
  save({ id: crypto.randomUUID(), type: 'enquiry', createdAt: new Date().toISOString(), ...v });
  res.redirect(303, '/contact?sent=1#form');
});

app.post('/api/unsubscribe', limit, (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  if (!EMAIL.test(email) || email.length > 120) return res.status(400).type('html').send(pages.unsubscribe(false, true));
  save({ id: crypto.randomUUID(), type: 'unsubscribe', channel: 'email', email, createdAt: new Date().toISOString() });
  res.type('html').send(pages.unsubscribe(true));
});

app.get('/seminar/thanks', (req, res) => {
  const rec = load().find(r => r.id === req.query.id && r.type === 'seminar');
  if (!rec) return res.status(404).type('html').send(pages.notFound());
  res.type('html').send(pages.seminarThanks(rec));
});
app.get('/confirmation', (req, res) => {
  const rec = load().find(r => r.id === req.query.id && r.type === 'purchase');
  if (!rec) return res.status(404).type('html').send(pages.notFound());
  res.type('html').send(pages.confirmation(rec));
});

app.get('/seminar.ics', (req, res) => {
  const s = pages.S.byId(req.query.session); // any generated session has its own .ics
  if (s && s.status !== 'confirmed') return res.status(404).type('html').send(pages.notFound()); // skipped/cancelled (QA v4 m3)
  if (!s) return res.status(404).type('html').send(pages.notFound());
  const f = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//mikeng_course//seminar//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${s.id}@mikeng-ai.com`, `DTSTAMP:${f(Date.now())}`, `DTSTART:${f(s.start)}`, `DTEND:${f(s.end)}`, `SUMMARY:${s.title}`,
    'DESCRIPTION:' + pages.ICS_DESC, 'LOCATION:Zoom（網上）', 'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:講座 1 小時後開始', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="mikeng-seminar-${s.id}.ics"` }).send(ics);
});

app.use((req, res) => res.status(404).type('html').send(pages.notFound()));
app.listen(PORT, () => console.log(`mikeng_course app on http://localhost:${PORT}`));
