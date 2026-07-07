#!/usr/bin/env node
/*
 * fleet.js — zero-dependency observability for the parallel-agent fleet.
 *
 * The orchestrator (ORCHESTRATION.md) runs one Claude Code session per
 * feature lane in a sibling git worktree (../solar-system-<name>). This
 * tool joins four independent data sources into one verdict per lane:
 *
 *   1. git       — worktree list, commits ahead of main, dirty files,
 *                  last-commit age (shared .git, read-only).
 *   2. status    — the lane's append-only .agent-status.md (last line +
 *                  mtime), the agent's own self-report.
 *   3. transcript— the lane's Claude Code session .jsonl under
 *                  ~/.claude/projects/<sanitized-cwd>/. Sanitized cwd is
 *                  the absolute path with '/' and '.' → '-'. NOTE (measured
 *                  2026-07-07): lanes launched *from the main checkout*
 *                  record cwd = main repo, so their transcripts live in the
 *                  MAIN project dir; we fall back to scanning that dir and
 *                  matching the lane's branch/worktree name in the first
 *                  user message (the mission brief always names the branch).
 *                  Since wave 5 lanes may also run as BACKGROUND SUBAGENTS
 *                  of the orchestrator session: their transcripts are
 *                  <main project dir>/<sessionId>/subagents/agent-*.jsonl
 *                  (top-level cwd field stays the main checkout — measured
 *                  2026-07-07 against the wave-5 ci/earth lanes — but the
 *                  first user message, the launch prompt, always names the
 *                  lane's worktree path). Second fallback: scan those files
 *                  with the same first-user-message match, newest first;
 *                  such rows get a ' [sub]' verdict suffix so the human can
 *                  tell terminal-session lanes from subagent lanes.
 *                  Assistant lines repeat one API message per content block
 *                  → dedupe usage by message.id before summing.
 *   4. GitHub    — `gh pr list` mapped to lanes by head branch; CI state
 *                  from statusCheckRollup. Degrades to "gh unavailable".
 *
 * Usage:
 *   node tools/fleet.js            compact aligned terminal table
 *   node tools/fleet.js --serve [port=4199]
 *                                  self-refreshing dark-theme dashboard
 *
 * Zero deps, streams transcripts line-by-line (never slurps multi-MB
 * files), skips unparseable lines, always exits 0 — an observability
 * tool must not itself become the incident.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { execFile } = require('child_process');

const REPO_HINT = path.resolve(__dirname, '..');
const STALL_MIN = 30;             // idle minutes before a lane counts as stalled
const MAX_LINE = 10 * 1024 * 1024; // skip absurd transcript lines outright
const BRIEF_SCAN_LINES = 80;      // how deep to look for the first user message

// ---------------------------------------------------------------------------
// small utils

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, Object.assign({
      timeout: 20000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8',
    }, opts || {}), (err, stdout) => {
      resolve({ ok: !err, out: (stdout || '').toString() });
    });
  });
}

function fmtDur(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return '-';
  const m = Math.floor(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h' + String(m % 60).padStart(2, '0') + 'm';
  return Math.floor(h / 24) + 'd' + (h % 24) + 'h';
}

function fmtTok(n) {
  if (n == null) return '-';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function sanitizeCwd(p) { return p.replace(/[/.]/g, '-'); }

// Overridable so the test suite can point the whole pipeline at a fixture
// tree instead of the real ~/.claude/projects.
function projectsRoot() {
  return process.env.FLEET_PROJECTS_ROOT ||
    path.join(os.homedir(), '.claude', 'projects');
}

function projectDirFor(worktreePath) {
  return path.join(projectsRoot(), sanitizeCwd(worktreePath));
}

function listJsonl(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    const p = path.join(dir, n);
    try {
      const st = fs.statSync(p);
      if (st.isFile()) out.push({ path: p, mtime: st.mtimeMs, size: st.size });
    } catch (e) { /* raced away */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// Background-subagent transcripts live BELOW the project dir:
// <projectDir>/<sessionId>/subagents/(workflows/wf_*/)?agent-*.jsonl.
// Bounded recursive walk — depth 4 reaches the workflow layer, and a hard
// file cap keeps a pathological dir from turning observability into the
// incident.
const AGENT_WALK_DEPTH = 4;
const AGENT_WALK_MAX = 500;

