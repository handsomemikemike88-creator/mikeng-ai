// SAMPLE DATA ONLY. Clearly fake leads (示範客戶NN, demoNN@example.com, phones 5555xxxx), all flagged is_demo=1.
// Orders use ONLY the existing price list (products table, copied from data/products.json). wipe() removes all of it.
const D = require('../db');
const Sx = require('./security');
const C = require('./crm');
const R = require('./reminders');
// Demo customer login (for screenshots) is created ONLY when DEMO_CUSTOMER_PASSWORD is set (no default in code),
// and demo data is never seeded when NODE_ENV=production or SITE_INDEXABLE=1.
const blocked = () => process.env.NODE_ENV === 'production' || process.env.SITE_INDEXABLE === '1';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const iso = ms => new Date(ms).toISOString();

function wipe() {
  const db = D.get();
  return db.transaction(() => {
    const n = db.prepare('SELECT COUNT(*) n FROM leads WHERE is_demo = 1').get().n;
    for (const t of ['reminders', 'notes', 'stage_history', 'orders', 'bookings']) db.prepare(`DELETE FROM ${t} WHERE is_demo = 1`).run();
    db.prepare('DELETE FROM leads WHERE is_demo = 1').run();
    db.prepare("DELETE FROM sessions WHERE area = 'account' AND user_id IN (SELECT id FROM customers WHERE is_demo = 1)").run();
    db.prepare('DELETE FROM customers WHERE is_demo = 1').run();
    db.prepare("DELETE FROM seminars WHERE is_demo = 1 AND id NOT IN (SELECT seminar_id FROM bookings)").run();
    db.prepare('DELETE FROM courses WHERE is_demo = 1').run();
    return n;
  })();
}

