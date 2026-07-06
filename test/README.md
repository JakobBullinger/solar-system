# Tests

Zero-dependency Node test suite for the orrery's physics and link plumbing.
CI (`.github/workflows/ci.yml`) runs it on every push/PR, then smoke-tests
the built `dist/index.html` under headless Chrome.

## Run

```bash
npm test              # all test/*.test.js (~2 s)
node test/kepler.test.js   # a single file
```

Every test prints one `ok / FAIL / skip` line; the runner exits non-zero on
any failure.

## How it works

The app modules are browser IIFEs on `window.ORRERY`, so
`test/lib/orrery-loader.js` evals each requested `src/` file in an isolated
`vm` context with minimal `THREE` / DOM / `location` stubs (the pattern from
CLAUDE.md "Verification"). Each `load()` call is a fresh context — module
state never leaks between tests.

## Add a test

Create `test/<name>.test.js`:

```js
const { test, ok, close } = require('./lib/harness');
const { load } = require('./lib/orrery-loader');
const O = load(['data/bodies.js', 'physics/kepler.js']);

test('describes one observable fact', function () {
  close(O.Kepler.periodDays(1), 365.25, 1e-9);
});
```

The runner picks it up automatically. Keep each file fast (< a few seconds);
prefer external reference values (Horizons, published almanac dates) over
values computed from the code under test. If a case can't pass, use
`skip(name, reason)` — never ship red.

## The trajectory regression guard

`trajectories.test.js` re-flies the baked mission constants against the real
integrator:

- the `VOYAGER` preset in `src/ui/sandbox.js` (parsed from source — the
  constant is private) must still produce the 1977 → Jupiter (< 0.02 AU) →
  Saturn (< 0.01 AU) grand tour;
- the `REPLAYS` scripts in `src/ui/replays.js` must still deliver
  New Horizons to < 0.005 AU of Pluto on 14 Jul 2015 and carry Cassini
  through the Venus-Venus-Earth-Jupiter chain into Saturn capture.

Those launch/burn parameters were offline-searched against the **exact**
behavior of `nbody.js` + `kepler.js` (step control, softening, indirect
term, burn splitting, planetary elements). This guard is what fails if
someone "improves" the integrator in a way that silently breaks every
shipped replay — verified by perturbing `SOFT2`, which sends the Voyager
Saturn encounter 1.1 AU wide. If you change the integrator deliberately,
re-run the offline searches and update the baked constants in the same
change.

## CI smoke test

After `node build.js`, CI screenshots `dist/index.html` with headless
Chrome + SwiftShader (plain `--disable-gpu` renders a black canvas — see
`.claude/skills/headless-check`). `test/ci/check-screenshot.js` decodes the
PNG (pure Node + zlib) and requires starfield coverage across the central
band of the frame, which cleanly separates a real render (95/96 grid cells
lit) from the black-canvas failure with DOM UI still visible (0/96). The
screenshot is uploaded as an Actions artifact either way.
