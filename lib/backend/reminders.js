// Reminder DRAFTS per booking (never sent). Follows whatsapp-templates.md (§16.3) and tech-plan §2.4/§2.6:
//   WhatsApp, max 3 per booking: registration confirm, D-1 (start−24h, 「明天」), H-1 (start−1h, 「1 小時後」, join link).
//   Email: confirmation (+ personal Zoom join link, .ics, Google Calendar), D-1, day-of 09:00, H-1, replay link (next day 12:00).
//   Marketing follow-up: email only, only with marketing consent. WhatsApp never carries marketing.
// WhatsApp opt-out (「停止」) skips all WhatsApp drafts; email continues. Each new draft is logged to data/outbox.jsonl as a stub.
const fs = require('fs'), path = require('path');
const D = require('../db');
const OUTBOX = () => process.env.OUTBOX_FILE || path.join(__dirname, '..', '..', 'data', 'outbox.jsonl');
const WA_MAX = 3;
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const OPT_OUT = '如不想再收到 WhatsApp 講座提示，請回覆「停止」（電郵通知照常發送）。';
const md = s => { const [y, m, d] = s.date.split('-').map(Number); return `${m}月${d}日（星期${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`; };
const tm = s => `${s.start.slice(11, 16)}–${s.end.slice(11, 16)}`;
const hk = iso => new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const short = n => String(n || '').replace(/[\r\n]+/g, ' ').slice(0, 30);
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00+08:00`).toISOString();
const addDay = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function plan({ lead, seminar: s, joinUrl, createdAt }) {
  const join = joinUrl || 'https://mikeng-ai.com/join/[個人連結 — 發送時由系統產生]';
  const name = short(lead.name), t0 = new Date(s.start).getTime();
  const gcal = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(s.title) + '&dates=' + [s.start, s.end].map(d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')).join('/') + '&location=Zoom';
  const ics = `https://mikeng-ai.com/seminar.ics?session=${encodeURIComponent(s.id)}`;
  const waReminder = (when) => `${name} 你好，\n提醒你：你報名的 mikeng_course 免費 AI 講座將於${when}開始。\n\n日期：${md(s)}\n時間：${tm(s)}（香港時間）\n平台：Zoom\n語言：${s.language}\n\n請按下面的按鈕，用你的個人連結加入講座。連結於講座開始前 15 分鐘開放，請不要轉發。\n\n${OPT_OUT}\n\n［按鈕：加入講座 → ${join}］\nmikeng_course 講座通知`;
  const emFoot = '\n\n— mikeng_course（營運者：MR Workshop）｜admin@mikeng-ai.com\n呢封係你報名講座嘅服務通知，唔係推廣電郵。';
  const replayEnd = `${addDay(s.date, 1 + (s.replayDays || 2))}T12:00:00+08:00`;
  const list = [
    { channel: 'whatsapp', kind: 'wa_confirm', template: 'seminar_registration_confirm', label: 'WhatsApp 1／3：報名確認', when: createdAt,
      body: `${name} 你好，\n多謝你報名 mikeng_course 免費 AI 講座，你的報名已經確認。\n\n日期：${md(s)}\n時間：${tm(s)}（香港時間）\n形式：Zoom 網上講座\n語言：${s.language}\n\n講座前我們會再經 WhatsApp 及電郵提示你。你可以按下面的按鈕查看你的個人講座連結，連結於講座開始前 15 分鐘開放，請不要轉發。\n\n${OPT_OUT}\n\n［按鈕：查看講座連結 → ${join}］\nmikeng_course 講座通知` },
    { channel: 'whatsapp', kind: 'wa_d1', template: 'seminar_reminder', label: 'WhatsApp 2／3：前一日提示（明天）', when: new Date(t0 - 864e5).toISOString(), body: waReminder('明天') },
    { channel: 'whatsapp', kind: 'wa_h1', template: 'seminar_reminder', label: 'WhatsApp 3／3：開始前 1 小時（附加入連結）', when: new Date(t0 - 36e5).toISOString(), body: waReminder('1 小時後') },
    { channel: 'email', kind: 'em_confirm', template: 'seminar-confirmation', label: '電郵：報名確認＋個人 Zoom 連結＋日曆邀請', when: createdAt,
      subject: `報名確認：免費 AI 講座 ${md(s)} ${tm(s)}（香港時間）`,
      body: `${name} 你好，\n\n多謝你報名 mikeng_course 免費 AI 講座，報名已經確認。\n\n日期：${md(s)}\n時間：${tm(s)}（香港時間，${s.duration}）\n形式：${s.platform}\n語言：${s.language}\n費用：免費\n\n你嘅個人 Zoom 加入連結（開始前 15 分鐘開放，請唔好轉發）：\n${join}\n\n加入日曆：\n・.ics 檔案（Apple／Outlook）：${ics}\n・Google 日曆：${gcal}\n\n講座前一日、當日早上同開始前 1 小時，我哋會再電郵提你。講座後會寄上重溫連結（收到後 ${s.replayDays || 2} 日內可觀看）。${emFoot}` },
    { channel: 'email', kind: 'em_d1', template: 'seminar-reminder-d1', label: '電郵：前一日提示', when: new Date(t0 - 864e5).toISOString(),
      subject: `明天 ${tm(s)}：免費 AI 講座提示`, body: `${name} 你好，\n\n提提你：免費 AI 講座明天（${md(s)}）${tm(s)}（香港時間）舉行。\n\n個人加入連結：${join}\n（開始前 15 分鐘開放）${emFoot}` },
    { channel: 'email', kind: 'em_morning', template: 'seminar-reminder-morning', label: '電郵：當日早上 09:00 提示（只經電郵）', when: at(s.date, '09:00'),
      subject: `今晚 ${tm(s)}：免費 AI 講座`, body: `${name} 你好，\n\n今日 ${md(s)} ${tm(s)}（香港時間）就係免費 AI 講座。\n\n個人加入連結：${join}\n（開始前 15 分鐘開放）${emFoot}` },
    { channel: 'email', kind: 'em_h1', template: 'seminar-reminder-h1', label: '電郵：開始前 1 小時', when: new Date(t0 - 36e5).toISOString(),
      subject: '1 小時後開始：免費 AI 講座加入連結', body: `${name} 你好，\n\n講座 1 小時後開始（${tm(s)} 香港時間）。\n\n個人加入連結：${join}${emFoot}` },
    { channel: 'email', kind: 'em_replay', template: 'seminar-replay', label: '電郵：重溫連結（只經電郵）', when: at(addDay(s.date, 1), '12:00'),
      subject: '免費 AI 講座重溫連結', body: `${name} 你好，\n\n多謝你報名 ${md(s)} 嘅免費 AI 講座。重溫錄影同講座筆記已經準備好：\n${join}\n\n重溫連結有效至 ${hk(replayEnd)}（香港時間），之後會失效，請唔好轉發。${emFoot}` },
  ];
  if (lead.marketing_consent) list.push({ channel: 'email', kind: 'em_followup', template: 'seminar-followup-marketing', label: '電郵：講座後一次課程資料跟進（推廣，已同意）', marketing: true,
    when: at(addDay(s.date, 3), '12:00'), subject: 'mikeng_course 課程資料（標準價目及退款條款）',
    body: `${name} 你好，\n\n多謝你參加免費 AI 講座。以下係課程資料，冇倒數、冇「今日限定」：\n・網上視頻課程 HK$588（由付款日起 1 年）\n・網上1對1收費課程 HK$1,288（合共 6 小時）\n・現場上堂課程 HK$2,200\n\n退款條款：https://mikeng-ai.com/refund\n\n你收到呢封電郵，係因為你報名時剔選咗同意接收推廣電郵。取消訂閱：https://mikeng-ai.com/unsubscribe\n— mikeng_course（營運者：MR Workshop）｜admin@mikeng-ai.com` });
  return list;
}

