import { writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dashboardHtml } from '../../gateway/dashboard.mjs';

const html = dashboardHtml();
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) throw new Error('wall inline script not found');
if (!html.includes("/api/sessions") || !html.includes("new EventSource('/events')")) {
  throw new Error('wall session/SSE endpoints missing');
}
const file = `/tmp/gpt-vps-wall-inline-${process.pid}.js`;
writeFileSync(file, match[1]);
const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
try { unlinkSync(file); } catch {}
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'wall inline script syntax failed\n');
  process.exit(result.status || 1);
}
console.log('wall-inline-js=PASS');
console.log('wall-session-tabs=present');
console.log('wall-sse=present');
