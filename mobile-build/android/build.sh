#!/usr/bin/env bash
# 无 Gradle 的极简 APK 构建：aapt2 → javac → d8 → zip → zipalign → apksigner
# 依赖：Android SDK（ANDROID_HOME）、JDK
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
OUT="$HERE/out"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
    echo "[apk] 找不到 Android SDK（ANDROID_HOME/ANDROID_SDK_ROOT）" >&2
    exit 1
fi

BT=$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)
PLATFORM=$(ls -d "$SDK"/platforms/android-* 2>/dev/null | sort -V | tail -1)
JAR="$PLATFORM/android.jar"
[ -f "$JAR" ] || { echo "[apk] 找不到 android.jar: $JAR" >&2; exit 1; }

echo "[apk] build-tools: $BT"
echo "[apk] platform:    $PLATFORM"

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT/assets"

# 1) 资源
"$BT/aapt2" compile --dir "$HERE/res" -o "$OUT/resources.zip"
"$BT/aapt2" link -o "$OUT/base.apk" \
    -I "$JAR" \
    --manifest "$HERE/AndroidManifest.xml" \
    -R "$OUT/resources.zip" \
    --java "$OUT/gen" \
    --min-sdk-version 21 --target-sdk-version 34

# 2) Java → class
find "$HERE/src" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -source 8 -target 8 -nowarn -encoding UTF-8 \
      -bootclasspath "$JAR" \
      -d "$OUT/classes" @"$OUT/sources.txt"

# 3) class → dex
find "$OUT/classes" -name '*.class' > "$OUT/classlist.txt"
"$BT/d8" --lib "$JAR" --min-api 21 --release --output "$OUT/dex" @"$OUT/classlist.txt"

# 4) 组装：资源 APK + classes.dex + assets/www（多文件页面，原样打包 web/）
cp "$OUT/base.apk" "$OUT/app.apk"
mkdir -p "$OUT/assets/www"
cp -R "$REPO/web/." "$OUT/assets/www/"
cp "$OUT/dex/classes.dex" "$OUT/classes.dex"
( cd "$OUT" && zip -q -r app.apk classes.dex assets )

# 5) 对齐 + 签名（调试密钥，仅用于测试安装）
( cd "$OUT" && "$BT/zipalign" -f 4 app.apk aligned.apk )
if [ ! -f "$OUT/debug.jks" ]; then
    keytool -genkeypair -v -keystore "$OUT/debug.jks" -storepass android -keypass android \
        -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
        -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$OUT/debug.jks" --ks-pass pass:android --key-pass pass:android \
    --out "$OUT/EasiNote.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify --verbose "$OUT/EasiNote.apk" | head -5

ls -l "$OUT/EasiNote.apk"
