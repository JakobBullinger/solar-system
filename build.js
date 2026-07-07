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
  'src/data/marsmissions.js',
  'src/data/stars.js',
  'src/physics/kepler.js',
  'src/physics/almanac.js',
  'src/physics/nbody.js',
  'src/physics/lambert.js',
  'src/physics/lagrange.js',
  'src/scene/camerapath.js',
  'src/scene/trajanim.js',
  'src/scene/orbitflow.js',
  'src/scene/textures.js',
  'src/scene/shaders.js',
  'src/scene/environment.js',
  'src/scene/cosmos.js',
  'src/scene/bodies3d.js',
  'src/scene/comets3d.js',
  'src/scene/lagrange3d.js',
  'src/scene/gravitywell.js',
  'src/scene/overlays.js',
  'src/scene/spirograph.js',
  'src/scene/barycenter.js',
  'src/ui/timebar.js',
  'src/ui/labels.js',
  'src/ui/panel.js',
  'src/ui/vizpanel.js',
  'src/ui/almanac-ui.js',
  'src/ui/sandbox.js',
  'src/ui/tour.js',
  'src/ui/ride.js',
  'src/ui/replays.js',
  'src/ui/missions.js',
  'src/ui/porkchop.js',
  'src/ui/marsplanner.js',
  'src/ui/challenge.js',
  'src/ui/director.js',
  'src/ui/permalink.js',
  'src/ui/header.js',
  'src/main.js'
];

const banner = (name) => `\n/* ========== ${name} ========== */\n`;

// PWA manifest as a data URI (keeps the build a single self-contained file);
// the icon is an inline SVG: an orbit ring around an amber sun.
const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect width="100" height="100" rx="22" fill="#060910"/>' +
  '<ellipse cx="50" cy="50" rx="40" ry="14" fill="none" stroke="#7DB8FF" stroke-width="3" transform="rotate(-20 50 50)"/>' +
  '<circle cx="50" cy="50" r="17" fill="#F2A63C"/>' +
  '<circle cx="85" cy="35" r="5" fill="#7DB8FF"/>' +
  '</svg>';
const MANIFEST = 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify({
  name: 'Solar System — Live Orrery',
  short_name: 'Orrery',
  display: 'standalone',
  background_color: '#060910',
  theme_color: '#060910',
  start_url: '.',
  icons: [{
    src: 'data:image/svg+xml,' + encodeURIComponent(ICON_SVG),
    sizes: 'any',
    type: 'image/svg+xml'
  }]
}));

const vendor = VENDOR.map((f) => banner(f) + read(f)).join('\n');
const app = MODULES.map((f) => banner(f) + read(f)).join('\n');
const css = read('styles/app.css');

const html = read('index.template.html')
  .replace('{{CSS}}', () => css)
  .replace('{{VENDOR}}', () => vendor)
  .replace('{{APP}}', () => app)
  .replace('{{MANIFEST}}', () => MANIFEST);

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'index.html'), html);

const kb = (html.length / 1024).toFixed(0);
console.log(`dist/index.html written (${kb} KB)`);