function seed({ count = 36 } = {}) {
  if (blocked()) throw new Error('示範數據唔可以喺正式環境建立（NODE_ENV=production 或 SITE_INDEXABLE=1）。');
  const demoPw = process.env.DEMO_CUSTOMER_PASSWORD;
  if (demoPw && Sx.pwProblem(demoPw)) throw new Error('DEMO_CUSTOMER_PASSWORD 最少 10 個字元。');
  wipe();
  const db = D.get(), r = rng(20261203), now = Date.now(), pick = a => a[Math.floor(r() * a.length)];
  const prod = Object.fromEntries(db.prepare('SELECT * FROM products').all().map(p => [p.id, p]));
  const course = id => db.prepare('SELECT id FROM courses WHERE product_id = ?').get(id);
  // past demo seminars (never public: is_demo=1) so attendance can be shown
  const pastDates = []; { const d = new Date(now); for (let i = 1; pastDates.length < 6 && i < 120; i++) { const x = new Date(d.getTime() - i * 864e5); const ymd = x.toISOString().slice(0, 10); if (x.getUTCDay() === 4 && x.getUTCDate() <= 21 && ((x.getUTCDate() <= 7) || (x.getUTCDate() >= 15))) pastDates.unshift(ymd); } }
  const insSem = db.prepare(`INSERT OR IGNORE INTO seminars (id, date, start_time, end_time, title, platform, zoom_url, language, capacity, is_free, replay_days, status, source, is_demo, created_at, updated_at)
    VALUES (?, ?, '19:00', '21:00', '【示範】免費 AI 講座', 'Zoom 網上直播', '', '廣東話為主、夾雜英文', 100, 1, 2, 'confirmed', 'demo', 1, ?, ?)`);
  const pastIds = pastDates.map(d => { const id = `demo-${d}`; insSem.run(id, d, iso(now - 100 * 864e5), iso(now - 100 * 864e5)); return id; });
  const future = require('./seminars').upcoming().slice(0, 2).map(s => s.id);
  const t = db.transaction(() => {
    for (let i = 1; i <= count; i++) {
      const nn = String(i).padStart(2, '0');
      const past = i <= 26, semId = past ? pastIds[(i - 1) % pastIds.length] : future[i % future.length];
      const semRow = semId && db.prepare('SELECT date FROM seminars WHERE id = ?').get(semId);
      const created = semRow ? new Date(semRow.date + 'T12:00:00+08:00').getTime() - Math.floor(2 + r() * 20) * 864e5 : now - 5 * 864e5;
      const svc = pick(['seminar', 'seminar', 'online-video', 'online-video', 'online-1on1', 'in-person']);
      const marketing = r() < 0.55;
      const l = C.upsertLead({ email: `demo${nn}@example.com`, name: `示範客戶${nn}`, phone: '+852' + '5555' + String(1000 + i * 37).slice(-4), service: svc, source: pick(['/seminar', '/seminar', 'Instagram', 'YouTube', 'enquiry']), marketing, is_demo: 1, at: iso(created) });
      if (i % 9 === 0) R.optOut(l.id, '示範');
      let stage = 'new';
      if (semId) {
        const b = C.createBooking(l.id, semId, { source: '/seminar', at: iso(created), isDemo: 1 });
        db.prepare('UPDATE reminders SET is_demo = 1 WHERE booking_id = ?').run(b.id);
        if (past) {
          db.prepare("UPDATE reminders SET status = CASE WHEN status = '已略過' THEN status ELSE '已手動發送' END, updated_by = '示範員工', updated_at = ? WHERE booking_id = ?").run(iso(created + 864e5), b.id);
          const att = r() < 0.62 ? '已出席' : '缺席';
          db.prepare('UPDATE bookings SET attendance = ? WHERE id = ?').run(att, b.id);
          stage = att === '已出席' ? 'attended' : (r() < 0.5 ? 'lost' : 'reminded');
          db.prepare('UPDATE leads SET reminder_status = ? WHERE id = ?').run('已手動發送：WhatsApp 3／3：開始前 1 小時（附加入連結）', l.id);
        } else stage = r() < 0.5 ? 'confirmed' : 'new';
      }
      // orders (existing price list only)
      if (past && stage === 'attended' && r() < 0.75) {
        const ips = Object.keys(prod).filter(k => k.startsWith('ip-') && db.prepare('SELECT 1 FROM courses WHERE product_id = ?').get(k));
        const pid = pick(['online-video', 'online-video', 'online-1on1', ...(ips.length ? [pick(ips)] : [])]), p = prod[pid];
        if (p) {
          const paid = r() < 0.8, at = created + Math.floor(8 + r() * 30) * 864e5, c = course(pid);
          const st = paid ? (r() < 0.08 ? '已退款' : '已付款') : (r() < 0.3 ? '退款處理中' : '未付款');
          db.prepare(`INSERT INTO orders (lead_id, product_id, course_id, price_hkd, payment_status, paid_at, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
            .run(l.id, pid, c ? c.id : null, p.price, st, paid || st === '退款處理中' ? iso(Math.min(at, now)) : null, iso(Math.min(at, now)), iso(Math.min(at, now)));
          C.refreshPayment(l.id);
          stage = st === '已付款' && c ? 'sold' : 'consult';
        }
      } else if (past && stage === 'attended' && r() < 0.6) stage = 'consult';
      // walk the stage history forward so the history looks real
      const path = ['new', 'reminded', 'confirmed', 'attended', 'consult', 'sold'];
      const target = stage === 'lost' ? ['new', 'reminded', 'lost'] : path.slice(0, path.indexOf(stage) + 1);
      let tt = created;
      for (const s of target.slice(1)) { tt += Math.floor(1 + r() * 4) * 864e5; C.moveStage(l.id, s, { byName: s === 'attended' ? 'system' : '示範員工', via: r() < 0.5 ? 'drag' : 'select' }); db.prepare('UPDATE stage_history SET at = ?, is_demo = 1 WHERE id = (SELECT MAX(id) FROM stage_history WHERE lead_id = ?)').run(iso(Math.min(tt, now)), l.id); }
      db.prepare('UPDATE stage_history SET is_demo = 1 WHERE lead_id = ?').run(l.id);
      const noteBodies = ['WhatsApp 問咗網上視頻課程有冇字幕，已答覆。', '講座後想了解 1 對 1，約咗下星期再傾。', '表示暫時未有時間，下季再跟進。', '想問現場班場地，等 Mikey 確認後回覆。'];
      if (i % 3 === 0) db.prepare('INSERT INTO notes (lead_id, author_name, body, created_at, is_demo) VALUES (?, ?, ?, ?, 1)').run(l.id, pick(['示範員工 Amy', '示範員工 Ben']), pick(noteBodies), iso(Math.min(created + 3 * 864e5, now)));
      db.prepare('UPDATE leads SET created_at = ?, updated_at = ? WHERE id = ?').run(iso(created), iso(Math.min(tt, now)), l.id);
    }
    // a demo customer login linked to demo01 (only if DEMO_CUSTOMER_PASSWORD is set)
    const l1 = db.prepare('SELECT id FROM leads WHERE email = ?').get('demo01@example.com');
    if (demoPw) {
      db.prepare('INSERT OR IGNORE INTO customers (email, name, phone, password_hash, created_at, email_verified_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, 1)').run('demo01@example.com', '示範客戶01', '+85255551037', Sx.hash(demoPw), iso(now), iso(now));
      const cu = db.prepare('SELECT id FROM customers WHERE email = ?').get('demo01@example.com');
      db.prepare('UPDATE leads SET customer_id = ? WHERE email = ?').run(cu.id, 'demo01@example.com');
    }
    const cv = course('online-video');
    if (cv && !db.prepare("SELECT 1 FROM orders WHERE lead_id = ? AND product_id = 'online-video' AND payment_status = '已付款'").get(l1.id))
      db.prepare(`INSERT INTO orders (lead_id, product_id, course_id, price_hkd, payment_status, paid_at, is_demo, created_at, updated_at) VALUES (?, 'online-video', ?, ?, '已付款', ?, 1, ?, ?)`).run(l1.id, cv.id, prod['online-video'].price, iso(now - 20 * 864e5), iso(now - 20 * 864e5), iso(now - 20 * 864e5));
    if (future[0]) { const b = C.createBooking(l1.id, future[0], { source: '/account', isDemo: 1 }); db.prepare('UPDATE reminders SET is_demo = 1 WHERE booking_id = ?').run(b.id); }
    C.refreshPayment(l1.id);
  });
  t();
  return { leads: db.prepare('SELECT COUNT(*) n FROM leads WHERE is_demo = 1').get().n, customerLogin: demoPw ? 'demo01@example.com（密碼：DEMO_CUSTOMER_PASSWORD）' : null };
}
module.exports = { seed, wipe, blocked };
