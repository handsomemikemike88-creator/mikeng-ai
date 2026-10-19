// Stripe TEST-mode checkout for the 「完成課程實體堂購買」 sample order (Mikey 2026-10-19).
// - Staff moving a lead to 已售出課程 does NOT change the stage: it opens a sample order (in-person course, price from
//   data/inperson-courses.json) in status 待付款 (lead payment 待付款（測試）).
// - Staff create a Stripe Checkout Session (TEST key only) and give the URL to the customer.
// - ONLY a signature-verified, livemode=false, payment_status=paid webhook (re-fetched from the API) marks it paid and
//   moves the lead to 已售出課程. Everything here is test data: never a real transaction or real revenue.
const fs = require('fs'), path = require('path');
const Stripe = require('stripe');
const D = require('../db');
const C = require('./crm');
const SC = require('./stripe-config');

const ACTOR = 'Stripe 測試模式 webhook';
const LABEL = '樣本／測試數據 — Stripe 測試模式，非真實交易';
const DASH_LABEL = 'Stripe 測試模式 — 非真實交易／收益';
const PROD = () => process.env.NODE_ENV === 'production' || process.env.SITE_INDEXABLE === '1';
const LIVE = /^(sk|rk)_live_/;

// ---- key handling ----
function assertNotLive() {
  if (LIVE.test(process.env.STRIPE_SECRET_KEY || '')) throw new Error('[backend] Refusing to start: STRIPE_SECRET_KEY is a LIVE Stripe key (sk_live_/rk_live_). Only Stripe TEST mode keys (sk_test_…) are allowed.');
}
function keyState() {
  const k = process.env.STRIPE_SECRET_KEY || '';
  if (!k) return { ok: false, msg: '未設定 STRIPE_SECRET_KEY（需要 Stripe 測試模式 key：sk_test_…）。未能建立 Stripe 測試 Checkout。' };
  if (LIVE.test(k)) return { ok: false, msg: '已拒絕 live key：只接受 Stripe 測試模式 key（sk_test_…）。' };
  if (!k.startsWith('sk_test_')) return { ok: false, msg: 'STRIPE_SECRET_KEY 必須以 sk_test_ 開頭（只接受測試模式）。' };
  return { ok: true, msg: '' };
}
function apiOpts() {
  const o = { telemetry: false, maxNetworkRetries: 1, timeout: 15000 };
  const base = process.env.STRIPE_API_BASE; // local mock only (scripts/stripe-mock.js); ignored in production
  if (base && !PROD()) { const u = new URL(base); Object.assign(o, { host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), protocol: u.protocol.replace(':', '') }); }
  return o;
}
let _c = null, _ck = '';
function client() {
  const ks = keyState(); if (!ks.ok) return null;
  const k = process.env.STRIPE_SECRET_KEY + '|' + (process.env.STRIPE_API_BASE || '');
  if (!_c || _ck !== k) { _c = new Stripe(process.env.STRIPE_SECRET_KEY, apiOpts()); _ck = k; }
  return _c;
}
// signature verification needs no API key: use the static Stripe.webhooks helper (no client, no key literal)
const verifier = { webhooks: Stripe.webhooks };

// ---- catalogue (price from data, never typed in) ----
function readyCourses() {
  const IP = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'inperson-courses.json'), 'utf8'));
  if (typeof IP.price !== 'number') return [];
  return (IP.courses || []).filter(c => c.launchReady !== false).map(c => ({ slug: c.slug, title: c.title, product_id: 'ip-' + c.slug, price: IP.price }));
}

// ---- orders ----
const byId = id => D.get().prepare('SELECT * FROM test_payments WHERE id = ?').get(+id || 0);
const pendingFor = leadId => D.get().prepare("SELECT * FROM test_payments WHERE lead_id = ? AND status = '待付款' ORDER BY id DESC LIMIT 1").get(leadId);
const forLead = leadId => D.get().prepare('SELECT * FROM test_payments WHERE lead_id = ? ORDER BY id DESC').all(leadId);
const pendingLeadIds = () => new Set(D.get().prepare("SELECT lead_id FROM test_payments WHERE status = '待付款'").all().map(r => r.lead_id));

