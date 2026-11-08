#!/usr/bin/env bash
# Publica o app no GitHub Pages:
#   1. carimba uma versão nova nos arquivos do index.html (força o navegador a baixar a versão nova)
#   2. commita no main
#   3. gera o branch gh-pages a partir da pasta app/ e envia os dois branches
# Uso: bash tools/publicar.sh "mensagem do commit"
set -euo pipefail
cd "$(dirname "$0")/.."
msg="${1:-Atualiza o app}"
v=$(date +%Y%m%d%H%M)
sed -i -E "s/\?v=[0-9]+/?v=$v/g" app/index.html
git add -A app tools README.md LOGICA.md
git commit -q -m "$msg"
git branch -D gh-pages -q 2>/dev/null || true
git subtree split --prefix app -b gh-pages >/dev/null
git push origin main
git push -f origin gh-pages
echo "Publicado (versão $v): https://netssu.github.io/enem/"
