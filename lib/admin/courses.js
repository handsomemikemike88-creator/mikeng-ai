// Course admin (online + in-person model): add / edit, markdown content, price, reference video upload (multer; mp4/webm;
// MIME + extension + magic bytes; size limit MAX_UPLOAD_MB, default 500), download link, draft/published, slug.
// Price guard: price not in 0/588/1288/2200 => 「新價錢，需 Mikey 確認」, stays unpublished until an admin ticks the box.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const multer = require('multer');
const D = require('../db');
const Sx = require('../backend/security');
const CO = require('../backend/courses');
const ST = require('../backend/stripe-config');
const { page, field, select, fmt, money, esc, demoTag } = require('./views');
const clean = s => String(s ?? '').trim();
const MAX_MB = () => Math.max(1, +process.env.MAX_UPLOAD_MB || 500);
const FLAG = '新價錢，需 Mikey 確認';

const upload = () => multer({
  storage: multer.diskStorage({ destination: (req, f, cb) => { fs.mkdirSync(CO.UPLOAD_DIR(), { recursive: true }); cb(null, CO.UPLOAD_DIR()); },
    filename: (req, f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(f.originalname).toLowerCase()) }),
  limits: { fileSize: MAX_MB() * 1024 * 1024, files: 1, fields: 5 },
  fileFilter: (req, f, cb) => { const ext = path.extname(f.originalname || '').toLowerCase(); cb(null, !!CO.VIDEO[ext] && CO.VIDEO[ext] === f.mimetype); },
}).single('video');