function logOut(rec) { try { fs.appendFileSync(OUTBOX(), JSON.stringify({ at: new Date().toISOString(), sent: false, stub: true, ...rec }) + '\n'); } catch {} }

// Create (idempotently) the drafts for one booking.
function createFor(bookingId, { joinUrl } = {}) {
  const db = D.get();
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId); if (!b) return [];
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(b.lead_id);
  const s = require('./seminars').byId(b.seminar_id); if (!s) return [];
  const ins = db.prepare(`INSERT OR IGNORE INTO reminders (booking_id, lead_id, channel, kind, template, label, scheduled_at, to_addr, subject, body, is_marketing, status, skip_reason, created_at, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const out = []; let wa = 0;
  for (const r of plan({ lead, seminar: s, joinUrl, createdAt: b.created_at })) {
    let status = '草稿', why = null;
    if (r.channel === 'whatsapp') {
      if (++wa > WA_MAX) continue; // hard cap
      if (!lead.phone) { status = '已略過'; why = '冇 WhatsApp 電話'; }
      else if (lead.whatsapp_opt_out_at) { status = '已略過'; why = '客戶已回覆「停止」（WhatsApp 退出），電郵照常'; }
    }
    if (b.status === 'cancelled') { status = '已略過'; why = '已取消報名'; }
    const to = r.channel === 'whatsapp' ? (lead.phone || '-') : lead.email;
    const info = ins.run(b.id, lead.id, r.channel, r.kind, r.template, r.label, r.when, to, r.subject || null, r.body, r.marketing ? 1 : 0, status, why, D.now(), b.is_demo);
    if (info.changes) { out.push(r.kind); if (!b.is_demo) logOut({ kind: 'reminder-draft', channel: r.channel, template: r.template, reminder: r.kind, to, sendAt: r.when, status, booking: b.id, session: s.id }); }
  }
  return out;
}
// 「停止」: mark the lead opted out and skip its open WhatsApp drafts.
function optOut(leadId, by = 'system') {
  const db = D.get(), t = D.now();
  db.prepare('UPDATE leads SET whatsapp_opt_out_at = COALESCE(whatsapp_opt_out_at, ?), updated_at = ? WHERE id = ?').run(t, t, leadId);
  return db.prepare(`UPDATE reminders SET status = '已略過', skip_reason = '客戶已回覆「停止」（WhatsApp 退出），電郵照常', updated_by = ?, updated_at = ? WHERE lead_id = ? AND channel = 'whatsapp' AND status IN ('草稿','已複製')`).run(by, t, leadId).changes;
}
// Marketing consent withdrawn: skip open marketing drafts.
function noMarketing(leadId, by = 'system') {
  const t = D.now();
  return D.get().prepare(`UPDATE reminders SET status = '已略過', skip_reason = '已取消推廣同意', updated_by = ?, updated_at = ? WHERE lead_id = ? AND is_marketing = 1 AND status IN ('草稿','已複製')`).run(by, t, leadId).changes;
}
function skipForBooking(bookingId, why, by = 'system') {
  return D.get().prepare(`UPDATE reminders SET status = '已略過', skip_reason = ?, updated_by = ?, updated_at = ? WHERE booking_id = ? AND status IN ('草稿','已複製')`).run(why, by, D.now(), bookingId).changes;
}
const waLink = r => 'https://wa.me/' + String(r.to_addr).replace(/\D/g, '') + '?text=' + encodeURIComponent(r.body);
const mailto = r => 'mailto:' + encodeURIComponent(r.to_addr).replace('%40', '@') + '?subject=' + encodeURIComponent(r.subject || '') + '&body=' + encodeURIComponent(r.body);
module.exports = { plan, createFor, optOut, noMarketing, skipForBooking, waLink, mailto, WA_MAX, logOut };
