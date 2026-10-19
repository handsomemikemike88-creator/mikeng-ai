// Public-facing backend routes (no login):
//   GET  /online-course            list of PUBLISHED online courses (seeded products + admin-added ones)
//   GET  /online-course/:slug      page for an admin-added course, with the existing stub checkout card
//   POST /api/checkout             only for admin-added products (oc-<slug>); everything else falls through to server.js
//   POST /api/seminar              capacity guard only (full seminar -> friendly error); otherwise falls through to server.js
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const D = require('../db');
const CO = require('./courses');
const C = require('./crm');
const { esc } = require('./security');
const pages = () => require('../pages');
const SUBS = () => process.env.SUBMISSIONS_FILE || path.join(__dirname, '..', '..', 'data', 'submissions.json');
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const clean = s => String(s ?? '').trim();

// Register admin-added online courses as products so the existing buyCard()/confirmation() in lib/pages.js work unchanged.
function syncProducts() {
  const P = pages().P; if (!P) return;
  for (const c of D.get().prepare("SELECT * FROM courses WHERE kind = 'online' AND product_id IS NULL").all()) {
    const live = c.status === 'published' && !c.is_demo && (!c.price_flag || c.price_confirmed_at);
    P['oc-' + c.slug] = { id: 'oc-' + c.slug, kind: 'online-video', backendCourse: c.id, name: '網上課程', course: c.title, price: c.price_hkd, priceLabel: CO.priceLabel(c.price_hkd), buyable: live };
  }
}
// Site chrome: use pages.layout when exported (BACKEND HOOK in lib/pages.js), else borrow the header/footer of a rendered page.
function shell({ title, desc = '', path: p = '/', body }) {
  const pg = pages();
  if (typeof pg.layout === 'function') return pg.layout({ title, desc, path: p, body, noindex: p.startsWith('/account') || p.startsWith('/pay/') });
  const html = pg.privacy(), a = html.indexOf('<main'), b = html.indexOf('</main>');
  if (a < 0 || b < 0) return `<!doctype html><html lang="zh-Hant-HK"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="/assets/css/template.css"><link rel="stylesheet" href="/assets/css/site.css"></head><body><main class="inner">${body}</main></body></html>`;
  return html.slice(0, a).replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`).replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace(/<link rel="canonical"[^>]*>/, '').replace(/<meta property="og:url"[^>]*>/, '').replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex,nofollow">')
    + `<main id="main" class="inner">${body}</main>` + html.slice(b + 7);
}
function listPage() {
  const list = CO.published('online');
  const body = `<section class="page-hero"><div class="wrap"><p class="eyebrow">ONLINE COURSES</p><h1>網上<em>課程</em></h1><p class="lead">網上課程一覽。收費一次過，價錢全部公開；網上視頻課程由付款日起 1 年內可重溫。</p>
<div class="grid g2" style="margin-top:28px">${list.map(c => `<a class="card hl" href="${esc(CO.publicUrl(c))}" style="display:block"><p class="section-kicker">${c.product_id ? '網上課程' : '新課程'}</p><h3>${esc(c.title)}</h3><p class="price">${CO.priceLabel(c.price_hkd)}</p><p class="small muted">${esc(c.description)}</p><span class="small">了解更多 →</span></a>`).join('') || '<p>暫時未有網上課程。</p>'}</div>
<p class="small muted" style="margin-top:20px">已購買課程？<a href="/account">登入學員區</a>睇課程內容。</p></div></section>`;
  return shell({ title: '網上課程｜mikeng_course', desc: '網上課程一覽，價錢全部公開。', path: '/online-course', body });
}
function coursePage(c, opts = {}) {
  syncProducts();
  const pid = 'oc-' + c.slug;
  const body = `<section class="page-hero"><div class="wrap grid g2" style="align-items:start"><div><nav class="small muted" aria-label="麵包屑" style="margin-bottom:14px"><a href="/">主頁</a> › <a href="/online-course">網上課程</a> › ${esc(c.title)}</nav>
<p class="eyebrow">網上課程</p><h1>${esc(c.title)}</h1><p class="lead">${esc(c.description)}</p>
<div class="card" style="margin-top:18px"><h3>課程內容</h3><div class="prose">${CO.md(c.content_md) || '<p class="muted">課程內容稍後公佈。</p>'}</div>
<dl class="kv" style="margin-top:12px"><dt>觀看期</dt><dd>由付款日起 1 年</dd><dt>參考影片</dt><dd>${c.video_file ? '付款後喺學員區觀看' : '—'}</dd><dt>下載資料</dt><dd>${c.download_url ? '付款後喺學員區下載' : '—'}</dd></dl></div></div>
<div id="buy">${pages().buyCard(pid, opts)}</div></div></section>`;
  return shell({ title: `${c.title}｜網上課程｜mikeng_course`, desc: c.description.slice(0, 150), path: '/online-course/' + c.slug, body });
}
const save = rec => { let all = []; try { all = JSON.parse(fs.readFileSync(SUBS(), 'utf8')); } catch {} all.push(rec); fs.writeFileSync(SUBS() + '.tmp', JSON.stringify(all, null, 2)); fs.renameSync(SUBS() + '.tmp', SUBS()); };
const hits = new Map();
const limit = (req, res, next) => { const k = req.ip, t = Date.now(); const a = (hits.get(k) || []).filter(x => t - x < 60000); a.push(t); hits.set(k, a); if (a.length > 20) return res.status(429).type('html').send('你提交得太快，請等一陣再試。'); next(); };

function routes(r, body) {
  // Stripe TEST-mode success/cancel page. Read-only: NEVER changes CRM or orders (only the verified webhook does).
  r.get('/pay/test-return', (req, res) => {
    const sid = String(req.query.session_id || '').slice(0, 200), cancelled = req.query.cancelled === '1';
    const tp = sid ? require('../db').get().prepare('SELECT status FROM test_payments WHERE session_id = ?').get(sid) : null;
    const done = tp && tp.status === '已付款';
    res.set('X-Robots-Tag', 'noindex, nofollow').type('html').send(shell({ title: 'Stripe 測試付款｜mikeng_course', path: '/pay/test-return', body: `<section class="page-hero"><div class="wrap" style="max-width:720px"><div class="card hl" role="status">
<p class="section-kicker">樣本／測試數據 — Stripe 測試模式，非真實交易</p>
<h1 style="font-size:34px">${cancelled ? '已取消（測試付款）' : done ? 'Stripe 測試模式已確認付款' : '等待 Stripe 確認'}</h1>
<p>${cancelled ? '你冇完成測試付款，冇任何收費。' : done ? 'Stripe 測試模式 webhook 已確認呢筆測試付款（非真實交易）。' : '多謝！我哋會等 Stripe 經已驗證嘅通知確認付款，確認之後職員會聯絡你。呢頁唔會更改任何紀錄。'}</p>
<p><a class="btn ghost" href="/courses">返回課程</a></p></div></div></section>` }));
  });
  r.get('/online-course', (req, res) => res.type('html').send(listPage()));
  r.get('/online-course/:slug', (req, res, next) => {
    const c = CO.bySlug(req.params.slug);
    if (!c || c.kind !== 'online' || c.is_demo || c.status !== 'published' || (c.price_flag && !c.price_confirmed_at)) return next();
    if (c.public_url && c.public_url !== '/online-course/' + c.slug) return res.redirect(301, c.public_url);
    res.type('html').send(coursePage(c));
  });
  r.post('/api/checkout', limit, ...body, (req, res, next) => {
    const pid = clean(req.body && req.body.product);
    if (CO.blockedProduct(pid)) return res.status(400).type('html').send(shell({ title: '暫時未能報名｜mikeng_course', path: '/courses', body: `<section class="page-hero"><div class="wrap" style="max-width:720px"><div class="card hl" role="alert"><h1 style="font-size:34px">呢個課程暫時未公開</h1><p>呢個課程仲未正式推出，暫時唔可以報名或付款。如有興趣，歡迎<a href="/contact">查詢</a>。</p><p><a class="btn ghost" href="/courses">睇其他課程</a></p></div></div></section>` }));
    if (!pid.startsWith('oc-')) return next();
    syncProducts();
    const c = CO.bySlug(pid.slice(3)), P = pages().P[pid];
    if (!c || !P || !P.buyable) return res.status(400).type('html').send(listPage());
    const b = req.body, errors = {}, v = { product: pid, name: clean(b.name), email: clean(b.email).toLowerCase(), agree: b.agree === 'yes' };
    if (!v.name || v.name.length > 60) errors.name = '請填寫你嘅名稱（最多 60 個字）。';
    if (!EMAIL.test(v.email) || v.email.length > 120) errors.email = '請填寫正確電郵。';
    if (!v.agree) errors.agree = '請先閱讀並同意退款條款。';
    if (Object.keys(errors).length) return res.status(400).type('html').send(coursePage(c, { values: v, errors }));
    const rec = { id: crypto.randomUUID(), type: 'purchase', stub: true, createdAt: new Date().toISOString(), product: pid, priceHKD: c.price_hkd, name: v.name, email: v.email, refundTermsAccepted: true, paymentStatus: 'stub-not-charged' };
    save(rec); try { C.syncJson(true); } catch {}
    res.redirect(303, '/confirmation?id=' + rec.id);
  });
  // Capacity guard for the public sign-up (server.js handles everything else).
  r.post('/api/seminar', ...body, (req, res, next) => {
    const id = clean(req.body && req.body.session), s = id && D.get().prepare('SELECT capacity FROM seminars WHERE id = ?').get(id);
    if (!s || !s.capacity || req.body.step === 'edit') return next();
    if (require('./seminars').bookedCount(id) < s.capacity) return next();
    res.status(400).type('html').send(pages().seminar({ values: { ...req.body, marketing: req.body.marketing === 'yes' }, errors: { session: '呢一場已經滿額，請揀另一個日期。' } }));
  });
}
module.exports = { routes, syncProducts, shell };
