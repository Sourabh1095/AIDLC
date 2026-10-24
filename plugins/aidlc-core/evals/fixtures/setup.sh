#!/usr/bin/env bash
# Shared scaffold for the AIDLC eval cases: a small React + TypeScript app that ALREADY has a
# pagination hook, a pagination control, a button and a date formatter, set up as an AIDLC project
# (mono, markdown backlog) and committed, with its reuse catalog built.
#
# Claude Code's eval runner calls a case's scaffold_script with the workspace as the working
# directory and the script's own absolute path in $0. Each case's scaffold.sh sources this file.
set -euo pipefail
FIXTURES="${FIXTURES:?set FIXTURES to this directory before sourcing setup.sh}"
PLUGIN_ROOT="${FIXTURES%/*/*}"   # fixtures → evals → plugin root

cp -R "$FIXTURES/web-app/." .
cp -R "$FIXTURES/aidlc/." .
git init -q -b main .
git config user.email eval@example.com
git config user.name eval
git add -A
git commit -q -m "chore: the app as it stands"

# The catalog the reuse skill queries. Built here because an eval run may have no shell tool to run
# catalog.mjs itself — the skill falls back to reading this file.
node "$PLUGIN_ROOT/skills/reuse/catalog.mjs" build . --name web --out .aidlc/catalog >/dev/null
