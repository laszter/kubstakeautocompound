#!/usr/bin/env bash
# เติมค่าลับที่ "ยังว่าง" ใน .env ให้อัตโนมัติ (POSTGRES_PASSWORD, MASTER_KEY, SESSION_SECRET)
#
#   bash scripts/gen-secrets.sh
#
# - ถ้ายังไม่มี .env จะคัดลอกจาก .env.example ให้ก่อน
# - idempotent: ค่าที่ตั้งไว้แล้วจะไม่ถูกเปลี่ยน (รันซ้ำกี่ครั้งก็ได้)
# - รหัสผ่านเข้าเว็บไม่ได้อยู่ใน .env: ตั้งที่หน้าเว็บตอนเข้าครั้งแรก
# - ใช้ได้ทั้ง macOS และ Linux (ต้องมี openssl + awk)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
EXAMPLE_FILE="$ROOT_DIR/.env.example"

for bin in openssl awk; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "❌ ไม่พบคำสั่ง $bin — ติดตั้งก่อนแล้วรันใหม่" >&2
    exit 1
  fi
done

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$EXAMPLE_FILE" ]; then
    echo "❌ ไม่พบ $EXAMPLE_FILE" >&2
    exit 1
  fi
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "📄 สร้าง $(basename "$ENV_FILE") จาก .env.example แล้ว"
fi
# .env เก็บค่าลับ → อ่าน/เขียนได้เฉพาะเจ้าของไฟล์
chmod 600 "$ENV_FILE"

# ค่าปัจจุบันของ KEY (บรรทัด KEY=... ล่าสุด) โดยตัดช่องว่างหัวท้ายและ quote ครอบออก; ไม่มีบรรทัด = ค่าว่าง
current_value() {
  GEN_KEY="$1" awk '
    BEGIN { key = ENVIRON["GEN_KEY"]; sq = sprintf("%c", 39); v = "" }
    index($0, key "=") == 1 { v = substr($0, length(key) + 2) }
    END {
      sub(/^[ \t]+/, "", v); sub(/[ \t\r]+$/, "", v)
      f = substr(v, 1, 1); l = substr(v, length(v), 1)
      if (length(v) >= 2 && f == l && (f == "\"" || f == sq)) v = substr(v, 2, length(v) - 2)
      printf "%s", v
    }' "$ENV_FILE"
}

# เขียน KEY=VALUE ลง .env: แทนที่บรรทัด KEY= เดิม (ทุกบรรทัด) หรือเพิ่มท้ายไฟล์ถ้าไม่มี
# ส่งค่าผ่าน ENVIRON (ไม่ใช่ sed/awk -v) → ปลอดภัยกับอักขระ / + = & \ ของ base64
tmp=""
trap 'if [ -n "$tmp" ]; then rm -f "$tmp"; fi' EXIT
write_value() {
  local key="$1" value="$2"
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  GEN_KEY="$key" GEN_VALUE="$value" awk '
    BEGIN { key = ENVIRON["GEN_KEY"]; val = ENVIRON["GEN_VALUE"]; done = 0 }
    index($0, key "=") == 1 { print key "=" val; done = 1; next }
    { print }
    END { if (!done) print key "=" val }
  ' "$ENV_FILE" >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
  tmp=""
}

generated=()

# fill_if_empty KEY <generator command...>
fill_if_empty() {
  local key="$1"
  shift
  if [ -n "$(current_value "$key")" ]; then
    echo "✔ $key ตั้งไว้แล้ว (ไม่เปลี่ยน)"
    return 0
  fi
  local value
  value="$("$@")"
  if [ -z "$value" ]; then
    echo "❌ สร้างค่า $key ไม่สำเร็จ" >&2
    exit 1
  fi
  write_value "$key" "$value"
  generated+=("$key")
  echo "🔑 สร้าง $key ใหม่แล้ว"
}

gen_postgres_password() { openssl rand -hex 24; }
gen_master_key() { openssl rand -base64 32 | tr -d '\n'; }
gen_session_secret() { openssl rand -base64 48 | tr -d '\n'; }

fill_if_empty POSTGRES_PASSWORD gen_postgres_password
fill_if_empty MASTER_KEY gen_master_key
fill_if_empty SESSION_SECRET gen_session_secret

echo
if [ "${#generated[@]}" -eq 0 ]; then
  echo "ไม่มีค่าใดเปลี่ยน — ค่าลับใน $(basename "$ENV_FILE") ครบแล้ว"
else
  echo "บันทึกลง $ENV_FILE แล้ว: ${generated[*]}"
fi

echo
echo "🔐 รหัสผ่านเข้าเว็บไม่ได้อยู่ใน $(basename "$ENV_FILE"): ตั้งที่หน้าเว็บตอนเข้าครั้งแรก และตั้งให้เสร็จก่อนเปิดเว็บออกเครือข่าย"

if [[ " ${generated[*]-} " == *" MASTER_KEY "* ]]; then
  echo
  echo "⚠️  สำรอง MASTER_KEY ไว้ที่ปลอดภัยแยกจาก backup ฐานข้อมูล — ถ้าหาย private key ที่เก็บไว้จะกู้คืนไม่ได้"
fi

dry_run="$(current_value DRY_RUN)"
if [ "${dry_run:-true}" != "true" ]; then
  echo
  echo "⚠️  DRY_RUN=$dry_run — worker จะส่ง transaction จริงบน KUB mainnet"
fi
