/**
 * harness.js — Micro test harness, zero dependencies.
 *
 * A test file requires this, declares test()/skip() cases at the top level,
 * and the harness runs them on the next tick — one `ok/FAIL/skip` line per
 * test, non-zero exit code if anything failed. run.js aggregates files.
 */
'use strict';

const tests = [];
let scheduled = false;

function schedule() {
  if (scheduled) return;
  scheduled = true;
  setImmediate(run);
}

function test(name, fn) {
  tests.push({ name: name, fn: fn });
  schedule();
}

/** Documented skip: shows up in output with its reason, never fails. */
function skip(name, reason) {
  tests.push({ name: name, reason: reason });
  schedule();
}

function run() {
  let pass = 0, fail = 0, skipped = 0;
  tests.forEach(function (t) {
    if (!t.fn) {
      console.log('skip - ' + t.name + '  [' + t.reason + ']');
      skipped++;
      return;
    }
    const t0 = Date.now();
    try {
      t.fn();
      console.log('ok   - ' + t.name + ' (' + (Date.now() - t0) + 'ms)');
      pass++;
    } catch (e) {
      console.log('FAIL - ' + t.name);
      String((e && e.stack) || e).split('\n').forEach(function (l) {
        console.log('       ' + l);
      });
      fail++;
    }
  });
  console.log('# ' + pass + ' passed, ' + fail + ' failed' +
    (skipped ? ', ' + skipped + ' skipped' : ''));
  if (fail) process.exitCode = 1;
}

// ---- Assertions ---------------------------------------------------------------
function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'eq') + ': got ' + JSON.stringify(actual) +
      ', expected ' + JSON.stringify(expected));
  }
}

function close(actual, expected, tol, msg) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error((msg || 'close') + ': got ' + actual + ', expected ' +
      expected + ' ± ' + tol + ' (off by ' + Math.abs(actual - expected) + ')');
  }
}

function between(x, lo, hi, msg) {
  if (!(x >= lo && x <= hi)) {
    throw new Error((msg || 'between') + ': ' + x + ' not in [' + lo + ', ' + hi + ']');
  }
}

module.exports = { test: test, skip: skip, ok: ok, eq: eq, close: close, between: between };
