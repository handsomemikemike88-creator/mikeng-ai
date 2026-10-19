// Courses (admin-managed). Seeded from data/products.json (exact prices) + all in-person courses in data/inperson-courses.json.
// Price guard: any price that is not on Mikey's list (0/588/1288/2200) is flagged 「新價錢，需 Mikey 確認」 and the course
// stays unpublished until an admin ticks the confirmation box.
const fs = require('fs'), path = require('path');
const D = require('../db');
const { esc } = require('./security');
const STANDARD = [0, 588, 1288, 2200];
const UPLOAD_DIR = () => process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const RESERVED = ['online-video', 'online-1on1', 'in-person'];

const PROD = () => process.env.NODE_ENV === 'production' || process.env.SITE_INDEXABLE === '1';
// launchReady:false in data/inperson-courses.json -> hidden + not bookable/purchasable in production (QA v5).
function ipLaunch(slug) { try { const c = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'inperson-courses.json'), 'utf8')).courses.find(x => x.slug === slug); return !c || c.launchReady !== false; } catch { return true; } }
const blockedProduct = pid => PROD() && typeof pid === 'string' && pid.startsWith('ip-') && !ipLaunch(pid.slice(3));
// multer/busboy hands originalname over as latin1; re-decode as UTF-8 (e.g. Chinese filenames) unless it isn't valid UTF-8.
function fileName(n) { n = String(n || ''); let d = n; if (/^[\u0000-\u00ff]*$/.test(n)) { const t = Buffer.from(n, 'latin1').toString('utf8'); if (!t.includes('\uFFFD')) d = t; } return d.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120); }
const HIDE = /(?!)/; // was a Hermes exclusion; Mikey 2026-10-19: all 7 in-person courses incl. Hermes are listed (only launchReady:false is gated, in production)
function ipMd(c) {
  const g = Array.isArray(c.goals) ? c.goals.map(x => `- ${x}`) : c.goals ? [c.goals] : [];
  return [c.audience ? `**適合：** ${c.audience}` : '', c.prereq ? `**入門要求：** ${c.prereq}` : '', '', g.length ? '## 學習目標' : '', ...g,
    ...(c.modules || []).flatMap(m => ['', `## ${m.title}`, ...(m.items || []).map(i => `- ${i}`)])].filter((x, i, a) => x || (a[i - 1] && a[i - 1] !== '')).join('\n').trim();
}
// Seeds from data/products.json (online products: names + exact prices) and data/inperson-courses.json (titles, slugs, price).
// Nothing is hardcoded; re-running keeps seeded titles/prices in sync with those files and never touches admin-made courses.
function seedCourses() {
  const root = path.join(__dirname, '..', '..', 'data');
  const P = JSON.parse(fs.readFileSync(path.join(root, 'products.json'), 'utf8'));
  let IP = { courses: [] }; try { IP = JSON.parse(fs.readFileSync(path.join(root, 'inperson-courses.json'), 'utf8')); } catch {}
  const db = D.get(), t = D.now();
  const up = db.prepare(`INSERT INTO courses (slug, title, description, content_md, price_hkd, product_id, public_url, status, is_seed, kind, launch_ready, created_at, updated_at)
    VALUES (@slug, @title, @description, @content_md, @price, @product_id, @public_url, 'published', 1, @kind, @launch, @t, @t)
    ON CONFLICT(slug) DO UPDATE SET title = excluded.title, price_hkd = excluded.price_hkd, product_id = excluded.product_id, public_url = excluded.public_url, kind = excluded.kind, launch_ready = excluded.launch_ready WHERE courses.is_seed = 1`);
  db.transaction(() => {
    for (const id of ['online-video', 'online-1on1']) {
      const p = P[id]; if (!p || typeof p.price !== 'number') continue;
      up.run({ slug: id, title: p.course || p.name, /* same title the public course page shows (products.json course, else name) */ description: id === 'online-video' ? '網上錄播課程，由付款日起 1 年內可重複觀看。' : `同導師網上 1 對 1 上堂${p.detail ? '，' + p.detail : ''}。`,
        content_md: '', price: p.price, product_id: id, public_url: '/courses/' + id, kind: 'online', launch: 1, t });
    }
    if (typeof IP.price === 'number') for (const c of IP.courses || []) {
      up.run({ slug: 'ip-' + c.slug, title: c.title, description: [c.short, IP.detail].filter(Boolean).join('｜'), content_md: ipMd(c), price: IP.price,
        product_id: 'ip-' + c.slug, public_url: '/courses/in-person/' + c.slug, kind: 'in-person', launch: c.launchReady === false ? 0 : 1, t });
    }
  })();
}
const priceLabel = n => 'HK$' + Number(n).toLocaleString('en-US');
const isStandard = n => STANDARD.includes(Number(n));
const publicId = c => c.product_id || 'oc-' + c.slug;
const publicUrl = c => c.public_url || '/online-course/' + c.slug;
const published = (kind = 'online') => D.get().prepare("SELECT * FROM courses WHERE kind = ? AND status = 'published' AND is_demo = 0 AND (price_flag = 0 OR price_confirmed_at IS NOT NULL) ORDER BY is_seed DESC, id").all(kind);
const bySlug = s => D.get().prepare('SELECT * FROM courses WHERE slug = ?').get(String(s || ''));
const byId = id => D.get().prepare('SELECT * FROM courses WHERE id = ?').get(+id || 0);

