// Reminder drafts: copy text, open wa.me / mailto, mark 已複製 / 已手動發送 / 已略過. Nothing is ever sent by the system.
const D = require('../db');
const Sx = require('../backend/security');
const C = require('../backend/crm');
const R = require('../backend/reminders');
const { page, select, fmt, esc, remChip, demoTag } = require('./views');
const clean = s => String(s ?? '').trim();

function list(req) {
  const q = { seminar: clean(req.query.seminar), channel: clean(req.query.channel), status: clean(req.query.status), lead: clean(req.query.lead), due: clean(req.query.due) };
  const w = [], a = [];
  if (q.seminar) { w.push('b.seminar_id = ?'); a.push(q.seminar); }
  if (['whatsapp', 'email'].includes(q.channel)) { w.push('r.channel = ?'); a.push(q.channel); }
  if (D.REMINDER_STATUS.includes(q.status)) { w.push('r.status = ?'); a.push(q.status); }
  if (/^\d+$/.test(q.lead)) { w.push('r.lead_id = ?'); a.push(+q.lead); }
  if (q.due === 'due') { w.push("r.scheduled_at <= ? AND r.status IN ('草稿','已複製')"); a.push(new Date(Date.now() + 864e5).toISOString()); }
  const rows = D.get().prepare(`SELECT r.*, l.name, l.is_demo ldemo, l.whatsapp_opt_out_at, b.seminar_id FROM reminders r JOIN leads l ON l.id = r.lead_id JOIN bookings b ON b.id = r.booking_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY r.scheduled_at, r.channel DESC, l.name LIMIT 300`).all(...a);
  const sems = D.get().prepare('SELECT DISTINCT s.id, s.date, s.start_time, s.is_demo FROM seminars s JOIN bookings b ON b.seminar_id = s.id ORDER BY s.date DESC').all();
  const f = Sx.csrfField(req);
  const card = r => `<article class="draft" id="d${r.id}"><div class="meta">${remChip(r.status)}<strong>${esc(r.label)}</strong><span class="muted">→ ${esc(r.name)} ${demoTag({ is_demo: r.ldemo })} · ${esc(r.to_addr)} · 預定 ${fmt(r.scheduled_at)}（香港時間）</span>${r.is_marketing ? '<span class="chip demo">推廣（已同意）</span>' : ''}</div>
${r.skip_reason ? `<p class="small muted">略過原因：${esc(r.skip_reason)}</p>` : ''}${r.subject ? `<p class="small"><strong>主旨：</strong>${esc(r.subject)}</p>` : ''}<pre id="t${r.id}">${esc(r.body)}</pre>
<div class="acts"><button class="btn sm" type="button" data-copy="t${r.id}" data-mark="/admin/reminders/${r.id}/status">複製內容</button>
${r.status !== '已略過' ? (r.channel === 'whatsapp' ? `<a class="btn ghost sm" href="${esc(R.waLink(r))}" target="_blank" rel="noopener">開 WhatsApp（wa.me 預填）</a>` : `<a class="btn ghost sm" href="${esc(R.mailto(r))}">開電郵（mailto）</a>`) : ''}
<form method="post" action="/admin/reminders/${r.id}/status" class="inline">${f}<input type="hidden" name="back" value="${esc(req.originalUrl)}">${select('status', '狀態', D.REMINDER_STATUS.filter(s => !(r.channel === 'whatsapp' && r.whatsapp_opt_out_at && s !== '已略過')).map(s => [s, s]), r.status)}<button class="btn sm" type="submit">更新狀態</button></form>
<span class="small muted">${r.updated_by ? `${esc(r.updated_by)} · ${fmt(r.updated_at)}` : ''}</span></div></article>`;
  const waCount = rows.filter(r => r.channel === 'whatsapp').length;
  return page({ title: '提醒草稿', active: 'reminders', user: req.user, req, body: `
<div class="head"><div><p class="kicker">REMINDER DRAFTS</p><h1>提醒草稿</h1><p class="small muted">系統只會自動整草稿，<strong>唔會自動發送</strong>。每個報名最多 3 個 WhatsApp（報名確認、前一日、開始前 1 小時附加入連結）；當日早上同重溫連結只經電郵。客戶回覆「停止」後 WhatsApp 草稿會自動略過。</p></div></div>
<form class="filters" method="get" action="/admin/reminders">${select('seminar', '場次', [['', '全部'], ...sems.map(s => [s.id, `${s.date} ${s.start_time}${s.is_demo ? '（示範）' : ''}`])], q.seminar)}
${select('channel', '渠道', [['', '全部'], ['whatsapp', 'WhatsApp'], ['email', '電郵']], q.channel)}${select('status', '狀態', [['', '全部'], ...D.REMINDER_STATUS.map(s => [s, s])], q.status)}
${select('due', '時間', [['', '全部'], ['due', '24 小時內要處理']], q.due)}${q.lead ? `<input type="hidden" name="lead" value="${esc(q.lead)}">` : ''}<button class="btn sm" type="submit">篩選</button><a class="small" href="/admin/reminders">清除</a></form>
<p class="small muted">${rows.length} 個草稿（WhatsApp ${waCount}，電郵 ${rows.length - waCount}）</p>${rows.map(card).join('') || '<p>未有草稿。</p>'}` });
}
function routes(r) {
  r.get('/admin/reminders', (req, res) => res.type('html').send(list(req)));
  r.post('/admin/reminders/:id/status', (req, res) => {
    const json = req.is('application/json');
    try { C.markReminder(+req.params.id, clean(req.body.status), req.user.name); }
    catch (e) { const m = e.message === 'opted out' ? '客戶已回覆「停止」，唔可以再發 WhatsApp。' : '狀態唔啱。'; return json ? res.status(400).json({ ok: false, error: m }) : res.status(400).type('html').send(page({ title: '錯誤', user: req.user, req, body: `<h1>${m}</h1><p><a href="/admin/reminders">返回</a></p>` })); }
    if (json) return res.json({ ok: true });
    const back = String(req.body.back || ''); res.redirect(303, (/^\/admin\/reminders[\w/?=&.%-]*$/.test(back) ? back : '/admin/reminders') + '#d' + (+req.params.id));
  });
}
module.exports = { routes };
