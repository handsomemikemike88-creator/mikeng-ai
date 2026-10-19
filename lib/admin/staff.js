// Admin-only: staff list / approval / disable, per-person invite codes, orders list, demo data seed + wipe.
const D = require('../db');
const Sx = require('../backend/security');
const C = require('../backend/crm');
const { requireAdmin } = require('./auth');
const { page, select, fmt, money, esc, payChip, demoTag, field } = require('./views');
const clean = s => String(s ?? '').trim();

function staffPage(req, newCode = '') {
  const db = D.get(), f = Sx.csrfField(req);
  const staff = db.prepare('SELECT id, email, name, role, status, created_at, last_login_at FROM staff ORDER BY status, created_at').all();
  const inv = db.prepare('SELECT i.*, s.name used_name FROM invites i LEFT JOIN staff s ON s.id = i.used_by ORDER BY i.created_at DESC LIMIT 30').all();
  return page({ title: '員工及邀請碼', active: 'staff', user: req.user, req, body: `<div class="head"><div><p class="kicker">STAFF</p><h1>員工及邀請碼</h1><p class="small muted">冇公開註冊：員工只可以用邀請碼開帳戶。用共用邀請碼（STAFF_INVITE_CODE）開嘅帳戶要管理員批核。</p></div></div>
${newCode ? `<div class="warnbox" role="status"><strong>新邀請碼（只顯示一次）：</strong> <code>${esc(newCode)}</code><br><span class="small">請私下交俾員工，佢喺 /admin/register 用。7 日內有效，只可用一次。</span></div>` : ''}
<section class="panel"><h2 class="h3">產生個人邀請碼</h2><form method="post" action="/admin/staff/invite" class="inline">${f}${select('role', '角色', [['staff', '員工'], ['admin', '管理員']], 'staff')}${field('note', '備註（例如員工名）', '', { attrs: 'maxlength="60"' })}<button class="btn sm" type="submit">產生邀請碼</button></form></section>
<section class="panel"><h2 class="h3">員工</h2><table class="tbl"><thead><tr><th>名稱</th><th>電郵</th><th>角色</th><th>狀態</th><th>最後登入</th><th></th></tr></thead><tbody>
${staff.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.email)}</td><td>${s.role === 'admin' ? '管理員' : '員工'}</td><td>${{ active: '使用中', pending: '待批核', disabled: '已停用' }[s.status]}</td><td class="small">${fmt(s.last_login_at)}</td>
<td>${s.id === req.user.id ? '（你）' : `<form method="post" action="/admin/staff/${s.id}" class="inline">${f}${select('status', '狀態', [['active', '使用中／批准'], ['pending', '待批核'], ['disabled', '停用']], s.status)}${select('role', '角色', [['staff', '員工'], ['admin', '管理員']], s.role)}<button class="btn sm" type="submit">更新</button></form>`}</td></tr>`).join('')}</tbody></table></section>
<section class="panel"><h2 class="h3">邀請碼紀錄</h2><table class="tbl"><thead><tr><th>建立</th><th>角色</th><th>備註</th><th>到期</th><th>使用</th></tr></thead><tbody>${inv.map(i => `<tr><td class="small">${fmt(i.created_at)}</td><td>${i.role === 'admin' ? '管理員' : '員工'}</td><td>${esc(i.note || '')}</td><td class="small">${fmt(i.expires_at)}</td><td>${i.used_by ? esc(i.used_name) + ' · ' + fmt(i.used_at) : '未用'}</td></tr>`).join('') || '<tr><td colspan="5">未有。</td></tr>'}</tbody></table></section>` });
}
function ordersPage(req) {
  const f = Sx.csrfField(req), st = D.PAY.includes(req.query.pay) ? req.query.pay : '';
  const rows = D.get().prepare(`SELECT o.*, l.name, l.email, l.is_demo ldemo, p.name pname, p.course pcourse, c.title ctitle FROM orders o JOIN leads l ON l.id = o.lead_id LEFT JOIN products p ON p.id = o.product_id LEFT JOIN courses c ON c.id = o.course_id ${st ? 'WHERE o.payment_status = ?' : ''} ORDER BY o.created_at DESC LIMIT 500`).all(...(st ? [st] : []));
  return page({ title: '訂單及付款', active: 'orders', user: req.user, req, body: `<div class="head"><div><p class="kicker">ORDERS</p><h1>訂單及付款</h1><p class="small muted">示範模式：網站 checkout 只係記錄訂單（未接通 Stripe，冇收錢）。付款狀態由職員手動更新；「已付款」先會開放網上課程。</p></div></div>
<form class="filters" method="get">${select('pay', '付款狀態', [['', '全部'], ...D.PAY.map(p => [p, p])], st)}<button class="btn sm" type="submit">篩選</button></form>
<div class="tablewrap"><table class="tbl"><thead><tr><th>建立</th><th>客戶</th><th>項目</th><th>價錢（快照）</th><th>付款狀態</th><th>付款日</th><th>開始觀看</th></tr></thead><tbody>
${rows.map(o => `<tr><td class="small">${fmt(o.created_at)}</td><td><a href="/admin/leads/${o.lead_id}">${esc(o.name)}</a> ${demoTag({ is_demo: o.ldemo })}<br><span class="small muted">${esc(o.email)}</span></td><td>${esc(o.ctitle || (o.pname + (o.pcourse ? '｜' + o.pcourse : '')))}</td><td>${money(o.price_hkd)}</td>
<td><form method="post" action="/admin/orders/${o.id}/payment" class="inline">${f}<input type="hidden" name="back" value="/admin/orders">${select('payment_status', '付款', D.PAY.map(p => [p, p]), o.payment_status)}<button class="btn sm" type="submit">更新</button></form></td><td class="small">${fmt(o.paid_at)}</td><td class="small">${fmt(o.first_viewed_at)}</td></tr>`).join('') || '<tr><td colspan="7">未有訂單。</td></tr>'}</tbody></table></div>` });
}
function demoPage(req, msg = '') {
  const f = Sx.csrfField(req), n = D.get().prepare('SELECT COUNT(*) n FROM leads WHERE is_demo = 1').get().n;
  return page({ title: '示範數據', active: 'demo', user: req.user, req, flash: msg, body: `<div class="head"><div><p class="kicker">SAMPLE DATA</p><h1>示範數據</h1></div></div>
<section class="panel"><p>而家有 <strong>${n}</strong> 個示範客戶（全部 is_demo=1：示範客戶NN、@example.com、5555 開頭電話）。示範訂單只用現有價目（HK$588／HK$1,288／HK$2,200）。示範數據唔會出現喺公開網站，亦唔會寫入 outbox。</p>
<div class="row">${require('../backend/demo').blocked() ? '<p class="small">正式環境唔可以建立示範數據。</p>' : `<form method="post" action="/admin/demo/seed">${f}<button class="btn" type="submit">重新建立示範數據</button></form>`}<form method="post" action="/admin/demo/wipe">${f}<button class="btn danger" type="submit">清除全部示範數據</button></form></div>
<p class="small muted">指令：<code>npm run seed:demo</code> 建立；<code>npm run demo:wipe</code> 清除。</p></section>` });
}
function routes(r) {
  r.get('/admin/orders', (req, res) => res.type('html').send(ordersPage(req)));
  r.get('/admin/staff', requireAdmin, (req, res) => res.type('html').send(staffPage(req)));
  r.post('/admin/staff/invite', requireAdmin, (req, res) => {
    const code = 'INV-' + Sx.rand(12), role = req.body.role === 'admin' ? 'admin' : 'staff';
    D.get().prepare('INSERT INTO invites (code_hash, role, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(Sx.sha(code), role, clean(req.body.note).slice(0, 60), req.user.id, D.now(), new Date(Date.now() + 7 * 864e5).toISOString());
    res.type('html').send(staffPage(req, code));
  });
  r.post('/admin/staff/:id', requireAdmin, (req, res) => {
    const id = +req.params.id; if (id === req.user.id) return res.redirect(303, '/admin/staff');
    const status = ['active', 'pending', 'disabled'].includes(req.body.status) ? req.body.status : 'pending', role = req.body.role === 'admin' ? 'admin' : 'staff';
    D.get().prepare('UPDATE staff SET status = ?, role = ?, approved_by = CASE WHEN ? = \'active\' THEN ? ELSE approved_by END WHERE id = ?').run(status, role, status, req.user.id, id);
    if (status !== 'active') D.get().prepare("DELETE FROM sessions WHERE area = 'admin' AND user_id = ?").run(id);
    res.redirect(303, '/admin/staff');
  });
  r.get('/admin/demo', requireAdmin, (req, res) => res.type('html').send(demoPage(req)));
  r.post('/admin/demo/seed', requireAdmin, (req, res) => { try { const x = require('../backend/demo').seed(); res.type('html').send(demoPage(req, `已建立 ${x.leads} 個示範客戶。`)); } catch (e) { res.status(403).type('html').send(demoPage(req, e.message)); } });
  r.post('/admin/demo/wipe', requireAdmin, (req, res) => { const n = require('../backend/demo').wipe(); res.type('html').send(demoPage(req, `已清除 ${n} 個示範客戶同相關示範紀錄。`)); });
}
module.exports = { routes };
