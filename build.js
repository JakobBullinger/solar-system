#!/usr/bin/env node
/**
 * build.js — Bundles the orrery into a single self-contained HTML file.
 *
 * Concatenates vendor libs + app modules (in dependency order) and inlines
 * them, with the stylesheet, into index.template.html → dist/index.html.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const VENDOR = ['vendor/three.min.js', 'vendor/OrbitControls.js'];

// Dependency order matters: data → physics → scene → ui → main
const MODULES = [
  'src/data/bodies.js',
  'src/physics/kepler.js',
  'src/physics/almanac.js',
  'src/physics/nbody.js',
  'src/scene/textures.js',
  'src/scene/environment.js',
  'src/scene/bodies3d.js',
  'src/scene/comets3d.js',
  'src/ui/timebar.js',
  'src/ui/labels.js',
  'src/ui/panel.js',
  'src/ui/almanac-ui.js',
  'src/ui/sandbox.js',
  'src/ui/tour.js',
  'src/main.js'
];

const banner = (name) => `\n/* ========== ${name} ========== */\n`;

const vendor = VENDOR.map((f) => banner(f) + read(f)).join('\n');
const app = MODULES.map((f) => banner(f) + read(f)).join('\n');
const css = read('styles/app.css');

const html = read('index.template.html')
  .replace('{{CSS}}', () => css)
  .replace('{{VENDOR}}', () => vendor)
  .replace('{{APP}}', () => app);

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'index.html'), html);

const kb = (html.length / 1024).toFixed(0);
console.log(`dist/index.html written (${kb} KB)`);
