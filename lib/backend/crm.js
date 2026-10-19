// Leads / CRM pipeline / products / orders, plus the one-way import of the existing JSON demo store (data/submissions.json).
const fs = require('fs'), path = require('path');
const D = require('../db');
const R = require('./reminders');
const SUBS = () => process.env.SUBMISSIONS_FILE || path.join(__dirname, '..', '..', 'data', 'submissions.json');
const STAGE_NAME = Object.fromEntries(D.STAGES.map(s => [s[0], s[1]]));
const ORDER = D.STAGE_KEYS;

// Products: snapshot of data/products.json + in-person catalogue. Prices are copied, never invented.
function seedProducts() {
  const P = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'products.json'), 'utf8'));
  let IP = { courses: [] }; try { IP = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'inperson-courses.json'), 'utf8')); } catch {}
  const up = D.get().prepare(`INSERT INTO products (id, name, course, price, price_label, kind, buyable) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, course = excluded.course, price = excluded.price, price_label = excluded.price_label, kind = excluded.kind, buyable = excluded.buyable`);
  D.get().transaction(() => {
    for (const [id, p] of Object.entries(P)) if (!id.startsWith('_') && p && typeof p.price === 'number') up.run(id, p.name, p.course || null, p.price, p.priceLabel, id, p.buyable ? 1 : 0);
    for (const c of IP.courses || []) if (typeof IP.price === 'number') up.run('ip-' + c.slug, '現場上堂課程', c.title, IP.price, IP.priceLabel, 'in-person', 1);
  })();
}
const product = id => D.get().prepare('SELECT * FROM products WHERE id = ?').get(String(id || ''));

function upsertLead(v, by = 'system') {
  const db = D.get(), t = v.at || D.now();
  if (v.is_demo == null && /@(example\.(com|org|net)|[^@]+\.test)$/i.test(v.email || '')) v.is_demo = 1; // test/e2e leftovers are tagged demo, never shown as real
  let l = db.prepare('SELECT * FROM leads WHERE email = ?').get(v.email);
  if (!l) {
    const p = v.service ? product(v.service) : null;
    const id = db.prepare(`INSERT INTO leads (email, name, phone, service, standard_price, source, stage, marketing_consent, marketing_consent_at, marketing_consent_text, is_demo, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)`).run(v.email, v.name, v.phone || null, v.service || null, p ? p.price : null, v.source || 'web',
      v.marketing ? 1 : 0, v.marketing ? t : null, v.marketing ? (v.consentText || 'v1-2026-10-19') : null, v.is_demo ? 1 : 0, t, t).lastInsertRowid;
    db.prepare("INSERT INTO stage_history (lead_id, from_stage, to_stage, by_name, via, at, is_demo) VALUES (?, NULL, 'new', ?, 'system', ?, ?)").run(id, by, t, v.is_demo ? 1 : 0);
    return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  }
  // existing lead: fill blanks, never overwrite staff edits; record new consent
  const p = !l.service && v.service ? product(v.service) : null;
  db.prepare(`UPDATE leads SET phone = COALESCE(phone, ?), service = COALESCE(service, ?), standard_price = COALESCE(standard_price, ?),
    marketing_consent = CASE WHEN ? = 1 THEN 1 ELSE marketing_consent END, marketing_consent_at = CASE WHEN ? = 1 AND marketing_consent = 0 THEN ? ELSE marketing_consent_at END, updated_at = ? WHERE id = ?`)
    .run(v.phone || null, v.service || null, p ? p.price : null, v.marketing ? 1 : 0, v.marketing ? 1 : 0, t, D.now(), l.id);
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(l.id);
}

