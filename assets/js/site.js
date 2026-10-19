/* Vanilla port of the template's React behaviour: character-reveal.tsx, page.tsx menu, creative-process.tsx, portfolio-finale.tsx */
(function () {
  var reduced = matchMedia('(prefers-reduced-motion: reduce)');

  /* --- Cursor spotlight: reveal BG_IMAGEs_2 over BG_IMAGEs_1 (faithful to character-reveal.tsx) --- */
  var layer = document.querySelector('.character-reveal');
  var hero = layer && layer.parentElement;
  if (layer && hero) {
    var frame = 0, active = false, x = 0, y = 0, tx = 0, ty = 0, prev = 0, touchTimer = 0;
    var paint = function () { layer.style.setProperty('--reveal-x', x + 'px'); layer.style.setProperty('--reveal-y', y + 'px'); };
    var animate = function (t) {
      frame = 0; if (!active) return;
      var el = prev ? Math.min(t - prev, 50) : 16.67; prev = t;
      var k = reduced.matches ? 1 : 1 - Math.pow(0.62, el / 16.67);
      x += (tx - x) * k; y += (ty - y) * k;
      if (Math.hypot(tx - x, ty - y) < 0.1) { x = tx; y = ty; } else frame = requestAnimationFrame(animate);
      paint();
    };
    var aim = function (cx, cy) {
      var b = hero.getBoundingClientRect(); tx = cx - b.left; ty = cy - b.top;
      if (!active) { active = true; x = tx; y = ty; paint(); layer.style.opacity = '1'; }
      if (!frame) { prev = 0; frame = requestAnimationFrame(animate); }
    };
    var hide = function () { active = false; layer.style.opacity = '0'; cancelAnimationFrame(frame); frame = 0; prev = 0; };
    var move = function (e) { if (e.pointerType === 'touch') return; aim(e.clientX, e.clientY); };
    hero.addEventListener('pointerenter', move); hero.addEventListener('pointermove', move);
    hero.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') hide(); });
    hero.addEventListener('pointercancel', function (e) { if (e.pointerType !== 'touch') hide(); });
    addEventListener('blur', hide); addEventListener('resize', hide);
    addEventListener('scroll', function () { if (!touchTimer) hide(); }, { passive: true });
    /* Touch/mobile fallback: touching the hero reveals under the finger (drag to move); it fades 1.2s after release.
       Scrolling still works because we never preventDefault. */
    var touchAt = function (e) {
      var t = e.touches[0]; if (!t) return;
      if (e.target.closest && e.target.closest('a,button,nav')) return;
      clearTimeout(touchTimer); touchTimer = 1; aim(t.clientX, t.clientY);
    };
    hero.addEventListener('touchstart', touchAt, { passive: true });
    hero.addEventListener('touchmove', touchAt, { passive: true });
    hero.addEventListener('touchend', function () { clearTimeout(touchTimer); touchTimer = setTimeout(function () { touchTimer = 0; hide(); }, 1200); }, { passive: true });
    /* On coarse-pointer devices with no hover, show a one-off reveal so the effect is discoverable. */
    if (matchMedia('(hover: none)').matches && !reduced.matches) {
      setTimeout(function () {
        if (active) return; var b = hero.getBoundingClientRect();
        touchTimer = 1; aim(b.left + b.width * 0.62, b.top + b.height * 0.42);
        touchTimer = setTimeout(function () { touchTimer = 0; hide(); }, 1600);
      }, 700);
    }
  }

  /* --- Mobile menu (page.tsx) --- */
  var btn = document.querySelector('.menu-toggle'), menu = document.getElementById('mobile-navigation');
  if (btn && menu) {
    var set = function (open) {
      menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.setAttribute('aria-label', open ? '關閉選單' : '打開選單');
      btn.querySelectorAll('.menu-line').forEach(function (l) { l.classList.toggle('open', open); });
    };
    btn.addEventListener('click', function () { set(menu.hidden); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { set(false); btn.focus(); } });
  }

  /* --- Creative process (creative-process.tsx) --- */
  var sec = document.querySelector('.creative-process');
  if (sec) {
    var pf = 0, steps = sec.querySelectorAll('.process-step'), links = sec.querySelectorAll('.process-navigation a');
    var update = function () {
      pf = 0; var j = sec.querySelector('.process-journey').getBoundingClientRect();
      sec.style.setProperty('--journey-progress', String(Math.max(0, Math.min(1, (innerHeight * .62 - j.top) / j.height))));
      var cur = 0; steps.forEach(function (s, i) { var r = s.getBoundingClientRect(); var reached = r.top + r.height / 2 <= innerHeight * .65; s.dataset.reached = String(reached); if (reached) cur = i; });
      links.forEach(function (a, i) { if (i === cur) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current'); });
    };
    var sched = function () { if (!pf) pf = requestAnimationFrame(update); };
    addEventListener('scroll', sched, { passive: true }); addEventListener('resize', sched); update();
    var data = JSON.parse(document.getElementById('process-data').textContent), dlg = document.getElementById('process-detail'), opener = null;
    var fill = function (i) {
      var d = data[i]; dlg.querySelector('[data-k]').textContent = '0' + (i + 1) + ' / ' + d.t; dlg.querySelector('[data-d]').textContent = d.d;
      dlg.querySelector('[data-b]').textContent = d.b; var ul = dlg.querySelector('[data-i]'); ul.innerHTML = '';
      d.i.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
      var h = dlg.querySelector('[data-h]'); h.href = d.h;
    };
    sec.querySelectorAll('.process-card').forEach(function (c) {
      c.addEventListener('click', function () { opener = c; fill(+c.dataset.step); dlg.showModal(); });
      c.addEventListener('pointermove', function (e) {
        if (e.pointerType === 'touch' || reduced.matches) return; var b = c.getBoundingClientRect(), px = (e.clientX - b.left) / b.width, py = (e.clientY - b.top) / b.height;
        c.style.setProperty('--tilt-x', (0.5 - py) * 5 + 'deg'); c.style.setProperty('--tilt-y', (px - 0.5) * 6 + 'deg'); c.style.setProperty('--light-x', px * 100 + '%'); c.style.setProperty('--light-y', py * 100 + '%');
      });
      c.addEventListener('pointerleave', function () { c.style.setProperty('--tilt-x', '0deg'); c.style.setProperty('--tilt-y', '0deg'); });
    });
    dlg.querySelector('.process-close').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', function () { if (opener) opener.focus(); });
  }

  /* --- Finale reveal + parallax + tilt (portfolio-finale.tsx) --- */
  var reveals = document.querySelectorAll('.finale-reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-revealed'); io.unobserve(e.target); } }); }, { threshold: .08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else reveals.forEach(function (el) { el.classList.add('is-revealed'); });
  var px = document.querySelectorAll('[data-parallax]'), ff = 0;
  var drift = function () { ff = 0; px.forEach(function (el) { var r = el.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) el.style.setProperty('--scroll-drift', Math.max(-24, Math.min(24, (r.top + r.height / 2 - innerHeight / 2) * .045)) + 'px'); }); };
  if (px.length) { addEventListener('scroll', function () { if (!ff) ff = requestAnimationFrame(drift); }, { passive: true }); drift(); }
  document.querySelectorAll('.work-card, .create-cta').forEach(function (el) {
    el.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch' || reduced.matches) return; var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--mx', x * 100 + '%'); el.style.setProperty('--my', y * 100 + '%'); el.style.setProperty('--rx', (.5 - y) * 4 + 'deg'); el.style.setProperty('--ry', (x - .5) * 5 + 'deg');
    });
    el.addEventListener('pointerleave', function () { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
  });
})();
// QA v4 m6: bring server-side error box into view and focus it (all checkouts / forms)
// QA v5 n2: the #buy-… fragment scroll runs after DOMContentLoaded and steals focus, so focus after load + next frame.
(function () { var go = function () { var e = document.querySelector('.errbox'); if (!e) return; e.setAttribute('tabindex', '-1');
  requestAnimationFrame(function () { e.scrollIntoView({ block: 'center' }); e.focus({ preventScroll: true }); }); };
  if (document.readyState === 'complete') go(); else addEventListener('load', go); })();
