import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_ROOTS = {
  n8n2erpnext: '/workspace/n8n2erpnext',
  services: '/workspace/services',
  thaiduy: '/workspace/thaiduy.digital',
  frappe: '/workspace/frappe'
};
function loadRoots() {
  const raw = process.env.MCP_WORKSPACE_ROOTS_JSON;
  if (!raw) return DEFAULT_ROOTS;
  let parsed; try { parsed = JSON.parse(raw); } catch { throw new Error('workspace_roots_json_invalid'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('workspace_roots_json_invalid');
  const entries = Object.entries(parsed).filter(([name,value]) => /^[A-Za-z0-9._-]{1,64}$/.test(name) && typeof value === 'string' && value.startsWith('/workspace/'));
  if (!entries.length || entries.length > 32 || entries.length !== Object.keys(parsed).length) throw new Error('workspace_roots_json_invalid');
  return Object.fromEntries(entries);
}
const ROOTS = Object.freeze(loadRoots());
const DENY_PARTS = new Set(['.ssh', '.gnupg', '.aws', 'node_modules', '.git/objects']);
const DENY_NAME = /(^\.env($|\.)|secret|token|credential|password|id_ed25519|id_rsa|\.pem$|\.key$|\.p12$|\.pfx$|\.npmrc$|\.netrc$)/i;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage']);

export function rootNames() { return Object.keys(ROOTS); }

function rejectSensitive(relative) {
  const parts = relative.split('/').filter(Boolean);
  if (parts.some(part => DENY_PARTS.has(part))) throw new Error('sensitive_path_denied');
  if (parts.some(part => DENY_NAME.test(part))) throw new Error('sensitive_path_denied');
}

export function resolveWorkspace(root, relative = '.') {
  const base = ROOTS[root];
  if (!base) throw new Error('unknown_root');
  const rel = String(relative || '.').replaceAll('\\', '/');
  rejectSensitive(rel);
  const target = path.resolve(base, rel);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error('path_escape_denied');
  return target;
}
export async function listWorkspace(root, relative = '.', depth = 1) {
  const target = resolveWorkspace(root, relative);
  const maxDepth = Math.max(1, Math.min(Number(depth) || 1, 3));
  const out = [];
  async function walk(dir, prefix, level) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries.slice(0, 250)) {
      if (DENY_NAME.test(entry.name) || DENY_PARTS.has(entry.name)) continue;
      const rel = path.posix.join(prefix, entry.name);
      out.push({ path: rel, type: entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other' });
      if (entry.isDirectory() && level < maxDepth && !SKIP_DIRS.has(entry.name)) {
        await walk(path.join(dir, entry.name), rel, level + 1);
      }
      if (out.length >= 500) return;
    }
  }
  await walk(target, String(relative || '.').replaceAll('\\', '/'), 1);
  return out.slice(0, 500);
}

export async function readWorkspaceText(root, relative, startLine = 1, maxLines = 200) {
  const target = resolveWorkspace(root, relative);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error('not_a_file');
  if (stat.size > 512 * 1024) throw new Error('file_too_large');
  const data = await fs.readFile(target);
  if (data.includes(0)) throw new Error('binary_file_denied');
  const lines = data.toString('utf8').split(/\r?\n/);
  const start = Math.max(1, Number(startLine) || 1);
  const count = Math.max(1, Math.min(Number(maxLines) || 200, 400));
  return {
    path: relative,
    totalLines: lines.length,
    startLine: start,
    endLine: Math.min(lines.length, start + count - 1),
    text: lines.slice(start - 1, start - 1 + count).join('\n')
  };
}

async function safeTextFile(file) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 512 * 1024) return null;
    const data = await fs.readFile(file);
    if (data.includes(0)) return null;
    return data.toString('utf8');
  } catch { return null; }
}

export async function searchWorkspace(root, relative, query, maxResults = 40) {
  if (!query || String(query).length < 2) throw new Error('query_too_short');
  const target = resolveWorkspace(root, relative || '.');
  const needle = String(query).toLowerCase();
  const limit = Math.max(1, Math.min(Number(maxResults) || 40, 80));
  const results = [];
  let visited = 0;
  async function walk(dir) {
    if (results.length >= limit || visited >= 5000) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= limit || visited >= 5000) return;
      if (DENY_NAME.test(entry.name) || DENY_PARTS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      visited++;
      const text = await safeTextFile(full);
      if (!text) continue;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length && results.length < limit; i++) {
        const pos = lines[i].toLowerCase().indexOf(needle);
        if (pos < 0) continue;
        results.push({
          path: path.relative(ROOTS[root], full).replaceAll('\\', '/'),
          line: i + 1,
          excerpt: lines[i].trim().slice(0, 240)
        });
      }
    }
  }
  await walk(target);
  return { query: String(query), visitedFiles: visited, results };
}
export async function gitStatus(root, repoPath = '.') {
  const repo = resolveWorkspace(root, repoPath);
  const { stdout, stderr } = await execFileAsync('git', ['-C', repo, 'status', '--short', '--branch'], {
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  });
  return { repo: repoPath, status: stdout.trimEnd(), stderr: stderr.trimEnd() };
}

export async function gitDiff(root, repoPath = '.', relativePath = '', cached = false) {
  const repo = resolveWorkspace(root, repoPath);
  if (relativePath) resolveWorkspace(root, path.posix.join(repoPath, relativePath));
  const args = ['-C', repo, 'diff', '--no-ext-diff', '--no-color', '--unified=3'];
  if (cached) args.push('--cached');
  if (relativePath) args.push('--', relativePath);
  const { stdout, stderr } = await execFileAsync('git', args, {
    timeout: 8000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  });
  const truncated = stdout.length > 300000;
  return {
    repo: repoPath,
    path: relativePath || null,
    cached: Boolean(cached),
    diff: stdout.slice(0, 300000),
    truncated,
    stderr: stderr.trimEnd()
  };
}
