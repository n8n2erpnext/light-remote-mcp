(() => {
  const root = document.querySelector('[data-home-wall-demo]');
  if (!root) return;
  root.classList.add('demo-ready');

  const $ = (sel) => root.querySelector(sel);
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = (n) => Array.from({length:n}, () => alphabet[Math.floor(Math.random()*alphabet.length)]).join('');
  const pick = (items) => items[Math.floor(Math.random()*items.length)];
  const waitVisible = async () => {
    while (document.hidden) await sleep(800);
  };

  function syntaxHtml(command, shell) {
    const input = String(command || '');
    const tokens = input.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\$env:[A-Za-z_][\w]*|\$[A-Za-z_][\w:.-]*|&&|\|\||[|;=]|\s+|[^\s|;=]+/g) || [];
    let expectCommand = true;
    const wrappers = new Set(['sudo','env','command','nohup','time','cmd','cmd.exe','powershell','powershell.exe','pwsh','pwsh.exe']);
    return tokens.map(raw => {
      if (/^\s+$/.test(raw)) return raw;
      const low = raw.toLowerCase();
      let cls = '';
      if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) cls = 'demo-syn-string';
      else if (/^\$(?:env:)?/i.test(raw)) cls = 'demo-syn-var';
      else if (/^(?:&&|\|\||\||;|=)$/.test(raw)) { cls = 'demo-syn-op'; expectCommand = true; }
      else if (/^--?/.test(raw) || (shell === 'powershell' && /^-[A-Za-z]/.test(raw))) cls = 'demo-syn-option';
      else if (/^(?:[A-Za-z]:[\\/]|\\\\|\/|\.\/|\.\.\/)/.test(raw)) cls = 'demo-syn-path';
      else if (/^\d+(?:\.\d+)?$/.test(raw)) cls = 'demo-syn-number';
      else if (shell === 'powershell' && /^[A-Z][A-Za-z]+-[A-Z][A-Za-z]+/.test(raw)) cls = 'demo-syn-cmdlet';
      else if (low === 'sudo') cls = 'demo-syn-danger';
      else if (expectCommand) { cls = 'demo-syn-command'; expectCommand = wrappers.has(low); }
      else if (/^(?:true|false|null|running|active)$/i.test(raw)) cls = 'demo-syn-keyword';
      return cls ? '<span class="' + cls + '">' + esc(raw) + '</span>' : esc(raw);
    }).join('');
  }

  function rowHtml(row, shell, totalJobs) {
    const riskClass = row.risk === 'DANGER' ? ' danger' : row.risk === 'SYSTEM' ? ' system' : '';
    const risk = row.risk ? '<span class="demo-risk' + riskClass + '">' + esc(row.risk) + '</span>' : '';
    const effectiveShell = row.shell || shell;
    const command = ['bash','powershell','cmd'].includes(effectiveShell) ? syntaxHtml(row.command, effectiveShell) : esc(row.command);
    const now = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    return '<div class="demo-stream-row is-entering">' +
      '<span class="demo-row-status">ok</span>' +
      '<span class="demo-row-time">' + now + '</span>' +
      '<div class="demo-row-main">' +
        '<div class="demo-row-command"><span class="demo-badge ' + esc(row.tone || 'command') + '">' + esc(row.badge) + '</span>' + risk + '<span class="demo-command-text">' + command + '</span></div>' +
        '<div class="demo-row-detail">' + esc(row.detail || ('job ' + totalJobs + ' finished')) + '</div>' +
      '</div>' +
      '<span class="demo-copy">' + esc(row.action || 'Copy output') + '</span>' +
    '</div>';
  }

  async function loadLibrary() {
    const response = await fetch('/account/assets/hero-demo-library.json', {cache:'no-store'});
    if (!response.ok) throw new Error('hero_demo_library_unavailable');
    return response.json();
  }

  function chooseScenario(library) {
    const scenarios = Array.isArray(library.scenarios) ? library.scenarios : [];
    const platform = Math.random() < 0.5 ? 'linux' : 'windows';
    const platformScenarios = scenarios.filter(s => s.platform === platform);
    return pick(platformScenarios.length ? platformScenarios : scenarios);
  }

  function configureScenario(scenario) {
    root.dataset.platform = scenario.platform;
    const device = $('[data-demo-device]');
    const project = $('[data-project-label]');
    const prompts = root.querySelectorAll('[data-demo-prompt]');
    if (device) device.textContent = scenario.device;
    if (project) project.textContent = scenario.project;
    prompts.forEach(node => node.textContent = scenario.prompt || (scenario.platform === 'windows' ? 'PS>' : '$'));
  }

  async function runPairing() {
    const aCode = code(4) + '-' + code(4);
    const bCode = code(4);
    $('[data-a-code]').textContent = aCode;
    $('[data-b-code]').textContent = bCode;
    $('[data-b-approve]').textContent = bCode;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const cadence = reduced ? 0 : 430;
    const steps = [...root.querySelectorAll('[data-flow-step]')];
    steps.forEach(step => step.classList.remove('show'));
    for (const step of steps) {
      step.classList.add('show');
      if (cadence) await sleep(cadence);
    }
    root.classList.add('connected');
  }

  async function runStream(library, scenario) {
    const host = $('.demo-stream-list');
    const counter = $('[data-stream-count]');
    const maxVisible = Math.max(4, Math.min(Number(library.visibleRows || 8), 10));
    const baseDelay = Math.max(450, Number(library.streamDelayMs || 900));
    const jitter = Math.max(0, Number(library.streamJitterMs || 500));
    const steps = Array.isArray(scenario.steps) ? scenario.steps : [];
    const loop = Array.isArray(scenario.loop) && scenario.loop.length ? scenario.loop : steps;
    let stepIndex = 0;
    let loopIndex = 0;
    let totalJobs = 0;

    host.innerHTML = '';
    if (counter) counter.textContent = '0 visible / 0 jobs';

    while (true) {
      await waitVisible();
      const row = stepIndex < steps.length ? steps[stepIndex++] : loop[loopIndex++ % loop.length];
      if (!row) return;
      totalJobs += 1;
      host.insertAdjacentHTML('beforeend', rowHtml(row, scenario.shell, totalJobs));
      const newest = host.lastElementChild;
      requestAnimationFrame(() => newest?.classList.remove('is-entering'));

      const children = [...host.children].filter(node => !node.classList.contains('is-leaving'));
      if (children.length > maxVisible) {
        const first = children[0];
        first.classList.add('is-leaving');
        setTimeout(() => first.remove(), 340);
      }

      const visible = Math.min(totalJobs, maxVisible);
      if (counter) counter.textContent = visible + ' visible / ' + totalJobs + ' jobs';
      await sleep(baseDelay + Math.floor(Math.random() * jitter));
    }
  }

  async function start() {
    try {
      const library = await loadLibrary();
      const scenario = chooseScenario(library);
      if (!scenario) return;
      configureScenario(scenario);
      await runPairing();
      await sleep(180);
      runStream(library, scenario);
    } catch (error) {
      root.classList.add('connected');
      const counter = $('[data-stream-count]');
      if (counter) counter.textContent = 'demo unavailable';
    }
  }

  start();
})();
