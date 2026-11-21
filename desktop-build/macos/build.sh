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

# 3) 图标：从页面自带的 logo.png 生成 .icns（失败不影响构建）
ICON_SRC="$REPO/web/assets/img/logo.png"
if [ -f "$ICON_SRC" ] && command -v iconutil >/dev/null 2>&1 && command -v sips >/dev/null 2>&1; then
    ICONSET="$BUILD/AppIcon.iconset"
    mkdir -p "$ICONSET"
    for s in 16 32 64 128 256 512; do
        sips -z "$s" "$s" "$ICON_SRC" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1 || true
        sips -z "$((s * 2))" "$((s * 2))" "$ICON_SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || true
    done
    if iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns" 2>/dev/null; then
        echo "[dmg] 图标已生成"
    else
        echo "[dmg] 图标生成失败，使用系统默认图标"
    fi
fi

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