function moveStage(leadId, to, { byId = null, byName = 'system', via = 'select' } = {}) {
  if (!ORDER.includes(to)) throw new Error('bad stage');
  const db = D.get(), l = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  if (!l) throw new Error('no lead'); if (l.stage === to) return false;
  const t = D.now();
  db.transaction(() => {
    db.prepare('UPDATE leads SET stage = ?, updated_at = ? WHERE id = ?').run(to, t, leadId);
    db.prepare('INSERT INTO stage_history (lead_id, from_stage, to_stage, by_id, by_name, via, at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(leadId, l.stage, to, byId, byName, via, t, l.is_demo);
  })();
  return true;
}
// System auto-advance: only forward, never out of 已售出/已流失.
function advance(leadId, to, byName = 'system') {
  const l = D.get().prepare('SELECT stage FROM leads WHERE id = ?').get(leadId); if (!l) return;
  if (['sold', 'lost'].includes(l.stage) && to !== 'sold') return;
  if (ORDER.indexOf(to) > ORDER.indexOf(l.stage)) moveStage(leadId, to, { byName, via: 'system' });
}
function refreshPayment(leadId) {
  const db = D.get(), os = db.prepare('SELECT payment_status FROM orders WHERE lead_id = ? ORDER BY created_at DESC').all(leadId);
  let st = os.length ? (os.find(o => o.payment_status === '已付款') ? '已付款' : os[0].payment_status) : '未付款';
  // Stripe TEST-mode sample orders show as their own statuses (never as real 已付款)
  const tp = db.prepare("SELECT status FROM test_payments WHERE lead_id = ? AND status IN ('已付款', '待付款') ORDER BY status = '已付款' DESC LIMIT 1").get(leadId);
  if (tp && st !== '已付款') st = tp.status === '已付款' ? '已付款（測試）' : '待付款（測試）';
  db.prepare('UPDATE leads SET payment_status = ?, updated_at = ? WHERE id = ?').run(st, D.now(), leadId);
}
function setOrderPayment(orderId, status, byName) {
  if (!D.PAY.includes(status)) throw new Error('bad status');
  const db = D.get(), o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId); if (!o) throw new Error('no order');
  const t = D.now();
  db.prepare(`UPDATE orders SET payment_status = ?, paid_at = CASE WHEN ? = '已付款' THEN COALESCE(paid_at, ?) ELSE paid_at END,
    refunded_at = CASE WHEN ? = '已退款' THEN ? ELSE refunded_at END, updated_at = ? WHERE id = ?`).run(status, status, t, status, t, t, orderId);
  refreshPayment(o.lead_id);
  // 已售出課程 is set only by a verified Stripe TEST-mode webhook (lib/backend/stripe-test.js), never by a manual payment change.
}
function addNote(leadId, staff, body) {
  const b = String(body || '').trim().slice(0, 4000); if (!b) return false;
  const l = D.get().prepare('SELECT is_demo FROM leads WHERE id = ?').get(leadId); if (!l) return false;
  D.get().prepare('INSERT INTO notes (lead_id, author_id, author_name, body, created_at, is_demo) VALUES (?, ?, ?, ?, ?, ?)').run(leadId, staff.id, staff.name, b, D.now(), l.is_demo);
  return true;
}

function createBooking(leadId, seminarId, { source = 'web', ref = null, at = null, joinUrl = null, tokenHash = null, isDemo = 0 } = {}) {
  const db = D.get();
  const ex = db.prepare('SELECT * FROM bookings WHERE lead_id = ? AND seminar_id = ?').get(leadId, seminarId);
  let id;
  if (ex) { if (ex.status === 'booked') return { id: ex.id, existed: true }; db.prepare("UPDATE bookings SET status = 'booked', cancelled_at = NULL WHERE id = ?").run(ex.id); id = ex.id;
    db.prepare("UPDATE reminders SET status = '草稿', skip_reason = NULL WHERE booking_id = ? AND skip_reason = '已取消報名'").run(id); }
  else id = db.prepare('INSERT INTO bookings (lead_id, seminar_id, source, source_ref, join_token_hash, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(leadId, seminarId, source, ref, tokenHash, isDemo, at || D.now()).lastInsertRowid;
  R.createFor(id, { joinUrl });
  return { id, existed: false };
}
function cancelBooking(bookingId, by = 'system') {
  D.get().prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ?").run(D.now(), bookingId);
  R.skipForBooking(bookingId, '已取消報名', by);
}
function markAttendance(bookingId, value, byName) {
  if (!D.ATTEND.includes(value)) throw new Error('bad attendance');
  const b = D.get().prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId); if (!b) throw new Error('no booking');
  D.get().prepare('UPDATE bookings SET attendance = ? WHERE id = ?').run(value, bookingId);
  if (value === '已出席') advance(b.lead_id, 'attended', byName);
}
function markReminder(id, status, byName) {
  if (!D.REMINDER_STATUS.includes(status)) throw new Error('bad status');
  const db = D.get(), r = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id); if (!r) throw new Error('no reminder');
  if (r.channel === 'whatsapp' && status !== '已略過') { const l = db.prepare('SELECT whatsapp_opt_out_at FROM leads WHERE id = ?').get(r.lead_id); if (l.whatsapp_opt_out_at) throw new Error('opted out'); }
  db.prepare('UPDATE reminders SET status = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(status, byName, D.now(), id);
  if (status === '已手動發送') {
    db.prepare('UPDATE leads SET reminder_status = ?, updated_at = ? WHERE id = ?').run(`已手動發送：${r.label}`, D.now(), r.lead_id);
    if (!['wa_confirm', 'em_confirm'].includes(r.kind)) advance(r.lead_id, 'reminded', byName);
  }
}

