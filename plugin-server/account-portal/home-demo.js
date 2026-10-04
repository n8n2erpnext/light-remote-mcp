(() => {
  const root = document.querySelector('[data-home-wall-demo]');
  if (!root) return;
  root.classList.add('demo-ready');

  const $ = (sel) => root.querySelector(sel);
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = (n) => Array.from({length:n}, () => alphabet[Math.floor(Math.random()*alphabet.length)]).join('');
  const shuffle = (items) => {
    const out = [...items];
    for (let i=out.length-1;i>0;i--) {
      const j = Math.floor(Math.random()*(i+1));
      [out[i],out[j]] = [out[j],out[i]];
    }
    return out;
  };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  const aCode = code(4) + '-' + code(4);
  const bCode = code(4);
  $('[data-a-code]').textContent = aCode;
  $('[data-b-code]').textContent = bCode;
  $('[data-b-approve]').textContent = bCode;

  const fallback = [
    {badge:'FS READ',tone:'fs',command:'fs.read /srv/app/package.json · max 80 lines',detail:'read 2.1 KB',action:'Copy output'},
    {badge:'PTY START',tone:'runtime',risk:'MUTATE',command:'pty.start · bash · 100×30 · /srv/app',detail:'running · terminal ready',action:'Copy cmd'},
    {badge:'GIT',tone:'command',command:'git status --short',detail:'working tree clean',action:'Copy cmd'},
    {badge:'SYSTEMCTL',tone:'system',command:'systemctl is-active light-remote-direct-plugin.service',detail:'active',action:'Copy output'}
  ];

  const rowHtml = (row, index) => {
    const risk = row.risk ? `<span class="demo-risk ${row.risk === 'SYSTEM' ? 'system' : ''}">${esc(row.risk)}</span>` : '';
    return `<div class="demo-stream-row" style="--row-delay:${index * 70}ms">
      <span class="demo-row-status">ok</span>
      <span class="demo-row-time">${new Date(Date.now() + index * 1100).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
      <div class="demo-row-main">
        <div class="demo-row-command"><span class="demo-badge ${esc(row.tone || 'command')}">${esc(row.badge)}</span>${risk}<span class="demo-command-text">${esc(row.command)}</span></div>
        <div class="demo-row-detail">${esc(row.detail || 'finished')}</div>
      </div>
      <span class="demo-copy">${esc(row.action || 'Copy cmd')}</span>
    </div>`;
  };

  async function loadRows() {
    try {
      const response = await fetch('/account/assets/hero-demo-library.json', {cache:'no-store'});
      if (!response.ok) throw new Error('library unavailable');
      const library = await response.json();
      const count = Math.max(5, Math.min(Number(library.rowsPerVisit || 8), 10));
      return shuffle(Array.isArray(library.commands) ? library.commands : fallback).slice(0, count);
    } catch {
      return shuffle(fallback);
    }
  }

  async function run() {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const steps = [...root.querySelectorAll('[data-flow-step]')];
    steps.forEach(step => step.classList.remove('show'));
    $('.demo-stream').classList.remove('live');
    $('.demo-stream-list').innerHTML = '';

    const rowsPromise = loadRows();
    const cadence = reduced ? 0 : 430;
    for (const step of steps) {
      step.classList.add('show');
      if (cadence) await sleep(cadence);
    }
    root.classList.add('connected');

    const rows = await rowsPromise;
    const count = root.querySelector('[data-stream-count]');
    if (count) count.textContent = rows.length + ' visible / ' + rows.length + ' jobs';
    $('.demo-stream-list').innerHTML = rows.map(rowHtml).join('');
    if (!reduced) await sleep(180);
    $('.demo-stream').classList.add('live');
  }

  run();
})();
