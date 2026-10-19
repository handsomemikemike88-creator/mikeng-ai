// Customer area /account: register / verify email / login / logout, seminar bookings (book + cancel), purchased courses, payment status.
// Never collects HKID. Existing seminar sign-ups and orders are linked by email ONLY after the email is verified
// (verification link is logged to the outbox as a stub — nothing is sent; in dev the link is shown on screen).
const crypto = require('crypto');
const D = require('../db');
const Sx = require('../backend/security');
const C = require('../backend/crm');
const R = require('../backend/reminders');
const CO = require('../backend/courses');
const SEM = require('../backend/seminars');
const { shell } = require('../backend/public');
const { esc } = Sx;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const clean = s => String(s ?? '').trim();
const fmt = iso => new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(iso));
const money = n => 'HK$' + Number(n).toLocaleString('en-US');

const me = req => req.sess && req.sess.user_id ? D.get().prepare('SELECT * FROM customers WHERE id = ?').get(req.sess.user_id) : null;
const need = (req, res, next) => { const c = me(req); if (!c) return res.redirect(303, '/account/login?next=' + encodeURIComponent(req.originalUrl)); req.cust = c; next(); };
const safeNext = n => /^\/account(\/[\w\-/?=&%.]*)?$/.test(String(n || '')) ? n : '/account';
const page = (req, title, inner, p = '/account') => shell({ title: `${title}｜學員區｜mikeng_course`, desc: 'mikeng_course 學員區', path: p,
  body: `<section class="page-hero acct"><div class="wrap" style="max-width:1000px">${inner}</div></section>` });
const errs = e => Object.keys(e).length ? `<div class="errbox" role="alert" tabindex="-1"><strong>請修正以下項目：</strong><ul>${Object.values(e).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
const inp = (id, name, label, type, val, extra = '') => `<div class="f"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="${type}" value="${esc(val || '')}" ${extra}></div>`;

function link(c) { // attach existing leads with this (verified) email
  D.get().prepare('UPDATE leads SET customer_id = ? WHERE email = ? AND (customer_id IS NULL OR customer_id = ?)').run(c.id, c.email, c.id);
}
function issueVerify(c) {
  const tok = Sx.rand(24);
  D.get().prepare('UPDATE customers SET verify_hash = ? WHERE id = ?').run(Sx.sha(tok), c.id);
  const url = `/account/verify?t=${tok}`;
  R.logOut({ kind: 'email', template: 'account-verify', to: c.email, link: 'https://mikeng-ai.com' + url });
  return url;
}

function loginForm(req, { error = '', email = '', next = '/account', msg = '' } = {}) {
  return page(req, '學員登入', `<div class="grid g2" style="align-items:start">
