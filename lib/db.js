// SQLite store for the backend (better-sqlite3). File: data/app.db (override with APP_DB).
// All SQL in the backend uses prepared statements with bound parameters.
const path = require('path'), fs = require('fs');
const Database = require('better-sqlite3');

const STAGES = [
  ['new', '新體驗潛在客戶', 'New Trial Lead'],
  ['reminded', '已發送提醒', 'Reminder Sent'],
  ['confirmed', '已確認', 'Confirmed'],
  ['attended', '已出席', 'Attended'],
  ['consult', '網上課程諮詢', 'Online Course Consultation'],
  ['sold', '已售出課程', 'Online Course Sold'],
  ['lost', '已流失', 'Lost'],
];
const STAGE_KEYS = STAGES.map(s => s[0]);
const PAY = ['未付款', '已付款', '已退款', '退款處理中'];
// Stripe TEST-mode sample orders (lib/backend/stripe-test.js). Kept apart from orders + demo data: never real money.
const PAY_TEST = ['待付款（測試）', '已付款（測試）'];
const TP_STATUS = ['待付款', '已付款', '失敗', '過期', '已取消'];
const REMINDER_STATUS = ['草稿', '已複製', '已手動發送', '已略過'];
const ATTEND = ['未標記', '已出席', '缺席'];

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff')), status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','disabled')),
  approved_by INTEGER, created_at TEXT NOT NULL, last_login_at TEXT);
CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'staff', note TEXT, created_by INTEGER, created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, used_by INTEGER, used_at TEXT);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT, password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, last_login_at TEXT, is_demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, area TEXT NOT NULL CHECK (area IN ('admin','account')), user_id INTEGER, csrf TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, course TEXT, price INTEGER NOT NULL, price_label TEXT NOT NULL, kind TEXT NOT NULL, buyable INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS seminars (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, title TEXT NOT NULL,
  platform TEXT NOT NULL, zoom_url TEXT NOT NULL DEFAULT '', language TEXT NOT NULL, capacity INTEGER, is_free INTEGER NOT NULL DEFAULT 1,
  replay_days INTEGER NOT NULL DEFAULT 2, status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','skipped-holiday')),
  holiday TEXT, reason TEXT, source TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('rule','admin','demo')), is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS seminars_date ON seminars(date);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT, service TEXT, standard_price INTEGER,
  source TEXT NOT NULL DEFAULT 'web', stage TEXT NOT NULL DEFAULT 'new', reminder_status TEXT NOT NULL DEFAULT '未有提醒',
  payment_status TEXT NOT NULL DEFAULT '未付款', marketing_consent INTEGER NOT NULL DEFAULT 0, marketing_consent_at TEXT, marketing_consent_text TEXT,
  whatsapp_opt_out_at TEXT, customer_id INTEGER, is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS leads_stage ON leads(stage);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE, seminar_id TEXT NOT NULL REFERENCES seminars(id),
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled')), attendance TEXT NOT NULL DEFAULT '未標記',
  join_token_hash TEXT, source TEXT NOT NULL DEFAULT 'web', source_ref TEXT UNIQUE, is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, cancelled_at TEXT, UNIQUE (lead_id, seminar_id));
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', content_md TEXT NOT NULL DEFAULT '',
  price_hkd INTEGER NOT NULL, product_id TEXT, public_url TEXT, video_file TEXT, video_mime TEXT, video_size INTEGER, video_name TEXT,
  download_url TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  price_flag INTEGER NOT NULL DEFAULT 0, price_confirmed_by INTEGER, price_confirmed_at TEXT,
  is_seed INTEGER NOT NULL DEFAULT 0, is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE, product_id TEXT NOT NULL, course_id INTEGER REFERENCES courses(id),
  price_hkd INTEGER NOT NULL, payment_status TEXT NOT NULL DEFAULT '未付款', paid_at TEXT, refunded_at TEXT, first_viewed_at TEXT,
  source_ref TEXT UNIQUE, is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE, author_id INTEGER, author_name TEXT NOT NULL,
  body TEXT NOT NULL, created_at TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS stage_history (
  id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE, from_stage TEXT, to_stage TEXT NOT NULL,
  by_id INTEGER, by_name TEXT NOT NULL, via TEXT NOT NULL, at TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE, lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','email')), kind TEXT NOT NULL, template TEXT NOT NULL, label TEXT NOT NULL,
  scheduled_at TEXT NOT NULL, to_addr TEXT NOT NULL, subject TEXT, body TEXT NOT NULL, is_marketing INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '草稿', skip_reason TEXT, updated_by TEXT, updated_at TEXT, created_at TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0,
  UNIQUE (booking_id, channel, kind));
CREATE TABLE IF NOT EXISTS imports (source_ref TEXT PRIMARY KEY, type TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS test_payments (
  id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE, course_slug TEXT NOT NULL, product_id TEXT NOT NULL, course_title TEXT NOT NULL,
  amount_hkd INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'hkd', status TEXT NOT NULL DEFAULT '待付款', from_stage TEXT, price_id TEXT,
  session_id TEXT UNIQUE, checkout_url TEXT, payment_intent TEXT, paid_amount INTEGER, paid_currency TEXT, note TEXT,
  created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, paid_at TEXT);
CREATE TABLE IF NOT EXISTS stripe_events (event_id TEXT PRIMARY KEY, type TEXT NOT NULL, session_id TEXT, livemode INTEGER NOT NULL, result TEXT NOT NULL, at TEXT NOT NULL);
`;

let db = null;
function open(file = process.env.APP_DB || path.join(__dirname, '..', 'data', 'app.db')) {
  if (db) return db;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  // additive migrations
  const cols = db.prepare('PRAGMA table_info(courses)').all().map(c => c.name);
  if (!cols.includes('launch_ready')) db.exec('ALTER TABLE courses ADD COLUMN launch_ready INTEGER NOT NULL DEFAULT 1');
  if (!cols.includes('kind')) db.exec("ALTER TABLE courses ADD COLUMN kind TEXT NOT NULL DEFAULT 'online'");
  const cc = db.prepare('PRAGMA table_info(customers)').all().map(c => c.name);
  if (!cc.includes('email_verified_at')) db.exec('ALTER TABLE customers ADD COLUMN email_verified_at TEXT');
  if (!cc.includes('verify_hash')) db.exec('ALTER TABLE customers ADD COLUMN verify_hash TEXT');
  return db;
}
const get = () => open();
const now = () => new Date().toISOString();
module.exports = { open, get, now, STAGES, STAGE_KEYS, PAY, PAY_TEST, TP_STATUS, REMINDER_STATUS, ATTEND };
