#!/usr/bin/env node
/**
 * run.js — Zero-dependency test runner.
 *
 * `npm test` → runs every test/*.test.js as its own Node process (each file
 * loads app modules into isolated vm contexts on top of that), streams the
 * per-test ok/FAIL lines, and exits non-zero if any file fails.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const files = fs.readdirSync(DIR)
  .filter(function (f) { return /\.test\.js$/.test(f); })
  .sort();

if (!files.length) {
  console.error('no test/*.test.js files found');
  process.exit(1);
}

const t0 = Date.now();
let failed = 0;

files.forEach(function (f) {
  console.log('\n== ' + f + ' ==');
  const res = spawnSync(process.execPath, [path.join(DIR, f)], { stdio: 'inherit' });
  if (res.status !== 0) failed++;
});

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log('\n' + (failed
  ? 'FAIL: ' + failed + ' of ' + files.length + ' test files failed'
  : 'PASS: ' + files.length + ' test files green') + ' (' + secs + 's)');
process.exit(failed ? 1 : 0);