<div class="card hl"><p class="section-kicker">學員區</p><h1 style="font-size:40px">學員<em>登入</em></h1>${msg ? `<p role="status" class="small">${esc(msg)}</p>` : ''}${error ? `<div class="errbox" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/account/login">${Sx.csrfField(req)}<input type="hidden" name="next" value="${esc(next)}">
${inp('a-email', 'email', '電郵', 'email', email, 'required maxlength="120" autocomplete="username"')}${inp('a-password', 'password', '密碼', 'password', '', 'required autocomplete="current-password"')}
<button class="btn" type="submit">登入</button></form></div>
<div class="card"><h2 style="font-size:24px">第一次用？</h2><p>用你報名講座或者購買課程時用嘅電郵開帳戶，驗證電郵之後就會見到你嘅講座報名、已購買課程同付款狀態。</p><a class="btn ghost" href="/account/register">開學員帳戶</a></div></div>`, '/account/login');
}
function registerForm(req, { errors = {}, v = {} } = {}) {
  return page(req, '開學員帳戶', `<div class="card hl" style="max-width:640px"><p class="section-kicker">學員區</p><h1 style="font-size:40px">開學員<em>帳戶</em></h1>${errs(errors)}
<form method="post" action="/account/register" novalidate>${Sx.csrfField(req)}
${inp('r-name', 'name', '名稱（稱呼）*', 'text', v.name, 'required maxlength="60" autocomplete="name"')}
${inp('r-email', 'email', '電郵 *', 'email', v.email, 'required maxlength="120" autocomplete="email"')}<p class="hint">請用報名講座或購買課程時用嘅電郵，咁先可以連結你嘅紀錄。</p>
${inp('r-phone', 'phone', 'WhatsApp 電話（選填，用嚟發講座提示）', 'tel', v.phone || '', 'maxlength="20" autocomplete="tel" placeholder="+852 9123 4567"')}
${inp('r-password', 'password', '密碼（最少 10 個字元）*', 'password', '', 'required minlength="10" autocomplete="new-password"')}
<div class="f"><label class="check"><input type="checkbox" name="marketing" value="yes"${v.marketing ? ' checked' : ''}><span>（選填）我同意 mikeng_course 使用我嘅姓名及電郵，透過<strong>電郵</strong>向我發送 AI 課程、講座及優惠資訊。我可隨時免費取消。</span></label><p class="hint">唔剔都唔會影響你使用學員區。</p></div>
<p class="small muted">我哋只收集名稱、電郵、電話（選填）同密碼，唔會收集身份證號碼。提交即表示你已閱讀<a href="/privacy#pics">《收集個人資料聲明》</a>。</p>
<button class="btn" type="submit">建立帳戶</button></form><p class="small" style="margin-top:12px">已經有帳戶？<a href="/account/login">登入</a></p></div>`, '/account/register');
}

