#!/usr/bin/env bash
# 未签名 .dmg 构建：clang 直接编译 AppKit + WKWebView 壳 → 手工组装 .app → hdiutil 打 dmg
# 需要 macOS + Xcode（sips / iconutil / hdiutil 均为系统自带）
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
BUILD="$HERE/build"
APP="$BUILD/EasiNote.app"
STAGE="$BUILD/dmg"

echo "[dmg] 页面：$REPO/web/（多文件，原样打包）"
[ -f "$REPO/web/index.html" ] || { echo "[dmg] 缺少 web/index.html" >&2; exit 1; }

rm -rf "$BUILD"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# 1) 通用二进制（Intel + Apple Silicon），最低 macOS 11
clang -arch arm64 -arch x86_64 \
    -mmacosx-version-min=11.0 \
    -fobjc-arc -O2 -Wall \
    -framework Cocoa -framework WebKit \
    -o "$APP/Contents/MacOS/EasiNote" \
    "$HERE/main.m"

strip -x "$APP/Contents/MacOS/EasiNote" 2>/dev/null || true

# 2) 组装 .app
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"
mkdir -p "$APP/Contents/Resources/www"
cp -R "$REPO/web/." "$APP/Contents/Resources/www/"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# 3) 图标：优先用页面 logo，其次用 mobile 的 1024 母版；生成失败直接报错，
#    避免"装完是白图标"却静默通过。
ICON_SRC=""
for candidate in "$REPO/web/assets/img/logo.png" "$REPO/mobile-build/ios/AppIcon-1024.png"; do
    if [ -f "$candidate" ]; then ICON_SRC="$candidate"; break; fi
done
if [ -z "$ICON_SRC" ]; then
    echo "[dmg] 找不到图标母版（web/assets/img/logo.png 或 mobile-build/ios/AppIcon-1024.png）" >&2
    exit 1
fi
ICONSET="$BUILD/AppIcon.iconset"
mkdir -p "$ICONSET"
# 只生成 iconset 规范要求的尺寸，避免 iconutil 因多余条目失败
for pair in "16 16" "16 32" "32 32" "32 64" "128 128" "128 256" "256 256" "256 512" "512 512" "512 1024"; do
    base=${pair%% *}
    px=${pair##* }
    if [ "$base" = "$px" ]; then
        out="$ICONSET/icon_${base}x${base}.png"
    else
        out="$ICONSET/icon_${base}x${base}@2x.png"
    fi
    sips -z "$px" "$px" "$ICON_SRC" --out "$out" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
[ -s "$APP/Contents/Resources/AppIcon.icns" ] || { echo "[dmg] AppIcon.icns 生成失败" >&2; exit 1; }
echo "[dmg] 图标已生成：$(ls -l "$APP/Contents/Resources/AppIcon.icns" | awk '{print $5}') B（源：${ICON_SRC}）"


# 4) 打 dmg（未签名，未公证；首次打开需在「隐私与安全性」里放行）
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

hdiutil create \
    -volname "快捷白板10" \
    -srcfolder "$STAGE" \
    -ov -format UDZO \
    "$BUILD/EasiNote.dmg"

ls -l "$BUILD/EasiNote.dmg"
