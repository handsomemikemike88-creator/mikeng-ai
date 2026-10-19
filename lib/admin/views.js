// Admin UI shell + small render helpers. All dynamic values go through esc().
const D = require('../db');
const { esc } = require('../backend/security');
const fmt = iso => { if (!iso) return '—'; const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso)); const g = t => p.find(x => x.type === t).value; return `${g('year')}-${g('month')}-${g('day')} ${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`; };
const money = n => 'HK$' + Number(n || 0).toLocaleString('en-US');
const STAGE = Object.fromEntries(D.STAGES.map(s => [s[0], s]));
const stageChip = k => `<span class="chip st-${esc(k)}">${esc(STAGE[k] ? STAGE[k][1] : k)}</span>`;
const payChip = p => `<span class="chip ${/（測試）$/.test(p) ? 'tp tp-' + (p.startsWith('已付款') ? 1 : 0) : 'pay-' + ['未付款', '已付款', '已退款', '退款處理中'].indexOf(p)}">${esc(p)}</span>`;
const remChip = s => `<span class="chip rem-${['草稿', '已複製', '已手動發送', '已略過'].indexOf(s)}">${esc(s)}</span>`;
const demoTag = r => r && r.is_demo ? '<span class="chip demo">示範</span>' : '';
const hasDemo = () => !!D.get().prepare('SELECT 1 FROM leads WHERE is_demo = 1 LIMIT 1').get() || !!D.get().prepare('SELECT 1 FROM orders WHERE is_demo = 1 LIMIT 1').get();
const NAV = [['/admin', '儀錶板', 'dash'], ['/admin/leads', '潛在客戶', 'leads'], ['/admin/pipeline', 'CRM 管道', 'pipeline'], ['/admin/seminars', '講座日曆', 'seminars'],
  ['/admin/reminders', '提醒草稿', 'reminders'], ['/admin/courses', '網上課程', 'courses'], ['/admin/orders', '訂單及付款', 'orders']];
const ADMIN_NAV = [['/admin/staff', '員工及邀請碼', 'staff'], ['/admin/demo', '示範數據', 'demo']];

function page({ title, body, user, active = '', req, flash = '', scripts = [] }) {
  const nav = user ? [...NAV, ...(user.role === 'admin' ? ADMIN_NAV : [])].map(([h, t, k]) => `<a href="${h}"${k === active ? ' aria-current="page" class="on"' : ''}>${t}</a>`).join('') : '';
  const banner = user && hasDemo() ? `<div class="demo-banner" role="note"><strong>示範數據 — 只作展示</strong>　以下包含虛構示範資料（示範客戶、@example.com、5555 開頭電話）。${user.role === 'admin' ? '<a href="/admin/demo">清除示範數據</a>' : ''}</div>` : '';
  return `<!doctype html><html lang="zh-Hant-HK"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">${req && req.sess ? `<meta name="csrf" content="${esc(req.sess.csrf)}">` : ''}<title>${esc(title)}｜mikeng_course 後台</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/admin/admin.css">
${scripts.map(s => `<script defer src="${s}"></script>`).join('')}<script defer src="/assets/admin/admin.js"></script></head>
<body class="adm${user ? '' : ' adm-auth'}"><a class="skip" href="#main">跳到主要內容</a>
${user ? `<header class="topbar"><a class="brand" href="/admin">Mikeng-ai<span>.com</span><i></i><b>後台</b></a>
<button class="navtoggle" type="button" aria-expanded="false" aria-controls="sidenav">選單</button>
<div class="who"><span>${esc(user.name)}（${user.role === 'admin' ? '管理員' : '員工'}）</span><form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${esc(req.sess.csrf)}"><button class="linkbtn" type="submit">登出</button></form></div></header>
<nav id="sidenav" class="sidenav" aria-label="後台選單">${nav}<a href="/" class="out">← 返回公開網站</a></nav>` : ''}
<main id="main" class="${user ? 'with-nav' : 'auth'}">${banner}${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}${body}</main></body></html>`;
}
const field = (name, label, value = '', { type = 'text', req = false, hint = '', attrs = '' } = {}) =>
  `<div class="f"><label for="f-${name}">${label}${req ? ' *' : ''}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}"${req ? ' required' : ''} ${attrs}>${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
const select = (name, label, opts, cur, attrs = '') => `<div class="f"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}" ${attrs}>${opts.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
module.exports = { page, field, select, fmt, money, stageChip, payChip, remChip, demoTag, hasDemo, esc, STAGE };
