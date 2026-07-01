#!/usr/bin/env bash
# Packt den Ordner extension/ in ein hochladbares ZIP (Chrome Web Store / entpackt).
set -euo pipefail

cd "$(dirname "$0")"

VERSION="$(node -p "require('./extension/manifest.json').version" 2>/dev/null \
  || grep -oE '"version"[^"]*"[^"]+"' extension/manifest.json | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"

OUT="dist"
ZIP="${OUT}/opennit-vault-${VERSION}.zip"

mkdir -p "$OUT"
rm -f "$ZIP"

# Nur die Erweiterungsdateien zippen (keine Docs/Store-Assets).
( cd extension && zip -r -X "../${ZIP}" . -x '.*' >/dev/null )

echo "Erstellt: ${ZIP}"
echo "→ Im Chrome Web Store Developer Dashboard hochladen, oder in chrome://extensions entpackt laden."
