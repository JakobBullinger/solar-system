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
 *
 * `swiftshader-webgl`, NOT `swiftshader` (e2e-speed lane, 2026-07-08): the
 * whole-GPU-process SwiftShader ANGLE hangs Chrome 149's shutdown for
 * 10 s – 5 min+ after WebGL-heavy pages (measured, heavy-tailed, page
 * already closed — it's GPU-process teardown). Under parallel workers that
 * surfaced as "worker process did not exit within 300000ms after stop,
 * force-killed it", which sets hasWorkerErrors and FAILS an otherwise
 * green run. `swiftshader-webgl` scopes SwiftShader to WebGL contexts
 * only: same rendered pixels (verified against the CI checker, zero
 * console errors), and browser.close() drops from ~25 s to ~65 ms. The
 * one-shot `--screenshot` recipe in /headless-check and ci.yml's smoke job
 * keeps plain `swiftshader` — no long-lived teardown there.
 *
 * Parallelism (e2e-speed lane, 2026-07-08): the original `workers: 1` was
 * SwiftShader-era caution, not a real constraint. The shared-state audit
 * found no cross-test coupling: every test gets its own ephemeral browser
 * context (localStorage on the file:// origin is context-scoped — the
 * header.spec.js first-visit test only passes BECAUSE of that isolation),
 * screenshot filenames are globally unique, there is no server and no port.
 * The one real hazard is CPU contention (SwiftShader renders on the CPU),
 * which slows frames but cannot change pinned-jd pixels — the specs' waits
 * are condition- or rAF-based, not wall-clock. `fullyParallel: true`
 * schedules individual tests, not whole files (every spec is written
 * self-contained: own gotoOrrery, no serial dependence — keep it that way).
 * Local default 4 workers (proven: 3 consecutive clean full-suite runs);
 * CI's 4-core runner runs 2 via E2E_WORKERS in ci.yml. Override with
 * E2E_WORKERS=n to bisect a suspected parallelism flake (E2E_WORKERS=1
 * restores the old serial behavior exactly).
 */
'use strict';

const path = require('path');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.js',
  outputDir: path.join(__dirname, 'artifacts', 'test-results'),
  timeout: 90000,
  fullyParallel: true,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS)
    : process.env.CI ? 2 : 4,
  retries: 0,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1600, height: 1000 },
    reducedMotion: 'reduce',
    launchOptions: {
      args: [
        '--use-angle=swiftshader-webgl', // NOT plain swiftshader — see header
        '--enable-unsafe-swiftshader',
        '--force-prefers-reduced-motion',
      ],
    },
  },
});
