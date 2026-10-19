// Dashboard, leads (list / CSV / detail / notes) and the CRM pipeline (kanban + list).
const D = require('../db');
const C = require('../backend/crm');
const R = require('../backend/reminders');
const Sx = require('../backend/security');
const ST = require('../backend/stripe-test');
const { page, fmt, money, stageChip, payChip, remChip, demoTag, esc, select, field } = require('./views');
const clean = s => String(s ?? '').trim();

// ---------- dashboard ----------
function stats() {
  const db = D.get(), nowIso = D.now();
  const q = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const weeks = []; const end = new Date(); end.setUTCHours(0, 0, 0, 0);
  for (let i = 11; i >= 0; i--) { const a = new Date(end.getTime() - (i + 1) * 7 * 864e5 + 864e5), b = new Date(a.getTime() + 7 * 864e5); weeks.push([a.toISOString(), b.toISOString()]); }
  const wk = (table, col) => weeks.map(([a, b]) => db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${col} >= ? AND ${col} < ?`).get(a, b).n);
  const past = all(`SELECT s.id, s.date, s.end_time, COUNT(b.id) booked, SUM(b.attendance = '已出席') att FROM seminars s JOIN bookings b ON b.seminar_id = s.id AND b.status = 'booked' GROUP BY s.id ORDER BY s.date`);
  const pastAll = past.filter(p => new Date(`${p.date}T${p.end_time}:00+08:00`) < new Date());
  const booked = pastAll.reduce((a, p) => a + p.booked, 0), att = pastAll.reduce((a, p) => a + (p.att || 0), 0);
  const months = []; { const d = new Date(); for (let i = 5; i >= 0; i--) { const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); months.push(m.toISOString().slice(0, 7)); } }
  const sales = months.map(m => q(`SELECT COUNT(*) n, COALESCE(SUM(price_hkd),0) rev FROM orders WHERE course_id IN (SELECT id FROM courses WHERE kind = 'online') AND payment_status = '已付款' AND substr(paid_at,1,7) = ?`, m));
  return {
    leads: q('SELECT COUNT(*) n FROM leads').n,
    bookings: q("SELECT COUNT(*) n FROM bookings WHERE status = 'booked'").n,
    upcomingBookings: q("SELECT COUNT(*) n FROM bookings b JOIN seminars s ON s.id = b.seminar_id WHERE b.status = 'booked' AND s.date >= ?", nowIso.slice(0, 10)).n,
    attendRate: booked ? Math.round(att / booked * 1000) / 10 : null, attended: att, pastBooked: booked,
    courses: q("SELECT COUNT(*) n FROM courses WHERE kind = 'online' AND status = 'published'").n, draftCourses: q("SELECT COUNT(*) n FROM courses WHERE kind = 'online' AND status = 'draft'").n,
    enrolments: q("SELECT COUNT(*) n FROM orders WHERE course_id IN (SELECT id FROM courses WHERE kind = 'online') AND payment_status = '已付款'").n,
    salesCount: q("SELECT COUNT(*) n FROM orders WHERE course_id IN (SELECT id FROM courses WHERE kind = 'online') AND payment_status = '已付款'").n,
    salesRev: q("SELECT COALESCE(SUM(price_hkd),0) n FROM orders WHERE course_id IN (SELECT id FROM courses WHERE kind = 'online') AND payment_status = '已付款'").n,
    allRev: q("SELECT COALESCE(SUM(price_hkd),0) n FROM orders WHERE payment_status = '已付款'").n,
    pendingRefunds: q("SELECT COUNT(*) n FROM orders WHERE payment_status = '退款處理中'").n,
    drafts: q("SELECT COUNT(*) n FROM reminders WHERE status IN ('草稿','已複製')").n,
    pipeline: D.STAGES.map(([k, zh]) => ({ k, zh, n: q('SELECT COUNT(*) n FROM leads WHERE stage = ?', k).n })),
    weekLabels: weeks.map(([a]) => a.slice(5, 10)), weekBookings: wk('bookings', 'created_at'), weekLeads: wk('leads', 'created_at'),
    attendance: pastAll.map(p => ({ d: p.date.slice(5), rate: p.booked ? Math.round((p.att || 0) / p.booked * 100) : 0 })),
    months, salesN: sales.map(s => s.n), salesRevM: sales.map(s => s.rev),
    perCourse: all(`SELECT c.title, c.kind, COUNT(o.id) n, COALESCE(SUM(o.price_hkd),0) rev FROM courses c LEFT JOIN orders o ON o.course_id = c.id AND o.payment_status = '已付款' GROUP BY c.id ORDER BY c.kind = 'online' DESC, n DESC`),
  };
}
function dashboard(req) {
  const s = stats();
  const kpi = (label, val, sub = '') => `<div class="kpi"><span>${label}</span><strong>${val}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const data = { ...s, perCourse: undefined };
  return page({ title: '儀錶板', active: 'dash', user: req.user, req, scripts: ['/assets/admin/vendor/chart.umd.min.js'], body: `
<div class="head"><div><p class="kicker">DASHBOARD</p><h1>儀錶板</h1></div><p class="muted small">香港時間 ${fmt(D.now())}</p></div>
<section class="kpis">${kpi('講座報名（有效）', s.bookings, `未來場次 ${s.upcomingBookings} 個`)}${kpi('出席率（已完場）', s.attendRate == null ? '—' : s.attendRate + '%', `${s.attended} / ${s.pastBooked} 人`)}
${kpi('網上課程', s.courses, `已發佈；草稿 ${s.draftCourses}`)}${kpi('課程學員（已付款）', s.enrolments)}${kpi('網上課程銷售', s.salesCount + ' 單', money(s.salesRev))}${kpi('潛在客戶', s.leads, `待處理提醒草稿 ${s.drafts}`)}</section>
<section class="charts">
<figure class="panel wide"><figcaption>講座報名及新潛在客戶（每週，最近 12 週）</figcaption><canvas id="c-signups" height="70"></canvas></figure>
<figure class="panel"><figcaption>每場講座出席率</figcaption><canvas id="c-attend" height="180"></canvas></figure>
<figure class="panel"><figcaption>網上課程銷售（每月：單數 / 港幣）</figcaption><canvas id="c-sales" height="180"></canvas></figure>
<figure class="panel"><figcaption>CRM 管道人數</figcaption><canvas id="c-pipe" height="180"></canvas></figure>
<div class="panel"><h2 class="h3">課程表現（已付款）</h2><table class="tbl"><thead><tr><th>課程</th><th>類別</th><th>學員</th><th>收入</th></tr></thead><tbody>${s.perCourse.map(c => `<tr><td>${esc(c.title)}</td><td class="small">${c.kind === 'online' ? '網上' : '現場'}</td><td>${c.n}</td><td>${money(c.rev)}</td></tr>`).join('')}</tbody></table>
<p class="small muted">全部收費項目已付款收入：${money(s.allRev)}；退款處理中：${s.pendingRefunds} 單。以上唔包括 Stripe 測試付款。</p></div>
</section>
${stripePanel()}
<script type="application/json" id="dash-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>` });
}

function stripePanel() {
  const t = ST.stats(), ks = ST.keyState(), b = t.by;
  const cell = (k, label) => `<div class="kpi"><span>${label}</span><strong>${b[k].n}</strong><small>課程價值 ${money(b[k].hkd)}</small></div>`;
  return `<section class="panel stripe-test" aria-labelledby="st-h"><p class="testband" role="note">${ST.DASH_LABEL}</p>
<h2 class="h3" id="st-h">Stripe 測試付款</h2>
<div class="kpis">${kpi2('測試付款總數', t.total, '只計 Stripe 測試模式訂單')}${cell('已付款', '已付款（測試）')}${cell('待付款', '待付款（測試）')}${cell('失敗', '失敗')}${cell('過期', '過期')}</div>
${ks.ok ? '' : `<p class="warnbox small">${esc(ks.msg)}</p>`}
<table class="tbl"><thead><tr><th>#</th><th>客戶</th><th>課程</th><th>課程價值</th><th>狀態</th><th>Stripe Session</th><th>更新</th></tr></thead><tbody>
${t.recent.map(r => `<tr><td>${r.id}</td><td><a href="/admin/leads/${r.lead_id}">${esc(r.lname)}</a> ${r.is_demo ? '<span class="chip demo">示範</span>' : ''}</td><td class="small">${esc(r.course_title)}</td><td>${money(r.status === '已付款' ? r.paid_amount / 100 : r.amount_hkd)}${r.status === '已付款' ? ' <span class="small muted">' + esc(String(r.paid_currency).toUpperCase()) + '</span>' : ''}</td><td>${tpChip(r.status)}</td><td class="small mono">${esc(r.session_id ? r.session_id.slice(0, 24) + '…' : '—')}${r.payment_intent ? '<br>' + esc(r.payment_intent.slice(0, 24)) : ''}</td><td class="small">${fmt(r.updated_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">未有 Stripe 測試付款。</td></tr>'}</tbody></table>
<p class="small muted">${ST.DASH_LABEL}。已付款只會由經簽名驗證嘅 Stripe 測試模式 webhook 設定；示範數據唔會計入呢度。</p></section>`;
}
const kpi2 = (label, val, sub = '') => `<div class="kpi"><span>${label}</span><strong>${val}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
const tpChip = st => `<span class="chip tp tp-${D.TP_STATUS.indexOf(st)}">${esc(st)}${st === '待付款' || st === '已付款' ? '（測試）' : ''}</span>`;
// Sample order panel shown when staff try to move a lead to 已售出課程 (the stage itself is not changed).
function soldModal(req, l, closeHref) {
  const tp = ST.pendingFor(l.id), f = Sx.csrfField(req), ks = ST.keyState();
  const back = `<input type="hidden" name="back" value="${esc(closeHref)}">`;
  const msg = { nokey: ks.msg || '未設定 Stripe 測試 key。', state: '呢張測試訂單唔係待付款狀態。', course: '請揀一個可以購買嘅現場課程。', api: 'Stripe 測試 API 出錯，請稍後再試。' }[clean(req.query.err)];
  const body = !tp ? `<p>呢個客戶未有待付款嘅測試訂單${l.stage === 'sold' ? '（已經喺「已售出課程」）' : ''}。</p>` : `
<dl class="kv"><dt>客戶</dt><dd>${esc(l.name)}（${esc(l.email)}）</dd><dt>目前階段</dt><dd>${stageChip(l.stage)} <span class="small muted">— 保持不變，等 Stripe 測試付款確認</span></dd>
<dt>項目</dt><dd>完成課程實體堂購買（現場上堂課程）</dd><dt>售價</dt><dd><strong>${money(tp.amount_hkd)}</strong> <span class="small muted">（由 data/inperson-courses.json 讀取，唔可以手動改）</span></dd>
<dt>訂單狀態</dt><dd>${tpChip(tp.status)} <span class="small muted">#${tp.id}</span></dd></dl>
${tp.session_id ? `<div class="f"><label for="co-url">Stripe 測試 Checkout 連結（俾客戶）</label><input id="co-url" class="mono" readonly value="${esc(tp.checkout_url)}"><code id="co-url-t" hidden>${esc(tp.checkout_url)}</code></div>
<div class="row"><a class="btn sm" href="${esc(tp.checkout_url)}" target="_blank" rel="noopener noreferrer">開啟 Checkout</a><button class="btn ghost sm" type="button" data-copy="co-url-t">複製連結</button></div>
<p class="small muted">課程：${esc(tp.course_title)}。客戶喺 Stripe 測試頁用測試卡（例如 4242 4242 4242 4242）付款。只有經簽名驗證嘅 Stripe 測試模式 webhook 先會將階段改為「已售出課程」。</p>`
  : `<form method="post" action="/admin/stripe-test/${tp.id}/checkout">${f}${back}
${select('course_slug', '現場課程（只列出已可推出嘅課程）', ST.readyCourses().map(c => [c.slug, `${c.title}（${money(c.price)}）`]), tp.course_slug)}
${ks.ok ? '' : `<p class="warnbox small" role="alert">${esc(ks.msg)}</p>`}
<button class="btn sm" type="submit"${ks.ok ? '' : ' disabled'}>建立 Stripe 測試 Checkout</button></form>`}
${tp ? `<form method="post" action="/admin/stripe-test/${tp.id}/cancel" class="inline">${f}${back}<button class="btn ghost sm" type="submit">取消測試訂單</button></form>` : ''}`;
  return `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="sold-h"><p class="testband" role="note">${ST.LABEL}</p>
<h2 id="sold-h" class="h3">完成課程實體堂購買 — 樣本訂單</h2>${msg ? `<p class="warnbox small" role="alert">${esc(msg)}</p>` : ''}${body}
<p class="row"><a class="small" href="${esc(closeHref)}">關閉</a></p></div></div>`;
}
function testPayTable(l) {
  const rows = ST.forLead(l.id); if (!rows.length) return '';
  return `<section class="panel"><p class="testband" role="note">${ST.LABEL}</p><h2 class="h3">Stripe 測試付款</h2><table class="tbl"><thead><tr><th>#</th><th>課程</th><th>課程價值</th><th>狀態</th><th>Session / PaymentIntent</th><th>付款時間</th></tr></thead><tbody>
${rows.map(r => `<tr><td>${r.id}</td><td>${esc(r.course_title)}</td><td>${money(r.amount_hkd)}</td><td>${tpChip(r.status)}${r.note ? '<br><span class="small">' + esc(r.note) + '</span>' : ''}</td><td class="small mono">${esc(r.session_id || '—')}${r.payment_intent ? '<br>' + esc(r.payment_intent) : ''}</td><td class="small">${fmt(r.paid_at)}</td></tr>`).join('')}</tbody></table>
${ST.pendingFor(l.id) ? `<p><a class="btn sm" href="/admin/leads/${l.id}?sold=1">開啟待付款測試訂單</a></p>` : ''}</section>`;
}

// ---------- leads ----------
const SERVICES = () => D.get().prepare('SELECT id, name, course, price_label FROM products ORDER BY price, id').all();
const svcName = id => { const p = id && D.get().prepare('SELECT name, course FROM products WHERE id = ?').get(id); return p ? p.name + (p.course ? '｜' + p.course : '') : (id || '—'); };
function leadQuery(q) {
  const w = [], a = [];
  if (q.q) { w.push('(l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)'); const s = '%' + q.q.replace(/[%_]/g, '') + '%'; a.push(s, s, s); }
  if (D.STAGE_KEYS.includes(q.stage)) { w.push('l.stage = ?'); a.push(q.stage); }
  if (D.PAY.includes(q.pay) || D.PAY_TEST.includes(q.pay)) { w.push('l.payment_status = ?'); a.push(q.pay); }
  if (q.service) { w.push('l.service = ?'); a.push(q.service); }
  if (q.consent === '1' || q.consent === '0') { w.push('l.marketing_consent = ?'); a.push(+q.consent); }
  if (q.demo === 'real') w.push('l.is_demo = 0'); else if (q.demo === 'demo') w.push('l.is_demo = 1');
  if (q.source) { w.push('l.source = ?'); a.push(q.source); }
  const sql = `SELECT l.*, (SELECT s.date || ' ' || s.start_time FROM bookings b JOIN seminars s ON s.id = b.seminar_id WHERE b.lead_id = l.id AND b.status = 'booked' ORDER BY s.date DESC LIMIT 1) AS seminar_at,
    (SELECT b.attendance FROM bookings b JOIN seminars s ON s.id = b.seminar_id WHERE b.lead_id = l.id AND b.status = 'booked' ORDER BY s.date DESC LIMIT 1) AS attendance,
    (SELECT COUNT(*) FROM bookings b WHERE b.lead_id = l.id AND b.status = 'booked') AS n_bookings
    FROM leads l ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY l.created_at DESC LIMIT 2000`;
  return D.get().prepare(sql).all(...a);
}
const qOf = req => ({ q: clean(req.query.q).slice(0, 80), stage: clean(req.query.stage), pay: clean(req.query.pay), service: clean(req.query.service), consent: clean(req.query.consent), demo: clean(req.query.demo), source: clean(req.query.source) });
function leadsPage(req) {
  const q = qOf(req), rows = leadQuery(q), qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
  return page({ title: '潛在客戶', active: 'leads', user: req.user, req, body: `
<div class="head"><div><p class="kicker">LEADS</p><h1>潛在客戶資料庫</h1></div><a class="btn ghost" href="/admin/leads.csv${qs ? '?' + qs : ''}">匯出 CSV</a></div>
<form class="filters" method="get" action="/admin/leads">
${field('q', '搜尋（名稱／電郵／電話）', q.q, { type: 'search' })}
${select('stage', 'CRM 階段', [['', '全部'], ...D.STAGES.map(s => [s[0], s[1]])], q.stage)}
${select('pay', '付款狀態', [['', '全部'], ...D.PAY.map(p => [p, p]), ...D.PAY_TEST.map(p => [p, p])], q.pay)}
${select('service', '所選服務', [['', '全部'], ...SERVICES().map(p => [p.id, `${p.name}${p.id.startsWith('ip-') ? '｜' + p.course : ''}（${p.price_label}）`])], q.service)}
${select('consent', '推廣同意', [['', '全部'], ['1', '已同意'], ['0', '未同意']], q.consent)}
${select('demo', '資料', [['', '全部'], ['real', '只顯示真實'], ['demo', '只顯示示範']], q.demo)}
<button class="btn sm" type="submit">篩選</button><a class="small" href="/admin/leads">清除</a></form>
<p class="small muted">${rows.length} 個結果</p>
<div class="tablewrap"><table class="tbl"><thead><tr><th>名稱</th><th>電郵／電話</th><th>所選服務</th><th>標準價目</th><th>講座日期</th><th>出席</th><th>提醒</th><th>階段</th><th>付款</th><th>推廣</th><th>來源</th></tr></thead><tbody>
${rows.map(l => `<tr><td><a href="/admin/leads/${l.id}">${esc(l.name)}</a> ${demoTag(l)}</td><td>${esc(l.email)}<br><span class="muted small">${esc(l.phone || '—')}${l.whatsapp_opt_out_at ? ' · WhatsApp 已退出' : ''}</span></td>
<td>${esc(svcName(l.service))}</td><td>${l.standard_price == null ? '—' : money(l.standard_price)}</td><td>${esc(l.seminar_at || '—')}</td><td>${esc(l.attendance || '—')}</td><td class="small">${esc(l.reminder_status)}</td><td>${stageChip(l.stage)}</td><td>${payChip(l.payment_status)}</td><td>${l.marketing_consent ? '✓' : '—'}</td><td class="small">${esc(l.source)}</td></tr>`).join('') || '<tr><td colspan="11">未有資料。</td></tr>'}
</tbody></table></div>` });
}
const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function leadsCsv(req) {
  const head = ['id', '名稱', '電郵', '電話', '所選服務', '標準價目(HKD)', '講座日期', '出席狀態', '提醒狀態', 'CRM 階段', '付款狀態', '推廣同意', 'WhatsApp 退出', '來源', '示範', '建立時間'];
  const rows = leadQuery(qOf(req)).map(l => [l.id, l.name, l.email, l.phone, svcName(l.service), l.standard_price, l.seminar_at, l.attendance, l.reminder_status, (C.STAGE_NAME[l.stage] || l.stage), l.payment_status, l.marketing_consent ? '是' : '否', l.whatsapp_opt_out_at ? '是' : '否', l.source, l.is_demo ? '是' : '否', fmt(l.created_at)]);
  return '\ufeff' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function leadDetail(req, l, flash = '') {
  const db = D.get(), f = Sx.csrfField(req);
  const bookings = db.prepare('SELECT b.*, s.date, s.start_time, s.title FROM bookings b JOIN seminars s ON s.id = b.seminar_id WHERE b.lead_id = ? ORDER BY s.date DESC').all(l.id);
  const orders = db.prepare('SELECT o.*, p.name pname, p.course pcourse, c.title ctitle FROM orders o LEFT JOIN products p ON p.id = o.product_id LEFT JOIN courses c ON c.id = o.course_id WHERE o.lead_id = ? ORDER BY o.created_at DESC').all(l.id);
  const notes = db.prepare('SELECT * FROM notes WHERE lead_id = ? ORDER BY created_at DESC').all(l.id);
  const hist = db.prepare('SELECT * FROM stage_history WHERE lead_id = ? ORDER BY at DESC, id DESC').all(l.id);
  const rems = db.prepare('SELECT * FROM reminders WHERE lead_id = ? ORDER BY scheduled_at').all(l.id);
  return page({ title: l.name, active: 'leads', user: req.user, req, flash, body: `
<div class="head"><div><p class="kicker"><a href="/admin/leads">潛在客戶</a> › #${l.id}</p><h1>${esc(l.name)} ${demoTag(l)}</h1><p>${stageChip(l.stage)} ${payChip(l.payment_status)}</p></div>
<form method="post" action="/admin/leads/${l.id}/stage" class="inline">${f}${select('stage', '移去階段', D.STAGES.map(s => [s[0], s[1]]), l.stage)}<button class="btn sm" type="submit">更新階段</button></form></div>
<div class="grid2">
<section class="panel"><h2 class="h3">資料</h2><form method="post" action="/admin/leads/${l.id}">${f}
${field('name', '名稱', l.name, { req: true, attrs: 'maxlength="60"' })}<div class="f"><label>電郵</label><p>${esc(l.email)}</p></div>
${field('phone', 'WhatsApp 電話', l.phone || '', { type: 'tel', attrs: 'maxlength="20"' })}
${select('service', '所選服務（標準價目會自動跟產品價目表）', [['', '—'], ...SERVICES().map(p => [p.id, `${p.name}${p.id.startsWith('ip-') ? '｜' + p.course : ''}（${p.price_label}）`])], l.service)}
${select('payment_status', '付款狀態', [...D.PAY, ...(D.PAY_TEST.includes(l.payment_status) ? [l.payment_status] : [])].map(p => [p, p]), l.payment_status)}
${field('source', '來源', l.source, { attrs: 'maxlength="60"' })}
<dl class="kv small"><dt>標準價目</dt><dd>${l.standard_price == null ? '—' : money(l.standard_price)}（報名時嘅價目快照）</dd><dt>提醒狀態</dt><dd>${esc(l.reminder_status)}</dd>
<dt>推廣同意</dt><dd>${l.marketing_consent ? `已同意（${fmt(l.marketing_consent_at)}，字句版本 ${esc(l.marketing_consent_text || '—')}）` : '未同意'}</dd>
<dt>WhatsApp</dt><dd>${l.whatsapp_opt_out_at ? `已回覆「停止」（${fmt(l.whatsapp_opt_out_at)}）— 唔會再有 WhatsApp 提示` : '可以發講座提示'}</dd><dt>建立</dt><dd>${fmt(l.created_at)}</dd></dl>
<button class="btn sm" type="submit">儲存</button></form>
<div class="row">${l.whatsapp_opt_out_at ? '' : `<form method="post" action="/admin/leads/${l.id}/optout">${f}<button class="btn ghost sm" type="submit">記錄客戶回覆「停止」（WhatsApp 退出）</button></form>`}
${l.marketing_consent ? `<form method="post" action="/admin/leads/${l.id}/unconsent">${f}<button class="btn ghost sm" type="submit">取消推廣同意</button></form>` : ''}</div></section>
<section class="panel"><h2 class="h3">員工備註</h2><form method="post" action="/admin/leads/${l.id}/notes">${f}<div class="f"><label for="f-note">新增備註</label><textarea id="f-note" name="body" rows="3" maxlength="4000" required></textarea></div><button class="btn sm" type="submit">加備註</button></form>
<ol class="notes">${notes.map(n => `<li><p>${esc(n.body).replace(/\n/g, '<br>')}</p><small>${esc(n.author_name)} · ${fmt(n.created_at)}</small></li>`).join('') || '<li class="muted">未有備註。</li>'}</ol></section>
</div>
<section class="panel"><h2 class="h3">講座報名</h2><table class="tbl"><thead><tr><th>場次</th><th>狀態</th><th>出席</th><th>來源</th><th>報名時間</th></tr></thead><tbody>
${bookings.map(b => `<tr><td><a href="/admin/seminars/${encodeURIComponent(b.seminar_id)}">${esc(b.date)} ${esc(b.start_time)}</a></td><td>${b.status === 'booked' ? '已報名' : '已取消'}</td><td><form method="post" action="/admin/bookings/${b.id}/attendance" class="inline">${f}<input type="hidden" name="back" value="/admin/leads/${l.id}">${select('attendance', '出席', D.ATTEND.map(a => [a, a]), b.attendance, 'data-autosubmit')}<button class="btn sm" type="submit">更新</button></form></td><td class="small">${esc(b.source)}</td><td class="small">${fmt(b.created_at)}</td></tr>`).join('') || '<tr><td colspan="5">未有報名。</td></tr>'}</tbody></table></section>
<section class="panel"><h2 class="h3">訂單</h2><table class="tbl"><thead><tr><th>項目</th><th>價錢</th><th>付款狀態</th><th>付款日</th><th>建立</th></tr></thead><tbody>
${orders.map(o => `<tr><td>${esc(o.ctitle || (o.pname + (o.pcourse ? '｜' + o.pcourse : '')))}</td><td>${money(o.price_hkd)}</td><td><form method="post" action="/admin/orders/${o.id}/payment" class="inline">${f}<input type="hidden" name="back" value="/admin/leads/${l.id}">${select('payment_status', '付款', D.PAY.map(p => [p, p]), o.payment_status)}<button class="btn sm" type="submit">更新</button></form></td><td class="small">${fmt(o.paid_at)}</td><td class="small">${fmt(o.created_at)}</td></tr>`).join('') || '<tr><td colspan="5">未有訂單。</td></tr>'}</tbody></table></section>
${testPayTable(l)}
<div class="grid2"><section class="panel"><h2 class="h3">提醒草稿</h2><ul class="plain">${rems.map(r => `<li>${remChip(r.status)} ${esc(r.label)} <span class="muted small">· ${fmt(r.scheduled_at)}${r.skip_reason ? ' · ' + esc(r.skip_reason) : ''}</span></li>`).join('') || '<li class="muted">未有。</li>'}</ul><a class="small" href="/admin/reminders?lead=${l.id}">喺提醒草稿頁處理 →</a></section>
<section class="panel"><h2 class="h3">階段紀錄</h2><ol class="hist">${hist.map(h => `<li>${h.from_stage ? stageChip(h.from_stage) + ' → ' : ''}${stageChip(h.to_stage)} <span class="muted small">${esc(h.by_name)} · ${h.via === 'drag' ? '拖放' : h.via === 'select' ? '選擇' : h.via === 'stripe-test' ? '經驗證 webhook' : '系統'} · ${fmt(h.at)}</span></li>`).join('')}</ol></section></div>
${req.query.sold ? soldModal(req, l, `/admin/leads/${l.id}`) : ''}` });
}

// ---------- pipeline ----------
function pipeline(req) {
  const db = D.get(), f = Sx.csrfField(req), view = req.query.view === 'list' ? 'list' : 'board';
  const leads = db.prepare(`SELECT l.*, (SELECT s.date FROM bookings b JOIN seminars s ON s.id = b.seminar_id WHERE b.lead_id = l.id AND b.status = 'booked' ORDER BY s.date DESC LIMIT 1) seminar_date FROM leads l ORDER BY l.updated_at DESC`).all();
  const pend = ST.pendingLeadIds(), soldL = +req.query.sold ? leads.find(x => x.id === +req.query.sold) : null;
  const by = Object.fromEntries(D.STAGE_KEYS.map(k => [k, []])); for (const l of leads) (by[l.stage] || by.new).push(l);
  const card = l => `<article class="kcard" draggable="true" data-id="${l.id}" data-stage="${l.stage}"><a href="/admin/leads/${l.id}"><strong>${esc(l.name)}</strong></a> ${demoTag(l)}
<p class="small muted">${esc(svcName(l.service))}${l.seminar_date ? ' · 講座 ' + esc(l.seminar_date.slice(5)) : ''}</p><p class="small">${payChip(l.payment_status)}${pend.has(l.id) ? ' <a class="chip tp tp-0" href="/admin/pipeline?sold=' + l.id + '">Stripe 測試待付款</a>' : ''}</p>
<form method="post" action="/admin/leads/${l.id}/stage" class="kmove">${f}<input type="hidden" name="back" value="/admin/pipeline"><label class="sr" for="mv-${l.id}">移去階段</label><select id="mv-${l.id}" name="stage" data-autosubmit>${D.STAGES.map(s => `<option value="${s[0]}"${s[0] === l.stage ? ' selected' : ''}>${s[1]}</option>`).join('')}</select><noscript><button class="btn sm" type="submit">移</button></noscript></form></article>`;
  const board = `<div class="kanban" data-csrf="${esc(req.sess.csrf)}">${D.STAGES.map(([k, zh, en]) => `<section class="kcol" data-stage="${k}" aria-label="${zh}"><header><h2>${zh}</h2><small>${en}</small><b class="count">${by[k].length}</b></header><div class="kdrop">${by[k].map(card).join('')}</div></section>`).join('')}</div>`;
  const list = `<div class="tablewrap"><table class="tbl"><thead><tr><th>名稱</th><th>所選服務</th><th>講座</th><th>付款</th><th>階段</th><th>最後更新</th></tr></thead><tbody>${leads.map(l => `<tr><td><a href="/admin/leads/${l.id}">${esc(l.name)}</a> ${demoTag(l)}</td><td>${esc(svcName(l.service))}</td><td>${esc(l.seminar_date || '—')}</td><td>${payChip(l.payment_status)}</td><td><form method="post" action="/admin/leads/${l.id}/stage" class="inline">${f}<input type="hidden" name="back" value="/admin/pipeline?view=list"><select name="stage" aria-label="階段" data-autosubmit>${D.STAGES.map(s => `<option value="${s[0]}"${s[0] === l.stage ? ' selected' : ''}>${s[1]}</option>`).join('')}</select><noscript><button class="btn sm">移</button></noscript></form></td><td class="small">${fmt(l.updated_at)}</td></tr>`).join('')}</tbody></table></div>`;
  return page({ title: 'CRM 管道', active: 'pipeline', user: req.user, req, body: `
<div class="head"><div><p class="kicker">PIPELINE</p><h1>CRM 客戶關係管道</h1><p class="small muted">拖放卡片或者用選擇框移動階段；每次移動都會記錄喺階段紀錄。</p></div>
<div class="seg"><a href="/admin/pipeline"${view === 'board' ? ' aria-current="page"' : ''}>看板</a><a href="/admin/pipeline?view=list"${view === 'list' ? ' aria-current="page"' : ''}>列表</a></div></div>
<p class="small muted">移去「已售出課程」唔會即時改階段：會開一張 Stripe 測試模式樣本訂單，只有經驗證嘅 Stripe 測試付款先會更新。</p>
${view === 'board' ? board : list}${soldL ? soldModal(req, soldL, view === 'list' ? '/admin/pipeline?view=list' : '/admin/pipeline') : ''}` });
}

function routes(r) {
  r.get('/admin', (req, res) => res.type('html').send(dashboard(req)));
  r.get('/admin/leads', (req, res) => res.type('html').send(leadsPage(req)));
  r.get('/admin/pipeline', (req, res) => res.type('html').send(pipeline(req)));
  r.get('/admin/leads.csv', (req, res) => res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"` }).send(leadsCsv(req)));
  const lead = (req, res) => { const l = D.get().prepare('SELECT * FROM leads WHERE id = ?').get(+req.params.id || 0); if (!l) res.status(404).type('html').send(page({ title: '搵唔到', user: req.user, req, body: '<h1>搵唔到呢個客戶</h1>' })); return l; };
  r.get('/admin/leads/:id', (req, res) => { const l = lead(req, res); if (l) res.type('html').send(leadDetail(req, l, req.query.ok ? '已儲存。' : '')); });
  r.post('/admin/leads/:id', (req, res) => {
    const l = lead(req, res); if (!l) return;
    const name = clean(req.body.name).slice(0, 60) || l.name, phone = clean(req.body.phone).slice(0, 20) || null, service = clean(req.body.service) || null;
    const p = service ? C.product(service) : null, pay = D.PAY.includes(req.body.payment_status) ? req.body.payment_status : l.payment_status;
    D.get().prepare('UPDATE leads SET name = ?, phone = ?, service = ?, standard_price = ?, payment_status = ?, source = ?, updated_at = ? WHERE id = ?')
      .run(name, phone, p ? p.id : null, p ? (service === l.service ? l.standard_price ?? p.price : p.price) : null, pay, clean(req.body.source).slice(0, 60) || l.source, D.now(), l.id);
    res.redirect(303, `/admin/leads/${l.id}?ok=1`);
  });
  r.post('/admin/leads/:id/notes', (req, res) => { const l = lead(req, res); if (!l) return; C.addNote(l.id, req.user, req.body.body); res.redirect(303, `/admin/leads/${l.id}?ok=1`); });
  r.post('/admin/leads/:id/optout', (req, res) => { const l = lead(req, res); if (!l) return; R.optOut(l.id, req.user.name); C.addNote(l.id, req.user, '記錄：客戶回覆「停止」，WhatsApp 講座提示已停止（電郵照常）。'); res.redirect(303, `/admin/leads/${l.id}?ok=1`); });
  r.post('/admin/leads/:id/unconsent', (req, res) => { const l = lead(req, res); if (!l) return; D.get().prepare('UPDATE leads SET marketing_consent = 0, updated_at = ? WHERE id = ?').run(D.now(), l.id); R.noMarketing(l.id, req.user.name); C.addNote(l.id, req.user, '記錄：已取消推廣同意。'); res.redirect(303, `/admin/leads/${l.id}?ok=1`); });
  r.post('/admin/leads/:id/stage', (req, res) => {
    const l = lead(req, res); if (!l) return;
    const to = clean(req.body.stage), json = req.is('application/json');
    if (!D.STAGE_KEYS.includes(to)) return json ? res.status(400).json({ ok: false, error: 'bad stage' }) : res.status(400).type('html').send(page({ title: '錯誤', user: req.user, req, body: '<h1>階段唔啱</h1>' }));
    const via = req.body.via === 'drag' ? 'drag' : 'select', back = String(req.body.back || '');
    if (to === 'sold' && l.stage !== 'sold') { // never set directly: open a Stripe TEST-mode sample order instead
      let tp; try { tp = ST.beginSold(l.id, req.user, via); } catch (e) { return json ? res.status(409).json({ ok: false, error: e.message }) : res.status(409).type('html').send(page({ title: '錯誤', user: req.user, req, body: `<h1>未能建立測試訂單</h1><p>${esc(e.message)}</p>` })); }
      const panel = back.startsWith('/admin/pipeline') ? `/admin/pipeline?${back.includes('view=list') ? 'view=list&' : ''}sold=${l.id}` : `/admin/leads/${l.id}?sold=1`;
      if (json) return res.status(202).json({ ok: false, pending: true, stage: l.stage, order: tp && tp.id, panel: `/admin/pipeline?sold=${l.id}` });
      return res.redirect(303, panel);
    }
    C.moveStage(l.id, to, { byId: req.user.id, byName: req.user.name, via });
    if (json) return res.json({ ok: true, stage: to }); res.redirect(303, /^\/admin\/[\w/?=&.-]*$/.test(back) ? back : `/admin/leads/${l.id}?ok=1`);
  });
  const backOr = (req, d) => { const b = String(req.body.back || ''); return /^\/admin\/[\w/?=&.-]*$/.test(b) ? b : d; };
  const withQ = (u, q) => u + (u.includes('?') ? '&' : '?') + q;
  r.post('/admin/stripe-test/:id/checkout', async (req, res) => {
    const tp = ST.byId(req.params.id); if (!tp) return res.status(404).send('搵唔到');
    const back = backOr(req, `/admin/leads/${tp.lead_id}`), open = back.startsWith('/admin/pipeline') ? withQ(back, 'sold=' + tp.lead_id) : withQ(back, 'sold=1');
    if (req.body.course_slug && !tp.session_id && req.body.course_slug !== tp.course_slug && !ST.setCourse(tp.id, clean(req.body.course_slug))) return res.redirect(303, withQ(open, 'err=course'));
    if (!ST.keyState().ok) return res.redirect(303, withQ(open, 'err=nokey'));
    try { await ST.createCheckout(tp.id, process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`); }
    catch (e) { console.error('[stripe-test] checkout create failed:', e.message); return res.redirect(303, withQ(open, e.user ? 'err=state' : 'err=api')); }
    res.redirect(303, open);
  });
  r.post('/admin/stripe-test/:id/cancel', (req, res) => {
    const tp = ST.byId(req.params.id); if (!tp) return res.status(404).send('搵唔到');
    ST.cancel(tp.id, req.user); res.redirect(303, backOr(req, `/admin/leads/${tp.lead_id}`));
  });
  r.post('/admin/orders/:id/payment', (req, res) => {
    try { C.setOrderPayment(+req.params.id, clean(req.body.payment_status), req.user.name); } catch { return res.status(400).send('付款狀態唔啱'); }
    const back = String(req.body.back || ''); res.redirect(303, /^\/admin\/[\w/?=&.-]*$/.test(back) ? back : '/admin/orders');
  });
  r.post('/admin/bookings/:id/attendance', (req, res) => {
    try { C.markAttendance(+req.params.id, clean(req.body.attendance), req.user.name); } catch { return res.status(400).send('出席狀態唔啱'); }
    const back = String(req.body.back || ''); res.redirect(303, /^\/admin\/[\w/?=&.%-]*$/.test(back) ? back : '/admin/seminars');
  });
}
module.exports = { routes, stats, svcName };
