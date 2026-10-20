const S = require('./sessions');
const { refundDeadline } = require('./refund');
const P = require('../data/products.json');
// In-person catalogue: 7 courses, each its own product (id ip-<slug>) so each can map to a Stripe TEST Price later.
const IP = require('../data/inperson-courses.json');
// Production gate (QA v5 n1): courses with launchReady:false are hidden in production.
const PROD = process.env.SITE_INDEXABLE === '1' || process.env.NODE_ENV === 'production';
IP.all = IP.all || IP.courses;
// QA v6 #3: display number (dn) is consecutive over the visible list (1-6 in production, 1-7 locally); c.n keeps the source number.
IP.courses = IP.all.filter(c => !PROD || c.launchReady !== false).map((c, i) => ({ ...c, dn: i + 1 }));
const HERMES_DN = (IP.courses.find(c => c.slug === 'hermes-agent') || {}).dn; // QA v7: 6 in production, 7 locally
const unpub = c => c.launchReady === false ? `<p class="unpub-banner" role="note">未公開：待確認香港供應</p>` : '';
for (const c of IP.courses) P['ip-' + c.slug] = { id: 'ip-' + c.slug, kind: 'in-person', slug: c.slug, name: '現場上堂課程', course: c.title, price: IP.price, priceLabel: IP.priceLabel, buyable: true, detail: IP.detail };
const HOOKS = { account: false }; // BACKEND HOOK: lib/backend sets account=true when mounted (BACKEND=off -> no /account link)
const kindOf = pid => (P[pid] && P[pid].kind) || pid;
const SYL_DRAFTS = require('../data/syllabus-drafts.json');
// Hidden draft syllabus: shown only when products.json <product>.syllabusReady === true.
const sylFor = (id) => (P[id] && P[id].syllabusReady === true && SYL_DRAFTS[P[id].syllabusDraft]) || null;
const sylProduct = () => Object.keys(P).find(id => sylFor(id));
function syllabusSection(id) {
  const y = sylFor(id); if (!y) return '';
  const li = a => a.map(x => `<li>${x}</li>`).join('');
  return `<div class="card" id="syllabus-${id}" style="margin-top:18px"><h3>課程大綱</h3><dl class="kv"><dt>課程主題</dt><dd>${y.topic}</dd><dt>適合</dt><dd>${y.audience}</dd><dt>入門要求</dt><dd>${y.prereq}</dd><dt>時數</dt><dd>${P[id].detail || ph('影片數量及總時數 — 待提供')}</dd></dl><h4>學習目標</h4><ul>${li(y.goals)}</ul>${y.modules.map(m => `<h4>${m.title.replace(/（\d+ 小時）/, '')}</h4><ul>${li(m.items)}</ul>`).join('')}<h4>你會學到</h4><ul>${y.learn.map(([a,b]) => `<li><strong>${a}：</strong>${b}</li>`).join('')}</ul><p><strong>課堂專題：</strong>${y.project}</p><p class="small muted"><strong>所需工具：</strong>${y.tools} ${ph('所需模型／API 及大約費用 — 待確認')}</p></div>`;
}
// Teaching language — single source (QA v3 M1). Use LANG everywhere.
const LANG = '廣東話為主、夾雜英文';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ph = t => `<span class="ph">[${t}]</span>`;
// Interim wording (Evelyn to finalise) — edit here only.
const REMINDER_NOTE = '提交即表示你同意 mikeng_course 向你發送今次講座嘅通知：電郵會寄上報名確認、個人 Zoom 加入連結、日曆邀請、講座提示同重溫連結；WhatsApp 只會發 3 個訊息：報名確認、講座前一日提示，同埋開始前 1 小時提示（附個人加入連結）。手機號碼只用嚟發講座提示，唔會用嚟推廣。唔想再收 WhatsApp 提示，隨時回覆「停止」就得（電郵通知照常發送）。詳情請睇<a href="/privacy#pics">《收集個人資料聲明》</a>（/privacy#pics）。推廣資訊只經電郵發送，而且要你另外剔選同意。';
const AI = 'AI 生成示範視覺效果';
const SITE = 'https://mikeng-ai.com';
// Pre-launch: everything is noindex. Set SITE_INDEXABLE=1 at launch (with Mikey's OK).
const INDEXABLE = process.env.SITE_INDEXABLE === '1';
const confirmed = () => S.upcoming();

const REFUND_FEE = '退款會扣除 Stripe 收取嘅交易手續費';
// Covers all 3 attended rules (QA v3 m2).
const REFUND_ALL = '付款後 3 個工作天內可申請退款（' + REFUND_FEE + '）；但已出席任何一堂便不設退款。點樣先算已出席：網上視頻課程＝已開始觀看課程內容；網上 1 對 1＝第一次上堂已開始；現場上堂＝第一堂已點名。';
const REFUND_ONE = '付款後 3 個工作天內可申請退款（' + REFUND_FEE + '）；但已出席任何一堂（網上視頻課程即已開始觀看）便不設退款。';
const REFUND_DAYS = '付款當日計第 1 日；如喺星期六、日或香港公眾假期付款，由下一個工作天起計第 1 日。工作天指星期一至五，香港公眾假期不計。';
const REFUND_HOW = '我哋會在 3 個工作天內經 Stripe 辦理退款，退回你原本嘅付款方式（會扣除 Stripe 收取嘅交易手續費）。';
const TOOLS_NOTE = '部分 AI 工具需要付費訂閱，費用唔包喺學費入面，由工具公司直接收取；付款前會列明要用邊啲工具。';

const OFFER = {
  course:     { slug:'ai-course', img:'demo-ai-course', name:'AI 課程', alt:'AI 課程示範圖：發光嘅神經網絡同電腦介面', short:`由零開始學識日常同工作用得着嘅 AI 工具（${LANG}）。` },
  vibe:       { slug:'vibe-coding', img:'demo-vibe-coding', name:'Vibe Coding', alt:'Vibe Coding 示範圖：用自然語言同 AI 一齊寫程式嘅畫面', short:'用自然語言叫 AI 幫你寫程式，砌出自己嘅小工具同網頁。' },
  imgvid:     { slug:'image-video-generation', img:'demo-image-video', name:'Image & Video Generation', alt:'AI 圖像及影片生成示範圖：多格生成畫面同影片時間軸', short:'用 AI 生成圖像同短片，由 prompt 做到可以用嘅成品。' },
  consultant: { slug:'ai-consultant', img:'demo-ai-consultant', name:'AI Consultant', alt:'AI 顧問服務示範圖：顧問同客戶睇住 AI 數據儀表板', short:'按你嘅工作流程，一齊研究 AI 可以用喺邊度。' },
};
const fig = (o, sizes='(max-width:760px) 100vw, 380px') => `<figure>
<img src="/assets/img/${o.img}-800.webp" srcset="/assets/img/${o.img}-480.webp 480w, /assets/img/${o.img}-800.webp 800w, /assets/img/${o.img}-1200.webp 1200w" sizes="${sizes}" width="800" height="500" loading="lazy" decoding="async" alt="${esc(o.alt)}（${AI}）">
<figcaption class="ailabel">${AI}</figcaption></figure>`;

// Social links — only verified ones are shown (QA M2, 2026-10-19). Restore the others here once Mikey confirms them.
// Social links (Mikey, 2026-10-19 via v11 brief). Edit here only.
const SOCIAL = [
  { name: 'YouTube', label: 'YouTube', url: 'https://www.youtube.com/@mikemike88' }, // confirmed by Mikey 2026-10-19
  { name: 'Instagram', label: 'Instagram', url: 'https://www.instagram.com/mikeng_course' },
  { name: 'Facebook', label: 'Facebook', url: 'https://www.facebook.com/mikengcourse' },
  { name: 'LinkedIn', label: 'LinkedIn', url: 'https://www.linkedin.com/in/mike-ng-0916976b' },
];
const ADDRESS = '香港荃灣中心大廈19樓E室'; // Mikey confirmed 2026-10-19 (copy.md v17)
const CONTACT = { phone: '6405 9475', tel: '+85264059475', wa: 'https://wa.me/85264059475', email: 'admin@mikeng-ai.com' };
const PHONE_HTML = `<a href="tel:${CONTACT.tel}">${CONTACT.phone}</a>（<a href="${CONTACT.wa}" rel="noopener">WhatsApp</a>）`;
const EMAIL_HTML = `<a href="mailto:${CONTACT.email}">${CONTACT.email}</a>`;
const ATTEND = {
  'online-video': '已開始觀看課程內容，即當已出席。',
  'online-1on1': '第一次上堂開始咗，即當已出席。',
  'in-person': '第一堂點名時已經點名，即當已出席。',
};
const ORG = { '@context':'https://schema.org', '@type':'Organization', name:'mikeng_course', legalName:'MR Workshop', alternateName:'mikeng-ai.com', url:SITE,
  address:{ '@type':'PostalAddress', streetAddress:'荃灣中心大廈19樓E室', addressLocality:'Tsuen Wan', addressRegion:'Hong Kong', addressCountry:'HK' },
  sameAs: SOCIAL.filter(x => x.url).map(x => x.url), email: CONTACT.email, telephone: CONTACT.tel,
  contactPoint: [{ '@type':'ContactPoint', contactType:'customer service', telephone: CONTACT.tel, email: CONTACT.email, areaServed:'HK', availableLanguage:['yue','zh-Hant','en'] }] };
const eventLD = s => ({ '@context':'https://schema.org', '@type':'Event', name:s.title, startDate:s.start, endDate:s.end,
  eventAttendanceMode:'https://schema.org/OnlineEventAttendanceMode', eventStatus:'https://schema.org/EventScheduled', inLanguage:'yue-Hant-HK',
  isAccessibleForFree:true, location:{ '@type':'VirtualLocation', url:SITE+'/seminar' }, organizer:{ '@type':'Organization', name:'mikeng_course', url:SITE },
  performer:{ '@type':'Person', name:'Mike Ng' }, offers:{ '@type':'Offer', price:'0', priceCurrency:'HKD', availability:'https://schema.org/InStock', url:SITE+'/seminar' } });
const COURSE_LD = { '@context':'https://schema.org', '@type':'Course', name:'Hermes AI 智能體入門：自動化工作流程同多智能體協作', description:`mikeng_course AI 網上視頻課程（${LANG}），由付款日起可觀看 1 年。`, inLanguage:'yue-Hant-HK',
  provider:{ '@type':'Organization', name:'mikeng_course', url:SITE },
  offers:[{ '@type':'Offer', name:'網上視頻課程：'+'Hermes AI 智能體入門：自動化工作流程同多智能體協作', price:'588', priceCurrency:'HKD', category:'Paid' },{ '@type':'Offer', name:'網上1對1收費課程（合共 6 小時）', price:'1288', priceCurrency:'HKD', category:'Paid' },{ '@type':'Offer', name:'現場上堂課程：'+'AI與設計及文書多功能使用班', price:'2200', priceCurrency:'HKD', category:'Paid' }],
  hasCourseInstance:{ '@type':'CourseInstance', courseMode:'online', courseWorkload:'P1Y' } };

const COURSE2_LD = { '@context':'https://schema.org', '@type':'Course', name:'AI與設計及文書多功能使用班', description:`mikeng_course 現場上堂課程（${LANG}）：${IP.courses.length} 個課程可分開報讀，每個 8 堂，合共 24 小時。`, inLanguage:'yue-Hant-HK', provider:{ '@type':'Organization', name:'mikeng_course', url:SITE }, offers:{ '@type':'Offer', price:'2200', priceCurrency:'HKD', category:'Paid' }, hasCourseInstance:{ '@type':'CourseInstance', courseMode:'onsite' } };
const NAV = [['/', '主頁'], ['/services', '服務'], ['/courses', '課程'], ['/instructors', '導師'], ['/seminar', 'Seminar 報名'], ['/contact', '聯絡']];
const ARROW = (d = true) => `<svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none"${d ? ' class="-rotate-45"' : ''}><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const cur = (h, path) => h === path || (h !== '/' && path.startsWith(h + '/'));
function siteHeader(path) {
  return `<header class="site-header flex items-center justify-between">