function listAgentJsonl(projectDir) {
  const out = [];
  (function walk(dir, depth) {
    if (depth > AGENT_WALK_DEPTH || out.length >= AGENT_WALK_MAX) return;
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of names) {
      if (out.length >= AGENT_WALK_MAX) return;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p, depth + 1);
      else if (ent.isFile() && /^agent-.*\.jsonl$/.test(ent.name)) {
        try { out.push({ path: p, mtime: fs.statSync(p).mtimeMs, size: fs.statSync(p).size }); }
        catch (e) { /* raced away */ }
      }
    }
  })(projectDir, 0);
  return out.sort((a, b) => b.mtime - a.mtime);
}

// ---------------------------------------------------------------------------
// 1. git

async function getWorktrees() {
  const res = await run('git', ['-C', REPO_HINT, 'worktree', 'list', '--porcelain']);
  if (!res.ok) return { main: null, lanes: [] };
  const entries = [];
  let cur = null;
  for (const line of res.out.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9).trim() }; entries.push(cur); }
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
  }
  const main = entries[0] || null; // git lists the primary worktree first
  const lanes = entries.filter((e) => {
    if (!e.path || e === main) return false;
    return /^solar-system-[A-Za-z0-9._-]+$/.test(path.basename(e.path));
  }).map((e) => ({
    path: e.path,
    name: path.basename(e.path).replace(/^solar-system-/, ''),
    branch: e.branch || '?',
  }));
  return { main, lanes };
}

async function gitFacts(dir, isMain) {
  const [ahead, status, last] = await Promise.all([
    isMain ? Promise.resolve({ ok: true, out: '' })
           : run('git', ['-C', dir, 'log', '--oneline', 'main..HEAD']),
    run('git', ['-C', dir, 'status', '--porcelain']),
    run('git', ['-C', dir, 'log', '-1', '--format=%ct']),
  ]);
  const count = (r) => (r.ok && r.out.trim() ? r.out.trim().split('\n').length : 0);
  return {
    ahead: isMain ? null : count(ahead),
    dirty: count(status),
    lastCommitMs: last.ok && last.out.trim() ? Number(last.out.trim()) * 1000 : null,
  };
}

// ---------------------------------------------------------------------------
// 2. self-reported status

function statusFacts(dir) {
  const p = path.join(dir, '.agent-status.md');
  try {
    const st = fs.statSync(p);
    if (st.size > 512 * 1024) return { line: '(status file too large)', mtime: st.mtimeMs };
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
    return { line: lines.length ? lines[lines.length - 1].trim() : '', mtime: st.mtimeMs };
  } catch (e) {
    return { line: null, mtime: null };
  }
}

// ---------------------------------------------------------------------------
// 3. session transcripts

function streamLines(file, onLine) {
  return new Promise((resolve) => {
    let stream;
    try { stream = fs.createReadStream(file, { encoding: 'utf8' }); }
    catch (e) { return resolve(); }
    stream.on('error', () => resolve());
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let done = false;
    const finish = () => { if (!done) { done = true; rl.close(); stream.destroy(); resolve(); } };
    rl.on('line', (line) => {
      if (done) return;
      if (onLine(line) === false) finish();
    });
    rl.on('close', finish);
  });
}

// First real user message of a session (the mission brief for lane agents).
// Top-level session files: skip sidechain lines (embedded Task prompts).
// Subagent agent-*.jsonl: EVERY line is isSidechain:true (measured
// 2026-07-07), and the first user message is the launch prompt we want —
// callers pass allowSidechain for those.
async function firstUserText(file, allowSidechain) {
  let text = null, seen = 0;
  await streamLines(file, (line) => {
    if (++seen > BRIEF_SCAN_LINES || line.length > MAX_LINE) return seen <= BRIEF_SCAN_LINES;
    let d; try { d = JSON.parse(line); } catch (e) { return true; }
    if (d && d.type === 'user' && (allowSidechain || !d.isSidechain) && d.message) {
      const c = d.message.content;
      text = typeof c === 'string' ? c : JSON.stringify(c);
      return false;
    }
    return true;
  });
  return text;
}