function listPage(req) {
  const rows = D.get().prepare('SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.course_id = c.id AND o.payment_status = \'已付款\') paid FROM courses c ORDER BY c.kind, c.is_seed DESC, c.id').all();
  const tbl = kind => `<div class="tablewrap"><table class="tbl"><thead><tr><th>課程</th><th>價錢</th><th>狀態</th><th>影片</th><th>下載</th><th>已付款學員</th><th>Stripe TEST Price</th></tr></thead><tbody>${rows.filter(c => c.kind === kind).map(c => `<tr>
<td><a href="/admin/courses/${c.id}">${esc(c.title)}</a> ${demoTag(c)}<br><span class="small muted">${esc(c.slug)}${c.is_seed ? ' · 由網站資料檔同步' : ''}</span></td><td>${money(c.price_hkd)}${c.price_flag && !c.price_confirmed_at ? `<br><span class="chip pay-3">${FLAG}</span>` : ''}</td>
<td>${c.launch_ready === 0 ? '<span class="chip pay-3" title="launchReady:false">未公開</span>' : c.status === 'published' ? '已發佈' : '草稿'}</td><td>${c.video_file ? '✓' : '—'}</td><td>${c.download_url ? '✓' : '—'}</td><td>${c.paid}</td><td class="small">${ST.priceId(c.product_id || 'oc-' + c.slug) ? '已設定' : '未設定（' + esc(ST.envName(c.product_id || 'oc-' + c.slug)) + '）'}</td></tr>`).join('') || '<tr><td colspan="7">未有。</td></tr>'}</tbody></table></div>`;
  return page({ title: '課程', active: 'courses', user: req.user, req, flash: req.query.ok ? '已儲存。' : '', body: `<div class="head"><div><p class="kicker">COURSES</p><h1>網上課程管理</h1><p class="small muted">已發佈嘅網上課程會即時喺公開 <a href="/online-course">/online-course</a> 出現，並可以用示範 checkout 購買。Stripe：${esc(ST.mode().label)}</p></div><a class="btn" href="/admin/courses/new">＋ 新增課程</a></div>
<section class="panel"><h2 class="h3">網上課程</h2>${tbl('online')}</section><section class="panel"><h2 class="h3">現場上堂課程（由 data/inperson-courses.json 同步）</h2>${tbl('in-person')}</section>` });
}
function form(req, c = {}, e = {}, warn = '') {
  const seeded = !!c.is_seed, err = k => e[k] ? `<p class="err">${esc(e[k])}</p>` : '';
  const flagged = c.price_flag && !c.price_confirmed_at;
  return `${warn ? `<div class="warnbox" role="alert">${esc(warn)}</div>` : ''}${flagged ? `<div class="warnbox" role="alert"><strong>⚠ ${FLAG}</strong>：HK$${esc(c.price_hkd)} 唔喺現有價目表（HK$0／588／1,288／2,200）。課程會保持「草稿」，直至管理員剔選下面嘅確認方格。</div>` : ''}
<form method="post" action="${c.id ? '/admin/courses/' + c.id : '/admin/courses'}" class="panel">${Sx.csrfField(req)}<div class="grid2">
<div>${field('title', '課程名稱', c.title, { req: true, attrs: `maxlength="120"${seeded ? ' readonly' : ''}`, hint: seeded ? '由 data/products.json／inperson-courses.json 同步，喺嗰度改。' : '' })}${err('title')}</div>
<div>${field('slug', 'Slug（網址）', c.slug, { req: true, attrs: `maxlength="60" pattern="[a-z0-9-]+"${c.id ? ' readonly' : ''}`, hint: '細楷英文、數字同 -，例如 ai-image-basics。建立後唔可以改。' })}${err('slug')}</div>
<div>${field('price_hkd', '價錢（港幣）', c.price_hkd ?? '', { type: 'number', req: true, attrs: `min="0" max="100000" step="1"${seeded ? ' readonly' : ''}`, hint: seeded ? '價錢跟網站價目表，唔可以喺後台改。' : '現有價目：0／588／1,288／2,200。其他價錢要 Mikey 確認先可以發佈。' })}${err('price_hkd')}</div>
<div>${c.id ? `<div class="f"><label>類別</label><p>${c.kind === 'online' ? '網上課程' : '現場上堂課程'}</p></div>` : select('kind', '類別', [['online', '網上課程'], ['in-person', '現場上堂課程（只入後台，公開頁跟 inperson-courses.json）']], c.kind || 'online')}</div>
<div style="grid-column:1/-1"><div class="f"><label for="f-description">簡介</label><textarea id="f-description" name="description" rows="2" maxlength="600">${esc(c.description || '')}</textarea></div></div>
<div style="grid-column:1/-1"><div class="f"><label for="f-content">課程內容／模組（Markdown：# 標題、- 列點、**粗體**、[連結](https://…)）</label><textarea id="f-content" name="content_md" rows="12" maxlength="50000">${esc(c.content_md || '')}</textarea></div></div>
<div>${field('download_url', '下載連結（https，只開放俾已付款學員，經有時效簽署連結）', c.download_url || '', { type: 'url', attrs: 'maxlength="500" placeholder="https://drive.google.com/…"' })}${err('download_url')}</div>
<div>${select('status', '狀態', [['draft', '草稿'], ['published', '已發佈']], c.status || 'draft')}</div>
${!seeded && req.user.role === 'admin' ? `<div class="f" style="grid-column:1/-1"><label class="check"><input type="checkbox" name="confirm_price" value="1"${c.price_confirmed_at ? ' checked' : ''}><span>（管理員）我確認 Mikey 已批准呢個價錢${c.price_confirmed_at ? `（已確認 ${fmt(c.price_confirmed_at)}）` : ''}</span></label></div>` : ''}
</div><button class="btn" type="submit">儲存</button></form>`;
}
function videoBox(req, c) {
  const sig = c.video_file ? Sx.sign('v', c.id, 'staff:' + req.user.id) : '';
  return `<section class="panel"><h2 class="h3">參考影片</h2>${c.video_file ? `<video controls preload="metadata" src="${esc(sig)}"></video><p class="small muted">${esc(c.video_name)} · ${(c.video_size / 1048576).toFixed(1)} MB · ${esc(c.video_mime)}｜檔案放喺 uploads/（唔係公開資料夾），只經有時效嘅簽署連結串流俾員工同已付款學員。</p>` : '<p class="muted">未有影片。</p>'}
<form method="post" action="/admin/courses/${c.id}/video?_csrf=${encodeURIComponent(req.sess.csrf)}" enctype="multipart/form-data" class="inline" style="margin-top:10px"><div class="f"><label for="f-video">上載 MP4／WebM（最大 ${MAX_MB()} MB）</label><input id="f-video" name="video" type="file" accept="video/mp4,video/webm,.mp4,.webm" required></div><button class="btn sm" type="submit">上載</button></form>
${c.video_file ? `<form method="post" action="/admin/courses/${c.id}/video/delete" style="margin-top:8px">${Sx.csrfField(req)}<button class="btn danger sm" type="submit">刪除影片</button></form>` : ''}
${c.download_url ? `<p class="small" style="margin-top:12px">下載連結測試（員工）：<a href="${esc(Sx.sign('d', c.id, 'staff:' + req.user.id))}" rel="noopener">開啟</a></p>` : ''}</section>`;
}
function editPage(req, c, e = {}, warn = '', flash = '') {
  const pub = c.kind === 'online' ? (c.public_url || '/online-course/' + c.slug) : c.public_url;
  return page({ title: c.title || '新增課程', active: 'courses', user: req.user, req, flash, body: `<div class="head"><div><p class="kicker"><a href="/admin/courses">課程</a>${c.id ? ' › #' + c.id : ''}</p><h1>${esc(c.title || '新增課程')} ${demoTag(c)}</h1>${c.id && pub ? `<p class="small"><a href="${esc(pub)}" target="_blank" rel="noopener">公開頁 ↗</a></p>` : ''}</div></div>
${form(req, c, e, warn)}${c.id ? videoBox(req, c) : ''}` });
}
function readForm(b, c, user) {
  const seeded = !!(c && c.is_seed), e = {};
  const v = { title: seeded ? c.title : clean(b.title), slug: c && c.id ? c.slug : clean(b.slug).toLowerCase(), price: seeded ? c.price_hkd : clean(b.price_hkd),
    kind: c && c.id ? c.kind : (b.kind === 'in-person' ? 'in-person' : 'online'), description: clean(b.description).slice(0, 600), content_md: String(b.content_md || '').slice(0, 50000),
    download_url: clean(b.download_url), status: b.status === 'published' ? 'published' : 'draft', confirm: b.confirm_price === '1' && user.role === 'admin' };
  if (!v.title || v.title.length > 120) e.title = '請填寫課程名稱（最多 120 字）。';
  if (!CO.SLUG.test(v.slug)) e.slug = 'Slug 只可以用細楷英文、數字同 -（2–60 字）。';
  else if (!(c && c.id) && (CO.RESERVED.includes(v.slug) || v.slug.startsWith('ip-') || CO.bySlug(v.slug))) e.slug = '呢個 slug 已經用咗。';
  if (!/^\d{1,6}$/.test(String(v.price))) e.price_hkd = '價錢要係 0 或以上嘅整數（港幣）。';
  if (v.download_url && !/^https:\/\/[^\s"'<>]{4,490}$/i.test(v.download_url)) e.download_url = '下載連結要係 https:// 開頭。';
  v.price = +v.price;
  return { v, e };
}
function save(req, c, v) {
  const t = D.now(), db = D.get();
  const flag = CO.isStandard(v.price) ? 0 : 1;
  const priceChanged = !c || c.price_hkd !== v.price;
  let confirmedAt = priceChanged ? null : c.price_confirmed_at, confirmedBy = priceChanged ? null : c.price_confirmed_by;
  if (flag && v.confirm) { confirmedAt = confirmedAt || t; confirmedBy = confirmedBy || req.user.id; }
  if (flag && !v.confirm) { confirmedAt = null; confirmedBy = null; }
  let status = v.status, warn = '';
  if (flag && !confirmedAt && status === 'published') { status = 'draft'; warn = `已儲存做草稿：${FLAG}（HK$${v.price}）。管理員剔選確認方格後先可以發佈。`; }
  if (c) db.prepare('UPDATE courses SET title = ?, description = ?, content_md = ?, price_hkd = ?, download_url = ?, status = ?, price_flag = ?, price_confirmed_at = ?, price_confirmed_by = ?, updated_at = ? WHERE id = ?')
    .run(v.title, v.description, v.content_md, v.price, v.download_url || null, status, flag, confirmedAt, confirmedBy, t, c.id);
  else c = { id: db.prepare('INSERT INTO courses (slug, title, description, content_md, price_hkd, download_url, status, price_flag, price_confirmed_at, price_confirmed_by, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(v.slug, v.title, v.description, v.content_md, v.price, v.download_url || null, status, flag, confirmedAt, confirmedBy, v.kind, t, t).lastInsertRowid };
  require('../backend/public').syncProducts();
  return { id: c.id, warn };
}
function routes(r) {
  r.get('/admin/courses', (req, res) => res.type('html').send(listPage(req)));
  r.get('/admin/courses/new', (req, res) => res.type('html').send(editPage(req, {})));
  r.post('/admin/courses', (req, res) => {
    const { v, e } = readForm(req.body, null, req.user);
    if (Object.keys(e).length) return res.status(400).type('html').send(editPage(req, { ...v, price_hkd: v.price }, e));
    const { id, warn } = save(req, null, v);
    res.status(warn ? 200 : 303); if (!warn) return res.redirect(303, `/admin/courses/${id}?ok=1`);
    res.type('html').send(editPage(req, CO.byId(id), {}, warn));
  });
  const get = (req, res) => { const c = CO.byId(req.params.id); if (!c) res.status(404).type('html').send(page({ title: '搵唔到', user: req.user, req, body: '<h1>搵唔到呢個課程</h1>' })); return c; };
  r.get('/admin/courses/:id', (req, res) => { const c = get(req, res); if (c) res.type('html').send(editPage(req, c, {}, '', req.query.ok === 'video' ? '影片已上載。' : req.query.ok ? '已儲存。' : '')); });
  r.post('/admin/courses/:id', (req, res) => {
    const c = get(req, res); if (!c) return;
    const { v, e } = readForm(req.body, c, req.user);
    if (Object.keys(e).length) return res.status(400).type('html').send(editPage(req, { ...c, ...v, price_hkd: v.price }, e));
    const { warn } = save(req, c, v);
    if (warn) return res.type('html').send(editPage(req, CO.byId(c.id), {}, warn));
    res.redirect(303, `/admin/courses/${c.id}?ok=1`);
  });
  // CSRF is checked (via ?_csrf=) by the router BEFORE multer writes anything to disk.
  r.post('/admin/courses/:id/video', (req, res) => {
    const c = get(req, res); if (!c) return;
    upload()(req, res, err => {
      const bad = msg => { if (req.file) fs.rm(req.file.path, { force: true }, () => {}); res.status(400).type('html').send(editPage(req, c, {}, msg)); };
      if (err) return bad(err.code === 'LIMIT_FILE_SIZE' ? `檔案太大（最大 ${MAX_MB()} MB）。` : '上載失敗。');
      if (!req.file) return bad('只接受 MP4 或 WebM 影片（副檔名同檔案類型要一致）。');
      const sniffed = CO.sniff(req.file.path);
      if (!sniffed || sniffed !== CO.VIDEO[path.extname(req.file.filename)]) return bad('檔案內容唔似 MP4／WebM 影片，已拒絕。');
      if (c.video_file) fs.rm(path.join(CO.UPLOAD_DIR(), path.basename(c.video_file)), { force: true }, () => {});
      D.get().prepare('UPDATE courses SET video_file = ?, video_mime = ?, video_size = ?, video_name = ?, updated_at = ? WHERE id = ?').run(req.file.filename, sniffed, req.file.size, CO.fileName(req.file.originalname), D.now(), c.id);
      res.redirect(303, `/admin/courses/${c.id}?ok=video`);
    });
  });
  r.post('/admin/courses/:id/video/delete', (req, res) => {
    const c = get(req, res); if (!c) return;
    if (c.video_file) fs.rm(path.join(CO.UPLOAD_DIR(), path.basename(c.video_file)), { force: true }, () => {});
    D.get().prepare('UPDATE courses SET video_file = NULL, video_mime = NULL, video_size = NULL, video_name = NULL, updated_at = ? WHERE id = ?').run(D.now(), c.id);
    res.redirect(303, `/admin/courses/${c.id}?ok=1`);
  });
}
module.exports = { routes, FLAG };
