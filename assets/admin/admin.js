// mikeng_course admin: nav toggle, auto-submit selects, kanban drag & drop, copy buttons, dashboard charts. No inline scripts.
(function () {
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const csrf = () => ($('meta[name="csrf"]') || {}).content || '';
  document.addEventListener('DOMContentLoaded', () => {
    const t = $('.navtoggle'), nav = $('#sidenav');
    if (t && nav) t.addEventListener('click', () => { const o = nav.classList.toggle('open'); t.setAttribute('aria-expanded', o); });
    $$('select[data-autosubmit]').forEach(s => s.addEventListener('change', () => s.form && s.form.requestSubmit ? s.form.requestSubmit() : s.form.submit()));
    // kanban
    const board = $('.kanban');
    if (board) {
      let drag = null;
      $$('.kcard', board).forEach(c => { c.addEventListener('dragstart', e => { drag = c; c.classList.add('dragging'); e.dataTransfer.setData('text/plain', c.dataset.id); }); c.addEventListener('dragend', () => { c.classList.remove('dragging'); drag = null; }); });
      $$('.kcol', board).forEach(col => {
        col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
        col.addEventListener('dragleave', () => col.classList.remove('over'));
        col.addEventListener('drop', async e => {
          e.preventDefault(); col.classList.remove('over'); if (!drag) return;
          const card = drag, from = card.closest('.kcol'), to = col.dataset.stage; if (from === col) return;
          $('.kdrop', col).prepend(card);
          const r = await fetch(`/admin/leads/${card.dataset.id}/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() }, body: JSON.stringify({ stage: to, via: 'drag' }) }).catch(() => null);
          if (r && r.status === 202) { $('.kdrop', from).prepend(card); const j = await r.json().catch(() => ({})); location.href = j.panel || `/admin/pipeline?sold=${card.dataset.id}`; return; } // 已售出課程: Stripe TEST sample order, stage unchanged
          if (!r || !r.ok) { $('.kdrop', from).prepend(card); alert('移動失敗，請重新整理再試。'); return; }
          card.dataset.stage = to; const sel = $('select', card); if (sel) sel.value = to;
          $$('.kcol', board).forEach(c => { $('.count', c).textContent = $$('.kcard', c).length; });
        });
      });
    }
    // copy draft text
    $$('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      const src = document.getElementById(b.dataset.copy); if (!src) return;
      try { await navigator.clipboard.writeText(src.textContent); } catch { const r = document.createRange(); r.selectNodeContents(src); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('copy'); }
      b.textContent = '已複製 ✓';
      if (b.dataset.mark) fetch(b.dataset.mark, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() }, body: JSON.stringify({ status: '已複製' }) }).then(() => { const chip = b.closest('.draft') && $('.chip', b.closest('.draft')); if (chip && chip.textContent === '草稿') chip.textContent = '已複製'; });
    }));
    // dashboard charts
    const dd = $('#dash-data');
    if (dd && window.Chart) {
      const d = JSON.parse(dd.textContent), C = window.Chart;
      C.defaults.animation = false; C.defaults.maintainAspectRatio = true; C.defaults.color = '#c9c6d0'; C.defaults.borderColor = '#ffffff14'; C.defaults.font.family = 'Arial, "Noto Sans HK", sans-serif';
      const acc = '#c1afe6', acc2 = '#7fd3ff', ok = '#9be3c0', warn = '#f4dd9a';
      new C($('#c-signups'), { type: 'line', data: { labels: d.weekLabels, datasets: [{ label: '講座報名', data: d.weekBookings, borderColor: acc, backgroundColor: acc + '33', fill: true, cubicInterpolationMode: 'monotone' }, { label: '新潛在客戶', data: d.weekLeads, borderColor: acc2, borderDash: [6, 4], cubicInterpolationMode: 'monotone' }] }, options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
      new C($('#c-attend'), { type: 'bar', data: { labels: d.attendance.map(a => a.d), datasets: [{ label: '出席率 %', data: d.attendance.map(a => a.rate), backgroundColor: ok + 'aa', borderRadius: 6 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } } });
      new C($('#c-sales'), { data: { labels: d.months, datasets: [{ type: 'bar', label: '單數', data: d.salesN, backgroundColor: acc + 'aa', borderRadius: 6, yAxisID: 'y' }, { type: 'line', label: '收入 HK$', data: d.salesRevM, borderColor: warn, yAxisID: 'y1', tension: .3 }] }, options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } } } });
      new C($('#c-pipe'), { type: 'bar', data: { labels: d.pipeline.map(p => p.zh), datasets: [{ label: '人數', data: d.pipeline.map(p => p.n), backgroundColor: ['#8fb7ff', '#b9a6ff', '#7fd3ff', '#9be3c0', '#f4dd9a', '#c1afe6', '#777'], borderRadius: 6 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } } });
    }
  });
})();