// Locate the newest/active session file for a lane. Primary: the lane's own
// sanitized project dir. Fallback 1 (verified live against the whatif lane):
// sessions launched from the main checkout land in the main repo's project
// dir — match the brief (first user message) against branch/worktree name.
// Fallback 2 (wave 5): background-subagent lanes — same match over the
// orchestrator project dir's agent-*.jsonl files, newest first, so the most
// recently active transcript wins when a lane was relaunched.
// Returns { path, subagent } or null.
async function findSessionFile(lane, mainDirFiles, agentFiles, briefCache) {
  const own = listJsonl(projectDirFor(lane.path));
  if (own.length) return { path: own[0].path, subagent: false };
  const needleA = lane.branch;
  const needleB = path.basename(lane.path);
  const matchIn = async (files, allowSidechain) => {
    for (const f of files) { // newest-first
      if (!(f.path in briefCache)) briefCache[f.path] = await firstUserText(f.path, allowSidechain);
      const brief = briefCache[f.path];
      if (brief && ((needleA && needleA !== '?' && brief.includes(needleA)) || brief.includes(needleB))) {
        return f.path;
      }
    }
    return null;
  };
  const sess = await matchIn(mainDirFiles, false);
  if (sess) return { path: sess, subagent: false };
  const sub = await matchIn(agentFiles, true); // subagent lines are all sidechain
  if (sub) return { path: sub, subagent: true };
  return null;
}

async function parseSession(file) {
  if (!file) return null;
  const s = {
    file, firstTs: null, lastTs: null, turns: 0, model: null,
    tokIn: 0, tokOut: 0, tokCache: 0, mtime: null,
  };
  try { s.mtime = fs.statSync(file).mtimeMs; } catch (e) { return null; }
  const seenIds = new Set();
  await streamLines(file, (line) => {
    if (line.length > MAX_LINE) return true;
    let d; try { d = JSON.parse(line); } catch (e) { return true; }
    if (!d || typeof d !== 'object') return true;
    if (typeof d.timestamp === 'string') {
      const t = Date.parse(d.timestamp);
      if (!isNaN(t)) { if (s.firstTs == null) s.firstTs = t; s.lastTs = t; }
    }
    if (d.type === 'assistant' && d.message) {
      const m = d.message;
      if (m.model && m.model.charAt(0) !== '<') s.model = m.model;
      const id = m.id || ('line-' + seenIds.size);
      if (!seenIds.has(id)) { // one API message → many content-block lines
        seenIds.add(id);
        s.turns++;
        const u = m.usage;
        if (u && typeof u === 'object') {
          s.tokIn += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          s.tokOut += u.output_tokens || 0;
          s.tokCache += u.cache_read_input_tokens || 0;
        }
      }
    }
    return true;
  });
  return s;
}

// ---------------------------------------------------------------------------
// 4. GitHub PRs

async function getPRs() {
  const res = await run('gh', ['pr', 'list', '--state', 'open',
    '--json', 'number,title,headRefName,statusCheckRollup'], { cwd: REPO_HINT });
  if (!res.ok) return { ok: false, byBranch: {} };
  let list;
  try { list = JSON.parse(res.out); } catch (e) { return { ok: false, byBranch: {} }; }
  const byBranch = {};
  for (const pr of list) {
    const checks = pr.statusCheckRollup || [];
    const red = checks.some((c) =>
      c && (c.conclusion === 'FAILURE' || c.conclusion === 'TIMED_OUT' ||
            c.state === 'FAILURE' || c.state === 'ERROR'));
    byBranch[pr.headRefName] = { number: pr.number, title: pr.title, red };
  }
  return { ok: true, byBranch };
}

// ---------------------------------------------------------------------------
// assemble

async function collect() {
  const now = Date.now();
  const { main, lanes } = await getWorktrees();
  const prs = await getPRs();
  const mainDirFiles = main ? listJsonl(projectDirFor(main.path)) : [];
  const agentFiles = main ? listAgentJsonl(projectDirFor(main.path)) : [];
  const briefCache = {};

  const rows = [];
  const claimed = new Set();

  for (const lane of lanes) {
    const [git, found] = await Promise.all([
      gitFacts(lane.path, false),
      findSessionFile(lane, mainDirFiles, agentFiles, briefCache),
    ]);
    if (found) claimed.add(found.path);
    const sess = await parseSession(found ? found.path : null);
    if (sess && found.subagent) sess.subagent = true;
    const stat = statusFacts(lane.path);
    rows.push(makeRow(lane.name, lane.branch, git, stat, sess, prs.byBranch[lane.branch], now, false));
  }

  // main/orchestrator row: newest main-dir session not claimed by a lane
  if (main) {
    const git = await gitFacts(main.path, true);
    const stat = statusFacts(main.path);
    const orch = mainDirFiles.find((f) => !claimed.has(f.path));
    const sess = await parseSession(orch ? orch.path : null);
    rows.unshift(makeRow('main', main.branch || 'main', git, stat, sess,
      undefined, now, true));
  }

  return { rows, ghOk: prs.ok, generatedAt: now };
}

