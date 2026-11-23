#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/dist/server" "$ROOT/dist/.openai"
cp "$ROOT/worker/index.js" "$ROOT/dist/server/index.js"
cp "$ROOT/.openai/hosting.json" "$ROOT/dist/.openai/hosting.json"
