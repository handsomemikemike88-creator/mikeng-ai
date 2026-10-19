// Crawl internal links + check prices/banned items. Usage: BASE=http://localhost:3312 node scripts/check.js
const B = process.env.BASE || 'http://localhost:3312';
const seen = new Map(), q = ['/', '/sitemap.xml', ...(process.env.PROD === '1' ? ['/courses/in-person/claude-codex-investing'] : [])], bad = [], issues = [];
const OK_PRICES = new Set(['HK$0', 'HK$588', 'HK$1,288', 'HK$2,200', ]);
(async () => {
  while (q.length) {
    const u = q.shift(); if (seen.has(u)) continue;
    const r = await fetch(B + u, { redirect: 'manual' }); seen.set(u, r.status);
    if (process.env.PROD === '1' && u === '/courses/in-person/claude-codex-investing') { if (r.status !== 404) issues.push(`${u}: PROD expected 404, got ${r.status}`); continue; }
    if (r.status >= 400) { bad.push(u); continue; }
    if (u === '/sitemap.xml') { const x = await r.text(); if (process.env.PROD === '1' && x.includes('claude-codex')) issues.push('sitemap: PROD lists unpublished course 6'); continue; }
    if (!(r.headers.get('content-type') || '').includes('html')) continue;
    const h = await r.text();
    for (const m of h.matchAll(/HK\$\s?[\d,.]+/g)) if (!OK_PRICES.has(m[0].replace(/\s/g, ''))) issues.push(`${u}: price ${m[0]}`);
    for (const w of ['twitter:', 'x.com', 'threads.net', '待確認」', '19:00–20:30', '總共 6 小時', '998', '選股', '量化投資', '交易員', '理財顧問', '約 20 小時', '每堂 3 小時', '1,980', '2,880', '1980', '2880', '全數', '3.4%', '550', '2,000']) if (h.includes(w)) issues.push(`${u}: contains ${w}`);
    // QA v5 n1: in production mode (PROD=1, server run with NODE_ENV=production) unpublished course 6 must not appear anywhere
    if (process.env.PROD === '1') for (const w of ['claude-codex-investing', 'Claude 與 Codex App 建立財報', '未公開：待確認香港供應']) if (h.includes(w)) issues.push(`${u}: PROD shows unpublished ${w}`);
    if (u === '/seminar' && !/id="phone"[^>]*required/.test(h)) issues.push('seminar phone not required');
    if (/name="marketing"[^>]*checked/.test(h)) issues.push(u + ': marketing pre-ticked');
    for (const m of h.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) { const l = m[1]; if (!l.startsWith('/api/') && !seen.has(l)) q.push(l); }
  }
  console.log([...seen].map(([u, s]) => s + ' ' + u).join('\n'));
  console.log('BROKEN:', bad.length ? bad : 'none'); console.log('ISSUES:', issues.length ? issues : 'none');
})();