function makeRow(name, branch, git, stat, sess, pr, now, isMain) {
  const lastSeen = Math.max(
    sess ? (sess.lastTs || 0) : 0,
    sess ? (sess.mtime || 0) : 0,
    stat.mtime || 0);
  const idleMs = lastSeen ? now - lastSeen : null;
  const idleMin = idleMs == null ? null : idleMs / 60000;

  let verdict, cls;
  if (pr && pr.red)       { verdict = 'CI RED #' + pr.number; cls = 'red'; }
  else if (pr)            { verdict = 'PR OPEN #' + pr.number; cls = 'green'; }
  else if (!sess)         { verdict = 'no session'; cls = 'dim'; }
  else if (idleMin != null && idleMin > STALL_MIN) { verdict = 'STALLED ' + fmtDur(idleMs); cls = 'amber'; }
  else                    { verdict = 'WORKING'; cls = 'ok'; }
  if (isMain && verdict === 'WORKING') verdict = 'ORCHESTRATOR';
  // Telemetry sourced from a background-subagent transcript, not a
  // per-worktree terminal session — mark it so the modes are tellable apart.
  if (sess && sess.subagent) verdict += ' [sub]';

  return {
    name, branch, isMain, verdict, cls,
    runtime: sess && sess.firstTs != null && sess.lastTs != null ? sess.lastTs - sess.firstTs : null,
    idleMs,
    turns: sess ? sess.turns : null,
    tokIn: sess ? sess.tokIn : null,
    tokOut: sess ? sess.tokOut : null,
    tokCache: sess ? sess.tokCache : null,
    model: sess ? sess.model : null,
    ahead: git.ahead,
    dirty: git.dirty,
    lastCommitAge: git.lastCommitMs ? now - git.lastCommitMs : null,
    statusLine: stat.line,
    statusAge: stat.mtime ? now - stat.mtime : null,
    pr: pr || null,
  };
}

// ---------------------------------------------------------------------------
// terminal table

function renderTable(data) {
  const heads = ['LANE', 'STATE', 'RUN', 'IDLE', 'TURNS', 'IN', 'OUT', 'CACHE', 'AHEAD', 'DIRTY', 'LAST STATUS'];
  const cells = data.rows.map((r) => [
    r.name,
    r.verdict,
    fmtDur(r.runtime),
    r.idleMs == null ? '-' : fmtDur(r.idleMs),
    r.turns == null ? '-' : String(r.turns),
    fmtTok(r.tokIn), fmtTok(r.tokOut), fmtTok(r.tokCache),
    r.ahead == null ? '·' : String(r.ahead),
    String(r.dirty),
    r.statusLine == null ? '(no .agent-status.md)' : r.statusLine,
  ]);
  const all = [heads].concat(cells);
  const nFixed = heads.length - 1;
  const widths = [];
  for (let c = 0; c < nFixed; c++) {
    widths[c] = Math.max.apply(null, all.map((row) => row[c].length));
  }
  const termW = (process.stdout.columns || 200);
  const used = widths.reduce((a, b) => a + b, 0) + nFixed * 2;
  const statusW = Math.max(24, termW - used - 1);
  const lines = all.map((row) => {
    const fixed = row.slice(0, nFixed).map((v, c) => v.padEnd(widths[c])).join('  ');
    let st = row[nFixed];
    if (st.length > statusW) st = st.slice(0, statusW - 1) + '…';
    return (fixed + '  ' + st).trimEnd();
  });
  lines.splice(1, 0, '-'.repeat(Math.min(termW, lines.reduce((a, l) => Math.max(a, l.length), 0))));
  const foot = 'fleet @ ' + new Date(data.generatedAt).toLocaleString() +
    (data.ghOk ? '' : '   [gh unavailable — PR/CI state unknown]');
  return lines.join('\n') + '\n' + foot;
}

// ---------------------------------------------------------------------------
// HTML dashboard

