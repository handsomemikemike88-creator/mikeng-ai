// Stripe config. TEST mode only (lib/backend/stripe-test.js uses it for the admin sample-order checkout); keys come from env, never from code.
//   STRIPE_SECRET_KEY=sk_test_...            (anything else, e.g. sk_live_, is refused)
//   Per-product Price IDs, either one JSON map:
//     STRIPE_PRICE_MAP={"online-video":"price_...","online-1on1":"price_...","ip-gemini":"price_..."}
//   or one var per product:
//     STRIPE_PRICE_ONLINE_VIDEO, STRIPE_PRICE_ONLINE_1ON1, STRIPE_PRICE_INPERSON_<SLUG> (slug upper-cased, '-' -> '_'),
//     STRIPE_PRICE_COURSE_<SLUG> for admin-added online courses (product id oc-<slug>).
function envName(productId) {
  const up = s => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  if (productId.startsWith('ip-')) return 'STRIPE_PRICE_INPERSON_' + up(productId.slice(3));
  if (productId.startsWith('oc-')) return 'STRIPE_PRICE_COURSE_' + up(productId.slice(3));
  return 'STRIPE_PRICE_' + up(productId);
}
function map() { try { return JSON.parse(process.env.STRIPE_PRICE_MAP || '{}'); } catch { return {}; } }
function priceId(productId) { const v = map()[productId] || process.env[envName(productId)] || ''; return /^price_[A-Za-z0-9]+$/.test(v) ? v : null; }
function mode() {
  const k = process.env.STRIPE_SECRET_KEY || '';
  if (!k) return { ok: false, label: '未設定（示範模式，唔會收錢）' };
  if (!k.startsWith('sk_test_')) return { ok: false, label: '已拒絕：只接受 TEST key（sk_test_…）' };
  return { ok: true, label: 'TEST mode key 已設定（仍未接通 checkout）' };
}
module.exports = { envName, priceId, mode };
