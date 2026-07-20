# AGENTS.md

Project overview, architecture, conventions, physics notes and the full command
reference live in `CLAUDE.md` and `README.md` — read those first. This file adds
only cloud-environment caveats.

## Cursor Cloud specific instructions

Single product: a zero-runtime-dependency 3D solar-system orrery that bundles to
one self-contained `dist/index.html`. There is no backend and no database. The
only dev dependency is Playwright (for the e2e suite); the update script runs
`npm install` to keep it current.

Commands are documented in `README.md` / `CLAUDE.md`. Notes that aren't obvious
from those:

- No lint step exists. The only npm scripts are `build`, `dev`, `test`, `e2e`,
  `fleet` — don't hunt for a linter.
- Run the app in dev with `npm run dev` (serves `http://localhost:4173`,
  rebuilds `dist/index.html` on save). There is no hot-reload — refresh the
  browser after a save. It only auto-opens a browser on macOS, so on this Linux
  VM nothing pops up; open the URL yourself.
- `dist/` is generated and gitignored — never edit it; run `npm run build` (or
  the dev server) to regenerate.
- `npm test` is a fast (~6 s) zero-dependency node suite. `npm run e2e` is the
  Playwright suite (~3 min, 67 specs) and drives the **system** Chrome via
  `channel:'chrome'` (found at `/opt/google/chrome/chrome`) — no browser binary
  is downloaded by `npm install`. If e2e can't find Chrome, that system Chrome
  install is the missing piece, not a Playwright download.
- e2e/headless rendering needs SwiftShader: the e2e config uses
  `--use-angle=swiftshader-webgl`; the one-shot screenshot recipe in the
  `headless-check` skill uses plain `--use-angle=swiftshader`. Plain
  `--disable-gpu` renders a black canvas.