function home(req, flash = '') {
  const c = req.cust, db = D.get(), f = Sx.csrfField(req);
  if (!c.email_verified_at) {
    const dev = !Sx.PROD && req.query.dev ? `<p class="small ph" style="display:block;padding:8px">開發模式（唔會出現喺正式網站）：<a href="${esc(req.query.dev)}">驗證連結</a></p>` : '';
    return page(req, '學員區', `<div class="card hl"><h1 style="font-size:36px">你好，${esc(c.name)}</h1><p>請先驗證你嘅電郵（${esc(c.email)}），驗證之後先會連結你嘅講座報名同課程紀錄。</p>${dev}
<form method="post" action="/account/verify/resend">${f}<button class="btn ghost" type="submit">再寄驗證電郵</button></form>${logout(req)}</div>`);
  }
  link(c);
  const bookings = db.prepare(`SELECT b.*, s.date, s.start_time, s.end_time, s.title, s.status sstatus FROM bookings b JOIN leads l ON l.id = b.lead_id JOIN seminars s ON s.id = b.seminar_id WHERE l.customer_id = ? ORDER BY s.date DESC`).all(c.id);
  const mineIds = new Set(bookings.filter(b => b.status === 'booked').map(b => b.seminar_id));
  const up = SEM.upcoming().filter(s => !mineIds.has(s.id));
  const orders = db.prepare(`SELECT o.*, p.name pname, p.course pcourse, co.title ctitle, co.slug cslug, co.kind ckind FROM orders o JOIN leads l ON l.id = o.lead_id LEFT JOIN products p ON p.id = o.product_id LEFT JOIN courses co ON co.id = o.course_id WHERE l.customer_id = ? ORDER BY o.created_at DESC`).all(c.id);
  const lead = db.prepare('SELECT * FROM leads WHERE customer_id = ? LIMIT 1').get(c.id);
  const now = new Date();
  const bk = bookings.map(b => { const start = new Date(`${b.date}T${b.start_time}:00+08:00`), future = start > now;
    return `<tr><td>${esc(b.date)} ${esc(b.start_time)}–${esc(b.end_time)}</td><td>${esc(b.title)}</td><td>${b.status === 'cancelled' ? '已取消' : b.sstatus !== 'confirmed' ? '場次已取消' : future ? '已報名' : b.attendance === '已出席' ? '已出席' : '已完場'}</td>
<td>${b.status === 'booked' && future ? `<form method="post" action="/account/bookings/${b.id}/cancel">${f}<button class="btn ghost sm" type="submit">取消報名</button></form>` : b.status === 'booked' ? `<a class="small" href="/seminar.ics?session=${encodeURIComponent(b.seminar_id)}">.ics</a>` : ''}</td></tr>`; }).join('');
  const od = orders.map(o => { const exp = o.paid_at ? CO.accessUntil(o.paid_at) : null, live = o.payment_status === '已付款' && exp && exp > now;
    return `<tr><td>${esc(o.ctitle || (o.pname + (o.pcourse ? '｜' + o.pcourse : '')))}</td><td>${money(o.price_hkd)}</td><td><span class="badge">${esc(o.payment_status)}</span></td><td>${o.payment_status === '已付款' && exp ? (o.ckind === 'online' ? '觀看期至 ' + fmt(exp) : '已付款') : o.payment_status === '未付款' ? '付款確認後開放' : '—'}</td>
<td>${live && o.cslug && o.ckind === 'online' ? `<a class="btn sm" href="/account/courses/${esc(o.cslug)}">睇課程</a>` : ''}</td></tr>`; }).join('');
  return page(req, '學員區', `${flash ? `<p class="card" role="status">${esc(flash)}</p>` : ''}<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap"><div><p class="section-kicker">學員區</p><h1 style="font-size:44px">你好，<em>${esc(c.name)}</em></h1><p class="small muted">${esc(c.email)}${lead && lead.payment_status ? '｜付款狀態：' + esc(lead.payment_status) : ''}</p></div>${logout(req)}</div>
<h2 style="font-size:28px;margin-top:28px">我嘅講座報名</h2><div class="tablewrap"><table><thead><tr><th>日期（香港時間）</th><th>講座</th><th>狀態</th><th></th></tr></thead><tbody>${bk || '<tr><td colspan="4">未有講座報名。</td></tr>'}</tbody></table></div>
<h2 style="font-size:28px;margin-top:28px">報名免費講座</h2>${up.length ? `<form method="post" action="/account/book" class="card">${f}<fieldset class="sessions"><legend>揀一個日期</legend>${up.slice(0, 6).map((s, i) => { const cap = s.capacity, n = cap ? SEM.bookedCount(s.id) : 0, full = cap && n >= cap;
    return `<label class="session"><input type="radio" name="session" value="${esc(s.id)}"${i === 0 && !full ? ' checked' : ''}${full ? ' disabled' : ''} required><span><strong>${esc(s.dateLabel)}</strong>${full ? '<span class="badge">已滿</span>' : ''}<br>${esc(s.timeLabel)}｜${esc(s.platform)}｜${esc(s.language)}｜免費</span></label>`; }).join('')}</fieldset>
<p class="small">講座提示會經電郵${c.phone ? '同 WhatsApp（' + esc(c.phone) + '）' : ''}發送。唔想再收 WhatsApp 提示，隨時回覆「停止」就得。</p><button class="btn" type="submit">確認報名</button></form>` : '<p>暫時未有可以報名嘅場次。</p>'}
<h2 style="font-size:28px;margin-top:28px">我嘅課程及付款</h2><div class="tablewrap"><table><thead><tr><th>課程</th><th>價錢</th><th>付款狀態</th><th>觀看／上堂</th><th></th></tr></thead><tbody>${od || '<tr><td colspan="5">未有課程紀錄。<a href="/courses">睇課程</a></td></tr>'}</tbody></table></div>
<p class="small muted" style="margin-top:12px">付款而家係示範模式（未接通 Stripe），付款狀態由職員確認後更新。網上視頻課程由付款日起 1 年內可觀看。退款條款見 <a href="/refund">/refund</a>。</p>`);
}
const logout = req => `<form method="post" action="/account/logout" style="margin-top:12px">${Sx.csrfField(req)}<button class="btn ghost sm" type="submit">登出</button></form>`;

