/**
 * fleet.test.js — transcript attribution + telemetry for tools/fleet.js.
 *
 * fleet.js joins git/status/transcript/GitHub sources; everything but the
 * transcript layer is exercised live every day. This file pins the part
 * that silently rots: WHICH transcript a lane's telemetry comes from, and
 * WHAT the parser sums out of it. Three modes, all real (measured 2026-07-07):
 *
 *   1. per-worktree terminal session   — <projects>/<sanitized-worktree>/*.jsonl
 *   2. background-subagent lane        — <projects>/<sanitized-main>/<sess>/
 *                                        subagents/agent-*.jsonl, attributed by
 *                                        the launch prompt naming the worktree
 *   3. no transcript at all            — 'no session' verdict
 *
 * The fixture tree is built in a temp dir and injected via
 * FLEET_PROJECTS_ROOT, so the test never reads the real ~/.claude.
 *
 * Async note: the harness runs test fns synchronously, so all async fleet
 * calls happen up front and the tests assert on the precomputed results.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, ok, eq } = require('./lib/harness');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-test-'));
process.env.FLEET_PROJECTS_ROOT = ROOT; // must be set before fleet reads it

const fleet = require('../tools/fleet.js');

// ---------------------------------------------------------------------------
// fixture tree

const MAIN_WT = '/wt/solar-system';
const ALPHA_WT = '/wt/solar-system-alpha';   // per-worktree terminal session
const BETA_WT = '/wt/solar-system-beta';     // background-subagent lane
const GAMMA_WT = '/wt/solar-system-gamma';   // no transcript anywhere

function jl(lines) { return lines.map((o) => JSON.stringify(o)).join('\n') + '\n'; }

function assistantLine(ts, id, usage) {
  return {
    type: 'assistant', timestamp: ts,
    message: { id: id, model: 'claude-test-1', usage: usage,
      content: [{ type: 'text', text: 'x' }] },
  };
}

// 1. alpha: own project dir, one session. Two assistant LINES share one
//    message.id (one API message split per content block — must count once).
const alphaDir = path.join(ROOT, fleet.sanitizeCwd(ALPHA_WT));
fs.mkdirSync(alphaDir, { recursive: true });
fs.writeFileSync(path.join(alphaDir, 'sess-alpha.jsonl'), jl([
  { type: 'user', timestamp: '2026-07-07T10:00:00Z',
    message: { role: 'user', content: 'You work in ' + ALPHA_WT + ' (branch feature/alpha).' } },
  assistantLine('2026-07-07T10:01:00Z', 'msg_1',
    { input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 1000 }),
  assistantLine('2026-07-07T10:01:00Z', 'msg_1',
    { input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 1000 }),
  assistantLine('2026-07-07T10:05:00Z', 'msg_2',
    { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 500 }),
]));

// 2. orchestrator project dir: one top-level session (no lane needles in its
//    first user message) + subagent transcripts below it. Two agent files
//    match beta — the NEWER one must win. A workflow-nested non-matching
//    agent file must be reachable by the walk but claim nothing.
const mainDir = path.join(ROOT, fleet.sanitizeCwd(MAIN_WT));
const subDir = path.join(mainDir, 'sess-orch', 'subagents');
fs.mkdirSync(path.join(subDir, 'workflows', 'wf_1'), { recursive: true });
// Top-level sessions may open with an EMBEDDED sidechain user line (a Task
// prompt) — firstUserText must skip it there, or a lane-naming Task prompt
// would misattribute the orchestrator's own session to a lane.
fs.writeFileSync(path.join(mainDir, 'orch-session.jsonl'), jl([
  { type: 'user', isSidechain: true, timestamp: '2026-07-07T08:59:00Z',
    message: { role: 'user', content: 'Embedded Task prompt mentioning ' + GAMMA_WT + ' — must be skipped.' } },
  { type: 'user', timestamp: '2026-07-07T09:00:00Z',
    message: { role: 'user', content: 'You are the orchestrator in ' + MAIN_WT + '.' } },
  assistantLine('2026-07-07T09:01:00Z', 'msg_o1', { input_tokens: 1, output_tokens: 1 }),
]));

// Subagent transcripts mark EVERY line isSidechain:true (measured 2026-07-07
// against the wave-5 ci/earth lanes) — the fallback must match them anyway.
function sidechain(o) { return Object.assign({ isSidechain: true }, o); }
const betaPrompt = 'You are a feature-lane agent. Your worktree is ' + BETA_WT +
  ' (branch feature/beta). Read the brief at ' + BETA_WT + '/.agent-brief.md.';
const betaOld = path.join(subDir, 'agent-abetaold.jsonl');
const betaNew = path.join(subDir, 'agent-abetanew.jsonl');
fs.writeFileSync(betaOld, jl([
  sidechain({ type: 'user', timestamp: '2026-07-07T11:00:00Z', message: { role: 'user', content: betaPrompt } }),
  sidechain(assistantLine('2026-07-07T11:01:00Z', 'msg_bo', { input_tokens: 9, output_tokens: 9 })),
]));
fs.writeFileSync(betaNew, jl([
  sidechain({ type: 'user', timestamp: '2026-07-07T12:00:00Z', message: { role: 'user', content: betaPrompt } }),
  sidechain(assistantLine('2026-07-07T12:01:00Z', 'msg_b1',
    { input_tokens: 200, cache_creation_input_tokens: 300, output_tokens: 40, cache_read_input_tokens: 7000 })),
  sidechain(assistantLine('2026-07-07T12:30:00Z', 'msg_b2',
    { input_tokens: 30, output_tokens: 4, cache_read_input_tokens: 2000 })),
]));
fs.writeFileSync(path.join(subDir, 'workflows', 'wf_1', 'agent-awf.jsonl'), jl([
  { type: 'user', timestamp: '2026-07-07T11:30:00Z',
    message: { role: 'user', content: 'Unrelated workflow micro-task.' } },
]));
// deterministic mtime order: wf < old < new
fs.utimesSync(path.join(subDir, 'workflows', 'wf_1', 'agent-awf.jsonl'),
  new Date('2026-07-07T11:00:00Z'), new Date('2026-07-07T11:00:00Z'));
fs.utimesSync(betaOld, new Date('2026-07-07T11:05:00Z'), new Date('2026-07-07T11:05:00Z'));
fs.utimesSync(betaNew, new Date('2026-07-07T12:31:00Z'), new Date('2026-07-07T12:31:00Z'));

const lane = (wt, branch) => ({ path: wt, name: path.basename(wt).replace(/^solar-system-/, ''), branch });
const NOGIT = { ahead: 0, dirty: 0, lastCommitMs: null };
const NOSTAT = { line: null, mtime: null };

// ---------------------------------------------------------------------------
// precompute (async), then register synchronous assertions

(async function () {
  const mainFiles = fleet.listJsonl(mainDir);
  const agentFiles = fleet.listAgentJsonl(mainDir);
  const cache = {};

  const foundAlpha = await fleet.findSessionFile(lane(ALPHA_WT, 'feature/alpha'), mainFiles, agentFiles, cache);
  const foundBeta = await fleet.findSessionFile(lane(BETA_WT, 'feature/beta'), mainFiles, agentFiles, cache);
  const foundGamma = await fleet.findSessionFile(lane(GAMMA_WT, 'feature/gamma'), mainFiles, agentFiles, cache);

  const sessAlpha = await fleet.parseSession(foundAlpha && foundAlpha.path);
  const sessBeta = await fleet.parseSession(foundBeta && foundBeta.path);
  if (sessBeta && foundBeta && foundBeta.subagent) sessBeta.subagent = true;

  test('projects root is the injected fixture, not ~/.claude', function () {
    eq(fleet.projectsRoot(), ROOT);
    eq(fleet.projectDirFor(ALPHA_WT), alphaDir, 'sanitized project dir');
  });

  test('listAgentJsonl finds agent-*.jsonl under sessions incl. workflows, newest first', function () {
    const names = agentFiles.map((f) => path.basename(f.path));
    eq(names.length, 3, 'three agent transcripts in fixture');
    eq(names[0], 'agent-abetanew.jsonl', 'newest first');
    ok(names.indexOf('agent-awf.jsonl') !== -1, 'workflow-nested transcript reachable');
    ok(names.indexOf('orch-session.jsonl') === -1, 'top-level sessions are not agent files');
  });

  test('per-worktree lane attributes to its own project-dir session', function () {
    ok(foundAlpha, 'alpha session found');
    eq(foundAlpha.path, path.join(alphaDir, 'sess-alpha.jsonl'));
    eq(foundAlpha.subagent, false);
  });

  test('parseSession sums turns/tokens and dedupes content-block lines by message.id', function () {
    eq(sessAlpha.turns, 2, 'two API messages, three assistant lines');
    eq(sessAlpha.tokIn, 170, 'input + cache-creation, msg_1 counted once');
    eq(sessAlpha.tokOut, 15);
    eq(sessAlpha.tokCache, 1500);
    eq(sessAlpha.model, 'claude-test-1');
  });

  test('subagent lane falls back to the newest matching agent-*.jsonl', function () {
    ok(foundBeta, 'beta transcript found');
    eq(foundBeta.path, betaNew, 'most recently active match wins');
    eq(foundBeta.subagent, true);
  });

  test('subagent telemetry: same sums from the agent transcript', function () {
    eq(sessBeta.turns, 2);
    eq(sessBeta.tokIn, 530);
    eq(sessBeta.tokOut, 44);
    eq(sessBeta.tokCache, 9000);
  });

  test('subagent rows get the [sub] verdict suffix; terminal rows do not', function () {
    const now = Date.parse('2026-07-07T12:35:00Z'); // 5 min idle → WORKING
    const rowBeta = fleet.makeRow('beta', 'feature/beta', NOGIT, NOSTAT, sessBeta, undefined, now, false);
    eq(rowBeta.verdict, 'WORKING [sub]');
    const nowA = Date.parse('2026-07-07T10:06:00Z');
    const rowAlpha = fleet.makeRow('alpha', 'feature/alpha', NOGIT, NOSTAT, sessAlpha, undefined, nowA, false);
    eq(rowAlpha.verdict, 'WORKING');
  });

  test('lane with no transcript anywhere still reads no session', function () {
    eq(foundGamma, null, 'nothing attributed');
    const row = fleet.makeRow('gamma', 'feature/gamma', NOGIT, NOSTAT, null, undefined, Date.now(), false);
    eq(row.verdict, 'no session');
    eq(row.turns, null);
  });
})().catch(function (e) {
  console.error('fleet.test.js setup failed:', e && e.stack || e);
  process.exit(1);
});
