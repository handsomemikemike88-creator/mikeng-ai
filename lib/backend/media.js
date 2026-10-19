// Course media: reference video (streamed with Range support) and download link, only via signed, expiring URLs
// bound to the viewer, AND only for staff or customers with a paid order still inside the 1-year access window.
//   GET /media/v/:courseId?e=<expiry ms>&s=<hmac>   -> video bytes (206 for Range requests)
//   GET /media/d/:courseId?e=...&s=...              -> 302 to the course download link
const path = require('path'), fs = require('fs');
const D = require('../db');
const Sx = require('./security');
const CO = require('./courses');

function viewer(req) {
  // req.sess is the account session (last one loaded); admin session is read separately.
  const tokA = Sx.parseCookies(req).mk_admin;
  if (tokA) { const s = D.get().prepare("SELECT user_id FROM sessions WHERE id_hash = ? AND area = 'admin' AND expires_at > ?").get(Sx.sha(tokA), D.now());
    if (s && s.user_id) { const u = D.get().prepare("SELECT id FROM staff WHERE id = ? AND status = 'active'").get(s.user_id); if (u) return { principal: 'staff:' + u.id, staff: true }; } }
  const tokC = Sx.parseCookies(req).mk_acct;
  if (tokC) { const s = D.get().prepare("SELECT user_id FROM sessions WHERE id_hash = ? AND area = 'account' AND expires_at > ?").get(Sx.sha(tokC), D.now());
    if (s && s.user_id) { const c = D.get().prepare('SELECT * FROM customers WHERE id = ?').get(s.user_id); if (c && c.email_verified_at) return { principal: 'cust:' + c.id, customer: c }; } }
  return null;
}
function allowed(req, kind) {
  const c = CO.byId(req.params.courseId); if (!c) return { code: 404 };
  const v = viewer(req); if (!v) return { code: 403 };
  if (!Sx.checkSig(kind, c.id, v.principal, req.query.e, req.query.s)) return { code: 403 };
  if (v.staff) return { c, v };
  const o = CO.paidOrder(v.customer, c); if (!o) return { code: 403 };
  return { c, v, o };
}
const deny = (res, code) => res.status(code).set('X-Robots-Tag', 'noindex, nofollow').type('text/plain; charset=utf-8').send(code === 404 ? '搵唔到' : '冇權限（需要登入、已付款，並喺觀看期內；連結會過期）');
function routes(r) {
  r.get('/media/v/:courseId', (req, res) => {
    const a = allowed(req, 'v'); if (!a.c) return deny(res, a.code);
    if (!a.c.video_file) return deny(res, 404);
    const dir = path.resolve(CO.UPLOAD_DIR()), file = path.resolve(dir, a.c.video_file);
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file)) return deny(res, 404);
    if (a.o && !a.o.first_viewed_at) D.get().prepare('UPDATE orders SET first_viewed_at = ? WHERE id = ?').run(D.now(), a.o.id); // refund rule: started watching
    res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' });
    res.sendFile(file, { headers: { 'Content-Type': a.c.video_mime || 'video/mp4' }, acceptRanges: true, dotfiles: 'deny' });
  });
  r.get('/media/d/:courseId', (req, res) => {
    const a = allowed(req, 'd'); if (!a.c) return deny(res, a.code);
    if (!/^https:\/\//i.test(a.c.download_url || '')) return deny(res, 404);
    res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).redirect(302, a.c.download_url);
  });
}
module.exports = { routes, viewer };
