#!/usr/bin/env bash
# gh.sh — gh pinned to the repo's personal identity (JakobBullinger).
#
# The machine's gh keyring holds two accounts (personal + work) sharing ONE
# active slot, and the user flips it for their job (Cursor) mid-session.
# Instead of fighting over the slot with `gh auth switch`, every gh call for
# THIS repo goes through here: GH_TOKEN overrides the active account, and
# `gh auth token -u` reads the personal token from the keyring without
# switching anything. Use `tools/gh.sh <args>` wherever you'd use `gh`.
set -euo pipefail
GH_TOKEN="$(gh auth token -u JakobBullinger)" exec gh "$@"
