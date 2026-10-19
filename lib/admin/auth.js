// Staff login / invite-only registration / logout. No open public staff registration:
//  - first admin: scripts/create-admin.js or env ADMIN_EMAIL + ADMIN_PASSWORD at start-up
//  - other staff: personal invite code from /admin/staff (active at once), or the shared env STAFF_INVITE_CODE
//    (account stays 「待批核」 until an admin approves it).
const D = require('../db');
const Sx = require('../backend/security');
const { page, field, esc } = require('./views');
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const clean = s => String(s ?? '').trim();

function bootstrapAdmin() {
  const e = clean(process.env.ADMIN_EMAIL).toLowerCase(), pw = process.env.ADMIN_PASSWORD;
  if (!e || !pw) return null;
  const db = D.get(); if (db.prepare('SELECT 1 FROM staff WHERE email = ?').get(e)) return null;
  if (Sx.pwProblem(pw)) { console.error('[backend] ADMIN_PASSWORD too short (min 10); admin not created'); return null; }
  db.prepare("INSERT INTO staff (email, name, password_hash, role, status, created_at) VALUES (?, ?, ?, 'admin', 'active', ?)").run(e, clean(process.env.ADMIN_NAME) || 'Admin', Sx.hash(pw), D.now());
  return e;
}
const currentStaff = req => req.sess && req.sess.user_id ? D.get().prepare("SELECT id, email, name, role, status FROM staff WHERE id = ? AND status = 'active'").get(req.sess.user_id) : null;
const requireStaff = (req, res, next) => { const u = currentStaff(req); if (!u) return res.redirect(303, '/admin/login?next=' + encodeURIComponent(req.originalUrl)); req.user = u; next(); };
const requireAdmin = (req, res, next) => req.user && req.user.role === 'admin' ? next() : res.status(403).type('html').send(page({ title: '冇權限', user: req.user, req, body: '<h1>冇權限</h1><p>呢頁只限管理員。</p>' }));
const safeNext = n => /^\/admin(\/[\w\-/?=&%.]*)?$/.test(String(n || '')) ? n : '/admin';