<a class="wordmark" href="/" aria-label="mikeng_course 主頁">Mikeng-ai<span class="wordmark-domain">.com</span><span class="logo-dot"></span></a>
<nav class="desktop-navigation items-center" aria-label="主選單">${NAV.map(([h, t]) => `<a href="${h}" class="nav-link${cur(h, path) ? ' current' : ''}"${cur(h, path) ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
<button class="menu-toggle" type="button" aria-label="打開選單" aria-expanded="false" aria-controls="mobile-navigation"><span class="menu-line first"></span><span class="menu-line last"></span></button>
</header>
<nav id="mobile-navigation" class="mobile-navigation" aria-label="手機選單" hidden>${NAV.map(([h, t]) => `<a href="${h}"${cur(h, path) ? ' aria-current="page"' : ''}>${t}${ARROW()}</a>`).join('')}</nav>`;
}
function cinematicFooter() {
  return `<footer id="contact-footer" class="cinematic-footer">
<div class="footer-aurora" aria-hidden="true"></div><div class="footer-particles" aria-hidden="true">${Array.from({ length: 16 }, (_, i) => `<i style="left:${(i * 37) % 100}%;top:${(i * 23) % 85}%;animation-delay:${i * -0.8}s"></i>`).join('')}</div>
<div class="footer-invitation finale-reveal"><p class="section-kicker">THE NEXT POSSIBILITY</p><h2>Have an idea<br>worth bringing<br><em>to life?</em></h2><p class="hero-zh">想用 AI 做啲乜？話我知。</p>
<a class="create-cta" href="/contact">查詢／聯絡 <span aria-hidden="true">→</span></a>
<p class="footer-email">WhatsApp／電話 ${PHONE_HTML}｜電郵 ${EMAIL_HTML}</p></div>
<div class="footer-directory"><a href="/" class="wordmark">Mikeng-ai<span class="wordmark-domain">.com</span><span class="logo-dot"></span></a>
<nav aria-label="頁尾選單"><span>網站</span>${NAV.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}${HOOKS.account ? '<a href="/account">學員登入</a>' : ''}<!-- BACKEND HOOK: customer area link, only when the backend is mounted --></nav>
<nav aria-label="社交媒體"><span>ELSEWHERE｜其他平台</span>${SOCIAL.map(x => `<a href="${x.url}" target="_blank" rel="noopener noreferrer">${x.label} <span aria-hidden="true">↗</span></a>`).join('')}</nav><nav aria-label="條款"><span>LEGAL</span><a href="/terms">使用及購買條款</a><a href="/privacy">私隱政策及收集個人資料聲明</a><a href="/refund">退款條款</a><a href="/unsubscribe">取消訂閱 Unsubscribe</a></nav></div>
<div class="legal"><p>mikeng_course（營運者：MR Workshop）｜網站：mikeng-ai.com｜地址：${ADDRESS}｜電話：${PHONE_HTML}｜電郵：${EMAIL_HTML}</p>
<p>${AI}：本網站示範圖及背景圖（包括首頁人像同機械人合成圖）均由 AI 生成，只作示意，並非真實學員作品或客戶項目。</p></div>
<div class="footer-base"><span>© 2026 mikeng_course（MR Workshop）</span><span>IMAGINATION MEETS POSSIBILITY.</span><a href="#top">返回頂部 ↑</a></div>
</footer>`;
}
function layout({ title, desc, path, body, ld = [], minimalNav = false, canonical = true, heroPage = false, noindex = false }) {
  return `<!doctype html><html lang="zh-Hant-HK"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="${noindex || !INDEXABLE ? 'noindex,nofollow' : 'index,follow'}">
${canonical ? `<link rel="canonical" href="${SITE}${path}">` : ''}
<meta property="og:type" content="website"><meta property="og:site_name" content="mikeng_course"><meta property="og:locale" content="zh_HK"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">${canonical ? `<meta property="og:url" content="${SITE}${path}">` : ''}
<meta property="og:image" content="${SITE}/assets/img/demo-ai-course.jpg"><meta property="og:image:width" content="1280"><meta property="og:image:height" content="720"><meta property="og:image:alt" content="AI 課程示範圖（${AI}）">

<meta name="theme-color" content="#090b10"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">${heroPage ? '<link rel="preload" as="image" href="/assets/img/template/BG_IMAGEs_1.webp" fetchpriority="high">' : ''}
<link rel="stylesheet" href="/assets/css/template.css"><link rel="stylesheet" href="/assets/css/site.css">
${[ORG, ...ld].map(j => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}
<!-- Analytics placeholder (self-hosted Umami, cookieless, 12-month retention). Enable at launch only:
<script defer src="https://stats.mikeng-ai.com/script.js" data-website-id="[UMAMI_WEBSITE_ID]"></script> -->
<script defer src="/assets/js/site.js"></script>
</head><body id="top"><a class="skip skip-link" href="#main">跳到主要內容</a>
${heroPage ? '' : `<div class="page-header">${siteHeader(path)}</div>`}
<main id="main"${heroPage ? '' : ' class="inner"'}>${body}</main>
${cinematicFooter()}
</body></html>`;
}

const formatCard = () => `<h3>形式及價錢</h3><p>可以經以下形式學：</p><ul>
<li>免費講座試堂：免費</li><li>網上視頻課程「${P['online-video'].course}」：${P['online-video'].priceLabel}（由付款日起可觀看 1 年）</li>
<li>網上1對1收費課程：${P['online-1on1'].priceLabel}（${P['online-1on1'].detail}）</li><li>現場上堂課程「${P['in-person'].course}」：${IP.courses.length} 個課程可分開報讀，每個 ${P['in-person'].priceLabel}（${P['in-person'].detail}）</li></ul>
<p class="small">每個形式涵蓋邊啲範疇：${sylProduct() ? `${P[sylProduct()].name}主題係 ${sylFor(sylProduct()).topic}，詳見 <a href="/courses/online-video#syllabus-${sylProduct()}">網上課程</a>；其他形式：${ph('課程大綱 — 待確認')}` : ph('課程大綱 — 待確認')}。冇另外收費嘅「顧問套餐」或其他價錢。</p><p class="small muted">${TOOLS_NOTE}</p>`;
function priceTable() {
  return `<div class="tablewrap prices"><table><caption class="small muted" style="text-align:left;padding:12px">標準價目表（港幣）。冇隱藏收費；第三方 AI 工具訂閱（如需要）另計，付款前列明。</caption>
<thead><tr><th scope="col">項目</th><th scope="col">形式</th><th scope="col">價錢</th><th scope="col"></th></tr></thead><tbody>
<tr><td data-l="項目"><strong>免費講座試堂（SEMINAR 免費上堂體驗）</strong></td><td>Zoom 網上直播，廣東話為主、夾雜英文，2 小時</td><td class="price">免費</td><td><a class="btn sm" href="/seminar">報名</a></td></tr>
<tr><td><strong>網上視頻課程：${P['online-video'].course}</strong></td><td>網上錄播，由付款日起可觀看 1 年</td><td class="price">HK$588</td><td><a class="btn sm ghost" href="/courses/online-video">了解</a></td></tr>
<tr><td><strong>${P['online-1on1'].name}</strong></td><td>網上 1 對 1，合共 6 小時</td><td class="price">HK$1,288</td><td><a class="btn sm ghost" href="/courses/online-1on1">了解</a></td></tr>
<tr><td><strong>現場上堂課程：${P['in-person'].course}</strong></td><td>現場面授，${IP.courses.length} 個課程可分開報讀，每個 ${P['in-person'].detail}</td><td class="price">HK$2,200</td><td><a class="btn sm ghost" href="/courses/in-person">了解</a></td></tr>
</tbody></table></div><p class="small muted">退款：${REFUND_ALL}詳見 <a href="/refund">退款條款</a>。</p>`;
}

// Hermes: 3 ways to learn (copy.md v17 §2.3 / Q5A)
const hermesCompare = () => { const rows = [
  ['課程', `<a href="/courses/online-video">${P['online-video'].course}</a>`, '<a href="/courses/online-1on1">網上1對1收費課程</a>', '<a href="/courses/in-person/hermes-agent">Hermes 智能體：建立自主 AI 工作流程同多智能體系統</a>'],
  ['價錢', 'HK$588', 'HK$1,288', 'HK$2,200'],
  ['形式', '網上錄播，自己按進度睇', '網上 1 對 1，同導師網上直接上', '現場面授'],
  ['時數', `影片總時數 ${ph('待確認')}`, '合共 6 小時', '8 堂 × 3 小時，合共 24 小時'],
  ['幾時上', '由付款日起可觀看 1 年', `預約安排 ${ph('待確認')}`, `上課日期及時間 ${ph('待提供')}`],
  ['導師即時解答', `錄播，冇直播；問答／支援方式 ${ph('待確認')}`, '有，上堂時直接問', '有，課堂上直接問'],
  ['內容', `同課程 ${HERMES_DN} 一樣嘅兩個模組：認識 Hermes 智能體；連接工具、自動化工作`, `同左；6 小時點樣分配 ${ph('待確認')}`, `同左，現場實戰；8 堂內容分配 ${ph('待確認')}`],
  ['幾時唔可以再退款', '已開始觀看', '已出席任何一堂', '已出席任何一堂']];
  return `<div class="tablewrap compare"><table><thead><tr><th scope="col"></th><th scope="col">網上視頻課程</th><th scope="col">網上1對1收費課程</th><th scope="col">現場上堂課程 ${HERMES_DN}</th></tr></thead><tbody>${rows.map(([h, ...c]) => `<tr><th scope="row">${h}</th>${c.map(x => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
<p class="small muted">三個都係付款後 3 個工作天內可申請退款（${REFUND_FEE}），但已出席任何一堂（網上視頻課程即已開始觀看）便不設退款。部分 AI 工具需要另外付費訂閱，費用唔包喺學費入面。</p>`; };
const hermesSection = () => `<section id="hermes-compare"><div class="wrap"><p class="section-kicker">Hermes 智能體三種學法點揀？</p><h2>同一套 Hermes 內容，三種學法</h2><p class="lead">揀最啱你時間同學習方式嘅一種。</p>${hermesCompare()}</div></section>`;
const FAQ = [
  ['會唔會硬銷？', '唔會。講座大部分時間係示範同問答，課程資料只喺尾段講約 3 分鐘，唔買完全冇問題。冇倒數計時、冇「今日限定」。講座後如你有剔選同意接收推廣電郵，最多再收到一封課程資料跟進；冇同意嘅話，我哋唔會向你推廣。'],
  ['YouTube 有咁多免費 AI 教學，點解要上課？', '免費資源真係好多。如果你習慣自己搵、自己試，可能已經夠用。課程多嘅係有系統嘅次序、完整工作流程同問答。建議先嚟免費講座，睇吓呢種教法啱唔啱你先決定。'],
  ['AI 工具變得咁快，學完會唔會好快過時？', '會變嘅係工具同按鈕位；唔會變嘅係判斷、寫清楚指示同溝通方法。講座有一段專講「乜會變、乜唔會變」。網上視頻課程由付款日起可觀看 1 年。'],
  ['用廣東話定英文教？', '廣東話為主、夾雜英文（工具名同專有名詞多數用英文）。講座同課程都係咁。'],
  ['有乜上堂形式？幾錢？', `免費講座試堂（Zoom，2 小時）：免費｜網上視頻課程「${P['online-video'].course}」（由付款日起可觀看 1 年）：HK$588｜網上1對1收費課程（合共 6 小時）：HK$1,288｜現場上堂課程「${P['in-person'].course}」（${IP.courses.length} 個課程可分開報讀，每個 ${P['in-person'].detail}）：每個 HK$2,200。價錢公開，冇隱藏收費（第三方 AI 工具訂閱另計）。`],
  [`網上視頻、網上 1 對 1 同現場課程 ${HERMES_DN}（Hermes）有乜分別？`, `三個都係教同一套 Hermes 智能體內容，分別喺學法同時數：${hermesCompare()}`],
  ['可唔可以退款？條件係乜？', `可以（${REFUND_FEE}），但要同時符合兩個條件：(1) 喺付款後 3 個工作天內提出申請；同埋 (2) 未出席任何一堂。點樣先算已出席：網上視頻課程＝已開始觀看；網上 1 對 1＝第一次上堂開始咗；現場上堂＝第一堂點名。${REFUND_DAYS}一旦已出席，就算仲喺 3 個工作天內，都不設退款。${REFUND_HOW}所有收費課程條款相同。完整條款見 <a href="/refund">退款條款</a>。`],
  ['要唔要另外俾錢買 AI 工具？', `部分 AI 工具需要付費訂閱，費用唔包喺學費入面，由工具公司直接收。付款前會列明：${ph('付費 AI 工具清單及大約月費 — 待提供')}。免費講座唔需要你買任何工具。`],
  ['我好忙，冇時間點算？有冇重溫？', `免費講座有重溫，觀看期為收到重溫連結後 2 日內。網上視頻課程由付款日起可觀看 1 年，按自己進度睇。網上 1 對 1 時間預約安排：${ph('待確認')}。現場上堂要親身出席，上課日期：${ph('待提供')}，缺課安排：${ph('待提供')}。`],
  ['唔識寫程式／唔係做設計，得唔得？', `得。四大範疇（AI 課程、Vibe Coding、圖像及影片生成、AI 顧問）大部分由基本開始講，唔限行業，${IP.courses.length} 個現場課程都唔需要寫程式經驗。個別現場課程有入門要求（例如 Google Flow 課程要對剪片或 AI 工具有初步概念），詳見 <a href="/courses/in-person">現場上堂課程</a>。想先睇吓啱唔啱你，可以先嚟免費講座。${ph('入門要求 — 待確認')}`],
  ['可唔可以用持續進修基金（CEF）？', `${ph('CEF/QF 狀況 — 待確認')} 照實講：除非課程已登記為 CEF 可發還課程，否則唔可以用 CEF。如果你一定要 CEF 或 QF 認可，呢個課程可能唔適合你。`],
  ['學完會唔會幫我搵到工或者多賺錢？', '唔會作呢種保證。課程教嘅係工作方法，實際成果視乎你嘅投入、練習同經驗。'],
  ['網站啲圖係咪學員作品？', '唔係。服務示範圖由 AI 生成，標示咗「AI 生成示範視覺效果」，只作示意。'],
  ['我嘅個人資料點處理？', '報名講座需要名稱、電郵同手機號碼；手機號碼係必填，只用嚟經 WhatsApp 發講座提示，唔會用嚟推廣。推廣只經電郵，要你另外剔選同意，唔同意都唔影響報名。詳見 <a href="/privacy">私隱政策</a>。'],
];

const STEPS = [
  { id: 'vision', title: '主頁', sub: '我哋嘅目標', copy: '用廣東話學識用得着嘅 AI。由一個好奇心開始，變成你每日用得着嘅工作方法。', action: '了解我哋嘅方向', icon: 'spark', detail: '用廣東話學識用得着嘅 AI', body: '我哋嘅目標好簡單：用真實工作示範，教你將 AI 放入日常工作。示範包括失敗位同點執，唔係淨係剪靚嘅部分。', items: ['廣東話為主、夾雜英文，有問題直接問', '真實工作示範，包括失敗位', '價錢同條款透明，付款前全部列明'], href: '/' },
  { id: 'service', title: '服務', sub: 'AI 課程・Vibe Coding・圖像及影片生成・AI 顧問', copy: '四大範疇，搵出你嘅想法同工具之間嘅連繫。', action: '睇四大範疇', icon: 'orbit', detail: '由一個問題，到一個方向。', body: 'AI 課程、Vibe Coding、Image & Video Generation、AI Consultant。範疇唔係另外收費嘅產品；每個上堂形式涵蓋邊啲範疇，以課程大綱為準。', items: ['AI 課程：由零開始學識常用 AI 工具', 'Vibe Coding：用自然語言叫 AI 幫你寫程式', '圖像及影片生成：由 prompt 做到成品', 'AI 顧問：一齊研究 AI 用喺你工作嘅邊幾步'], href: '/services' },
  { id: 'consultant', title: '導師', sub: '導師背景同強項', copy: '認識 Mike Ng（Mikey）：香港設計師，用真實工作去試 AI。', action: '認識導師', icon: 'person', detail: '一位用真實工作試 AI 嘅設計師。', body: '好用嘅、唔好用嘅、出錯點執，都照實講。YouTube @mikemike88 分享實測。其他導師資料待提供。', items: ['Mike Ng（Mikey）：香港設計師', '範疇及年資：待 Mikey 確認', '其他導師：導師資料待提供'], href: '/instructors' },
  { id: 'seminar', title: 'Seminar', sub: '免費講座日期同形式', copy: '', action: '報名免費講座', icon: 'calendar', detail: '先嚟試一堂，覺得啱先再講。', body: '', items: [], href: '/seminar' },
  { id: 'courses', title: '網上及現場課程', sub: '報名同付款', copy: '網上視頻、網上 1 對 1、現場上堂，揀適合你嘅形式。', action: '睇課程同價錢', icon: 'course', detail: '你嘅下一章，由學習開始。', body: '三個收費課程都可以網上報名（示範模式，未接通付款），亦可以先查詢。價錢全部公開。', items: ['網上視頻課程：HK$588（由付款日起可觀看 1 年）', '網上1對1收費課程：HK$1,288（合共 6 小時）', '現場上堂課程：HK$2,200（' + P['in-person'].detail + '）'], href: '/courses' },
];
const ICON = k => `<svg viewBox="0 0 40 40" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${k === 'spark' ? '<path d="M20 7 23 17 33 20 23 23 20 33 17 23 7 20 17 17Z"/><path d="m30 5 1 4 4 1-4 1-1 4-1-4-4-1 4-1Z"/>' : k === 'orbit' ? '<circle cx="20" cy="20" r="5"/><ellipse cx="20" cy="20" rx="16" ry="8" transform="rotate(-40 20 20)"/><path d="M12 7c7 0 18 17 17 24"/>' : k === 'person' ? '<circle cx="20" cy="13" r="6"/><path d="M9 33v-3a11 11 0 0 1 22 0v3M5 26v-3m30 3v-3"/>' : k === 'calendar' ? '<rect x="7" y="9" width="26" height="25" rx="4"/><path d="M7 17h26M14 6v7m12-7v7m-12 11h4m5 0h3m-12 5h4"/>' : '<path d="m4 14 16-8 16 8-16 8ZM10 18v10c6 6 14 6 20 0V18M36 14v14"/>'}</svg>`;
function home() {
  const s = confirmed()[0];
  const steps = STEPS.map(x => x.id !== 'seminar' ? x : { ...x,
    copy: s ? `${s.dateLabel} ${s.timeLabel}｜${s.platform}｜免費` : '暫時未有已確認場次。',
    body: s ? `2 小時 Zoom 講座，${s.language}。課程資料只喺尾段講約 3 分鐘，唔會硬銷。收到重溫連結後 ${s.replayDays} 日內可重溫。` : '暫時未有已確認場次。',
    items: s ? [`日期：${s.dateLabel}`, `時間：${s.timeLabel}`, `形式：${s.platform}｜免費，唔使訂金`] : [] });
  const works = Object.values(OFFER);
  const body = `<section id="home" class="hero relative isolate overflow-hidden text-white" aria-labelledby="hero-title">
<img class="hero-background absolute inset-0 -z-30 h-full w-full object-cover" src="/assets/img/template/BG_IMAGEs_1.webp" alt="AI 生成示範視覺效果：未來城市背景" fetchpriority="high" decoding="async" width="1536" height="768">
<span class="hero-ai-label">${AI}</span>
<div class="character-reveal" aria-hidden="true"><img src="/assets/img/template/BG_IMAGEs_2.webp" alt="AI 生成示範視覺效果：人像同機械人合成圖" width="1536" height="768" draggable="false" class="character-reveal-image" loading="eager" decoding="async"></div>
<div class="hero-atmosphere pointer-events-none absolute inset-0 -z-20" aria-hidden="true"></div>
${siteHeader('/')}
<div id="hero-content" class="hero-content">
<p class="eyebrow">AI CONSULTANT <span>/</span> AI COURSE PROVIDER <span class="eb-tail">/</span><br class="eyebrow-break"> 香港 AI 電腦教學｜廣東話為主、夾雜英文</p>
<h1 id="hero-title">Where<br>Creativity Meets<br><span>Technology</span></h1>
<p class="hero-zh">用廣東話學識用得着嘅 AI</p>
<p class="hero-description">AI 課程、Vibe Coding、圖像及影片生成、AI 顧問。<br class="description-break">先嚟免費 2 小時 Zoom 講座，睇我用真實工作由頭做到尾，覺得啱先再講。</p>
<a href="/courses/online-video" class="course-cta group inline-flex items-center"><span class="cta-circle flex items-center justify-center">${ARROW()}</span><span>View My <span class="course-word">COURSE</span>｜睇課程</span></a>
${s ? `<a class="hero-next-card" href="/seminar"><span class="hnc-k">下一場免費講座</span><strong>${s.dateLabel}</strong><span>${s.timeLabel}｜Zoom｜免費</span><span class="hnc-cta">揀日子報名 →</span></a>` : ''}
</div>
<aside class="discipline-indicator" aria-label="範疇"><span class="indicator-line"></span>${['AI', 'CODE', 'IMAGE', 'VIDEO'].map((t, i) => `<span class="discipline${i ? '' : ' active'}">${t}</span>`).join('')}<span class="indicator-line"></span></aside>
<span class="reveal-hint" aria-hidden="true">MOVE TO REVEAL｜移動滑鼠睇隱藏畫面</span>
<a href="#explore" class="scroll-cue inline-flex items-center"><span class="scroll-stem" aria-hidden="true"></span>SCROLL TO EXPLORE｜向下睇更多</a>
<span class="hero-index" aria-hidden="true">01 <span>/</span> 04</span>
</section>

<section id="explore" class="creative-process" aria-labelledby="process-title">
<div class="process-haze" aria-hidden="true"></div>
<header class="process-heading"><div><p class="section-kicker"><span class="process-live-dot"></span> THE CREATIVE JOURNEY</p><h2 id="process-title">Every possibility<br>begins with a <em>spark.</em></h2><p class="hero-zh" style="margin-top:14px">每個可能，都由一個火花開始。</p></div><div class="process-intro"><span>CREATIVE PROCESS / 01—05</span><p>由第一個想法，到你嘅下一章。<br>跟住光，搵你自己嘅路。</p></div></header>
<nav class="process-navigation" aria-label="流程步驟">${steps.map((x, i) => `<a href="#${x.id}" aria-label="${i + 1}：${x.title}"><span>0${i + 1}</span><span class="process-nav-label">${x.title}</span></a>`).join('')}</nav>
<div class="process-journey">
<svg class="process-path" viewBox="0 0 1000 1500" preserveAspectRatio="none" fill="none" aria-hidden="true"><defs><linearGradient id="journey-light" x1="0" y1="0" x2="0" y2="1500" gradientUnits="userSpaceOnUse"><stop stop-color="#c7b8f4"/><stop offset=".5" stop-color="#dbaac9"/><stop offset="1" stop-color="#a89cec"/></linearGradient></defs>${['path-bed', 'path-glow', 'path-light'].map(c => `<path class="${c}" pathLength="1" d="M500 0 C500 75 360 75 360 150 C360 300 640 300 640 450 C640 600 360 600 360 750 C360 900 640 900 640 1050 C640 1200 360 1200 360 1350 C360 1425 500 1425 500 1500"/>`).join('')}</svg>
<ol class="process-steps">${steps.map((x, i) => `<li class="process-step" id="${x.id}">
<a class="process-node" href="#${x.id}" aria-label="第 ${i + 1} 步：${x.title}">${ICON(x.icon)}<span>0${i + 1}</span></a>
<button class="process-card" type="button" data-step="${i}" aria-haspopup="dialog" aria-controls="process-detail"><span class="process-step-label">0${i + 1} <span>/</span> ${x.sub}</span><h3>${x.title}</h3><p>${x.copy}</p><span class="process-action">${x.action}<span aria-hidden="true">↗</span></span></button>
</li>`).join('')}</ol></div>
<div class="process-end"><span class="process-end-spark" aria-hidden="true">✧</span><p>THE NEXT CHAPTER IS YOURS.<br>下一章由你寫。</p><a href="/seminar">免費報名試堂講座 <span aria-hidden="true">→</span></a></div>
<dialog id="process-detail" class="process-dialog" aria-labelledby="process-dialog-title"><div class="process-dialog-inner"><button class="process-close" type="button" aria-label="關閉">×</button><p class="section-kicker" data-k></p><h2 id="process-dialog-title" data-d></h2><p class="process-dialog-copy" data-b></p><ul data-i></ul><a class="process-dialog-next" data-h href="/">前往呢一頁<span aria-hidden="true">↗</span></a></div></dialog>
<script type="application/json" id="process-data">${JSON.stringify(steps.map(x => ({ t: x.title, d: x.detail, b: x.body, i: x.items, h: x.href })))}</script>
</section>

<div class="portfolio-finale">
<section id="selected-works" class="selected-works finale-section" aria-labelledby="works-title">
<header class="finale-section-heading finale-reveal"><div><p class="section-kicker">03 / 四大範疇</p><h2 id="works-title">Things you can<br><em>bring to life.</em></h2><p class="hero-zh" style="margin-top:14px">用 AI 將想法變成真。</p></div><p>以下示範圖由 AI 生成，只作示意，<br>並非學員作品或客戶項目。</p></header>
<div class="works-editorial">${works.map((o, i) => `<article class="work-editorial work-editorial-${i + 1} finale-reveal">
<a class="work-card" href="/services#${o.slug}" aria-label="${o.name}：了解更多"><span class="work-image-wrap" data-parallax><img src="/assets/img/${o.img}-1200.webp" srcset="/assets/img/${o.img}-800.webp 800w, /assets/img/${o.img}-1200.webp 1200w" sizes="(max-width:760px) 100vw, 60vw" alt="${esc(o.alt)}（${AI}）" loading="lazy" decoding="async" width="1200" height="750"></span>
<span class="work-art-label">0${i + 1} / ${o.name}</span><span class="work-ai-label">${AI}</span><span class="work-view">了解更多 <span aria-hidden="true">→</span></span><span class="work-corner" aria-hidden="true">0${i + 1}</span></a>
<div class="work-caption"><div><h3>${o.name}</h3><p>${o.short}</p></div></div></article>`).join('')}</div>
<div class="works-colophon"><span>四大範疇 / 01—04</span><p>Imagined worlds. Human possibilities.<br>想像嘅世界，人嘅可能。</p></div>
</section>
<section class="finale-section" id="prices" aria-labelledby="price-title"><div style="max-width:1300px;margin:auto">
<header class="finale-section-heading finale-reveal" style="margin-bottom:40px"><div><p class="section-kicker">04 / 標準價目表</p><h2 id="price-title">Learn your <em>way.</em></h2></div><p>點樣開始：報名免費講座 → Zoom 上一堂 →<br>覺得啱先揀上堂形式。</p></header>
${priceTable()}
<div class="grid g2" style="margin-top:60px;align-items:center"><div class="card"><picture class="avatar photo"><source srcset="/assets/img/mike.webp" type="image/webp"><img src="/assets/img/mike.jpg" alt="Mike Ng（伍家俊）相片" width="900" height="1200" loading="lazy" style="width:100%;height:100%;object-fit:cover;object-position:50% 25%"></picture><p class="section-kicker">導師</p><h3>Mike Ng（Mikey）</h3><p>香港設計師，用真實工作去試 AI：好用嘅、唔好用嘅、出錯點執，都照實講。YouTube @mikemike88 分享實測。${ph('一句可核實的項目／經驗 — 待 Mikey 提供')}</p><a class="btn ghost" href="/instructors">認識導師</a></div>
<div><p class="section-kicker">常見問題</p>${FAQ.map(([q, a]) => `<details><summary>${q}</summary><div class="faq-a">${a}</div></details>`).join('')}</div></div>
</div></section>
</div>`;
  return layout({ title:`mikeng_course｜香港 AI 課程（${LANG}）｜免費試堂講座`, desc:`AI 課程（${LANG}）：AI 課程、Vibe Coding、圖像及影片生成、AI 顧問。先嚟免費 2 小時網上講座，價錢全部公開。`, path:'/', body, heroPage:true, ld:[COURSE_LD, COURSE2_LD, ...confirmed().map(eventLD)] });
}

function services() {
  const blocks = [
    [OFFER.course, ['常用 AI 工具嘅實際用法，由簡單任務開始', '點樣寫清楚 prompt／指示，減少試錯', '將 AI 放入日常工作流程（包括設計及文書工作）', '分辨乜會變、乜唔會變'], ['想由零開始、有系統咁學 AI 嘅人', '睇咗好多 YouTube 但砌唔埋完整流程嘅人', `想以${LANG}學、可以即場問問題嘅人`], null],
    [OFFER.vibe, ['用自然語言同 AI 合作寫程式嘅基本方法', '由一個想法砌出可以用嘅小工具或網頁', '點樣檢查同修正 AI 寫嘅程式'], ['唔識寫程式、但想自己做小工具嘅人', '想加快工作嘅自由工作者同小團隊'], null],
    [OFFER.imgvid, ['AI 圖像生成：構圖、風格、修正', 'AI 短片生成：由靜態圖到短片', '整理成可以用嘅成品（例如提案 board、社交媒體素材）', '版權同使用條款要留意嘅地方'], ['內容創作者、小店經營者、設計同市場推廣工作者', '任何想將 AI 圖像／影片用喺工作嘅人'], null],
    [OFFER.consultant, ['了解你嘅工作流程同目標', '一齊研究 AI 可以用喺邊幾步', '建議工具同做法（不保證任何成效）'], ['想評估 AI 用喺自己工作嘅個人或小團隊'], null],
  ];
  const body = `<section class="page-hero"><div class="wrap"><p class="eyebrow">服務</p><h1>四大範疇</h1><p class="lead">全部以廣東話為主、夾雜英文教。示範圖由 AI 生成，只作示意，並非學員作品。</p></div></section>
${blocks.map(([o, learn, who, f]) => `<section id="${o.slug}"><div class="wrap grid g2" style="align-items:start"><div>${fig(o, '(max-width:760px) 100vw, 560px')}</div>
<div><h2>${o.name}</h2><p class="lead">${o.short}</p><h3>你會學到／得到</h3><ul>${learn.map(x => `<li>${x}</li>`).join('')}</ul><h3>適合邊個</h3><ul>${who.map(x => `<li>${x}</li>`).join('')}</ul>
<div class="card">${formatCard()}</div><p style="margin-top:16px"><a class="btn" href="/seminar">先嚟免費講座</a></p></div></div></section>`).join('')}${hermesSection()}`;
  return layout({ title:'服務：AI 課程、Vibe Coding、圖像及影片生成、AI 顧問｜mikeng_course', desc:'mikeng_course 四大範疇：AI 課程、Vibe Coding、Image & Video Generation、AI Consultant。上堂形式同價錢公開。', path:'/services', body });
}

function instructors() {
  const body = `<section class="page-hero"><div class="wrap"><p class="eyebrow">導師</p><h1>導師簡介</h1><p class="lead">只寫可核實嘅事實。</p></div></section>
<section><div class="wrap grid g2">
<article class="card hl"><picture class="avatar photo"><source srcset="/assets/img/mike.webp" type="image/webp"><img src="/assets/img/mike.jpg" alt="Mike Ng（伍家俊）相片" width="900" height="1200" loading="lazy" style="width:100%;height:100%;object-fit:cover;object-position:50% 25%"></picture><h2>Mike Ng（Mikey）伍家俊</h2><p class="muted">創辦人｜MR Workshop、Raw Furnishing Limited 設計總監</p>
<p>我係伍家俊 Mike Ng，大家叫我 Mikey。2016 年起做 Raw Furnishing Limited 設計總監，2020 年起做 MR Workshop 設計總監，負責中港兩地嘅室內設計同傢俬項目，由大型地盤、會所到商舖同住宅都有。日常工作包括地盤管理、判頭協調、標書準備、CAD 同 3D 繪圖，近年亦做 VR／MR 開發，同埋 AI 顧問、Vibe Coding、AI 圖像及影片生成同 AI 系統開發。我亦喺多間院校做過兼職講師。AI 工具出得好快，我嘅做法好簡單：攞真實工作去試。用得到嘅，我分享點樣用；用唔到、或者出錯嘅，我都照實講。</p>
<dl class="kv"><dt>現職</dt><dd>MR Workshop 設計總監（2020 年 3 月至今）<br>Raw Furnishing Limited 設計總監（2016 年 3 月至今）</dd><dt>兼職講師</dt><dd>CITYU、HKCT、FEVA、IVE/HKDI/HKIIT、CBCC、THEi、HKBU</dd><dt>學歷</dt><dd>PolyU Bachelor Degree (2001)<br>香港理工大學 Master of Product Engineering and Marketing（2002）<br>The DesignFirst Institute High Diploma of Interior and Environment Design（2008）</dd><dt>獎項</dt><dd><ul style="margin:0;padding-left:18px"><li>International Interior Design Awards — Other Groups Champion Gold Medal（2008）</li><li>Design first Modeling Gold Medal（2008）</li><li>International Interior Design Awards — Professional Furniture Bronze Medal（2019）</li><li>European Design Awards — Professional Honors（2019）</li><li>STD Furniture Design Awards — Professional Honors（2020）</li></ul></dd><dt>營運者及地址</dt><dd>mikeng_course（營運者：MR Workshop）｜${ADDRESS}</dd><dt>語言</dt><dd>廣東話、英文、普通話</dd><dt>真實項目</dt><dd>${ph('項目 1–3 — 待提供，須取得客戶同意')}</dd><dt>YouTube</dt><dd>@mikemike88</dd><dt>Instagram</dt><dd><a href="https://www.instagram.com/mikeng_course">mikeng_course</a></dd></dl>
<h3 style="margin-top:16px">教書原則</h3><ul><li>講真話：示範包括失敗位</li><li>廣東話為主、夾雜英文：有問題直接問</li><li>唔硬銷：免費講座以示範為主，課程介紹只佔尾段約 3 分鐘</li><li>價錢透明：價格、退款條款、要額外付費嘅工具事先寫清楚</li></ul></article>
${[1, 2].map(i => `<article class="card phcard"><div class="avatar">${ph('相片 — 待提供')}</div><h2>${ph('導師資料待提供')}</h2><p class="muted">導師 ${i}（佔位卡）｜授課形式：${ph('授課導師 — 待確認')}</p><p>${ph('姓名、範疇、可核實資歷 — 導師資料待提供')}</p></article>`).join('')}
</div></section>
<section><div class="wrap card" style="text-align:center"><h2>想親身睇 Mikey 點教？</h2><a class="btn" href="/seminar">免費報名試堂講座</a></div></section>`;
  return layout({ title:'導師簡介｜Mike Ng｜mikeng_course', desc:'mikeng_course 導師 Mike Ng（Mikey），用真實工作實測 AI，以廣東話為主、夾雜英文教。', path:'/instructors', body, ld:[{ '@context':'https://schema.org', '@type':'Person', name:'Mike Ng', alternateName:'伍家俊', jobTitle:'Design Director', image:'/assets/img/mike.jpg', worksFor:{ '@type':'Organization', name:'mikeng_course' }, alumniOf:[{ '@type':'CollegeOrUniversity', name:'The Hong Kong Polytechnic University' }], knowsLanguage:['yue','en','zh'] }] });
}

function seminar({ values = {}, errors = {} } = {}) {
  const list = confirmed();
  const v = k => esc(values[k] ?? '');
  const e = k => errors[k] ? `<p class="err" id="${k}-err">${errors[k]}</p>` : '';
  const aria = k => errors[k] ? ` aria-invalid="true" aria-describedby="${k}-err"` : '';
  const sel = values.session || (list[0] && list[0].id);
  const body = `<section class="page-hero"><div class="wrap grid g2" style="align-items:start">
<div><p class="eyebrow">SEMINAR 免費上堂體驗</p><h1>免費 AI 講座：真實工作示範，由 brief 做到成品</h1>
<p class="lead">2 小時 Zoom 講座，廣東話為主、夾雜英文。課程資料只喺尾段講約 3 分鐘，唔會硬銷。</p>${list[0] ? `<p class="hero-date"><strong>${list[0].dateLabel} ${list[0].timeLabel}</strong><br>${list[0].platform}｜${list[0].language}｜免費，唔使訂金</p>` : ''}<p><a class="btn" href="#form">免費報名 ↓</a></p>
<h2 style="font-size:22px;margin-top:24px">你會帶走乜</h2><ol><li>一套完整 AI 工作步驟，連常見失敗位同修正方法</li><li>點樣將 AI 成果整成睇得明嘅 board、文件或短片</li><li>判斷新 AI 工具「值唔值得學」嘅簡單方法</li><li>講座示範用嘅 prompt／範本 ${ph('免費資源內容 — 待確認')}</li></ol>
<h2 style="font-size:22px;margin-top:24px">流程</h2><div class="tablewrap"><table><tbody>
<tr><td>開場</td><td>我係邊個、今日流程。先講明：課程資料只喺尾段講約 3 分鐘，冇壓力。</td></tr><tr><td>示範一</td><td>用一個真實 brief 完整行一次 AI 流程，包括失敗同修正 ${ph('示範項目 — 待確認')}</td></tr><tr><td>示範二</td><td>將成果整成可以用嘅 board／短片</td></tr><tr><td>乜會變、乜唔會變</td><td>工具會換；判斷、寫清楚指示、溝通方法唔會過時</td></tr><tr><td>即場問答</td><td>有問題直接問</td></tr><tr><td>課程簡介（約 3 分鐘）</td><td>標準價目（網上視頻課程 HK$588；網上1對1收費課程 HK$1,288；現場上堂課程 HK$2,200）、書面退款條款、要額外付費嘅 AI 工具、邊啲人唔適合。冇倒數、冇「今日限定」。</td></tr><tr><td>講座後</td><td>電郵送上重溫（收到重溫連結後 2 日內可觀看）；之後最多一次課程資料跟進（只限已同意接收推廣電郵者），隨時可取消。</td></tr></tbody></table></div>
<h2 style="font-size:22px;margin-top:24px">未必適合你，如果</h2><ul><li>你想搵保證搵到工、加人工或增加收入嘅課程，我唔會作呢類承諾</li><li>你需要 CEF 資助或 QF 認可證書 ${ph('CEF/QF 狀況 — 待確認')}</li><li>你淨係想睇，唔打算自己動手試</li></ul>
<h2 style="font-size:22px;margin-top:24px" id="timetable">講座時間表（未來約 3 個月）</h2><ul class="timetable">${list.map(x => `<li><strong>${x.dateLabel}</strong> ${x.timeLabel}</li>`).join('')}</ul><p class="small muted">每月第 1 及第 3 個星期四舉行；如遇香港公眾假期會暫停嗰一場。</p>
<h2 style="font-size:22px;margin-top:24px">講座 FAQ</h2>
<details><summary>有冇重溫？</summary><p>有。講座後會電郵重溫連結，觀看期為收到重溫連結後 2 日內，到期後會如期下架。</p></details>
<details><summary>要準備乜？</summary><p>一部電腦或手機，裝好 Zoom。唔使預先安裝 AI 工具；想跟住試，可預備 ${ph('建議預備工具／帳戶 — 待確認')}。</p></details>
<details><summary>會唔會硬銷？</summary><p>唔會。課程資料只喺尾段講約 3 分鐘，冇倒數、冇「今日限定」。</p></details>
<details><summary>收唔收費？</summary><p>完全免費，唔使訂金，唔使信用卡。</p></details></div>
<div class="card hl" id="form"><h2>免費報名講座</h2>
${Object.keys(errors).length ? `<div class="errbox" role="alert" tabindex="-1" autofocus><strong>請修正以下項目：</strong><ul>${Object.values(errors).map(x => `<li>${x}</li>`).join('')}</ul></div>` : ''}
<form method="post" action="/api/seminar#form">
<fieldset class="sessions date-picker"><legend>① 揀一個日期</legend><p class="small muted" style="margin:0 0 6px">每場內容一樣，揀一場最方便你嘅就得。每月第 1 同第 3 個星期四，19:00–21:00（香港時間）。</p>
${S.flagged().map(x => `<div class="session paused" aria-disabled="true"><strong>${x.dateLabel}</strong>｜呢日暫停${x.holiday ? '（香港公眾假期）' : ''}</div>`).join('')}${list.length ? list.map(s => `<label class="session"><input type="radio" name="session" value="${s.id}"${s.id === sel ? ' checked' : ''} required><span><strong>${s.dateLabel}</strong><span class="badge">已確認</span><br>${s.timeLabel}｜${s.duration}<br>${s.platform}｜${s.language}｜免費<br><span class="small muted">重溫：收到重溫連結後 ${s.replayDays} 日內</span></span></label>`).join('') : '<p>暫時未有已確認場次。</p>'}
</fieldset>${e('session')}
<div class="f"><label for="name">名稱（稱呼）<span aria-hidden="true"> *</span></label><input id="name" name="name" type="text" required maxlength="60" autocomplete="name" placeholder="例如：陳小明 / Siu Ming" value="${v('name')}"${aria('name')}>${e('name')}</div>
<div class="f"><label for="email">電郵<span aria-hidden="true"> *</span></label><input id="email" name="email" type="email" required maxlength="120" autocomplete="email" placeholder="name@example.com" value="${v('email')}"${aria('email')}><p class="hint">用嚟寄 Zoom 連結同日曆邀請。</p>${e('email')}</div>
<div class="f"><label for="phone">WhatsApp 電話<span aria-hidden="true"> *</span></label><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required pattern="^(\\+?852)?[\\s\\-]*[2-9]\\d{3}[\\s\\-]?\\d{4}$" title="香港號碼請填 8 位數字" placeholder="+852 9123 4567" value="${values.phone !== undefined ? v('phone') : '+852 '}"${aria('phone')}><p class="hint">用嚟發講座提示，唔會用嚟推廣。</p>${e('phone')}</div>
<div class="f"><label class="check"><input type="checkbox" name="marketing" value="yes"${values.marketing ? ' checked' : ''}><span>（選填）我同意 mikeng_course 使用我嘅姓名及電郵，透過<strong>電郵</strong>向我發送 AI 課程、講座及優惠資訊。我可隨時免費取消。</span></label>
<p class="hint">呢項係選填。<strong>唔剔都唔會影響你報名免費講座</strong>，你照樣會收到確認、Zoom 連結、提示同重溫。取消方法：按電郵內「取消訂閱」、前往 <a href="/unsubscribe">/unsubscribe</a>，或聯絡 ${EMAIL_HTML}。</p></div>
<p class="small" id="reminder-note">${REMINDER_NOTE}</p>
<button class="btn" type="submit" style="width:100%" aria-describedby="reminder-note">下一步</button>
<p class="small muted" style="margin-top:12px">提交即表示你已閱讀<a href="/privacy#pics">《收集個人資料聲明》</a>。報名免費；除非你另外剔選同意，否則我哋唔會向你發送推廣訊息。</p>
</form></div></div></section>
<section><div class="wrap card hl" style="text-align:center"><h2>留個位，${list[0] ? '下一場 ' + list[0].dateLabel + ' Zoom 見' : '下一場日期待定'}</h2><a class="btn" href="#form">揀日子報名</a></div></section>`;
  return layout({ title:'免費 AI 講座｜SEMINAR 免費上堂體驗｜Zoom 講座', desc:'免費 2 小時 Zoom 講座（廣東話為主、夾雜英文），每月第 1 及第 3 個星期四 19:00–21:00（由 2026年12月3日起）。課程資料只喺尾段講約 3 分鐘，唔會硬銷。', path:'/seminar', body, ld:list.map(eventLD), minimalNav:true });
}

// Seminar step ②: review before submit (server-rendered, works without JS).
function seminarReview(v, s) {
  const hid = (k, x) => `<input type="hidden" name="${k}" value="${esc(x)}">`;
  const fields = hid('session', s.id) + hid('name', v.name) + hid('email', v.email) + hid('phone', v.phone) + (v.marketing ? hid('marketing', 'yes') : '');
  const body = `<section class="page-hero"><div class="wrap" style="max-width:720px"><div class="card hl" id="form"><p class="section-kicker">③ 確認</p><h1 style="font-size:32px">確認報名呢個日期？</h1>
<dl class="kv"><dt>日期</dt><dd><strong>${s.dateLabel}</strong></dd><dt>時間</dt><dd>${s.timeLabel}（${s.duration}）</dd><dt>形式</dt><dd>${s.platform}｜${LANG}｜免費</dd><dt>名稱</dt><dd>${esc(v.name)}</dd><dt>電郵</dt><dd>${esc(v.email)}</dd><dt>WhatsApp 電話</dt><dd>${esc(v.phone)}</dd><dt>推廣電郵</dt><dd>${v.marketing ? '同意（只經電郵，可隨時取消）' : '唔同意（唔會收到推廣）'}</dd></dl>
<p class="small">${REMINDER_NOTE}</p>
<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:18px">
<form method="post" action="/api/seminar#form">${fields}<input type="hidden" name="step" value="edit"><button class="btn ghost" type="submit">返回修改</button></form>
<form method="post" action="/api/seminar">${fields}<input type="hidden" name="step" value="confirm"><button class="btn" type="submit">確認</button></form></div><p class="small muted" style="margin-top:10px">按「確認」先會正式報名；按「返回修改」可以改日期或資料。</p></div></div></section>`;
  return layout({ title:'確認講座報名｜mikeng_course', desc:'確認你嘅免費講座報名資料。', path:'/seminar/review', canonical:false, noindex:true, body });
}
const REFUND_EX = { 'online-video': '已開始觀看課程內容', 'online-1on1': '第一次上堂已經開始', 'in-person': '第一堂點名時已經點名' };
const refundExamples = pid => `<details class="small"><summary>退款例子</summary><ul><li>星期三付款：星期三係第 1 日，最遲星期五 23:59 申請（期間冇公眾假期）。</li><li>星期五付款：星期五第 1 日、星期一第 2 日，最遲星期二申請。</li><li>星期六付款：由下星期一起計第 1 日，最遲星期三申請。</li><li>就算仲喺期限內，如果${REFUND_EX[kindOf(pid)]}，就不設退款。</li></ul></details>`;
const deadlineLine = (now, pid) => { try { const d = refundDeadline(now); return `<p class="deadline"><strong>如果現在付款，退款期限是 ${d.label}</strong><br><span class="small muted">${REFUND_FEE}。付款當日計第 1 日；週末及香港公眾假期不計。點樣先算已出席：${ATTEND[kindOf(pid)]}</span></p>`; } catch (err) { return `<p class="err">暫時未能計算退款期限，請聯絡我哋。</p>`; } };
function buyCard(pid, { values = {}, errors = {}, now = new Date() } = {}) {
  const p = P[pid]; const mine = values.product === pid;
  const v = k => mine ? esc(values[k] ?? '') : '';
  const e = k => mine && errors[k] ? `<p class="err" id="${pid}-${k}-err">${errors[k]}</p>` : '';
  const title = p.course ? `${p.name}｜${p.course}` : p.name;
  return `<div class="card hl" id="buy-${pid}"><p class="eyebrow">${title}</p><p class="price">${p.priceLabel} <small>一次性付款，港幣</small></p>
<p class="small ph" style="display:block;padding:8px">示範模式：付款功能未接通，按下唔會收取任何費用。</p>
${mine && Object.keys(errors).length ? `<div class="errbox" role="alert" tabindex="-1" autofocus><ul>${Object.values(errors).map(x => `<li>${x}</li>`).join('')}</ul></div>` : ''}
${deadlineLine(now, pid)}${refundExamples(pid)}
<form method="post" action="/api/checkout#buy-${pid}" novalidate><input type="hidden" name="product" value="${pid}">
<div class="f"><label for="${pid}-name">名稱 *</label><input id="${pid}-name" name="name" type="text" required maxlength="60" autocomplete="name" value="${v('name')}">${e('name')}</div>
<div class="f"><label for="${pid}-email">電郵 *</label><input id="${pid}-email" name="email" type="email" required maxlength="120" autocomplete="email" value="${v('email')}"><p class="hint">${pid === 'online-video' ? '課程登入資料會寄到呢個電郵。' : '我哋會用呢個電郵聯絡你安排上堂時間。'}</p>${e('email')}</div>
<div class="f"><label class="check"><input type="checkbox" name="agree" value="yes" required${mine && values.agree ? ' checked' : ''}><span>我已閱讀並明白：(1) <a href="/refund">退款條款</a>：付款後 3 個香港工作天內可申請退款（付款當日計第 1 日；星期六、日及公眾假期不計），${REFUND_FEE}，但已出席任何一堂（${ATTEND[kindOf(pid)].replace('，即當已出席。', '')}即當已出席）便不設退款；(2) 部分 AI 工具需要另外付費訂閱，費用唔包喺學費內；(3) 課程唔保證任何收入或就業成果；(4) 已閱讀 <a href="/terms">使用及購買條款</a> 同 <a href="/privacy">私隱政策</a>。</span></label>${e('agree')}</div>
<button class="btn" type="submit" style="width:100%;justify-content:center">立即購買 ${p.priceLabel}（示範）</button></form>
<p style="margin-top:12px"><a class="btn ghost sm" href="/contact?interest=${pid}">查詢 Enquire</a></p></div>`;
}
// ---- Course product pages (/courses/<slug>) ----
const COURSE_SLUGS = ['online-video', 'online-1on1', 'in-person'];
const crumbs = (pid) => `<nav class="small muted" aria-label="麵包屑" style="margin-bottom:14px"><a href="/">主頁</a> › <a href="/courses">課程</a>${pid ? ` › ${P[pid].name}` : ''}</nav>`;
const otherCourses = (pid) => `<section><div class="wrap"><p class="section-kicker">其他上堂形式</p><div class="grid g2">${COURSE_SLUGS.filter(x => x !== pid).map(x => `<a class="card" href="/courses/${x}" style="display:block"><h3>${P[x].name}${P[x].course ? '｜' + P[x].course : ''}</h3><p class="price">${P[x].priceLabel}</p><p class="small muted">${x === 'online-video' ? '網上錄播，由付款日起 1 年' : P[x].detail}</p><span class="small">了解更多 →</span></a>`).join('')}</div>
<p style="margin-top:20px"><a class="btn ghost" href="/courses">比較全部課程</a></p></div></section>`;
const ENQ = `<div class="card" id="enquire" style="margin-top:28px"><h3>查詢／預約</h3><p>三個收費課程都可以喺網上直接付款（示範模式）。想先問清楚，或者唔想網上付款，可以 WhatsApp／電話 ${PHONE_HTML} 或電郵 ${EMAIL_HTML}，或者用<a href="/contact">查詢表格</a>，註明想報邊個課程。所有收費課程退款條款相同：${REFUND_ALL}</p></div>`;
function courseVideo(opts = {}) {
  const body = `<section class="page-hero"><div class="wrap">${crumbs('online-video')}</div><div class="wrap grid g2" style="align-items:start"><div>
<p class="section-kicker">網上視頻課程</p><h1>${P['online-video'].course}</h1><p class="lead">網上錄播課程（${LANG}），按自己進度睇。由付款日起可觀看 1 年。</p>${fig(OFFER.course, '(max-width:760px) 100vw, 560px')}
<h2 style="margin-top:36px">課程資料</h2><div class="tablewrap"><table><tbody>
<tr><th scope="row">形式</th><td>網上錄播視頻</td></tr><tr><th scope="row">價錢</th><td>HK$588（一次性付款，港幣）</td></tr><tr><th scope="row">觀看期</th><td>由付款日起 1 年</td></tr>
<tr><th scope="row">語言</th><td>廣東話為主、夾雜英文 ${ph('字幕安排 — 待確認')}</td></tr><tr><th scope="row">影片數量及總時數</th><td>${ph('待提供')}</td></tr><tr><th scope="row">教材／範本</th><td>${ph('待提供')}</td></tr>
<tr><th scope="row">問答／支援方式</th><td>${ph('待提供')}</td></tr><tr><th scope="row">帳戶</th><td>只限購買者本人使用 ${ph('帳戶／分享政策 — 待確認')}</td></tr><tr><th scope="row">證書</th><td>${ph('有冇完成證書 — 待確認')}</td></tr><tr><th scope="row">點樣先算已出席</th><td>${ATTEND['online-video']}</td></tr></tbody></table></div>
${sylFor('online-video') ? syllabusSection('online-video') : `<h2 style="margin-top:36px">課程大綱</h2><p>${ph('課程大綱 — 待確認')}</p>`}
<h2>要用嘅 AI 工具</h2><div class="tablewrap"><table><thead><tr><th>工具</th><th>用途</th><th>免費／付費</th><th>大約月費</th></tr></thead><tbody>${[1,2,3].map(i => `<tr><td>${ph(`工具 ${i} — 待提供`)}</td><td>${ph('用途')}</td><td>${ph('待提供')}</td><td>${ph('大約月費')}</td></tr>`).join('')}</tbody></table></div>
<p class="small"><strong>重要：部分 AI 工具需要付費訂閱，訂閱費唔包喺學費內</strong>，由工具供應商直接收取，亦唔屬本課程退款範圍。請以供應商官方網站為準（核實日期：${ph('待提供')}）。</p>
<h2>退款</h2><p>${REFUND_ONE}</p><p class="small muted">${REFUND_DAYS}${REFUND_HOW}適用於所有收費課程（網上視頻、網上 1 對 1、現場上堂）。<a href="/refund">完整條款</a></p>
<h2>網上課程 FAQ</h2>
<details><summary>1 年觀看期幾時開始計？</summary><p>由付款日開始計，1 年後無法再觀看。${ph('到期後安排 — 待確認')}</p></details>
<details><summary>要唔要有 AI 基礎？</summary><p>${ph('入門要求 — 待確認')}</p></details>
<details><summary>電腦要求？</summary><p>${ph('電腦／軟件要求 — 待確認')}</p></details>
<details><summary>網上視頻、1 對 1、現場上堂有乜分別？</summary><p>網上視頻係錄播，由付款日起可觀看 1 年；網上 1 對 1 合共 6 小時，同導師網上直接上；現場上堂係面授，${IP.courses.length} 個課程可揀，每個 ${P['in-person'].detail}，大綱見 <a href="/courses/in-person">現場上堂課程</a>。${sylFor('in-person') ? `現場上堂課程嘅大綱見 <a href="/courses/in-person#syllabus-in-person">下面</a>；網上視頻同網上 1 對 1 內容：${ph('課程大綱 — 待確認')}` : `各自內容：${ph('課程大綱 — 待確認')}`}。</p></details>
<p class="small muted">學習成效因人而異，視乎個人投入、練習同原有經驗。本課程唔保證任何特定成果、就業機會或收入。頁面示範圖由 AI 生成（${AI}），只作示意，並非學員作品。</p></div>
<div id="buy">${buyCard('online-video', opts)}<p class="small muted" style="margin-top:12px">課程價錢：網上視頻課程 HK$588；網上1對1收費課程 HK$1,288；現場上堂課程 HK$2,200。冇其他隱藏收費（第三方 AI 工具訂閱除外）。</p></div></div></section>
${hermesSection()}<section><div class="wrap">${ENQ}</div></section>${otherCourses('online-video')}`;
  return layout({ title:'網上視頻課程 HK$588｜Hermes AI 智能體入門：自動化工作流程同多智能體協作｜mikeng_course', desc:'AI 網上視頻課程 HK$588（廣東話為主、夾雜英文），由付款日起可觀看 1 年。退款條款付款前列明。', path:'/courses/online-video', body, ld:[COURSE_LD] });
}
function course1on1(opts = {}) {
  const body = `<section class="page-hero"><div class="wrap">${crumbs('online-1on1')}<p class="section-kicker">網上 1 對 1</p><h1>網上1對1收費課程</h1><p class="lead">同導師網上 1 對 1 上堂，合共 6 小時，${LANG}。</p></div>
<div class="wrap grid g2" style="align-items:start"><div><div class="card"><h3>網上1對1收費課程</h3><dl class="kv"><dt>價錢</dt><dd>HK$1,288</dd><dt>形式</dt><dd>網上 1 對 1，合共 6 小時</dd><dt>內容</dt><dd>${sylFor('online-1on1') ? `課程主題：${sylFor('online-1on1').topic}（見下面大綱）` : ph('課程大綱 — 待確認')}</dd><dt>預約</dt><dd>付款後我哋會電郵聯絡你安排時間 ${ph('預約安排 — 待確認')}</dd><dt>點樣先算已出席</dt><dd>${ATTEND['online-1on1']}</dd></dl><p class="small muted">注意：如果喺付款後 3 個工作天內已經上第一次堂，就唔可以再退款。</p></div>${syllabusSection('online-1on1')}</div><div id="buy">${buyCard('online-1on1', opts)}</div></div></section>${hermesSection()}<section><div class="wrap">${ENQ}</div></section>${otherCourses('online-1on1')}`;
  return layout({ title:'網上1對1收費課程 HK$1,288（合共 6 小時）｜mikeng_course', desc:'網上 1 對 1 AI 課程，合共 6 小時，HK$1,288。退款條款付款前列明。', path:'/courses/online-1on1', body, ld:[{ '@context':'https://schema.org', '@type':'Course', name:'網上1對1收費課程', description:'mikeng_course 網上 1 對 1 AI 課程，合共 6 小時。', inLanguage:'yue-Hant-HK', provider:{ '@type':'Organization', name:'mikeng_course', url:SITE }, offers:{ '@type':'Offer', price:'1288', priceCurrency:'HKD', category:'Paid' } }] });
}
function courseInPerson() {
  const body = `<section class="page-hero"><div class="wrap">${crumbs('in-person')}<p class="section-kicker">現場上堂課程｜${P['in-person'].course}</p><h1>${IP.courses.length} 個現場課程，<em>分開報讀</em></h1><p class="lead">每個課程 ${IP.priceLabel}，${IP.detail}，現場面授，${LANG}。揀你需要嘅一個就得。</p></div></section>
<section><div class="wrap ip-grid">${IP.courses.map(c => `<article class="card hl ip-card">${unpub(c)}<p class="section-kicker">課程 ${c.dn}</p><h2>${esc(c.title)}</h2><p class="small muted">${esc(c.audience)}</p><p class="price">${IP.priceLabel} <small>${IP.detail}</small></p><a class="btn" href="/courses/in-person/${c.slug}">睇大綱及報名</a></article>`).join('')}</div>
<div class="card" style="margin-top:28px"><h3>所有現場課程共用資料</h3><dl class="kv"><dt>地點</dt><dd>${ph('上課地點 — 待提供')}</dd><dt>日期及時間</dt><dd>${ph('上課日期及時間 — 待提供')}</dd><dt>要自備</dt><dd>${ph('例如手提電腦 — 待確認')}</dd><dt>點樣先算已出席</dt><dd>${ATTEND['in-person']}</dd><dt>退款</dt><dd>${REFUND_ONE.replace('（網上視頻課程即已開始觀看）', '（現場上堂即第一堂點名時已經點名）')}</dd></dl><p class="small muted">${TOOLS_NOTE}</p></div>
<div style="margin-top:28px">${ENQ}</div></div></section>${otherCourses('in-person')}`;
  return layout({ title:`現場上堂課程：${IP.courses.length} 個 AI 課程｜每個 HK$2,200｜mikeng_course`, desc:`${IP.courses.length} 個現場 AI 課程（${LANG}），每個 HK$2,200，8 堂，合共 24 小時，可分開報讀。`, path:'/courses/in-person', body, ld:[COURSE2_LD] });
}
function ipCourse(slug, opts = {}) {
  const c = IP.courses.find(x => x.slug === slug); if (!c) return notFound(); const pid = 'ip-' + slug;
  const li = a => a.map(x => `<li>${esc(x)}</li>`).join('');
  const body = `<section class="page-hero"><div class="wrap"><nav class="small muted" aria-label="麵包屑" style="margin-bottom:14px"><a href="/">主頁</a> › <a href="/courses">課程</a> › <a href="/courses/in-person">現場上堂課程</a> › 課程 ${c.dn}</nav>${unpub(c)}<p class="section-kicker">現場上堂課程 ${c.dn}</p><h1>${esc(c.title)}</h1><p class="lead">現場面授，${IP.detail}，${LANG}。</p></div>
<div class="wrap grid g2" style="align-items:start"><div>
<div class="card"><dl class="kv"><dt>價錢</dt><dd>${IP.priceLabel}（一次性付款，港幣）</dd><dt>形式及時數</dt><dd>現場面授，${IP.detail}</dd><dt>地點</dt><dd>${ph('上課地點 — 待提供')}</dd><dt>日期及時間</dt><dd>${ph('上課日期及時間 — 待提供')}</dd><dt>要自備</dt><dd>${ph('例如手提電腦 — 待確認')}</dd><dt>適合</dt><dd>${esc(c.audience)}</dd><dt>入門要求</dt><dd>${esc(c.prereq)}</dd><dt>點樣先算已出席</dt><dd>${ATTEND['in-person']}</dd></dl></div>
<div class="card" id="syllabus-${pid}" style="margin-top:18px"><h2 style="font-size:24px">課程大綱</h2><h3>學習目標</h3>${Array.isArray(c.goals) ? `<ul>${li(c.goals)}</ul>` : `<p>${esc(c.goals)}</p>`}
${c.modules.map(m => `<h3>${esc(m.title)}</h3><ul>${li(m.items)}</ul>`).join('')}
<p class="small muted">8 堂 × 3 小時，合共 24 小時。內容分 ${c.modules.length} 個模組。${ph('8 堂內容分配 — 待確認')}</p>
${c.learn && c.learn.length ? `<h3>你會學到</h3>${Array.isArray(c.learn) ? `<ul>${li(c.learn)}</ul>` : `<p>${esc(c.learn)}</p>`}` : ''}${c.project ? `<h3>課堂專題</h3><p>${esc(c.project)}</p>` : ''}
${c.note ? `<p class="small"><strong>學生資料：</strong>${esc(c.note)}</p>` : ''}
${c.toolsPh ? `<p class="small"><strong>所需工具：</strong>${esc(c.tools)} ${ph(c.toolsPh)}</p>` : ''}<p class="small muted">${TOOLS_NOTE}</p>
${c.disclaimer ? `<div class="card" style="margin-top:12px;border-color:#e0b04d"><strong>重要聲明：</strong>${esc(c.disclaimer)}${c.disclaimerPh ? ' ' + ph(c.disclaimerPh) : ''}</div>` : ''}</div>
<p class="small muted" style="margin-top:16px">學習成效因人而異，課程唔保證任何收入、就業或者事業發展。</p></div>
<div id="buy">${buyCard(pid, opts)}</div></div></section>${slug === 'hermes-agent' ? hermesSection() : ''}<section><div class="wrap">${ENQ}</div></section>
<section><div class="wrap"><p class="section-kicker">其他現場課程</p><div class="ip-grid">${IP.courses.filter(x => x.slug !== slug).map(x => `<a class="card" href="/courses/in-person/${x.slug}" style="display:block"><span class="small muted">課程 ${x.dn}</span><h3 style="font-size:18px">${esc(x.title)}</h3><span class="small">${IP.priceLabel} →</span></a>`).join('')}</div></div></section>`;
  return layout({ title:`${c.title}｜現場課程 HK$2,200｜mikeng_course`, desc:`現場 AI 課程「${c.title}」，HK$2,200，8 堂，合共 24 小時（${LANG}）。`, path:'/courses/in-person/' + slug, body,
    ld:[{ '@context':'https://schema.org', '@type':'Course', name:c.title, description:`現場面授，${IP.detail}（${LANG}）。`, inLanguage:'yue-Hant-HK', provider:{ '@type':'Organization', name:'mikeng_course', url:SITE }, offers:{ '@type':'Offer', price:'2200', priceCurrency:'HKD', category:'Paid' }, hasCourseInstance:{ '@type':'CourseInstance', courseMode:'onsite' } }] });
}
const IP_SLUGS = IP.courses.map(c => c.slug);
const COURSE_PAGE = { 'online-video': courseVideo, 'online-1on1': course1on1, 'in-person': courseInPerson };
const coursePage = (pid, opts) => P[pid] && P[pid].kind === 'in-person' ? ipCourse(P[pid].slug, opts) : COURSE_PAGE[pid](opts);
function courses() {
  const body = `<section class="page-hero"><div class="wrap">${crumbs()}<p class="section-kicker">課程總覽</p><h1>揀適合你嘅<em>上堂形式</em></h1><p class="lead">三個收費課程，價錢全部公開（港幣，一次性付款）。未決定？先嚟免費講座。</p></div></section>
<section><div class="wrap grid g3" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px">${COURSE_SLUGS.map(x => `<article class="card hl"><p class="section-kicker">${P[x].name}</p><h2 style="font-size:24px">${P[x].course || P[x].name}</h2><p class="price">${P[x].priceLabel}</p><ul><li>${x === 'online-video' ? '網上錄播，由付款日起 1 年' : x === 'online-1on1' ? '網上 1 對 1，' + P[x].detail : '現場面授，' + P[x].detail}</li><li>${LANG}</li><li>點樣先算已出席：${ATTEND[x]}</li></ul><a class="btn" href="/courses/${x}">了解及報名</a></article>`).join('')}</div>
<div class="card" style="margin-top:28px"><h3>免費講座試堂</h3><p>${confirmed()[0] ? confirmed()[0].dateLabel + ' ' + confirmed()[0].timeLabel + '｜Zoom｜免費' : '下一場日期待定'}</p><a class="btn ghost" href="/seminar">免費報名</a></div>
${priceTable()}<div style="margin-top:28px">${ENQ}</div></div></section>`;
  return layout({ title:'課程總覽及價錢｜mikeng_course', desc:'mikeng_course 三個收費 AI 課程：網上視頻 HK$588、網上 1 對 1 HK$1,288、現場上堂 HK$2,200，另有免費講座。', path:'/courses', body, ld:[COURSE_LD, COURSE2_LD] });
}
function terms() {
  const body = `<section><div class="wrap" style="max-width:820px"><h1>使用及購買條款</h1><p class="ph" style="display:block;padding:8px">全部內容待法律確認。生效日期：${ph('生效日期 — 待提供')}</p>
<h2>1. 關於我哋</h2><p>本網站 mikeng-ai.com 由 mikeng_course（營運者：MR Workshop，${ADDRESS}）營運。聯絡：${EMAIL_HTML}｜WhatsApp／電話 ${PHONE_HTML}。</p>
<h2>2. 網站使用</h2><ul><li>網站內容只供個人參考，未經書面同意，不得複製、轉載或作商業用途。</li><li>網站示範圖由 AI 生成，只作示意，並非學員作品或客戶項目。</li><li>我哋會盡力保持資料準確，但如有更改，以最新公佈為準。</li></ul>
<h2>3. 課程及價錢</h2><p>所有價錢以港幣顯示，一次性付款：網上視頻課程「${P['online-video'].course}」HK$588；網上1對1收費課程（${P['online-1on1'].detail}）HK$1,288；現場上堂課程「${P['in-person'].course}」（${IP.courses.length} 個課程可分開報讀，每個 ${P['in-person'].detail}）每個 HK$2,200。免費講座不收費。冇隱藏收費；部分第三方 AI 工具需要另外付費訂閱，費用唔包喺學費內，由工具供應商直接收取。</p>
<h2>4. 付款</h2><p>網上付款經 Stripe 處理，我哋唔會儲存你嘅信用卡資料。付款後你會收到確認電郵。</p>
<h2>5. 課程使用</h2><ul><li>網上視頻課程觀看期為「由付款日起 1 年」。</li><li>課程帳戶只限購買者本人使用。${ph('帳戶／分享政策 — 待確認')}</li><li>課程內容（影片、教材、範本）版權屬 mikeng_course 所有，不得轉發、錄影或公開分享。</li><li>網上 1 對 1 及現場上堂嘅時間安排：${ph('預約／缺課安排 — 待確認')}</li></ul>
<h2>6. 退款</h2><p>${REFUND_ALL}${REFUND_DAYS}詳情見 <a href="/refund">退款條款</a>。</p>
<h2>7. 不作保證</h2><p>學習成效因人而異。本課程唔保證任何特定成果、就業機會或收入。</p>
<h2>8. 個人資料</h2><p>我哋點樣處理你嘅個人資料，見 <a href="/privacy">私隱政策及收集個人資料聲明</a>。</p>
<h2>9. 條款修訂及適用法律</h2><p>我哋可不時修訂本條款，修訂後會喺本頁公佈；已付款嘅課程按付款時嘅條款處理。本條款受香港特別行政區法律管轄。</p></div></section>`;
  return layout({ title:'使用及購買條款｜mikeng_course', desc:'mikeng-ai.com 網站使用及課程購買條款。', path:'/terms', body });
}
// /join/<token> — DEMO STUB. Backend replaces this with token lookup (hash in DB), 302 to Zoom from 18:45 HKT, 410 when expired.
const joinStub = () => layout({ title:'講座加入連結｜mikeng_course', desc:'個人講座加入連結。', path:'/join', canonical:false, noindex:true, body:`<section class="page-hero"><div class="wrap"><div class="card" style="max-width:720px"><p class="section-kicker">個人加入連結</p><h1>講座加入連結</h1><p>呢條連結會喺講座開始前 15 分鐘（${confirmed()[0] ? confirmed()[0].dateLabel + ' 18:45 香港時間' : '開始前 15 分鐘'}）開放，自動轉到 Zoom。</p><p class="ph" style="display:block;padding:8px">示範模式：後端未接通，呢頁唔會轉址。</p><p><a class="btn ghost" href="/seminar">返回講座頁</a></p></div></div></section>` });
const INTERESTS = [['online-video', '網上視頻課程（HK$588）'], ['online-1on1', '網上1對1收費課程（HK$1,288）'], ['in-person', '現場上堂課程（每個 HK$2,200）'], ...IP.courses.map(c => ['ip-' + c.slug, `現場課程 ${c.dn}：${c.title}`]), ['seminar', '免費講座'], ['other', 'AI 顧問／其他']];
function contact({ values = {}, errors = {}, sent = false } = {}) {
  const v = k => esc(values[k] ?? '');
  const e = k => errors[k] ? `<p class="err" id="q-${k}-err">${errors[k]}</p>` : '';
  const body = `<section class="page-hero"><div class="wrap grid g2" style="align-items:start"><div>
<p class="section-kicker">A CONVERSATION STARTS HERE</p><h1>What’s on<br><em>your mind?</em></h1><p class="lead">有問題想先問清楚？填表、WhatsApp 或者電郵都得。</p>
<dl class="kv" style="margin-top:24px"><dt>WhatsApp／電話</dt><dd>${PHONE_HTML}</dd><dt>電郵</dt><dd>${EMAIL_HTML}</dd></dl>
<p class="small muted" style="margin-top:24px">查詢資料只用嚟回覆你嘅查詢，詳見<a href="/privacy#pics">《收集個人資料聲明》</a>。我哋唔會因為你查詢而向你發推廣訊息。</p></div>
<div class="card hl" id="form">${sent ? '<div role="status"><h2>多謝你嘅查詢！</h2><p>我哋收到咗，會盡快用你留低嘅電郵（或電話）回覆你。</p><p><a class="btn ghost" href="/">返回首頁</a></p></div>' : `<h2>查詢表格</h2>
${Object.keys(errors).length ? `<div class="errbox" role="alert" tabindex="-1" autofocus><ul>${Object.values(errors).map(x => `<li>${x}</li>`).join('')}</ul></div>` : ''}
<form method="post" action="/api/enquiry#form" novalidate>
<div class="f"><label for="q-name">名稱 *</label><input id="q-name" name="name" type="text" required maxlength="60" autocomplete="name" value="${v('name')}">${e('name')}</div>
<div class="f"><label for="q-email">電郵 *</label><input id="q-email" name="email" type="email" required maxlength="120" autocomplete="email" value="${v('email')}">${e('email')}</div>
<div class="f"><label for="q-phone">電話／WhatsApp（選填）</label><input id="q-phone" name="phone" type="tel" maxlength="20" autocomplete="tel" placeholder="+852 9123 4567" value="${v('phone')}"><p class="hint">只用嚟回覆今次查詢。</p>${e('phone')}</div>
<div class="f"><label for="q-interest">想查詢</label><select id="q-interest" name="interest">${INTERESTS.map(([k, t]) => `<option value="${k}"${values.interest === k ? ' selected' : ''}>${t}</option>`).join('')}</select>${e('interest')}</div>
<div class="f"><label for="q-msg">你嘅問題 *</label><textarea id="q-msg" name="message" rows="5" required maxlength="2000">${v('message')}</textarea>${e('message')}</div>
<button class="btn" type="submit" style="width:100%;justify-content:center">送出查詢</button></form>`}</div></div></section>`;
  return layout({ title:'聯絡及查詢｜mikeng_course', desc:'查詢 mikeng_course 課程、講座同 AI 顧問：查詢表格、WhatsApp 或電郵。', path:'/contact', body });
}

// Same text as the .ics DESCRIPTION (QA v3 m3).
const ICS_DESC = `Zoom 連結會經確認電郵寄出。${LANG}，免費。`;
const hkt = iso => new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) + '（香港時間）';
const gcal = s => { const f = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(s.title) + '&dates=' + f(s.start) + '/' + f(s.end) + '&details=' + encodeURIComponent(ICS_DESC) + '&location=Zoom'; };
function seminarThanks(sub) {
  const s = S.byId(sub.session) || {};
  const inner = `<h1>報名成功！多謝你，${esc(sub.name)}。</h1>
<dl class="kv"><dt>場次</dt><dd>${s.title}</dd><dt>日期</dt><dd>${s.dateLabel}</dd><dt>時間</dt><dd>${s.timeLabel.replace('（香港時間）', '')}（香港時間，${s.duration}）</dd><dt>形式</dt><dd>${s.platform}｜${s.language}</dd><dt>費用</dt><dd>免費</dd><dt>電郵</dt><dd>${esc(sub.email)}</dd><dt>提示時間</dt><dd>${s.reminders ? `D-1：${hkt(s.reminders['D-1'])}<br>H-1：${hkt(s.reminders['H-1'])}` : ''}</dd><dt>Zoom 連結</dt><dd>${s.zoomUrl ? '會經確認電郵同個人加入連結發送' : ph('Zoom 連結 — 上線前喺 data/sessions.json 填入')}<br><span class="small muted">個人加入連結喺講座開始前 15 分鐘開放。</span></dd><dt>WhatsApp 提示</dt><dd>會發送到 ${esc(sub.phone)}（隨時回覆「停止」即可退出）</dd><dt>推廣電郵</dt><dd>${sub.marketing ? '已同意（可隨時取消）' : '未同意，唔會收到推廣'}</dd></dl>
<p class="cta" style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap"><a class="btn" href="/seminar.ics?session=${encodeURIComponent(s.id)}" download>加入日曆（.ics）</a><a class="btn ghost" href="${gcal(s)}" rel="noopener">加入 Google 日曆</a></p>
<h2 style="margin-top:28px">接下來</h2><ol><li>確認電郵會寄到 ${esc(sub.email)}，入面有你嘅個人 Zoom 加入連結。${ph('電郵發送 — 上線前接通')}</li><li>講座前會經電郵同 WhatsApp 收到提示。</li><li>講座後會收到重溫連結，觀看期為收到重溫連結後 ${s.replayDays} 日內。</li></ol>
<p class="small muted">搵唔到電郵？請睇吓垃圾郵件匣或「推廣」分頁。</p>
<h3>小任務（選做）</h3><p>回覆確認電郵，講講你最想 AI 幫你做嘅一件工作（想嘅話可附一張你有權分享嘅圖或文件）。我會盡量揀幾個喺講座做例子，但唔保證每個都用到。</p>
<h3>免費資源</h3><p>${ph('免費資源下載連結 — 待提供')}</p>
<p class="small muted">講座免費，不涉及付款。如之後報讀收費課程：${REFUND_ALL}</p>`;
  return layout({ title:'報名成功｜免費 AI 講座', desc:'你已成功報名，請把講座加入日曆。', path:'/seminar/thanks', body:`<section><div class="wrap"><div class="card hl">${inner}</div></div></section>` });
}
const ACCESS = {
  'online-video': ['觀看期', '由付款日起 1 年', `你會收到課程登入資料電郵 ${ph('課程平台 — 待確認')}。`],
  'online-1on1': ['上堂安排', `合共 6 小時，預約安排 ${ph('待確認')}`, '我哋會電郵聯絡你安排上堂時間。'],
  'in-person': ['上堂安排', `${IP.detail}，日期及地點 ${ph('待提供')}`, '我哋會電郵聯絡你安排上堂時間。'],
};
function confirmation(sub) {
  const p = P[sub.product]; const [label, access, next] = ACCESS[kindOf(p.id)];
  const inner = `<h1>多謝你，${esc(sub.name)}！訂單已收到</h1>
<p class="ph" style="display:block;padding:8px">示範模式：未有收取任何費用，亦未接通 Stripe。</p>
<dl class="kv"><dt>項目</dt><dd>${p.name}${p.course ? '｜' + p.course : ''}</dd><dt>價錢</dt><dd>${p.priceLabel}（港幣）</dd><dt>參考編號</dt><dd>${esc(sub.id.slice(0, 8).toUpperCase())}</dd><dt>電郵</dt><dd>${esc(sub.email)}</dd><dt>${label}</dt><dd>${access}</dd></dl>
<p class="small muted">點樣先算已出席：${ATTEND[kindOf(p.id)]}</p><h2 style="margin-top:28px">接下來</h2><ol><li>你會收到付款收據電郵（經 Stripe）。</li><li>${next}</li><li>有問題可電郵 ${EMAIL_HTML}。</li></ol>
<h2>退款條款</h2><p>${REFUND_ALL}</p><p class="small muted">${REFUND_DAYS}${REFUND_HOW}</p>`;
  return layout({ title:'確認｜mikeng_course', desc:'報名／訂單確認。', path:'/confirmation', body:`<section><div class="wrap"><div class="card hl">${inner}</div></div></section>` });
}

function privacy() {
  const body = `<section><div class="wrap" style="max-width:820px"><h1>私隱政策及收集個人資料聲明</h1><p class="ph" style="display:block;padding:8px">全部內容待法律確認。</p>
<h2 id="pics">收集個人資料聲明（PICS）</h2><p>mikeng_course（營運者：MR Workshop）透過講座報名表及課程報名收集你嘅個人資料。</p>
<h3>1. 收集目的</h3><ul><li>處理免費講座報名，安排講座</li><li>發送報名確認、Zoom 連結、日曆邀請、講座提示同重溫</li><li>經 WhatsApp 發送講座提示</li><li>處理課程報名、付款同退款（包括記錄網上課程首次觀看時間，用作判斷退款資格）</li><li>回應你嘅查詢</li><li>只喺你另外同意下，以電郵作直接促銷</li></ul>
<h3>2. 必須同自願提供嘅資料</h3><p>名稱、電郵及 WhatsApp 電話為必須提供，否則我哋無法處理你嘅報名。你嘅電話只會用嚟經 WhatsApp 發送講座提示（隨時回覆「停止」即可停止提示），絕不會用嚟發推廣訊息。推廣只經電郵，並須你另外剔選同意。</p>
<h3>3. 資料轉移對象</h3><ul><li>網上會議平台 Zoom</li><li>電郵發送服務供應商 ${ph('待確認')}</li><li>WhatsApp（Meta）${ph('WhatsApp API 供應商 — 待確認')}</li><li>收款服務供應商 Stripe</li><li>網站寄存 Hostinger</li></ul><p>部分供應商可能位於香港以外。除上述及法律要求外，我哋唔會出售或提供你嘅資料予第三方。</p>
<h3>4. 保留期限</h3><p>我哋會保留你嘅個人資料 12 個月，之後會刪除或作匿名處理。</p>
<h3>5. 查閱及改正</h3><p>你有權要求查閱及改正你嘅個人資料。請書面聯絡 ${ph('私隱事務聯絡人 — 待提供')}，電郵 ${EMAIL_HTML}，地址：${ADDRESS}。</p>
<h2>私隱政策</h2><ul><li><strong>Cookies：</strong>本網站唔使用追蹤 Cookies。瀏覽統計用自設嘅 Umami，屬無 Cookie、唔識別個人身份嘅分析工具，所以冇 Cookie 同意橫額。</li>
<li><strong>直接促銷：</strong>只喺取得你同意後，先會以電郵向你發送課程、講座及優惠資訊。你可隨時免費取消（電郵內「取消訂閱」或 <a href="/unsubscribe">/unsubscribe</a>），我哋會喺 10 個工作天內停止。</li>
<li><strong>生效日期：</strong>${ph('生效日期 — 待提供')}</li></ul><p><a class="btn ghost" href="/seminar">返回免費講座報名</a></p></div></section>`;
  return layout({ title:'私隱政策及收集個人資料聲明｜mikeng_course', desc:'我哋點樣收集、使用及保護你嘅個人資料。', path:'/privacy', body });
}

function refund() {
  const body = `<section><div class="wrap" style="max-width:820px"><h1>退款條款</h1><p class="lead">報名前清楚知道退款條件，係你應有嘅權利。</p>
<div class="card hl"><strong>一句講晒：</strong>${REFUND_ALL}<br><span class="small">退款期為 3 個香港工作天，付款當日計第 1 日；星期六、日及公眾假期不計。</span></div>
<div class="tablewrap" style="margin-top:20px"><table><tbody>
<tr><th scope="row">適用</th><td>所有收費項目：網上視頻課程「Hermes AI 智能體入門：自動化工作流程同多智能體協作」（HK$588）、網上1對1收費課程（HK$1,288）、現場上堂課程「AI與設計及文書多功能使用班」（HK$2,200）</td></tr>
<tr><th scope="row">退款期</th><td>付款後 3 個工作天內（${REFUND_DAYS}）</td></tr>
<tr><th scope="row">退款金額</th><td>退回所付學費；${REFUND_FEE}（以該筆付款嘅 Stripe 記錄為準）。</td></tr>
<tr><th scope="row">點樣先算「已出席」</th><td>網上視頻課程：已開始觀看課程內容。網上 1 對 1：第一次上堂開始咗。現場上堂：第一堂點名時已經點名。</td></tr><tr><th scope="row">不設退款</th><td>已出席任何一堂（定義見上一行）。</td></tr>
<tr><th scope="row">申請方法</th><td>電郵 ${EMAIL_HTML}，註明姓名、付款日期及課程名稱</td></tr>
<tr><th scope="row">處理及方式</th><td>${REFUND_HOW}</td></tr>
<tr><th scope="row">第三方 AI 工具</th><td>由工具供應商直接收取，不屬本課程退款範圍。</td></tr>
<tr><th scope="row">免費講座</th><td>免費，不涉及退款。</td></tr></tbody></table></div>
<h2 style="margin-top:28px">例子（方便理解）</h2><ul><li>星期三付款、星期四申請，未開始觀看網上視頻課程 → 可以退款（${REFUND_FEE.replace('退款會','')}）。</li><li>星期三付款、星期四申請，但已經開始觀看 → 不設退款。</li><li>星期五付款：星期五係第 1 日、星期一第 2 日、星期二第 3 日，最遲星期二申請；星期三先申請就已過期。（如果星期一或星期二係香港公眾假期，嗰日唔計，期限順延到下一個工作天。）</li><li>星期六付款：由下星期一起計第 1 日，最遲星期三申請。</li><li>報咗網上 1 對 1，付款後第 2 個工作天第一次上堂已經開始 → 不設退款。</li><li>報咗現場上堂，第一堂喺付款後第 2 個工作天，你已經點名 → 不設退款。</li></ul>
<p class="small muted">以上就係全部退款條件，冇隱藏條款。生效日期：${ph('待提供')}</p><p class="small muted">本條款適用於 mikeng_course（營運者：MR Workshop，${ADDRESS}）提供嘅所有收費課程。</p></div></section>`;
  return layout({ title:'退款條款｜mikeng_course', desc:'課程退款條件、期限及申請方法。', path:'/refund', body });
}

function unsubscribe(done, error) {
  const body = `<section><div class="wrap" style="max-width:640px"><div class="card"><h1>取消訂閱 Unsubscribe</h1>
${done ? `<p role="status">已收到你嘅要求，我哋會喺 10 個工作天內停止向你發送推廣電郵。如果你已報名講座，你仍會收到該場講座嘅連結同提示（呢啲唔係推廣訊息）；如果都唔想收，請電郵 ${EMAIL_HTML}。<br>Request received. We will stop sending marketing emails within 10 working days. If you have registered for a seminar, you will still receive its link and reminders (these are not marketing messages); to stop those too, email ${EMAIL_HTML}.</p>` :
`<p>取消接收 mikeng_course 推廣電郵。講座提示等服務訊息不受影響。<br>Unsubscribe from mikeng_course marketing emails. Service messages are not affected.</p>
${error ? '<div class="errbox" role="alert" tabindex="-1" autofocus>請填寫正確電郵。/ Please enter a valid email.</div>' : ''}<form method="post" action="/api/unsubscribe"><div class="f"><label for="uemail">電郵 Email</label><input id="uemail" name="email" type="email" required maxlength="120"${error ? ' aria-invalid="true"' : ''}></div><button class="btn" type="submit">確認取消／Confirm unsubscribe</button></form>`}<p class="small muted" style="margin-top:16px">mikeng_course（營運者：MR Workshop）｜${ADDRESS}｜${EMAIL_HTML}</p></div></div></section>`;
  return layout({ title:'取消訂閱 Unsubscribe｜mikeng_course', desc:'取消接收推廣電郵。', path:'/unsubscribe', body });
}
const notFound = () => layout({ title:'搵唔到呢頁｜mikeng_course', desc:'你搵嘅頁面唔存在或者已經搬咗。', path:'/404', canonical:false, body:`<section class="page-hero"><div class="wrap"><div class="card" style="max-width:720px"><p class="section-kicker">404</p><h1>搵唔到<em>呢頁</em></h1><p>你搵嘅頁面唔存在或者已經搬咗，可能條連結舊咗，或者網址打錯咗字。</p><p style="display:flex;gap:12px;flex-wrap:wrap;margin-top:20px"><a class="btn ghost" href="/">返回首頁</a><a class="btn ghost" href="/courses">睇課程</a><a class="btn" href="/seminar">免費報名試堂講座</a></p></div></div></section>` });

module.exports = { layout, HOOKS /* BACKEND HOOK: used by /account and /online-course */, IP, IP_SLUGS, ipCourse, kindOf, seminarReview, S, LANG, ICS_DESC, coursePage, courses, terms, joinStub, COURSE_SLUGS, contact, buyCard, seminarThanks, home, services, instructors, seminar, confirmation, privacy, refund, unsubscribe, notFound, confirmed, P };
