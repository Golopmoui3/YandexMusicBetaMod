#!/usr/bin/env bash
#
# Сборка мобильного мода Яндекс Музыки (Android).
# Пайплайн: merge сплитов -> apktool decode -> наложение патчей -> apktool build -> подпись.
#
# Использование:
#   KEYSTORE=путь/к/keystore KS_PASS=пароль ./build.sh <папка-со-сплитами-или-base.apk> [выход.apk]
#
# Зависимости: java 17+, jar-инструменты (пути задаются переменными окружения):
#   APKEDITOR_JAR  - APKEditor (merge сплитов),   по умолчанию tools/APKEditor-1.4.9.jar
#   APKTOOL_JAR    - apktool 3.x (decode/build),  по умолчанию tools/apktool_3.0.3.jar
#   SIGNER_JAR     - uber-apk-signer 1.3.x,       по умолчанию tools/uber-apk-signer-1.3.0.jar
#   KEYSTORE       - PKCS12/JKS keystore для подписи (обязательный)
#   KS_ALIAS       - алиас ключа (по умолчанию ymmod)
#   KS_PASS        - пароль keystore и ключа (обязательный)

set -euo pipefail

INPUT="${1:?Использование: ./build.sh <папка-со-сплитами-или-base.apk> [выход.apk]}"
OUTPUT="${2:-YandexMusic-mod.apk}"

APKEDITOR_JAR="${APKEDITOR_JAR:-tools/APKEditor-1.4.9.jar}"
APKTOOL_JAR="${APKTOOL_JAR:-tools/apktool_3.0.3.jar}"
SIGNER_JAR="${SIGNER_JAR:-tools/uber-apk-signer-1.3.0.jar}"
KEYSTORE="${KEYSTORE:?Задайте KEYSTORE=путь/к/keystore}"
KS_ALIAS="${KS_ALIAS:-ymmod}"
KS_PASS="${KS_PASS:?Задайте KS_PASS=пароль}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "[1/5] Merge APK-сплитов в единый APK"
if [ -d "$INPUT" ]; then
    java -jar "$APKEDITOR_JAR" m -i "$INPUT" -o "$WORK/merged.apk"
else
    cp -- "$INPUT" "$WORK/merged.apk"
fi

echo "[2/5] Декомпиляция apktool"
java -jar "$APKTOOL_JAR" d -f -o "$WORK/src" "$WORK/merged.apk"

echo "[3/5] Наложение smali-патчей из patches/ (6 файлов)"
cp -rv patches/. "$WORK/src/"

echo "[4/5] Сборка apktool"
java -jar "$APKTOOL_JAR" b -o "$WORK/unsigned.apk" "$WORK/src"

echo "[5/5] Подпись (v1+v2+v3) + zipalign"
java -jar "$SIGNER_JAR" -a "$WORK/unsigned.apk" --out "$WORK/signed" \
    --ks "$KEYSTORE" --ksAlias "$KS_ALIAS" --ksPass "$KS_PASS" --ksKeyPass "$KS_PASS"

cp "$WORK/signed/"*-aligned-signed.apk "$OUTPUT"
echo "Готово: $OUTPUT"
sha256sum "$OUTPUT"