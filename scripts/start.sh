#!/usr/bin/env bash
# เริ่มระบบด้วยคำสั่งเดียว: ตรวจ Docker → สร้างค่าลับ → build + start → รอจนพร้อม แล้วบอก URL
#
#   bash scripts/start.sh
#
# รันซ้ำได้: ค่าลับเดิมไม่ถูกเปลี่ยน ข้อมูลไม่หาย ใช้เริ่มระบบใหม่หรือหลัง git pull ได้เลย
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

WAIT_SEC="${START_WAIT_SEC:-180}"

fail() {
  printf '\n❌ %s\n' "$1" >&2
  shift
  for line in "$@"; do
    printf '   %s\n' "$line" >&2
  done
  exit 1
}

# ---- 1. Docker ---------------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 ||
  fail "ไม่พบ Docker" \
    "ติดตั้ง Docker Desktop จาก https://www.docker.com/products/docker-desktop/ แล้วรันคำสั่งนี้อีกครั้ง"
docker compose version >/dev/null 2>&1 ||
  fail "ไม่พบคำสั่ง docker compose" \
    "อัปเดต Docker Desktop หรือติดตั้ง Docker Compose v2 แล้วรันคำสั่งนี้อีกครั้ง"
docker info >/dev/null 2>&1 ||
  fail "เชื่อมต่อ Docker ไม่ได้" \
    "เปิดโปรแกรม Docker Desktop รอจนพร้อม แล้วรันคำสั่งนี้อีกครั้ง" \
    "บน Linux ให้ตรวจว่า Docker ทำงานอยู่ และ user นี้มีสิทธิ์ใช้ Docker"

# ---- 2. .env + ค่าลับ (ไม่เขียนทับของเดิม) -----------------------------------------------------------
first_run=1
if [ -f .env ] && grep -q '^MASTER_KEY=..*' .env; then
  first_run=0
fi
bash scripts/gen-secrets.sh

# ---- 3. build + start --------------------------------------------------------------------------
echo
echo "🚀 กำลังเริ่มระบบ (ครั้งแรกต้อง build อาจใช้เวลาหลายนาที)"
docker compose up -d --build ||
  fail "เริ่มระบบไม่สำเร็จ" \
    "ถ้า error บอกว่า port ไม่ว่าง: ตั้ง WEB_PORT=3100 ในไฟล์ .env แล้วรันคำสั่งนี้อีกครั้ง" \
    "วิธีแก้อื่น ๆ: docs/operations.md หัวข้อ Troubleshooting"

# ---- 4. รอจนพร้อม ---------------------------------------------------------------------------------
address="$(docker compose port web 3000)"
url="http://${address/0.0.0.0/127.0.0.1}"

if command -v curl >/dev/null 2>&1; then
  echo "⏳ กำลังรอให้ระบบพร้อม (สูงสุด ${WAIT_SEC} วินาที)"
  waited=0
  until curl -fsS --max-time 3 "$url/api/health" 2>/dev/null | grep -q '"fresh":true'; do
    if [ "$waited" -ge "$WAIT_SEC" ]; then
      fail "ระบบยังไม่พร้อมภายใน ${WAIT_SEC} วินาที" \
        "ดูสถานะ: docker compose ps -a" \
        "ดู log: docker compose logs worker --tail 50" \
        "วิธีแก้: docs/operations.md หัวข้อ Troubleshooting"
    fi
    sleep 3
    waited=$((waited + 3))
  done
fi

# ---- 5. สรุป --------------------------------------------------------------------------------------
echo
echo "✅ ระบบพร้อมแล้ว เปิด $url ในเบราว์เซอร์"
echo "   หยุดระบบ: docker compose down (ห้ามใส่ -v เพราะจะลบข้อมูลทั้งหมด)"
if [ "$first_run" -eq 1 ]; then
  echo
  echo "⚠️  ทำตอนนี้: คัดลอกค่า MASTER_KEY จากไฟล์ .env ไปเก็บที่ปลอดภัย ถ้าหาย private key ที่เก็บไว้จะกู้คืนไม่ได้"
fi
echo
echo "⚠️  ทุกคำสั่งในหน้าเว็บใช้เงินจริงบน KUB Chain mainnet ให้เริ่มจากจำนวนน้อยก่อน"
