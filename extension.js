// Claude Window Status
//
// Claude Code hooks (see hooks/claude-window-status.ps1) write one JSON file per
// session to ~/.claude/window-status/. This extension picks out the sessions whose
// cwd lies inside this window's workspace folders and prefixes window.title with
// the most urgent state (waiting > working > ready), so the taskbar hover preview
// shows which window needs you. The title is written to the open .code-workspace
// file's settings, so it only affects this window.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATUS_DIR = path.join(os.homedir(), '.claude', 'window-status');
const POLL_MS = 1500;
const RANK = { ready: 1, working: 2, waiting: 3 };
const ICON = { ready: '$(check)', working: '$(sync~spin)', waiting: '$(bell)' };

let ctx;
let log;
let statusItem;
let lastState; // last aggregate state applied to the title (undefined = never applied)
let clearedAt = 0; // sessions not updated since the Clear command are ignored
let queue = Promise.resolve();
const interruptCache = new Map(); // transcriptPath -> { mtimeMs, interrupted }

function activate(context) {
  ctx = context;
  log = vscode.window.createOutputChannel('Claude Window Status');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.command = 'claudeWindowStatus.clear';

  try { fs.mkdirSync(STATUS_DIR, { recursive: true }); } catch { /* polled anyway */ }

  let watcher;
  try { watcher = fs.watch(STATUS_DIR, () => schedule()); } catch (e) { log.appendLine(`fs.watch unavailable: ${e.message}`); }
  const timer = setInterval(() => schedule(), POLL_MS);

  context.subscriptions.push(
    log,
    statusItem,
    { dispose: () => { clearInterval(timer); if (watcher) watcher.close(); } },
    vscode.commands.registerCommand('claudeWindowStatus.clear', () => { clearedAt = Date.now(); schedule(true); }),
    vscode.commands.registerCommand('claudeWindowStatus.showLog', () => log.show()),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('claudeWindowStatus')) schedule(true); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => schedule(true)),
  );

  log.appendLine(`Watching ${STATUS_DIR} for ${workspaceRoots().join(', ') || '(no folders)'}`);
  schedule(true);
}

function deactivate() {
  // Best effort: put the title back. If the window dies first, the next activation fixes it.
  return applyTitle(null);
}

let pending = false;
let pendingForce = false;
function schedule(force = false) {
  pendingForce = pendingForce || force;
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    const f = pendingForce;
    pendingForce = false;
    queue = queue.then(() => tick(f)).catch(e => log.appendLine(`tick failed: ${e.stack || e}`));
  }, 100);
}

async function tick(force) {
  const sessions = currentSessions();
  const state = sessions.reduce((best, s) => (!best || RANK[s.state] > RANK[best] ? s.state : best), null);

  if (state) {
    statusItem.text = `${ICON[state]} Claude`;
    statusItem.tooltip = sessions.map(s => `${s.state} - ${s.projectDir || s.cwd}`).join('\n') + '\n\nClick to clear';
    statusItem.show();
  } else {
    statusItem.hide();
  }

  if (force || state !== lastState) {
    log.appendLine(`${new Date().toLocaleTimeString()} state: ${lastState ?? '-'} -> ${state ?? '-'}`);
    lastState = state;
    await applyTitle(state);
  }
}

function currentSessions() {
  const roots = workspaceRoots();
  if (!roots.length) return [];
  const cfg = vscode.workspace.getConfiguration('claudeWindowStatus');
  const staleMs = cfg.get('staleHours', 12) * 3600 * 1000;
  const now = Date.now();

  let names;
  try { names = fs.readdirSync(STATUS_DIR); } catch { return []; }

  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(STATUS_DIR, name), 'utf8').replace(/^\uFEFF/, '')); } catch { continue; }
    if (!s || !RANK[s.state] || !s.cwd || typeof s.ts !== 'number') continue;
    if (now - s.ts > staleMs || s.ts <= clearedAt) continue;
    if (!insideAny(s.cwd, roots) && !(s.projectDir && insideAny(s.projectDir, roots))) continue;
    // Esc/interrupt doesn't fire Stop, so a "working" session would stick; check the transcript.
    if (s.state === 'working' && s.transcriptPath && wasInterrupted(s.transcriptPath, s.ts)) s.state = 'ready';
    out.push(s);
  }
  return out;
}