// Staff asked to move a lead to 已售出課程: create (or reuse) a pending sample order. The stage is NOT changed.
function beginSold(leadId, staff, via = 'select') {
  const db = D.get(), l = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId); if (!l) throw new Error('no lead');
  if (l.stage === 'sold') return null;
  const ex = pendingFor(leadId); if (ex) return ex;
  const list = readyCourses(); if (!list.length) throw new Error('no launch-ready in-person course');
  const c = list.find(x => x.product_id === l.service) || list[0], t = D.now();
  const id = db.prepare(`INSERT INTO test_payments (lead_id, course_slug, product_id, course_title, amount_hkd, currency, status, from_stage, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'hkd', '待付款', ?, ?, ?, ?)`).run(leadId, c.slug, c.product_id, c.title, c.price, l.stage, staff && staff.name || 'staff', t, t).lastInsertRowid;
  C.refreshPayment(leadId);
  if (staff && staff.id) C.addNote(leadId, staff, `（${via === 'drag' ? '拖放' : '選擇'}）要求移去「已售出課程」→ 已建立 Stripe 測試模式待付款訂單 #${id}（${c.title}，HK$${c.price.toLocaleString('en-US')}）。階段保持不變，等 Stripe 測試付款確認。`);
  return byId(id);
}
function setCourse(tpId, slug) {
  const tp = byId(tpId); if (!tp || tp.status !== '待付款' || tp.session_id) return false;
  const c = readyCourses().find(x => x.slug === slug); if (!c) return false;
  D.get().prepare('UPDATE test_payments SET course_slug = ?, product_id = ?, course_title = ?, amount_hkd = ?, updated_at = ? WHERE id = ?').run(c.slug, c.product_id, c.title, c.price, D.now(), tp.id);
  return true;
}
function cancel(tpId, staff) {
  const tp = byId(tpId); if (!tp || tp.status !== '待付款') return false;
  D.get().prepare("UPDATE test_payments SET status = '已取消', updated_at = ? WHERE id = ?").run(D.now(), tp.id);
  C.refreshPayment(tp.lead_id); if (staff) C.addNote(tp.lead_id, staff, `已取消 Stripe 測試模式待付款訂單 #${tp.id}。`);
  return true;
}
async function createCheckout(tpId, baseUrl) {
  const tp = byId(tpId); if (!tp || tp.status !== '待付款') throw Object.assign(new Error('呢張測試訂單唔係待付款狀態。'), { user: true });
  if (tp.session_id && tp.checkout_url) return tp;
  const ks = keyState(); if (!ks.ok) throw Object.assign(new Error(ks.msg), { user: true });
  const c = readyCourses().find(x => x.slug === tp.course_slug); if (!c) throw Object.assign(new Error('呢個課程暫時唔可以購買（launchReady:false 或者已移除）。'), { user: true });
  const l = D.get().prepare('SELECT * FROM leads WHERE id = ?').get(tp.lead_id);
  const price = SC.priceId(tp.product_id);
  const meta = { lead_id: String(tp.lead_id), order_id: String(tp.id), course_slug: tp.course_slug, purpose: 'mikeng-test-order' };
  const s = await client().checkout.sessions.create({
    mode: 'payment', currency: 'hkd', client_reference_id: `lead_${tp.lead_id}_order_${tp.id}`, metadata: meta, payment_intent_data: { metadata: meta },
    line_items: [price ? { price, quantity: 1 } : { quantity: 1, price_data: { currency: 'hkd', unit_amount: tp.amount_hkd * 100, product_data: { name: `現場上堂課程｜${c.title}` } } }],
    ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(l.email) ? { customer_email: l.email } : {}),
    success_url: `${baseUrl}/pay/test-return?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${baseUrl}/pay/test-return?cancelled=1`,
  }, { idempotencyKey: `mk-test-order-${tp.id}-${tp.course_slug}` });
  if (s.livemode) throw new Error('Stripe returned a livemode session — refused.');
  D.get().prepare('UPDATE test_payments SET session_id = ?, checkout_url = ?, price_id = ?, updated_at = ? WHERE id = ?').run(s.id, s.url, price, D.now(), tp.id);
  return byId(tp.id);
}

