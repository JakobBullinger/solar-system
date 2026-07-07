/**
 * playwright.config.js — e2e harness configuration.
 *
 * Dev-only tooling: the app itself stays zero-dependency (a single
 * `dist/index.html` opened over file://, no server). Playwright drives the
 * SYSTEM Chrome (`channel: 'chrome'`) so `npm install` never downloads a
 * browser binary. CI compatibility (a Chrome-provisioned runner or a
 * `playwright install` step) is deliberately future work — this config is
 * for local agent verification.
 *
 * The launch args are the hard-won SwiftShader recipe from CLAUDE.md:
 * plain `--disable-gpu` renders a black canvas; SwiftShader gives a real
 * software-WebGL frame. `--force-prefers-reduced-motion` makes camera
 * fly-ins instant so screenshots don't catch mid-tween frames.
 */
'use strict';

const path = require('path');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.js',
  outputDir: path.join(__dirname, 'artifacts', 'test-results'),
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1600, height: 1000 },
    reducedMotion: 'reduce',
    launchOptions: {
      args: [
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--force-prefers-reduced-motion',
      ],
    },
  },
});