function workspaceRoots() {
  return (vscode.workspace.workspaceFolders || [])
    .filter(f => f.uri.scheme === 'file')
    .map(f => normalize(f.uri.fsPath));
}

function normalize(p) {
  // Accept Git Bash style /c/Users/... as well as C:\Users\...
  const m = /^\/([a-z])\/(.*)$/i.exec(p);
  if (m && process.platform === 'win32') p = `${m[1]}:/${m[2]}`;
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

function insideAny(cwd, roots) {
  const c = normalize(cwd);
  return roots.some(r => c === r || c.startsWith(r + path.sep));
}

// True when the transcript's last conversational entry (written after `sinceTs`)
// is Claude Code's "[Request interrupted by user...]" marker.
function wasInterrupted(transcriptPath, sinceTs) {
  let st;
  try { st = fs.statSync(transcriptPath); } catch { return false; }
  if (st.mtimeMs < sinceTs) return false;
  const cached = interruptCache.get(transcriptPath);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.interrupted;

  let interrupted = false;
  try {
    const len = Math.min(st.size, 64 * 1024);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(transcriptPath, 'r');
    try { fs.readSync(fd, buf, 0, len, st.size - len); } finally { fs.closeSync(fd); }
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let e;
      try { e = JSON.parse(lines[i]); } catch { continue; }
      if (e.type !== 'user' && e.type !== 'assistant') continue;
      interrupted = e.type === 'user' && lines[i].includes('[Request interrupted by user');
      break;
    }
  } catch { /* treat as not interrupted */ }

  interruptCache.set(transcriptPath, { mtimeMs: st.mtimeMs, interrupted });
  return interrupted;
}

async function applyTitle(state) {
  const wsFile = vscode.workspace.workspaceFile;
  if (!wsFile || wsFile.scheme !== 'file') return; // folder windows would write .vscode/settings.json; skip

  const windowCfg = vscode.workspace.getConfiguration('window');
  const inspected = windowCfg.inspect('title') || {};
  const current = inspected.workspaceValue;

  // Remember the workspace's own window.title (if any) so it can be restored. If the
  // current value isn't the one we last wrote, the user (or a first run) set it.
  const cfg = vscode.workspace.getConfiguration('claudeWindowStatus');
  const inherited = inspected.globalValue ?? inspected.defaultValue ?? '';
  let base = ctx.workspaceState.get('base');
  if (!base || current !== ctx.workspaceState.get('lastWritten')) {
    base = adoptBase(current, inherited, cfg);
    await ctx.workspaceState.update('base', base);
  }

  let desired;
  if (state && cfg.get('updateTitle', true)) {
    const template = base.had ? base.value : inherited;
    desired = cfg.get(`prefix.${state}`, '') + template;
  } else {
    desired = base.had ? base.value : undefined;
  }

  if (desired === current) return;
  await ctx.workspaceState.update('lastWritten', desired);
  try {
    await windowCfg.update('title', desired, vscode.ConfigurationTarget.Workspace);
  } catch (e) {
    log.appendLine(`Failed to update window.title: ${e.message}`);
  }
}

// A workspace title we didn't write this session may still carry one of our prefixes
// (window closed mid-run and workspace state lost, or the extension was reinstalled).
// Strip it so prefixes never stack, and treat a bare copy of the inherited title as unset.
function adoptBase(current, inherited, cfg) {
  if (current === undefined) return { had: false, value: undefined };
  let value = current;
  for (const state of Object.keys(RANK)) {
    const prefix = cfg.get(`prefix.${state}`, '');
    if (prefix && value.startsWith(prefix)) { value = value.slice(prefix.length); break; }
  }
  if (value !== current && value === inherited) return { had: false, value: undefined };
  return { had: true, value };
}

module.exports = { activate, deactivate };
