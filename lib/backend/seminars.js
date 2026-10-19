// DB-backed seminar timetable. Seeds the `seminars` table from the data/sessions.json rule (lib/sessions.js generator),
// then serves the SAME session objects lib/pages.js expects (upcoming/flagged/byId), so admin-created seminars
// show on the public /seminar page and booking form immediately. Demo seminars (is_demo=1) are never public.
const D = require('../db');
const S = require('../sessions');
const cfg = require('../../data/sessions.json');
const ORIG = { upcoming: S.upcoming, flagged: S.flagged, byId: S.byId, generate: S.generate };
const LANG = '廣東話為主、夾雜英文';
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const hkToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(now);
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function windowFor(now = new Date()) { const t = hkToday(now); const base = t < cfg.rule.start ? cfg.rule.start : t; return [t, addDays(base, cfg.rule.windowDays)]; }

function duration(st, et) {
  const m = (+et.slice(0, 2) * 60 + +et.slice(3)) - (+st.slice(0, 2) * 60 + +st.slice(3));
  return m % 60 === 0 ? `${m / 60} 小時` : `${m} 分鐘`;
}
// Row -> session object (same shape as lib/sessions.js build()).
function toSession(r) {
  if (!r) return null;
  const [y, m, d] = r.date.split('-').map(Number), w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const start = `${r.date}T${r.start_time}:00+08:00`, end = `${r.date}T${r.end_time}:00+08:00`, t0 = new Date(start).getTime();
  const s = { ...cfg.defaults, id: r.id, date: r.date, status: r.status, start, end, language: r.language || LANG,
    title: r.title, platform: r.platform, zoomUrl: r.zoom_url || '', replayDays: r.replay_days, price: r.is_free ? 0 : cfg.defaults.price,
    duration: duration(r.start_time, r.end_time), dateLabel: `星期${WEEK[w]} ${y}年${m}月${d}日`, timeLabel: `${r.start_time}–${r.end_time}（香港時間）`,
    reminders: { 'D-1': new Date(t0 - 864e5).toISOString(), 'H-1': new Date(t0 - 36e5).toISOString() },
    joinOpensAt: new Date(t0 - 15 * 6e4).toISOString(), capacity: r.capacity, isFree: !!r.is_free, source: r.source, isDemo: !!r.is_demo };
  if (r.holiday) s.holiday = r.holiday; if (r.reason) s.reason = r.reason;
  return s;
}

const ins = () => D.get().prepare(`INSERT OR IGNORE INTO seminars (id, date, start_time, end_time, title, platform, zoom_url, language, capacity, is_free, replay_days, status, holiday, reason, source, is_demo, created_at, updated_at)
  VALUES (@id, @date, @start_time, @end_time, @title, @platform, @zoom_url, @language, @capacity, @is_free, @replay_days, @status, @holiday, @reason, @source, @is_demo, @at, @at)`);
// Copy rule-generated dates into the DB up to `to` (idempotent; existing rows, incl. admin edits, are kept).
function ensureRule(to) {
  const done = D.get().prepare("SELECT v FROM meta WHERE k = 'rule_seeded_to'").get();
  if (done && done.v >= to) return;
  const stmt = ins(), at = D.now();
  D.get().transaction(() => {
    for (const s of ORIG.generate(cfg.rule.start, to)) stmt.run({ id: s.id, date: s.date, start_time: s.start.slice(11, 16), end_time: s.end.slice(11, 16),
      title: s.title, platform: s.platform, zoom_url: s.zoomUrl || '', language: s.language || LANG, capacity: null, is_free: s.price === 0 ? 1 : 0,
      replay_days: s.replayDays, status: ['confirmed', 'cancelled', 'skipped-holiday'].includes(s.status) ? s.status : 'cancelled', holiday: s.holiday || null,
      reason: s.reason || null, source: 'rule', is_demo: 0, at });
    D.get().prepare("INSERT INTO meta (k, v) VALUES ('rule_seeded_to', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(to);
  })();
}
function publicRows(now = new Date()) {
  const [a, b] = windowFor(now); ensureRule(addDays(b, 400));
  // rule dates: same ~3-month window as before; admin-added dates: shown as soon as they are created (up to 1 year ahead)
  return D.get().prepare(`SELECT * FROM seminars WHERE is_demo = 0 AND date >= ? AND ((source = 'rule' AND date <= ?) OR (source = 'admin' AND date <= ?)) ORDER BY date, start_time`).all(a, b, addDays(a, 366));
}
function upcoming(now = new Date()) { return publicRows(now).filter(r => r.status === 'confirmed').map(toSession).filter(s => new Date(s.start) > now); } // sign-up closes at start time (Vincent's rule)
function flagged(now = new Date()) { return publicRows(now).filter(r => r.status !== 'confirmed').map(toSession); }
function byId(id) { const r = D.get().prepare('SELECT * FROM seminars WHERE id = ?').get(String(id || '')); return r ? toSession(r) : ORIG.byId(id); }

// Swap the generator for the DB versions. lib/pages.js and server.js call S.upcoming()/S.flagged()/S.byId() through
// the module object, so no change to those files is needed for this part.
let installed = false;
function install() { if (installed) return; installed = true; S.upcoming = upcoming; S.flagged = flagged; S.byId = byId; }

function bookedCount(id) { return D.get().prepare("SELECT COUNT(*) n FROM bookings WHERE seminar_id = ? AND status = 'booked'").get(id).n; }
function newId(date, st) { const base = `${date}-zoom`; return D.get().prepare('SELECT 1 FROM seminars WHERE id = ?').get(base) ? `${date}-${st.replace(':', '')}-zoom` : base; }
module.exports = { install, toSession, upcoming, flagged, byId, bookedCount, newId, ensureRule, windowFor, ORIG, LANG, addDays, hkToday };
