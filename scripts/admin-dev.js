#!/usr/bin/env node
// Standalone dev entry for the backend (no existing file is edited). Default port 3100.
//   node scripts/admin-dev.js              -> public site (server.js) + backend, backend mounted first
//   node scripts/admin-dev.js --standalone -> backend only (+ /assets), if server.js is mid-edit
// Until the server.js hook is applied, this wraps express() so the app server.js creates gets the backend mounted first.
// Once server.js contains "BACKEND HOOK", it just runs server.js.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
process.env.PORT = process.env.PORT || '3100';
if (!process.env.OUTBOX_FILE && process.env.NODE_ENV !== 'production') process.env.OUTBOX_FILE = path.join(ROOT, 'data', 'outbox.backend-dev.jsonl');
const standalone = process.argv.includes('--standalone');
const backend = require('../lib/backend');
const express = require('express');

if (standalone) {
  const app = express(); app.disable('x-powered-by');
  backend.mount(app);
  app.use('/assets', express.static(path.join(ROOT, 'assets')));
  app.get(['/favicon.svg'], (q, r) => r.sendFile(path.join(ROOT, 'assets', 'img', 'favicon.svg')));
  app.get('/', (q, r) => r.redirect('/admin'));
  app.listen(+process.env.PORT, () => console.log(`backend (standalone) on http://localhost:${process.env.PORT}/admin`));
} else if (fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').includes('BACKEND HOOK')) {
  require('../server.js');
} else {
  const mod = require.cache[require.resolve('express')];
  const orig = mod.exports;
  let done = false;
  const wrapped = Object.assign(function () { const app = orig.apply(this, arguments); if (!done) { done = true; backend.mount(app); } return app; }, orig);
  mod.exports = wrapped;
  require('../server.js');
}