function coursePage(req, c, o) {
  const principal = 'cust:' + req.cust.id;
  const video = c.video_file ? `<video controls preload="metadata" src="${esc(Sx.sign('v', c.id, principal))}"></video><p class="small muted">參考影片連結有時效，過期請重新整理頁面。</p>` : '<p class="muted">呢個課程未有參考影片。</p>';
  const dl = c.download_url ? `<p><a class="btn ghost" href="${esc(Sx.sign('d', c.id, principal))}" rel="noopener">下載課程資料</a></p>` : '';
  return page(req, c.title, `<nav class="small muted" style="margin-bottom:14px"><a href="/account">學員區</a> › ${esc(c.title)}</nav><h1 style="font-size:40px">${esc(c.title)}</h1>
<p class="small muted">觀看期至 ${fmt(CO.accessUntil(o.paid_at))}（由付款日起 1 年）</p><div class="card">${video}${dl}</div><div class="card prose" style="margin-top:18px"><h2 style="font-size:26px">課程內容</h2>${CO.md(c.content_md) || '<p class="muted">課程內容稍後提供。</p>'}</div>`, '/account/courses');
}

function routes(r) {
  r.get('/account/login', (req, res) => { if (me(req)) return res.redirect(303, '/account'); res.type('html').send(loginForm(req, { next: safeNext(req.query.next) })); });
  r.post('/account/login', (req, res) => {
    const email = clean(req.body.email).toLowerCase(), pw = String(req.body.password || ''), next = safeNext(req.body.next);
    if (Sx.limited(req.ip, 'c:' + email)) return res.status(429).type('html').send(loginForm(req, { error: '登入嘗試太多次，請 15 分鐘後再試。', email, next }));
    const c = D.get().prepare('SELECT * FROM customers WHERE email = ?').get(email);
    if (!Sx.verify(pw, c && c.password_hash) || !c) { Sx.fail(req.ip, 'c:' + email); return res.status(401).type('html').send(loginForm(req, { error: '電郵或密碼唔啱。', email, next })); }
    Sx.clearFails(req.ip, 'c:' + email); Sx.rotate(req, res, 'account', c.id);
    D.get().prepare('UPDATE customers SET last_login_at = ? WHERE id = ?').run(D.now(), c.id);
    res.redirect(303, next);
  });
  r.get('/account/register', (req, res) => res.type('html').send(registerForm(req)));
  r.post('/account/register', (req, res) => {
    const v = { name: clean(req.body.name), email: clean(req.body.email).toLowerCase(), phone: clean(req.body.phone), marketing: req.body.marketing === 'yes' }, pw = String(req.body.password || ''), errors = {};
    if (Sx.limited(req.ip, 'creg')) return res.status(429).type('html').send(registerForm(req, { errors: { name: '嘗試太多次，請稍後再試。' }, v }));
    if (!v.name || v.name.length > 60) errors.name = '請填寫名稱（最多 60 個字）。';
    if (!EMAIL.test(v.email) || v.email.length > 120) errors.email = '請填寫正確電郵（例如 name@example.com）。';
    let digits = v.phone.replace(/[\s-]/g, '').replace(/^\+?852/, '');
    if (v.phone && !/^[2-9]\d{7}$/.test(digits)) errors.phone = '電話號碼格式唔正確。香港號碼請填 8 位數字。';
    const pp = Sx.pwProblem(pw); if (pp) errors.password = pp;
    if (!errors.email && D.get().prepare('SELECT 1 FROM customers WHERE email = ?').get(v.email)) errors.email = '呢個電郵已經有帳戶，請直接登入。';
    if (Object.keys(errors).length) { Sx.fail(req.ip, 'creg'); return res.status(400).type('html').send(registerForm(req, { errors, v })); }
    const phone = v.phone ? '+852' + digits : null;
    const id = D.get().prepare('INSERT INTO customers (email, name, phone, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(v.email, v.name, phone, Sx.hash(pw), D.now()).lastInsertRowid;
    const c = D.get().prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (v.marketing) C.upsertLead({ email: v.email, name: v.name, phone, source: '/account', marketing: true, consentText: 'v1-2026-10-19' }); // linked to the account only after email verification
    const url = issueVerify(c);
    Sx.rotate(req, res, 'account', id);
    res.redirect(303, '/account' + (Sx.PROD ? '' : '?dev=' + encodeURIComponent(url)));
  });
  r.get('/account/verify', (req, res) => {
    const t = clean(req.query.t), c = t && D.get().prepare('SELECT * FROM customers WHERE verify_hash = ?').get(Sx.sha(t));
    if (!c) return res.status(400).type('html').send(page(req, '驗證', '<div class="card"><h1 style="font-size:32px">驗證連結無效或已用過</h1><p><a href="/account">返回學員區</a></p></div>'));
    D.get().prepare('UPDATE customers SET email_verified_at = ?, verify_hash = NULL WHERE id = ?').run(D.now(), c.id); link(c);
    res.redirect(303, '/account');
  });
  r.post('/account/logout', (req, res) => { Sx.destroy(req, res, 'account'); res.redirect(303, '/account/login'); });
  r.use('/account', need);
  r.post('/account/verify/resend', (req, res) => { const url = req.cust.email_verified_at ? '' : issueVerify(req.cust); res.redirect(303, '/account' + (url && !Sx.PROD ? '?dev=' + encodeURIComponent(url) : '')); });
  r.get('/account', (req, res) => res.type('html').send(home(req, req.query.ok === 'booked' ? '已報名，確認同提示會經電郵（同 WhatsApp）發送。' : req.query.ok === 'cancelled' ? '已取消報名。' : '')));
  r.post('/account/book', (req, res) => {
    const c = req.cust; if (!c.email_verified_at) return res.redirect(303, '/account');
    const s = SEM.upcoming().find(x => x.id === clean(req.body.session));
    if (!s) return res.status(400).type('html').send(home(req, '呢個日期已經唔可以報名，請揀另一個日期。'));
    if (s.capacity && SEM.bookedCount(s.id) >= s.capacity) return res.status(400).type('html').send(home(req, '呢一場已經滿額，請揀另一個日期。'));
    const l = C.upsertLead({ email: c.email, name: c.name, phone: c.phone, service: 'seminar', source: '/account' });
    D.get().prepare('UPDATE leads SET customer_id = ? WHERE id = ?').run(c.id, l.id);
    const token = crypto.randomBytes(32).toString('base64url');
    C.createBooking(l.id, s.id, { source: '/account', tokenHash: Sx.sha(token), joinUrl: `https://mikeng-ai.com/join/${token}` });
    res.redirect(303, '/account?ok=booked');
  });
  r.post('/account/bookings/:id/cancel', (req, res) => {
    const b = D.get().prepare("SELECT b.*, s.date, s.start_time FROM bookings b JOIN leads l ON l.id = b.lead_id JOIN seminars s ON s.id = b.seminar_id WHERE b.id = ? AND l.customer_id = ? AND b.status = 'booked'").get(+req.params.id || 0, req.cust.id);
    if (!b || new Date(`${b.date}T${b.start_time}:00+08:00`) <= new Date()) return res.status(404).type('html').send(home(req, '搵唔到可以取消嘅報名。'));
    C.cancelBooking(b.id, req.cust.name + '（學員）');
    res.redirect(303, '/account?ok=cancelled');
  });
  r.get('/account/courses/:slug', (req, res) => {
    const c = CO.bySlug(req.params.slug);
    const o = c && req.cust.email_verified_at ? CO.paidOrder(req.cust, c) : null;
    if (!c || !o) return res.status(403).type('html').send(page(req, '冇權限', '<div class="card"><h1 style="font-size:32px">未可以睇呢個課程</h1><p>課程只限已付款、並喺觀看期（由付款日起 1 年）內嘅學員。</p><p><a href="/account">返回學員區</a></p></div>'));
    res.type('html').send(coursePage(req, c, o));
  });
  r.use('/account', (req, res) => res.status(404).type('html').send(page(req, '搵唔到', '<div class="card"><h1 style="font-size:32px">搵唔到呢頁</h1><p><a href="/account">返回學員區</a></p></div>')));
}
module.exports = { routes };