// ---- webhook ----
function log(msg) { console.log('[stripe-test] ' + msg); }
async function handle(ev) {
  const typ = ev.type, obj = ev.data && ev.data.object || {};
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(typ)) return 'ignored_type';
  let s = obj; const api = client();
  if (api) { s = await api.checkout.sessions.retrieve(obj.id); if (s.livemode !== false) return 'ignored_livemode_session'; } // re-fetch: trust Stripe's copy, not the event body
  const tp = D.get().prepare('SELECT * FROM test_payments WHERE session_id = ?').get(String(s.id || ''));
  if (!tp) return 'unknown_session';
  if (s.metadata && s.metadata.order_id && String(s.metadata.order_id) !== String(tp.id)) return 'metadata_mismatch';
  const t = D.now();
  if (typ === 'checkout.session.expired') {
    if (tp.status !== '待付款') return 'noop_' + tp.status;
    D.get().prepare("UPDATE test_payments SET status = '過期', updated_at = ? WHERE id = ?").run(t, tp.id); C.refreshPayment(tp.lead_id); return 'expired';
  }
  if (typ === 'checkout.session.async_payment_failed') {
    if (tp.status === '已付款') return 'noop_paid';
    D.get().prepare("UPDATE test_payments SET status = '失敗', updated_at = ? WHERE id = ?").run(t, tp.id); C.refreshPayment(tp.lead_id); return 'failed';
  }
  if (s.payment_status !== 'paid') return 'unpaid_no_change';
  if (tp.status === '已付款') return 'already_paid';
  if (String(s.currency).toLowerCase() !== 'hkd' || s.amount_total !== tp.amount_hkd * 100) {
    D.get().prepare('UPDATE test_payments SET note = ?, updated_at = ? WHERE id = ?').run(`金額／貨幣唔夾：${s.amount_total} ${s.currency}`, t, tp.id); return 'amount_mismatch';
  }
  const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent && s.payment_intent.id || null;
  D.get().transaction(() => {
    D.get().prepare("UPDATE test_payments SET status = '已付款', paid_amount = ?, paid_currency = ?, payment_intent = ?, paid_at = ?, updated_at = ? WHERE id = ?").run(s.amount_total, String(s.currency).toLowerCase(), pi, t, t, tp.id);
    C.moveStage(tp.lead_id, 'sold', { byName: ACTOR, via: 'stripe-test' });
    C.refreshPayment(tp.lead_id);
  })();
  return 'paid_moved';
}
async function webhook(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!secret) { log('webhook rejected: STRIPE_WEBHOOK_SECRET not set'); return res.status(400).json({ error: 'webhook secret not configured' }); }
  let ev;
  try { ev = verifier.webhooks.constructEvent(req.body, req.get('stripe-signature') || '', secret); }
  catch (e) { log('webhook rejected: bad signature'); return res.status(400).json({ error: 'invalid signature' }); }
  const sid = ev.data && ev.data.object && ev.data.object.id || null, db = D.get();
  if (ev.livemode !== false) {
    db.prepare("INSERT OR IGNORE INTO stripe_events (event_id, type, session_id, livemode, result, at) VALUES (?, ?, ?, 1, 'ignored_livemode', ?)").run(String(ev.id), String(ev.type), sid, D.now());
    log(`IGNORED livemode=true event ${ev.id} (${ev.type}) — this backend only accepts Stripe TEST mode`); return res.json({ received: true, ignored: 'livemode' });
  }
  if (!db.prepare("INSERT OR IGNORE INTO stripe_events (event_id, type, session_id, livemode, result, at) VALUES (?, ?, ?, 0, 'processing', ?)").run(String(ev.id), String(ev.type), sid, D.now()).changes) {
    return res.json({ received: true, duplicate: true });
  }
  try {
    const result = await handle(ev);
    db.prepare('UPDATE stripe_events SET result = ? WHERE event_id = ?').run(result, String(ev.id));
    log(`event ${ev.id} ${ev.type} -> ${result}`); res.json({ received: true, result });
  } catch (e) {
    db.prepare('DELETE FROM stripe_events WHERE event_id = ?').run(String(ev.id)); // let Stripe retry
    log(`event ${ev.id} failed: ${e.message}`); res.status(500).json({ error: 'processing failed' });
  }
}

function stats() {
  const db = D.get(), by = Object.fromEntries(D.TP_STATUS.map(s => [s, { n: 0, hkd: 0 }]));
  for (const r of db.prepare('SELECT status, COUNT(*) n, COALESCE(SUM(CASE WHEN status = \'已付款\' THEN paid_amount / 100 ELSE amount_hkd END), 0) hkd FROM test_payments GROUP BY status').all()) by[r.status] = { n: r.n, hkd: r.hkd };
  const recent = db.prepare('SELECT t.*, l.name lname, l.is_demo FROM test_payments t JOIN leads l ON l.id = t.lead_id ORDER BY t.updated_at DESC LIMIT 8').all();
  return { by, total: Object.values(by).reduce((a, b) => a + b.n, 0), recent };
}

module.exports = { ACTOR, LABEL, DASH_LABEL, assertNotLive, keyState, client, readyCourses, byId, pendingFor, forLead, pendingLeadIds, beginSold, setCourse, cancel, createCheckout, webhook, handle, stats };
