#!/usr/bin/env node
// npm run seed:demo          -> create SAMPLE data (is_demo=1)
// npm run seed:demo -- --wipe (or npm run demo:wipe) -> remove all demo data
process.env.OUTBOX_FILE = process.env.OUTBOX_FILE || require('path').join(__dirname, '..', 'data', 'outbox.backend-dev.jsonl'); // demo drafts are never logged anyway
const backend = require('../lib/backend');
backend.init({ quiet: true });
const demo = require('../lib/backend/demo');
if (process.argv.includes('--wipe')) console.log(`示範數據已清除：${demo.wipe()} 個示範客戶。`);
else { try { const r = demo.seed(); console.log(`示範數據已建立：${r.leads} 個示範客戶（只作展示）。${r.customerLogin ? '示範學員登入 /account：' + r.customerLogin : '（未設 DEMO_CUSTOMER_PASSWORD，所以冇建立示範學員登入）'}`); } catch (e) { console.error(e.message); process.exit(1); } }
