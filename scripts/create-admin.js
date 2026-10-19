#!/usr/bin/env node
// Create the first admin (or another admin) from the CLI. Password from env ADMIN_PASSWORD or an interactive prompt.
//   ADMIN_PASSWORD='...' node scripts/create-admin.js --email mikey@example.com --name Mikey
const args = process.argv.slice(2), arg = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const D = require('../lib/db'), Sx = require('../lib/backend/security');
(async () => {
  const email = String(arg('email') || process.env.ADMIN_EMAIL || '').trim().toLowerCase(), name = arg('name') || process.env.ADMIN_NAME || 'Admin';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { console.error('Usage: ADMIN_PASSWORD=... node scripts/create-admin.js --email you@domain --name Name'); process.exit(1); }
  let pw = process.env.ADMIN_PASSWORD;
  if (!pw) { const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout }); pw = await new Promise(r => rl.question('Password (min 10 chars): ', a => { rl.close(); r(a); })); }
  const p = Sx.pwProblem(pw); if (p) { console.error(p); process.exit(1); }
  D.open();
  const ex = D.get().prepare('SELECT id FROM staff WHERE email = ?').get(email);
  if (ex) D.get().prepare("UPDATE staff SET role = 'admin', status = 'active', password_hash = ? WHERE id = ?").run(Sx.hash(pw), ex.id);
  else D.get().prepare("INSERT INTO staff (email, name, password_hash, role, status, created_at) VALUES (?, ?, ?, 'admin', 'active', ?)").run(email, name, Sx.hash(pw), D.now());
  console.log(`Admin ${ex ? 'updated' : 'created'}: ${email}`); // password is never printed
})();
