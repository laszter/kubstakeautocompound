# ความปลอดภัยและความเสี่ยง

อ่านหน้านี้ให้จบก่อนใส่เงินจริง ถ้าต้องการเริ่มติดตั้งให้กลับไปที่ [README](../README.md)

## Hot wallet — ใส่เงินเท่าที่จำเป็น
- ใช้ **wallet แยกเฉพาะสำหรับระบบนี้** อย่าใช้กระเป๋าหลัก และเก็บ private key ต้นฉบับไว้เองที่อื่นด้วย
- เงินที่ stake อยู่ **ไม่ได้ปลอดภัยกว่าเงินในกระเป๋า**: `undelegate()` คืน principal ใน tx เดียวกันทันที (ไม่มี unbonding) ใครได้ key ไปก็ถอนแล้วโอนออกได้ทั้งหมด → ความเสี่ยงรวม = balance + principal ที่ stake + reward ค้าง
- ระบบกัน `GAS_RESERVE_KUB` (≥ 0.05 KUB) ไว้ในกระเป๋าเสมอ ไม่ stake จนหมด

## Encryption ป้องกันอะไร / ไม่ป้องกันอะไร
private key เข้ารหัสด้วย AES-256-GCM (key = `MASTER_KEY` จาก `.env`, AAD = address) ก่อนลง DB

| สถานการณ์ | ปลอดภัยไหม |
|---|---|
| DB dump / backup / volume หลุดไป (แต่ `.env` ไม่หลุด) | ✅ private key ถอดรหัสไม่ได้ เพราะ `MASTER_KEY` อยู่นอก DB · ⚠️ ในนั้นมี argon2id hash ของรหัสผู้ดูแล คนที่ได้ไปเดารหัสแบบ offline ได้โดยไม่ติด rate limit จึงควรตั้งรหัสยาว ๆ และเปลี่ยนรหัสถ้า dump หลุด |
| คนเข้าหน้าเว็บได้ (รู้รหัสผู้ดูแล) | ⚠️ ดู key ไม่ได้ แต่ **สั่ง undelegate/claim/delegate ได้** (เงินยังอยู่ใน wallet เดิม) |
| Host ถูกยึด (root / อยู่ใน group `docker` / อ่าน `.env` ได้ / `docker inspect` ได้) | ❌ ไม่ป้องกัน — อ่าน `MASTER_KEY` + DB แล้วถอดรหัส key ได้ทั้งหมด |

## `MASTER_KEY` — สำรองแยกจาก backup ฐานข้อมูล
- **หาย = private key ที่เก็บใน DB กู้คืนไม่ได้** (backup DB ไร้ค่าถ้าไม่มี `MASTER_KEY` เดิม)
- เก็บไว้ใน password manager / offline **คนละที่กับไฟล์ backup** (ได้ทั้งสองอย่าง = ได้ key ทั้งหมด)
- **ห้ามเปลี่ยน `MASTER_KEY` หลังเพิ่ม wallet แล้ว** — ยังไม่รองรับ key rotation (re-encrypt) ถ้าจำเป็นต้องเปลี่ยน: ลบ wallet ทั้งหมด → เปลี่ยน key → เพิ่ม wallet ใหม่
- `.env` เก็บค่าลับทั้งหมด — `scripts/gen-secrets.sh` ตั้ง `chmod 600` ให้, ห้าม commit (`.gitignore` กันไว้แล้ว)

## อย่า expose port ตรง ๆ
- หน้าเว็บมีแค่ admin password เดียว (ไม่มี 2FA) และ bind `127.0.0.1` โดย default — **อย่าตั้ง `WEB_BIND=0.0.0.0` บนเครื่องที่มี public IP** ถ้าจะเข้าจากที่อื่นดู [วิธีเปิดให้เข้าอย่างปลอดภัย](operations.md#เปิดให้เข้าจากที่อื่นอย่างปลอดภัย)
- **ตั้งรหัสผู้ดูแลก่อนเปิดเว็บออกเครือข่าย**: ช่วงที่ยังไม่มีรหัส (ติดตั้งใหม่, อัปเกรดจากรุ่นเดิม, หลังลบแถวเพื่อกู้รหัส) ใครเข้า `/setup` ก่อนจะได้สิทธิ์ผู้ดูแล ระบบไม่มี setup token จึงพึ่ง default bind `127.0.0.1` → ตั้งรหัสจากเครื่อง host หรือผ่าน SSH tunnel ให้เสร็จก่อน แล้วค่อยเปิด reverse proxy / tunnel
- Postgres ไม่ publish port เลย (อย่าเพิ่ม `ports:` ให้ `db`)
- **Login rate limit** = ล้มเหลว 5 ครั้ง / 15 นาที / IP (นับรวมการกรอกรหัสปัจจุบันผิดตอนเปลี่ยนรหัส) โดย IP มาจาก **ค่าแรกของ header `X-Forwarded-For`** (ไม่มี = `127.0.0.1`) → ถ้าใครเข้าถึง port ของ web ได้ตรง ๆ จะปลอม header นี้เพื่อเลี่ยง rate limit ได้ ใช้ reverse proxy ที่ **เขียนทับ** header นี้ และตั้งรหัสผู้ดูแลยาว ๆ
  - ถ้าเปิดเว็บผ่าน docker port mapping ตรง ๆ (ไม่มี reverse proxy) ทุก request จะมาจาก **IP ของ docker bridge** (เช่น `172.23.0.1`) → **ทุก browser บน host ใช้ rate-limit bucket เดียวกัน**: ใครพิมพ์ผิด 5 ครั้ง ทุกคนถูกล็อก 15 นาที
  - ปลดล็อกทันที (ลบเฉพาะครั้งที่ล้มเหลว; ใช้ค่า `POSTGRES_USER` / `POSTGRES_DB` ของคุณถ้าไม่ใช่ค่าเริ่มต้น `kubstake`):
    ```bash
    docker compose exec db psql -U kubstake -d kubstake -c "delete from login_attempts where success=false"
    ```

## ไม่มีโหมดจำลอง — worker ส่ง tx จริงเสมอ
- ทันทีที่ worker ทำงาน คำสั่งในคิวและ position ที่เปิด auto-compound จะเซ็นและ broadcast จริงบน mainnet — simulate (`eth_call` + `estimateGas`) มีไว้กัน tx ที่จะ revert หรือเงินไม่พอเท่านั้น ถ้าผ่านก็ส่งเลย
- ทดสอบโดยไม่ใช้เงินจริงด้วย [`npm run e2e:fork`](development.md#คำสั่งที่ใช้บ่อย) · ก่อนเติมเงินดู [go-live checklist](operations.md#ก่อนเติมเงินจริง-go-live-checklist) — เริ่มด้วยจำนวนน้อยก่อน

## เรื่องอื่นที่ควรรู้
- เจ้าของ validator เปลี่ยน `delegation` / `minDelegated` / pause ได้ทุกเมื่อ → ระบบอ่าน flag สดก่อนส่ง tx ทุกครั้ง ถ้าปิดรับ delegate position จะเป็น **claim-only** (claim ได้, undelegate ได้, แต่ stake เพิ่มไม่ได้)
- `undelegate` จนเหลือต่ำกว่า `minDelegated` ของ validator = contract **ถอนทั้งหมด**
- principal ไม่โดน slash (ตาม contract ที่ตรวจสอบ ณ 2026-11) แต่ reward ขึ้นกับ fee ของ chain
- ยังไม่มี: notification (LINE/Telegram/email), backup อัตโนมัติ, `MASTER_KEY` rotation, multi-user/2FA
