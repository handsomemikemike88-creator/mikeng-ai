// Seminar calendar (month view + list), create / edit / cancel, attendee list, attendance marking and rate.
// New/edited seminars appear on the public /seminar page and booking form immediately (lib/backend/seminars.js).
const D = require('../db');
const Sx = require('../backend/security');
const SEM = require('../backend/seminars');
const C = require('../backend/crm');
const { page, field, select, fmt, esc, demoTag, remChip } = require('./views');
const clean = s => String(s ?? '').trim();
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const STATUS = { confirmed: '已確認', cancelled: '已取消', 'skipped-holiday': '公眾假期暫停' };
const rate = (att, n) => n ? Math.round(att / n * 100) + '%' : '—';
const counts = id => D.get().prepare("SELECT COUNT(*) n, SUM(attendance = '已出席') att, SUM(attendance = '缺席') abs FROM bookings WHERE seminar_id = ? AND status = 'booked'").get(id);

function validate(b, existing = {}) {
  const v = { date: clean(b.date), start_time: clean(b.start_time), end_time: clean(b.end_time), title: clean(b.title) || '免費 AI 講座（SEMINAR 免費上堂體驗）',
    platform: clean(b.platform) || 'Zoom 網上直播', zoom_url: clean(b.zoom_url), language: clean(b.language) || SEM.LANG, capacity: clean(b.capacity), is_free: b.is_free === '1' ? 1 : 0, replay_days: clean(b.replay_days) || '2' }, e = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || isNaN(new Date(v.date))) e.date = '請揀日期。';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.start_time)) e.start_time = '開始時間格式 HH:MM。';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.end_time) || v.end_time <= v.start_time) e.end_time = '結束時間要遲過開始時間。';
  if (v.zoom_url && !/^https:\/\/([\w-]+\.)*zoom\.us\/[\w\-/?=&%.#]+$/i.test(v.zoom_url) && !/^https:\/\/meet\.google\.com\/[\w-]+$/i.test(v.zoom_url)) e.zoom_url = '請貼上 https://…zoom.us/… 或 Google Meet 連結。';
  if (v.capacity && (!/^\d{1,5}$/.test(v.capacity) || +v.capacity < 1)) e.capacity = '名額要係正整數（留空＝唔設上限）。';
  if (!/^\d{1,2}$/.test(v.replay_days)) e.replay_days = '重溫日數要係數字。';
  for (const k of ['title', 'platform', 'language']) if (v[k].length > 120) e[k] = '太長（最多 120 字）。';
  if (!existing.id && !e.date && v.date < SEM.hkToday()) e.date = '新講座日期唔可以係過去。';
  v.capacity = v.capacity ? +v.capacity : null; v.replay_days = +v.replay_days;
  return { v, e };
}
function form(req, { v = {}, e = {}, id = null } = {}) {
  const err = k => e[k] ? `<p class="err">${esc(e[k])}</p>` : '';
  return `<form method="post" action="${id ? `/admin/seminars/${encodeURIComponent(id)}` : '/admin/seminars'}" class="panel">${Sx.csrfField(req)}
${Object.keys(e).length ? '<div class="errbox" role="alert">請修正以下項目。</div>' : ''}<div class="grid2">
<div>${field('date', '日期', v.date, { type: 'date', req: true })}${err('date')}</div><div class="grid2" style="grid-template-columns:1fr 1fr;gap:10px"><div>${field('start_time', '開始（香港時間）', v.start_time || '19:00', { type: 'time', req: true })}${err('start_time')}</div><div>${field('end_time', '結束（香港時間）', v.end_time || '21:00', { type: 'time', req: true })}${err('end_time')}</div></div>
<div>${field('title', '標題', v.title || '免費 AI 講座（SEMINAR 免費上堂體驗）', { attrs: 'maxlength="120"' })}${err('title')}</div><div>${field('platform', '平台', v.platform || 'Zoom 網上直播', { attrs: 'maxlength="120"' })}${err('platform')}</div>
<div>${field('zoom_url', 'Zoom 連結（唔會喺公開頁顯示；經個人加入連結發送）', v.zoom_url || '', { type: 'url', attrs: 'maxlength="300" placeholder="https://us02web.zoom.us/j/…"' })}${err('zoom_url')}</div><div>${field('language', '語言', v.language || SEM.LANG, { attrs: 'maxlength="120"' })}${err('language')}</div>
<div>${field('capacity', '名額（留空＝唔設上限；只顯示真實上限）', v.capacity ?? '', { type: 'number', attrs: 'min="1" max="10000"' })}${err('capacity')}</div><div>${field('replay_days', '重溫日數', v.replay_days ?? 2, { type: 'number', attrs: 'min="0" max="30"' })}${err('replay_days')}</div>
<div class="f"><label class="check"><input type="checkbox" name="is_free" value="1"${v.is_free === 0 ? '' : ' checked'}><span>免費講座（顯示「免費」標記）</span></label></div></div>
<button class="btn" type="submit">${id ? '儲存修改' : '新增講座'}</button> <span class="small muted">儲存後即時喺公開 /seminar 頁同報名表出現。</span></form>`;
}
function calendar(req) {
  const m = /^\d{4}-\d{2}$/.test(req.query.m || '') ? req.query.m : SEM.hkToday().slice(0, 7);
  const [y, mo] = m.split('-').map(Number), first = new Date(Date.UTC(y, mo - 1, 1)), days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  SEM.ensureRule(`${y + 1}-12-31`);
  const rows = D.get().prepare('SELECT * FROM seminars WHERE date LIKE ? ORDER BY date, start_time').all(m + '-%');
  const by = {}; for (const r of rows) (by[r.date] = by[r.date] || []).push(r);
  const prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7), today = SEM.hkToday();
  const cells = []; for (let i = 0; i < first.getUTCDay(); i++) cells.push('<div class="day out" aria-hidden="true"></div>');
  for (let d = 1; d <= days; d++) { const ds = `${m}-${String(d).padStart(2, '0')}`;
    cells.push(`<div class="day${ds === today ? ' today' : ''}"><b>${d}</b>${(by[ds] || []).map(r => { const c = counts(r.id); return `<a class="ev ${r.status}${r.is_demo ? ' demo' : ''}" href="/admin/seminars/${encodeURIComponent(r.id)}">${esc(r.start_time)} ${r.is_demo ? '示範 ' : ''}${STATUS[r.status] === '已確認' ? '' : STATUS[r.status] + ' '}· ${c.n}${r.capacity ? '/' + r.capacity : ''} 人</a>`; }).join('')}</div>`); }
  const list = D.get().prepare('SELECT * FROM seminars WHERE date >= ? OR id IN (SELECT seminar_id FROM bookings) ORDER BY date DESC LIMIT 60').all(SEM.addDays(today, -120)).filter(r => r.date <= SEM.addDays(today, 200));
  return page({ title: '講座日曆', active: 'seminars', user: req.user, req, flash: req.query.ok ? '已儲存，公開頁已即時更新。' : '', body: `
<div class="head"><div><p class="kicker">SEMINARS</p><h1>講座日曆</h1></div><a class="btn" href="/admin/seminars/new">＋ 新增講座</a></div>
<section class="panel"><div class="head" style="margin-bottom:10px"><h2 class="h3">${y} 年 ${mo} 月</h2><div class="seg"><a href="/admin/seminars?m=${prev}">← 上月</a><a href="/admin/seminars">今個月</a><a href="/admin/seminars?m=${next}">下月 →</a></div></div>
<div class="cal" role="grid">${WEEK.map(w => `<div class="dow">星期${w}</div>`).join('')}${cells.join('')}</div></section>
<section class="panel"><h2 class="h3">場次列表</h2><div class="tablewrap"><table class="tbl"><thead><tr><th>日期</th><th>時間（香港）</th><th>平台／語言</th><th>狀態</th><th>報名</th><th>出席率</th><th>來源</th></tr></thead><tbody>
${list.map(r => { const c = counts(r.id); return `<tr><td><a href="/admin/seminars/${encodeURIComponent(r.id)}">${esc(r.date)}</a> ${demoTag(r)}</td><td>${esc(r.start_time)}–${esc(r.end_time)}</td><td class="small">${esc(r.platform)}<br>${esc(r.language)}${r.is_free ? ' · 免費' : ''}</td><td>${STATUS[r.status]}${r.holiday ? '<br><span class="small muted">' + esc(r.holiday) + '</span>' : ''}</td><td>${c.n}${r.capacity ? ' / ' + r.capacity : ''}</td><td>${rate(c.att || 0, (c.att || 0) + (c.abs || 0))}</td><td class="small">${r.source === 'rule' ? '時間表規則' : r.source === 'demo' ? '示範' : '管理員新增'}</td></tr>`; }).join('')}</tbody></table></div></section>` });
}
function detail(req, r) {
  const f = Sx.csrfField(req), c = counts(r.id);
  const att = D.get().prepare(`SELECT b.*, l.name, l.email, l.phone, l.is_demo, l.whatsapp_opt_out_at, (SELECT COUNT(*) FROM reminders x WHERE x.booking_id = b.id AND x.status = '已手動發送') sent FROM bookings b JOIN leads l ON l.id = b.lead_id WHERE b.seminar_id = ? ORDER BY b.status, l.name`).all(r.id);
  const s = SEM.toSession(r), marked = (c.att || 0) + (c.abs || 0);
  return page({ title: '講座 ' + r.date, active: 'seminars', user: req.user, req, flash: req.query.ok ? '已儲存。' : '', body: `
<div class="head"><div><p class="kicker"><a href="/admin/seminars?m=${r.date.slice(0, 7)}">講座日曆</a> › ${esc(r.id)}</p><h1>${esc(s.dateLabel)} ${demoTag(r)}</h1><p class="muted">${esc(s.timeLabel)}｜${esc(r.platform)}｜${esc(r.language)}｜${STATUS[r.status]}</p></div>
<div class="row">${r.status === 'confirmed' ? `<form method="post" action="/admin/seminars/${encodeURIComponent(r.id)}/cancel">${f}<button class="btn danger sm" type="submit">取消呢場講座</button></form>` : `<form method="post" action="/admin/seminars/${encodeURIComponent(r.id)}/restore">${f}<button class="btn ghost sm" type="submit">恢復場次</button></form>`}<a class="btn ghost sm" href="/admin/reminders?seminar=${encodeURIComponent(r.id)}">提醒草稿</a></div></div>
<section class="kpis"><div class="kpi"><span>報名人數</span><strong>${c.n}${r.capacity ? ' / ' + r.capacity : ''}</strong></div><div class="kpi"><span>已出席</span><strong>${c.att || 0}</strong></div><div class="kpi"><span>缺席</span><strong>${c.abs || 0}</strong></div><div class="kpi"><span>出席率（已標記）</span><strong>${rate(c.att || 0, marked)}</strong><small>佔全部報名：${rate(c.att || 0, c.n)}</small></div></section>
<section class="panel"><h2 class="h3">出席名單</h2><div class="tablewrap"><table class="tbl"><thead><tr><th>名稱</th><th>電郵／電話</th><th>報名</th><th>已手動發送提醒</th><th>出席</th></tr></thead><tbody>
${att.map(a => `<tr><td><a href="/admin/leads/${a.lead_id}">${esc(a.name)}</a> ${demoTag(a)}</td><td class="small">${esc(a.email)}<br>${esc(a.phone || '—')}${a.whatsapp_opt_out_at ? ' · WhatsApp 已退出' : ''}</td><td class="small">${a.status === 'booked' ? '已報名' : '已取消'} · ${fmt(a.created_at)}</td><td>${a.sent}</td>
<td>${a.status === 'booked' ? `<form method="post" action="/admin/bookings/${a.id}/attendance" class="inline">${f}<input type="hidden" name="back" value="/admin/seminars/${encodeURIComponent(r.id)}?ok=1">${select('attendance', '出席', D.ATTEND.map(x => [x, x]), a.attendance, 'data-autosubmit')}<noscript><button class="btn sm">更新</button></noscript></form>` : '—'}</td></tr>`).join('') || '<tr><td colspan="5">未有人報名。</td></tr>'}</tbody></table></div></section>
<h2 class="h3">修改場次</h2>${form(req, { v: r, id: r.id })}` });
}
function routes(rt) {
  rt.get('/admin/seminars', (req, res) => res.type('html').send(calendar(req)));
  rt.get('/admin/seminars/new', (req, res) => res.type('html').send(page({ title: '新增講座', active: 'seminars', user: req.user, req, body: `<div class="head"><div><p class="kicker"><a href="/admin/seminars">講座日曆</a></p><h1>新增講座</h1></div></div>${form(req)}` })));
  rt.post('/admin/seminars', (req, res) => {
    const { v, e } = validate(req.body);
    if (Object.keys(e).length) return res.status(400).type('html').send(page({ title: '新增講座', active: 'seminars', user: req.user, req, body: `<h1>新增講座</h1>${form(req, { v, e })}` }));
    const id = SEM.newId(v.date, v.start_time), t = D.now();
    D.get().prepare(`INSERT INTO seminars (id, date, start_time, end_time, title, platform, zoom_url, language, capacity, is_free, replay_days, status, source, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'admin', 0, ?, ?)`)
      .run(id, v.date, v.start_time, v.end_time, v.title, v.platform, v.zoom_url, v.language, v.capacity, v.is_free, v.replay_days, t, t);
    res.redirect(303, `/admin/seminars/${encodeURIComponent(id)}?ok=1`);
  });
  const get = (req, res) => { const r = D.get().prepare('SELECT * FROM seminars WHERE id = ?').get(req.params.id); if (!r) res.status(404).type('html').send(page({ title: '搵唔到', user: req.user, req, body: '<h1>搵唔到呢場講座</h1>' })); return r; };
  rt.get('/admin/seminars/:id', (req, res) => { const r = get(req, res); if (r) res.type('html').send(detail(req, r)); });
  rt.post('/admin/seminars/:id', (req, res) => {
    const r = get(req, res); if (!r) return;
    const { v, e } = validate(req.body, r);
    if (Object.keys(e).length) return res.status(400).type('html').send(page({ title: '修改講座', active: 'seminars', user: req.user, req, body: `<h1>修改講座</h1>${form(req, { v, e, id: r.id })}` }));
    D.get().prepare('UPDATE seminars SET date = ?, start_time = ?, end_time = ?, title = ?, platform = ?, zoom_url = ?, language = ?, capacity = ?, is_free = ?, replay_days = ?, updated_at = ? WHERE id = ?')
      .run(v.date, v.start_time, v.end_time, v.title, v.platform, v.zoom_url, v.language, v.capacity, v.is_free, v.replay_days, D.now(), r.id);
    if (v.date !== r.date || v.start_time !== r.start_time) { // timing changed: open drafts are re-generated
      const bs = D.get().prepare("SELECT id FROM bookings WHERE seminar_id = ? AND status = 'booked'").all(r.id);
      for (const b of bs) { D.get().prepare("DELETE FROM reminders WHERE booking_id = ? AND status IN ('草稿','已複製')").run(b.id); require('../backend/reminders').createFor(b.id); }
    }
    res.redirect(303, `/admin/seminars/${encodeURIComponent(r.id)}?ok=1`);
  });
  rt.post('/admin/seminars/:id/cancel', (req, res) => {
    const r = get(req, res); if (!r) return;
    D.get().prepare("UPDATE seminars SET status = 'cancelled', reason = ?, updated_at = ? WHERE id = ?").run('管理員取消：' + req.user.name, D.now(), r.id);
    for (const b of D.get().prepare("SELECT id FROM bookings WHERE seminar_id = ? AND status = 'booked'").all(r.id)) require('../backend/reminders').skipForBooking(b.id, '講座已取消（請另行通知報名者）', req.user.name);
    res.redirect(303, `/admin/seminars/${encodeURIComponent(r.id)}?ok=1`);
  });
  rt.post('/admin/seminars/:id/restore', (req, res) => {
    const r = get(req, res); if (!r) return;
    D.get().prepare("UPDATE seminars SET status = 'confirmed', reason = NULL, updated_at = ? WHERE id = ?").run(D.now(), r.id);
    D.get().prepare("UPDATE reminders SET status = '草稿', skip_reason = NULL WHERE skip_reason LIKE '講座已取消%' AND booking_id IN (SELECT id FROM bookings WHERE seminar_id = ?)").run(r.id);
    res.redirect(303, `/admin/seminars/${encodeURIComponent(r.id)}?ok=1`);
  });
}
module.exports = { routes };
