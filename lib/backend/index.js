// Backend entry. mount(app) adds /admin, /account, /media, /online-course and the online-course checkout to the Express app.
// Must be mounted BEFORE server.js's own routes (see BACKEND.md "Hooks"). Nothing here sends email/WhatsApp or charges money.
const express = require('express');
const D = require('../db');
const Sx = require('./security');
const C = require('./crm');
const CO = require('./courses');
const SEM = require('./seminars');

let inited = false;
function init({ quiet = false } = {}) {
  if (inited) return; inited = true;
  require('./stripe-test').assertNotLive(); // refuses to start with sk_live_/rk_live_
  D.open(); C.seedProducts(); CO.seedCourses(); SEM.ensureRule(SEM.addDays(SEM.windowFor()[1], 400));
  const made = require('../admin/auth').bootstrapAdmin();
  if (made && !quiet) console.log(`[backend] first admin created from ADMIN_EMAIL: ${made}`);
  if (!quiet && !Sx.PROD) { const code = Sx.envInviteCode(); console.log(`[backend] staff invite code (${process.env.STAFF_INVITE_CODE ? 'from STAFF_INVITE_CODE' : 'dev, generated'}): ****${String(code).slice(-4)} (full value: your STAFF_INVITE_CODE env; or create a personal invite at /admin/staff)`); } // never log the full code
  try { C.syncJson(true); } catch (e) { console.error('[backend] JSON import failed:', e.message); }
  require('./public').syncProducts();
}
const sync = (req, res, next) => { try { C.syncJson(); } catch {} next(); };

function mount(app, opts = {}) {
  init(opts);
  try { require('../pages').HOOKS.account = true; } catch {} // show 「學員登入」 footer link only when the backend is mounted
  SEM.install(); // DB-backed seminar list for /seminar, booking form, .ics, thanks page
  const body = [express.urlencoded({ extended: false, limit: '300kb' }), express.json({ limit: '20kb' })];

  const admin = express.Router();
  admin.use(Sx.session('admin'), ...body, Sx.csrf, sync);
  require('../admin/auth').routes(admin);
  admin.use(require('../admin/auth').requireStaff);
  require('../admin').routes(admin);
  admin.use((req, res) => res.status(404).type('html').send(require('../admin/views').page({ title: '搵唔到', user: req.user, req, body: '<h1>搵唔到呢頁</h1><p><a href="/admin">返回儀錶板</a></p>' })));

  const account = express.Router();
  account.use(Sx.session('account'), ...body, Sx.csrf, sync);
  require('../account').routes(account);

  const media = express.Router();
  // media reads both session cookies itself (lib/backend/media.js viewer())
  require('./media').routes(media);

  const pub = express.Router();
  require('./public').routes(pub, [express.urlencoded({ extended: false, limit: '10kb' })]);

  // Stripe TEST-mode webhook: raw body (signature check), mounted before any body parser.
  app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '512kb' }), require('./stripe-test').webhook);
  const under = (p, r) => (req, res, next) => (req.path === p || req.path.startsWith(p + '/')) ? r(req, res, next) : next();
  app.use(under('/admin', admin));
  app.use(under('/account', account));
  app.use(under('/media', media));
  app.use(pub);
  return app;
}
module.exports = { mount, init };