function loginPage(req, { error = '', email = '', next = '/admin', msg = '' } = {}) {
  return page({ title: '員工登入', req, body: `<div class="authcard"><p class="kicker">STAFF ONLY</p><h1>員工<em>登入</em></h1>
${msg ? `<div class="flash" role="status">${esc(msg)}</div>` : ''}${error ? `<div class="errbox" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/admin/login">${Sx.csrfField(req)}<input type="hidden" name="next" value="${esc(next)}">
${field('email', '電郵', email, { type: 'email', req: true, attrs: 'autocomplete="username" maxlength="120"' })}${field('password', '密碼', '', { type: 'password', req: true, attrs: 'autocomplete="current-password"' })}
<button class="btn" type="submit">登入</button></form><p class="small muted">有邀請碼？<a href="/admin/register">用邀請碼開員工帳戶</a></p></div>` });
}
function registerPage(req, { errors = {}, v = {} } = {}) {
  const e = k => errors[k] ? `<p class="err">${esc(errors[k])}</p>` : '';
  return page({ title: '員工註冊（只限邀請）', req, body: `<div class="authcard"><p class="kicker">INVITE ONLY</p><h1>員工<em>註冊</em></h1>
<p class="small muted">只限持有邀請碼嘅員工。冇邀請碼請搵管理員。</p>${Object.keys(errors).length ? '<div class="errbox" role="alert">請修正以下項目。</div>' : ''}
<form method="post" action="/admin/register">${Sx.csrfField(req)}
${field('invite', '邀請碼', v.invite, { req: true, attrs: 'autocomplete="off" maxlength="80"' })}${e('invite')}
${field('name', '名稱', v.name, { req: true, attrs: 'maxlength="60" autocomplete="name"' })}${e('name')}
${field('email', '電郵', v.email, { type: 'email', req: true, attrs: 'maxlength="120" autocomplete="username"' })}${e('email')}
${field('password', '密碼（最少 10 個字元）', '', { type: 'password', req: true, attrs: 'autocomplete="new-password" minlength="10"' })}${e('password')}
<p class="small muted">提交即表示你已閱讀<a href="/privacy#pics">《收集個人資料聲明》</a>。</p>
<button class="btn" type="submit">建立帳戶</button></form><p class="small"><a href="/admin/login">返回登入</a></p></div>` });
}

function routes(r) {
  r.get('/admin/login', (req, res) => { if (currentStaff(req)) return res.redirect(303, '/admin'); res.type('html').send(loginPage(req, { next: safeNext(req.query.next), msg: req.query.registered === 'pending' ? '帳戶已建立，要等管理員批核先可以登入。' : req.query.registered === '1' ? '帳戶已建立，請登入。' : '' })); });
  r.post('/admin/login', (req, res) => {
    const email = clean(req.body.email).toLowerCase(), pw = String(req.body.password || ''), ip = req.ip, next = safeNext(req.body.next);
    if (Sx.limited(ip, email)) return res.status(429).type('html').send(loginPage(req, { error: '登入嘗試太多次，請 15 分鐘後再試。', email, next }));
    const u = D.get().prepare('SELECT * FROM staff WHERE email = ?').get(email);
    const ok = Sx.verify(pw, u && u.password_hash);
    if (!u || !ok) { Sx.fail(ip, email); return res.status(401).type('html').send(loginPage(req, { error: '電郵或密碼唔啱。', email, next })); }
    if (u.status !== 'active') return res.status(403).type('html').send(loginPage(req, { error: u.status === 'pending' ? '帳戶仲等緊管理員批核。' : '帳戶已停用。', email, next }));
    Sx.clearFails(ip, email); Sx.rotate(req, res, 'admin', u.id);
    D.get().prepare('UPDATE staff SET last_login_at = ? WHERE id = ?').run(D.now(), u.id);
    res.redirect(303, next);
  });
  r.post('/admin/logout', (req, res) => { Sx.destroy(req, res, 'admin'); res.redirect(303, '/admin/login'); });
  r.get('/admin/register', (req, res) => res.type('html').send(registerPage(req)));
  r.post('/admin/register', (req, res) => {
    const v = { invite: clean(req.body.invite), name: clean(req.body.name), email: clean(req.body.email).toLowerCase() }, pw = String(req.body.password || ''), errors = {};
    if (Sx.limited(req.ip, 'register')) return res.status(429).type('html').send(registerPage(req, { errors: { invite: '嘗試太多次，請 15 分鐘後再試。' }, v }));
    const db = D.get(), t = D.now();
    const inv = v.invite ? db.prepare('SELECT * FROM invites WHERE code_hash = ? AND used_by IS NULL AND expires_at > ?').get(Sx.sha(v.invite), t) : null;
    const envCode = Sx.envInviteCode(), envOk = !!(envCode && v.invite && Sx.sha(v.invite) === Sx.sha(envCode));
    if (!inv && !envOk) { errors.invite = '邀請碼無效或已過期。'; Sx.fail(req.ip, 'register'); }
    if (!v.name || v.name.length > 60) errors.name = '請填寫名稱（最多 60 字）。';
    if (!EMAIL.test(v.email) || v.email.length > 120) errors.email = '請填寫正確電郵。';
    else if (db.prepare('SELECT 1 FROM staff WHERE email = ?').get(v.email)) errors.email = '呢個電郵已經有帳戶。';
    const pp = Sx.pwProblem(pw); if (pp) errors.password = pp;
    if (Object.keys(errors).length) return res.status(400).type('html').send(registerPage(req, { errors, v }));
    const status = inv ? 'active' : 'pending', role = inv ? inv.role : 'staff';
    const id = db.prepare('INSERT INTO staff (email, name, password_hash, role, status, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(v.email, v.name, Sx.hash(pw), role, status, inv ? inv.created_by : null, t).lastInsertRowid;
    if (inv) db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code_hash = ?').run(id, t, inv.code_hash);
    res.redirect(303, '/admin/login?registered=' + (status === 'active' ? '1' : 'pending'));
  });
}
module.exports = { routes, requireStaff, requireAdmin, currentStaff, bootstrapAdmin };