// ---- import the JSON demo store (idempotent; re-runs only when the file changes) ----
let lastSig = '';
function outboxJoins() {
  const m = new Map(); try { for (const line of fs.readFileSync(process.env.OUTBOX_FILE || path.join(__dirname, '..', '..', 'data', 'outbox.jsonl'), 'utf8').split('\n')) { if (!line) continue; const r = JSON.parse(line); if (r.template === 'seminar-confirmation' && r.join) m.set(r.to + '|' + r.session, r.join); } } catch {}
  return m;
}
function syncJson(force = false) {
  const f = SUBS(); let st; try { st = fs.statSync(f); } catch { return 0; }
  const sig = st.mtimeMs + ':' + st.size; if (!force && sig === lastSig) return 0; lastSig = sig;
  let all = []; try { all = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return 0; }
  const db = D.get(), seen = db.prepare('SELECT 1 FROM imports WHERE source_ref = ?'), mark = db.prepare('INSERT INTO imports (source_ref, type, at) VALUES (?, ?, ?)');
  const joins = outboxJoins(); let n = 0;
  const S = require('./seminars');
  for (const r of all) {
    if (!r || !r.id || seen.get(r.id)) continue;
    try {
      db.transaction(() => {
        if (r.type === 'seminar') {
          S.ensureRule(r.session ? r.session.slice(0, 10) : '2026-12-31');
          if (!db.prepare('SELECT 1 FROM seminars WHERE id = ?').get(r.session)) { const s = S.ORIG.byId(r.session); if (s) db.prepare(`INSERT OR IGNORE INTO seminars (id, date, start_time, end_time, title, platform, zoom_url, language, is_free, replay_days, status, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '', ?, 1, ?, 'confirmed', 'rule', ?, ?)`).run(s.id, s.date, s.start.slice(11, 16), s.end.slice(11, 16), s.title, s.platform, s.language, s.replayDays, D.now(), D.now()); }
          const l = upsertLead({ email: r.email, name: r.name, phone: r.phone, service: 'seminar', source: '/seminar', marketing: !!r.marketing, at: r.createdAt, consentText: r.marketingConsent && r.marketingConsent.textVersion });
          if (db.prepare('SELECT 1 FROM seminars WHERE id = ?').get(r.session)) createBooking(l.id, r.session, { source: '/seminar', ref: r.id, at: r.createdAt, tokenHash: r.joinTokenHash, joinUrl: joins.get(r.email + '|' + r.session) });
        } else if (r.type === 'purchase') {
          const l = upsertLead({ email: r.email, name: r.name, service: r.product, source: 'checkout', at: r.createdAt });
          const c = String(r.product).startsWith('oc-') ? db.prepare('SELECT id FROM courses WHERE slug = ? AND product_id IS NULL').get(r.product.slice(3)) : db.prepare('SELECT id FROM courses WHERE product_id = ?').get(r.product);
          db.prepare(`INSERT OR IGNORE INTO orders (lead_id, product_id, course_id, price_hkd, payment_status, source_ref, created_at, updated_at) VALUES (?, ?, ?, ?, '未付款', ?, ?, ?)`)
            .run(l.id, r.product, c ? c.id : null, r.priceHKD, r.id, r.createdAt, r.createdAt);
          refreshPayment(l.id); advance(l.id, 'consult');
        } else if (r.type === 'enquiry') {
          const l = upsertLead({ email: r.email, name: r.name, phone: r.phone, service: (r.interest || '').startsWith('ip-') || ['online-video', 'online-1on1', 'in-person'].includes(r.interest) ? r.interest : null, source: 'enquiry', at: r.createdAt });
          db.prepare("INSERT INTO notes (lead_id, author_name, body, created_at) VALUES (?, '網站查詢表格', ?, ?)").run(l.id, `查詢（${r.interest}）：${r.message}`, r.createdAt);
          if (['online-video', 'online-1on1'].includes(r.interest)) advance(l.id, 'consult');
        } else if (r.type === 'unsubscribe') {
          const l = db.prepare('SELECT id FROM leads WHERE email = ?').get(r.email);
          if (l) { db.prepare('UPDATE leads SET marketing_consent = 0, updated_at = ? WHERE id = ?').run(D.now(), l.id); R.noMarketing(l.id); }
        }
        mark.run(r.id, r.type || '?', D.now());
      })(); n++;
    } catch (e) { console.error('[backend] import skipped', r.id, e.message); }
  }
  return n;
}
module.exports = { seedProducts, product, upsertLead, moveStage, advance, setOrderPayment, refreshPayment, addNote, createBooking, cancelBooking, markAttendance, markReminder, syncJson, STAGE_NAME };
