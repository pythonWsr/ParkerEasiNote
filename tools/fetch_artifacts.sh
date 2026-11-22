#!/usr/bin/env bash
# 把 test 分支最近一次成功的打包产物统一下载到仓库根目录 out/（已 gitignore）
# 用法：bash tools/fetch_artifacts.sh
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
OUT="$REPO/out"
mkdir -p "$OUT"

fetch() {
    local wf="$1"
    local rid
    rid=$(gh run list --workflow "$wf.yml" --branch test --status success \
            --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)
    if [ -z "$rid" ] || [ "$rid" = "null" ]; then
        echo "[out] 跳过 $wf（没有成功记录）"
        return 0
    fi
    local tmp
    tmp=$(mktemp -d)
    echo "[out] $wf run=$rid"
    gh run download "$rid" --dir "$tmp" >/dev/null
    find "$tmp" -type f | while read -r f; do
        cp -f "$f" "$OUT/"
        echo "       $(basename "$f")"
    done
    find "$tmp" -type f -delete
    find "$tmp" -depth -type d -empty -delete
}

for wf in build-html build-verify-exe build-apk build-ipa build-dmg; do
    fetch "$wf"
done

echo "[out] $OUT"
ls -lh "$OUT" | tail -n +2
