#!/usr/bin/env bash
# 未签名 .ipa 构建：clang 直接编译 ObjC 壳 → 手工组装 .app → 打成 ipa
# 需要 macOS + Xcode（xcrun / iPhoneOS SDK）
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
BUILD="$HERE/build"
APP="$BUILD/EasiNote.app"

SDK=$(xcrun --sdk iphoneos --show-sdk-path)
echo "[ipa] SDK: $SDK"

rm -rf "$BUILD"
mkdir -p "$APP"

# 1) 编译可执行文件（arm64，iOS 12+）
xcrun --sdk iphoneos clang \
    -arch arm64 \
    -mios-version-min=12.0 \
    -isysroot "$SDK" \
    -fobjc-arc \
    -O2 \
    -framework UIKit -framework WebKit \
    -o "$APP/EasiNote" \
    "$HERE/main.m"

# 去符号，减小体积
xcrun --sdk iphoneos strip -x "$APP/EasiNote" || true

# 2) 组装 .app
cp "$HERE/Info.plist" "$APP/Info.plist"
mkdir -p "$APP/www"
cp -R "$REPO/web/." "$APP/www/"
printf 'APPL????' > "$APP/PkgInfo"

# 3) 打包成 ipa（未签名，安装前需自行重签）
mkdir -p "$BUILD/Payload"
cp -R "$APP" "$BUILD/Payload/"
( cd "$BUILD" && zip -qry EasiNote.ipa Payload )

ls -l "$BUILD/EasiNote.ipa"
