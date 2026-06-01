/**
 * Workspace Service (Phase C2)
 *
 * Gives the engineering agent a REAL, sandboxed multi-file project workspace:
 * a per-run directory on disk plus Claude-Code-style file ops and a guarded
 * command runner. Text files are mirrored to the DB (workspace_files) for
 * durability, and a static preview can be assembled for the code_project card.
 *
 * Safety:
 *  - All file paths are confined to the workspace dir (no traversal/escape).
 *  - run_command runs with cwd = workspace, a command ALLOWLIST, a timeout, and a
 *    SANITIZED env (no app secrets / .env leak).
 *  - WORKSPACE_ROOT defaults to the OS temp dir — outside the app source.
 *
 * Deferred (documented follow-ups): live dev-server proxy preview, Docker
 * hardening, Supabase Storage tarballs for binaries, network restrictions.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const supabase = require('../models/supabaseClient');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.join(os.tmpdir(), 'thebrain-workspaces');

// Base commands the agent may run. Anything else is rejected.
const COMMAND_ALLOWLIST = [
  'npm', 'npx', 'node', 'pnpm', 'yarn', 'vite', 'tsc', 'eslint', 'jest',
  'vitest', 'next', 'react-scripts', 'ls', 'cat', 'mkdir', 'rm', 'cp', 'mv', 'echo',
];
const RUN_TIMEOUT_MS = parseInt(process.env.WORKSPACE_CMD_TIMEOUT_MS || '120000', 10);

function _wsDir(workspaceId) {
  return path.join(WORKSPACE_ROOT, workspaceId);
}

// Resolve a user-supplied relative path and ensure it stays inside the workspace.
function _safePath(workspaceId, relPath) {
  const root = _wsDir(workspaceId);
  const resolved = path.resolve(root, relPath || '.');
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the workspace: ${relPath}`);
  }
  return resolved;
}

/**
 * Find or create the workspace for an execution. Returns { id, dir }.
 */
async function ensureWorkspace(executionId, companyId, name = 'project') {
  let { data: ws } = await supabase
    .from('workspaces')
    .select('*')
    .eq('agent_execution_id', executionId)
    .single();

  if (!ws) {
    const insert = { company_id: companyId, agent_execution_id: executionId, name, project_type: 'static' };
    const { data, error } = await supabase.from('workspaces').insert([insert]).select().single();
    if (error) throw new Error(`Failed to create workspace: ${error.message}`);
    ws = data;
  }

  const dir = _wsDir(ws.id);
  await fsp.mkdir(dir, { recursive: true });
  // Best-effort restore from DB mirror if the disk dir is empty (ephemeral disk).
  try {
    const onDisk = await fsp.readdir(dir);
    if (onDisk.length === 0) {
      const { data: files } = await supabase.from('workspace_files').select('path, content, is_binary').eq('workspace_id', ws.id);
      for (const f of (files || [])) {
        if (f.is_binary) continue;
        const p = _safePath(ws.id, f.path);
        await fsp.mkdir(path.dirname(p), { recursive: true });
        await fsp.writeFile(p, f.content || '', 'utf8');
      }
    }
  } catch { /* non-fatal */ }

  return { id: ws.id, dir };
}