function renderHTML(data) {
  const badge = { ok: '#2f9e5b', green: '#2f9e5b', amber: '#c98a1b', red: '#c43c3c', dim: '#5a6472' };
  const rowBg = (r) =>
    r.cls === 'amber' ? 'background:rgba(201,138,27,.13);' :
    (r.cls === 'green' ? 'background:rgba(47,158,91,.12);' :
    (r.cls === 'red' ? 'background:rgba(196,60,60,.14);' : ''));
  const cards = data.rows.map((r) => `
  <div class="card" style="${rowBg(r)}">
    <div class="top">
      <span class="lane">${esc(r.name)}</span>
      <span class="badge" style="background:${badge[r.cls] || '#5a6472'}">${esc(r.verdict)}</span>
    </div>
    <div class="branch">${esc(r.branch)}${r.model ? ' · ' + esc(r.model) : ''}</div>
    <div class="idle"><span class="big">${r.idleMs == null ? '—' : esc(fmtDur(r.idleMs))}</span><span class="lbl">idle</span></div>
    <div class="stats">
      <div><b>${esc(fmtDur(r.runtime))}</b><span>runtime</span></div>
      <div><b>${r.turns == null ? '—' : r.turns}</b><span>turns</span></div>
      <div><b>${esc(fmtTok(r.tokIn))}</b><span>tok in</span></div>
      <div><b>${esc(fmtTok(r.tokOut))}</b><span>tok out</span></div>
      <div><b>${esc(fmtTok(r.tokCache))}</b><span>cache rd</span></div>
      <div><b>${r.ahead == null ? '—' : r.ahead}</b><span>ahead</span></div>
      <div><b>${r.dirty}</b><span>dirty</span></div>
      <div><b>${esc(fmtDur(r.lastCommitAge))}</b><span>last commit</span></div>
    </div>
    <div class="status">${r.statusLine ? esc(r.statusLine) : '<i>no .agent-status.md</i>'}
      ${r.statusAge != null ? `<span class="age">(${esc(fmtDur(r.statusAge))} ago)</span>` : ''}</div>
  </div>`).join('\n');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="30">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fleet — solar-system agents</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { background:#0d1117; color:#c9d4e3; font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; padding:24px; }
  h1 { font-size:16px; font-weight:600; color:#e8eef7; margin-bottom:2px; }
  .sub { color:#5a6472; font-size:12px; margin-bottom:20px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:14px; }
  .card { border:1px solid #232b36; border-radius:10px; padding:14px 16px; background:#11161d; }
  .top { display:flex; justify-content:space-between; align-items:center; }
  .lane { font-size:17px; font-weight:700; color:#e8eef7; }
  .badge { font-size:11px; font-weight:700; color:#fff; border-radius:5px; padding:3px 8px; letter-spacing:.4px; }
  .branch { color:#5a6472; font-size:11.5px; margin:4px 0 10px; }
  .idle { display:flex; align-items:baseline; gap:8px; margin-bottom:10px; }
  .idle .big { font-size:34px; font-weight:800; color:#e8eef7; }
  .idle .lbl { color:#5a6472; font-size:11px; text-transform:uppercase; letter-spacing:.8px; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:8px 10px; margin-bottom:10px; }
  .stats div { display:flex; flex-direction:column; }
  .stats b { font-size:13px; color:#dbe4f0; }
  .stats span { font-size:10px; color:#5a6472; text-transform:uppercase; letter-spacing:.5px; }
  .status { border-top:1px solid #232b36; padding-top:8px; font-size:12px; color:#9fb0c3; overflow-wrap:anywhere; }
  .status .age { color:#5a6472; }
  .warn { color:#c98a1b; font-size:12px; margin-bottom:14px; }
</style></head><body>
<h1>agent fleet</h1>
<div class="sub">generated ${esc(new Date(data.generatedAt).toLocaleString())} · auto-refreshes every 30 s</div>
${data.ghOk ? '' : '<div class="warn">gh unavailable — PR / CI state unknown</div>'}
<div class="grid">
${cards}
</div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// entry

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--serve') {
    const port = Number(args[1]) || 4199;
    const server = http.createServer(async (req, res) => {
      let body;
      try { body = renderHTML(await collect()); }
      catch (e) { body = '<!doctype html><meta http-equiv="refresh" content="30"><pre>fleet error: ' + esc(e && e.message) + '</pre>'; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    server.listen(port, () => {
      console.log('fleet dashboard: http://localhost:' + port + ' (refreshes every 30s)');
    });
    return;
  }
  console.log(renderTable(await collect()));
}

if (require.main === module) {
  main().catch((e) => {
    console.error('fleet error:', e && e.message ? e.message : e);
    process.exitCode = 0;
  });
}

// Testable internals (test/fleet.test.js drives these against a fixture
// tree via FLEET_PROJECTS_ROOT). Not a public API.
module.exports = {
  sanitizeCwd, projectDirFor, projectsRoot,
  listJsonl, listAgentJsonl, firstUserText, findSessionFile,
  parseSession, makeRow, collect,
};
