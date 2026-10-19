// Seminar timetable generator. Rule + overrides live in data/sessions.json.
// 1st/3rd Thursday each month 19:00–21:00 HKT from rule.start; HK public holidays skipped (flagged).
const cfg = require('../data/sessions.json');
const HOL = new Map(require('../data/hk-holidays.json').holidays.map(h => [h.date, h.name]));
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const LANG = '廣東話為主、夾雜英文';
const ymd = d => d.toISOString().slice(0, 10);
const hkToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(now);

function nthWeekdays(year, month, weekday, nths) { // month 0-based, UTC dates
  const out = []; const first = new Date(Date.UTC(year, month, 1));
  const off = (weekday - first.getUTCDay() + 7) % 7;
  for (const n of nths) { const d = new Date(Date.UTC(year, month, 1 + off + (n - 1) * 7)); if (d.getUTCMonth() === month) out.push(ymd(d)); }
  return out;
}
function build(date, ov = {}) {
  const r = cfg.rule, st = ov.startTime || r.startTime, et = ov.endTime || r.endTime;
  const [y, m, d] = date.split('-').map(Number), w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const start = `${date}T${st}:00+08:00`, end = `${date}T${et}:00+08:00`;
  const t0 = new Date(start).getTime();
  return { ...cfg.defaults, id: `${date}-zoom`, date, status: 'confirmed', start, end, language: LANG,
    dateLabel: `星期${WEEK[w]} ${y}年${m}月${d}日`, timeLabel: `${st}–${et}（香港時間）`,
    reminders: { 'D-1': new Date(t0 - 864e5).toISOString(), 'H-1': new Date(t0 - 36e5).toISOString() },
    joinOpensAt: new Date(t0 - 15 * 6e4).toISOString(), ...ov, id: `${date}-zoom` };
}
// All generated dates in [from, to] including skipped/cancelled (for admin / flags).
function generate(from, to) {
  const r = cfg.rule, ovs = new Map((cfg.overrides || []).map(o => [o.date, o])), out = [];
  const a = from < r.start ? r.start : from;
  let y = +a.slice(0, 4), m = +a.slice(5, 7) - 1;
  while (true) {
    for (const date of nthWeekdays(y, m, r.weekday, r.nths)) {
      if (date < a || date > to) continue;
      const ov = ovs.get(date) || {};
      if (HOL.has(date) && !ov.status) out.push({ ...build(date), status: 'skipped-holiday', holiday: HOL.get(date) });
      else out.push(build(date, ov));
    }
    if (++m > 11) { m = 0; y++; }
    if (`${y}-${String(m + 1).padStart(2, '0')}-01` > to) break;
  }
  return out;
}
const windowFor = (now = new Date()) => { const t = hkToday(now); const base = t < cfg.rule.start ? cfg.rule.start : t;
  const e = new Date(base + 'T00:00:00Z'); e.setUTCDate(e.getUTCDate() + cfg.rule.windowDays); return [t, ymd(e)]; };
// Public list: upcoming confirmed sessions in the next ~3 months (past ones hidden).
function upcoming(now = new Date()) { const [a, b] = windowFor(now); return generate(a, b).filter(s => s.status === 'confirmed' && new Date(s.start) > now) /* sign-up closes at start time (QA v4 m4) */; }
function flagged(now = new Date()) { const [a, b] = windowFor(now); return generate(a, b).filter(s => s.status !== 'confirmed'); }
// Find any session by id (any date, for .ics/thanks pages of past bookings).
function byId(id) { const m = /^(\d{4}-\d{2}-\d{2})-zoom$/.exec(id || ''); if (!m) return null; return generate(m[1], m[1])[0] || null; }
module.exports = { upcoming, flagged, byId, generate };
