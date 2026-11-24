#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/dist/server" "$ROOT/dist/.openai"
python3 - "$ROOT" <<'PY'
import json, sys
from pathlib import Path
root=Path(sys.argv[1])
names=['bg-1.webp.b64','bg-2.webp.b64','bg-3.webp.b64','bg-4.webp.b64']
assets={str(slot):(root/'assets/backgrounds'/name).read_text().strip() for slot,name in enumerate(names,start=1)}
source=(root/'worker/index.js').read_text()
marker='const BUNDLED_BACKGROUND_DATA={};'
if source.count(marker)!=1:
    raise SystemExit('Expected exactly one bundled-background marker')
built=source.replace(marker,'const BUNDLED_BACKGROUND_DATA='+json.dumps(assets,separators=(',',':'))+';')
(root/'dist/server/index.js').write_text(built)
PY
cp "$ROOT/.openai/hosting.json" "$ROOT/dist/.openai/hosting.json"
