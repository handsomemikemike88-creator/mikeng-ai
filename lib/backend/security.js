// Auth helpers: bcrypt hashing, DB-backed sessions (httpOnly + SameSite=Lax cookies, Secure in production),
// per-session CSRF tokens, login rate limiting, HMAC-signed expiring media URLs. No secrets in code.
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const D = require('../db');

const PROD = process.env.NODE_ENV === 'production';
const ROUNDS = Math.max(4, +process.env.BCRYPT_ROUNDS || 12);
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function meta(k, make) {
  const db = D.get(); const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(k);
  if (r) return r.v; if (!make) return null;
  const v = make(); db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run(k, v); return v;
}
// Signing secret: env APP_SECRET; in dev a random one is generated once and kept in the local DB (never in code).
function secret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  if (PROD) throw new Error('APP_SECRET must be set in production');
  return meta('dev_app_secret', () => rand(48));
}
// Staff invite code: env STAFF_INVITE_CODE; in dev one is generated and printed at start-up.
function envInviteCode() {
  if (process.env.STAFF_INVITE_CODE) return process.env.STAFF_INVITE_CODE;
  if (PROD) return null; // production: per-person invites from /admin/staff only
  return meta('dev_invite_code', () => 'DEV-' + rand(9));
}

const hash = pw => bcrypt.hashSync(String(pw), ROUNDS);
const DUMMY = bcrypt.hashSync('timing-equaliser', 4);
const verify = (pw, h) => bcrypt.compareSync(String(pw), h || DUMMY);
const pwProblem = pw => (typeof pw !== 'string' || pw.length < 10) ? '密碼最少要 10 個字元。' : pw.length > 200 ? '密碼太長。' : null;

// ---- cookies / sessions ----
const COOKIE = { admin: 'mk_admin', account: 'mk_acct' };
const TTL = { admin: 12 * 3600e3, account: 7 * 24 * 3600e3 };
function parseCookies(req) {
  const out = {}; for (const part of String(req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
function setCookie(res, name, value, maxAgeMs) {
  const c = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (PROD) c.push('Secure');
  const prev = res.getHeader('Set-Cookie'); res.setHeader('Set-Cookie', [...(prev ? [].concat(prev) : []), c.join('; ')]);
}
function newSession(res, area, userId = null) {
  const token = rand(32), csrf = rand(24), t = Date.now();
  D.get().prepare('INSERT INTO sessions (id_hash, area, user_id, csrf, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha(token), area, userId, csrf, new Date(t).toISOString(), new Date(t + TTL[area]).toISOString());
  setCookie(res, COOKIE[area], token, TTL[area]);
  return { id_hash: sha(token), area, user_id: userId, csrf };
}
// Middleware: loads (or creates an anonymous) session for the area, puts it on req.sess.
const session = area => (req, res, next) => {
  const tok = parseCookies(req)[COOKIE[area]]; let s = null;
  if (tok) { s = D.get().prepare('SELECT * FROM sessions WHERE id_hash = ? AND area = ?').get(sha(tok), area); if (s && s.expires_at < new Date().toISOString()) { D.get().prepare('DELETE FROM sessions WHERE id_hash = ?').run(s.id_hash); s = null; } }
  req.sess = s || newSession(res, area);
  res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
  next();
};
// On login/logout: drop the old session and issue a fresh id (prevents fixation).
function rotate(req, res, area, userId) { if (req.sess) D.get().prepare('DELETE FROM sessions WHERE id_hash = ?').run(req.sess.id_hash); req.sess = newSession(res, area, userId); return req.sess; }
function destroy(req, res, area) { if (req.sess) D.get().prepare('DELETE FROM sessions WHERE id_hash = ?').run(req.sess.id_hash); setCookie(res, COOKIE[area], '', 0); }

// CSRF: hidden _csrf field, ?_csrf= (multipart forms, checked before the upload is parsed) or X-CSRF-Token header.
function csrfOk(req) {
  const t = (req.body && req.body._csrf) || req.query._csrf || req.get('x-csrf-token') || '';
  const a = Buffer.from(String(t)), b = Buffer.from(req.sess.csrf);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const csrf = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!csrfOk(req)) return res.status(403).type('html').send('<!doctype html><meta charset="utf-8"><title>403</title><p>表單已過期或者無效（CSRF），請返回上一頁重新整理再試。</p>');
  next();
};
const csrfField = req => `<input type="hidden" name="_csrf" value="${esc(req.sess.csrf)}">`;

// Login rate limit: max 5 failures per email+IP and 20 per IP in 15 minutes.
const fails = new Map();
const WINDOW = 15 * 60e3;
function limited(ip, email) {
  const t = Date.now(), f = k => (fails.get(k) || []).filter(x => t - x < WINDOW);
  return f('ip:' + ip).length >= 20 || f('e:' + ip + ':' + email).length >= 5;
}
function fail(ip, email) { const t = Date.now(); for (const k of ['ip:' + ip, 'e:' + ip + ':' + email]) fails.set(k, [...(fails.get(k) || []).filter(x => t - x < WINDOW), t]); }
function clearFails(ip, email) { fails.delete('e:' + ip + ':' + email); }

// Signed expiring media URLs, bound to the viewer (staff:<id> / cust:<id>).
const MEDIA_TTL = (+process.env.MEDIA_URL_TTL_MIN || 120) * 60e3;
function sign(kind, courseId, principal, exp = Date.now() + MEDIA_TTL) {
  const s = crypto.createHmac('sha256', secret()).update(`${kind}:${courseId}:${principal}:${exp}`).digest('base64url');
  return `/media/${kind}/${courseId}?e=${exp}&s=${s}`;
}
function checkSig(kind, courseId, principal, exp, sig) {
  if (!/^\d+$/.test(String(exp)) || +exp < Date.now()) return false;
  const want = crypto.createHmac('sha256', secret()).update(`${kind}:${courseId}:${principal}:${exp}`).digest('base64url');
  const a = Buffer.from(String(sig || '')), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { PROD, sha, rand, esc, hash, verify, pwProblem, session, rotate, destroy, csrf, csrfOk, csrfField, limited, fail, clearFails, sign, checkSig, secret, envInviteCode, meta, parseCookies };