// Access window: 「由付款日起 1 年」 — from the HK payment date to the day before its anniversary, 23:59:59 HKT.
// (29 Feb payments: anniversary taken as 28 Feb, so access ends 27 Feb.) Exact last day: see BACKEND.md decisions.
function accessUntil(paidAt) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date(paidAt));
  let [y, m, dd] = d.split('-').map(Number); y += 1; if (m === 2 && dd === 29) dd = 28;
  const ann = new Date(Date.UTC(y, m - 1, dd)); ann.setUTCDate(ann.getUTCDate() - 1);
  return new Date(ann.toISOString().slice(0, 10) + 'T23:59:59+08:00');
}
// Paid order for this customer (matched by customer link or email) covering this course, and still within access.
function paidOrder(customer, course, now = new Date()) {
  if (!customer || !course) return null;
  if (PROD() && course.launch_ready === 0) return null;
  const rows = D.get().prepare(`SELECT o.* FROM orders o JOIN leads l ON l.id = o.lead_id
    WHERE (l.customer_id = ? OR l.email = ?) AND (o.course_id = ? OR (o.product_id IS NOT NULL AND o.product_id = ?)) AND o.payment_status = '已付款' AND o.paid_at IS NOT NULL`)
    .all(customer.id, customer.email, course.id, course.product_id || '\u0000');
  return rows.find(o => accessUntil(o.paid_at) > now) || null;
}

// Minimal safe Markdown: input is escaped first; supports #/##/### headings, - lists, **bold**, *italic*, [text](https://link), paragraphs.
function md(src) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => `<a href="${u}" rel="noopener nofollow">${t}</a>`);
  const out = []; let list = false, para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  for (const raw of String(src || '').split(/\r?\n/)) {
    const line = raw.trimEnd(), h = /^(#{1,3})\s+(.*)$/.exec(line), li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) { flush(); if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (h) { flush(); const n = h[1].length + 2; out.push(`<h${n}>${inline(h[2])}</h${n}>`); }
    else if (!line.trim()) flush(); else para.push(line);
  }
  flush(); if (list) out.push('</ul>');
  return out.join('\n');
}
// Upload validation: extension AND declared MIME AND magic bytes.
const VIDEO = { '.mp4': 'video/mp4', '.webm': 'video/webm' };
function sniff(file) {
  const fd = fs.openSync(file, 'r'), b = Buffer.alloc(12); fs.readSync(fd, b, 0, 12, 0); fs.closeSync(fd);
  if (b.slice(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
  if (b.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  return null;
}
module.exports = { fileName, PROD, blockedProduct, HIDE, STANDARD, UPLOAD_DIR, SLUG, RESERVED, seedCourses, priceLabel, isStandard, publicId, publicUrl, published, bySlug, byId, accessUntil, paidOrder, md, VIDEO, sniff };
