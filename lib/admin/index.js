// Staff-only admin routes (auth already enforced by lib/backend/index.js).
const fs = require('fs'), path = require('path');
function routes(r) {
  require('./crm').routes(r);
  for (const m of ['seminars', 'reminders', 'courses', 'staff']) if (fs.existsSync(path.join(__dirname, m + '.js'))) require('./' + m).routes(r);
}
module.exports = { routes };
