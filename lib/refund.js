// Refund deadline per tech-plan §3.7/§3.8. Payment day = working day 1 (if it is a working day);
// payment on Sat/Sun/HK public holiday -> next working day is day 1. Deadline = end (23:59) of working day 3, Asia/Hong_Kong.
const data = require('../data/hk-holidays.json');
const HOL = new Set(data.holidays.map(h => h.date));
const YEARS = new Set(data.years);
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function hkDate(instant = new Date()) { // YYYY-MM-DD in Asia/Hong_Kong
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}
const addDay = (ymd, n = 1) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = ymd => new Date(ymd + 'T00:00:00Z').getUTCDay();
function isWorkingDay(ymd) {
  if (!YEARS.has(+ymd.slice(0, 4))) throw new Error(`hk-holidays.json has no data for ${ymd.slice(0, 4)}`);
  const w = dow(ymd); return w !== 0 && w !== 6 && !HOL.has(ymd);
}
function refundDeadline(paidAt = new Date()) {
  let d = hkDate(paidAt), count = 0;
  for (let guard = 0; guard < 40; guard++, d = addDay(d)) { if (isWorkingDay(d) && ++count === 3) break; }
  return { date: d, weekday: WEEK[dow(d)], label: `${d}（星期${WEEK[dow(d)]}）23:59 香港時間`, iso: `${d}T23:59:59+08:00` };
}
module.exports = { refundDeadline, isWorkingDay, hkDate };
