#!/usr/bin/env node
/**
 * serve.js — Dev server: serves the built app and rebuilds on source change.
 *
 *   node serve.js [port]     (default 4173; opens the browser on start)
 *
 * Watches src/, styles/, vendor/ and index.template.html; every save
 * triggers a rebuild — refresh the browser to see it.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');

const ROOT = __dirname;
const PORT = parseInt(process.argv[2], 10) || 4173;
const DIST = path.join(ROOT, 'dist', 'index.html');

function build(cb) {
  execFile(process.execPath, [path.join(ROOT, 'build.js')], (err, out) => {
    if (err) console.error('build failed:\n' + err.message);
    else process.stdout.write(out);
    if (cb) cb();
  });
}

const server = http.createServer((req, res) => {
  fs.readFile(DIST, (err, html) => {
    if (err) { res.writeHead(500); res.end('no build — run: node build.js'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });
});

let timer = null;
function scheduleRebuild(what) {
  clearTimeout(timer);
  timer = setTimeout(() => build(() => console.log('rebuilt (' + what + ')')), 120);
}
for (const dir of ['src', 'styles', 'vendor']) {
  fs.watch(path.join(ROOT, dir), { recursive: true }, (ev, f) => scheduleRebuild(f || dir));
}
fs.watch(path.join(ROOT, 'index.template.html'), () => scheduleRebuild('index.template.html'));

build(() => server.listen(PORT, () => {
  const url = 'http://localhost:' + PORT;
  console.log('orrery running at ' + url + ' — rebuilds on save, refresh to see changes');
  if (process.platform === 'darwin') exec('open ' + url);
}));