async function writeFile(executionId, companyId, relPath, content) {
  const ws = await ensureWorkspace(executionId, companyId);
  const p = _safePath(ws.id, relPath);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content ?? '', 'utf8');
  // Mirror to DB (upsert by workspace+path), bumping version.
  const { data: existing } = await supabase.from('workspace_files')
    .select('id, version').eq('workspace_id', ws.id).eq('path', relPath).single();
  if (existing) {
    await supabase.from('workspace_files')
      .update({ content: content ?? '', version: (existing.version || 1) + 1, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await supabase.from('workspace_files').insert([{ workspace_id: ws.id, path: relPath, content: content ?? '' }]);
  }
  return { ok: true, path: relPath, bytes: Buffer.byteLength(content ?? '', 'utf8') };
}

async function readFile(executionId, companyId, relPath) {
  const ws = await ensureWorkspace(executionId, companyId);
  const p = _safePath(ws.id, relPath);
  const content = await fsp.readFile(p, 'utf8');
  return { path: relPath, content: content.slice(0, 100000) };
}

// Exact-string replace (like the Edit tool). old_string must be unique.
async function editFile(executionId, companyId, relPath, oldString, newString) {
  const ws = await ensureWorkspace(executionId, companyId);
  const p = _safePath(ws.id, relPath);
  const content = await fsp.readFile(p, 'utf8');
  const idx = content.indexOf(oldString);
  if (idx === -1) throw new Error('old_string not found in file');
  if (content.indexOf(oldString, idx + oldString.length) !== -1) {
    throw new Error('old_string is not unique; include more surrounding context');
  }
  const updated = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
  return writeFile(executionId, companyId, relPath, updated);
}

async function listFiles(executionId, companyId) {
  const ws = await ensureWorkspace(executionId, companyId);
  const root = _wsDir(ws.id);
  const out = [];
  async function walk(dir) {
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  await walk(root);
  return { files: out.slice(0, 500) };
}

async function searchFiles(executionId, companyId, query) {
  const { files } = await listFiles(executionId, companyId);
  const ws = await ensureWorkspace(executionId, companyId);
  const matches = [];
  const q = (query || '').toLowerCase();
  for (const f of files) {
    if (matches.length >= 50) break;
    try {
      const content = await fsp.readFile(_safePath(ws.id, f), 'utf8');
      content.split('\n').forEach((line, i) => {
        if (matches.length < 50 && line.toLowerCase().includes(q)) {
          matches.push({ path: f, line: i + 1, text: line.trim().slice(0, 200) });
        }
      });
    } catch { /* skip */ }
  }
  return { matches };
}

function _commandAllowed(cmd) {
  const base = (cmd || '').trim().split(/\s+/)[0];
  const leaf = base.split(/[\\/]/).pop();
  return COMMAND_ALLOWLIST.includes(leaf);
}

async function runCommand(executionId, companyId, cmd) {
  const ws = await ensureWorkspace(executionId, companyId);
  if (!_commandAllowed(cmd)) {
    return { ok: false, error: `Command not allowed. Allowed base commands: ${COMMAND_ALLOWLIST.join(', ')}` };
  }
  // Sanitized env — do NOT inherit app secrets / .env.
  const safeEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME || process.env.USERPROFILE,
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP, TMP: process.env.TMP,
    NODE_ENV: 'development',
    npm_config_yes: 'true',
  };
  return new Promise((resolve) => {
    exec(cmd, { cwd: ws.dir, env: safeEnv, timeout: RUN_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 8, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error?.code ?? 0,
          stdout: (stdout || '').slice(-6000),
          stderr: (stderr || '').slice(-6000),
          ...(error && error.killed ? { timedOut: true } : {}),
        });
      });
  });
}

/**
 * Assemble a static preview: take the entry HTML and inline same-dir local
 * <link>/<script src> references so it renders in a sandboxed iframe. Returns
 * { html, entry, files } or null if there's no HTML entry.
 */
async function buildPreview(executionId, companyId) {
  const ws = await ensureWorkspace(executionId, companyId);
  const { files } = await listFiles(executionId, companyId);
  const entry = files.find(f => /(^|\/)index\.html$/i.test(f)) || files.find(f => f.toLowerCase().endsWith('.html'));
  if (!entry) return { html: null, entry: null, files };

  let html = await fsp.readFile(_safePath(ws.id, entry), 'utf8');
  const baseDir = path.posix.dirname(entry);
  const resolveRel = (ref) => (baseDir === '.' ? ref : path.posix.join(baseDir, ref)).replace(/^\.\//, '');

  // Inline local stylesheets.
  html = await _replaceAsync(html, /<link[^>]*href=["']([^"':]+\.css)["'][^>]*>/gi, async (m, href) => {
    try { const css = await fsp.readFile(_safePath(ws.id, resolveRel(href)), 'utf8'); return `<style>\n${css}\n</style>`; }
    catch { return m; }
  });
  // Inline local scripts.
  html = await _replaceAsync(html, /<script[^>]*src=["']([^"':]+\.js)["'][^>]*>\s*<\/script>/gi, async (m, src) => {
    try { const js = await fsp.readFile(_safePath(ws.id, resolveRel(src)), 'utf8'); return `<script>\n${js}\n</script>`; }
    catch { return m; }
  });

  return { html: html.slice(0, 400000), entry, files };
}

async function _replaceAsync(str, regex, asyncFn) {
  const matches = [];
  str.replace(regex, (m, ...args) => { matches.push({ m, args }); return m; });
  let result = str;
  for (const { m, args } of matches) {
    const replacement = await asyncFn(m, ...args);
    result = result.replace(m, () => replacement);
  }
  return result;
}

module.exports = {
  ensureWorkspace,
  writeFile,
  readFile,
  editFile,
  listFiles,
  searchFiles,
  runCommand,
  buildPreview,
  WORKSPACE_ROOT,
};
