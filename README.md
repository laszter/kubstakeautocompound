# KUB Stake Auto-Compound

Webapp + worker + PostgreSQL ที่รันด้วย `docker compose` สำหรับ stake (delegate) KUB บน **KUB Chain mainnet (chainId 96)** จากหลาย wallet หลาย validator แล้วให้ระบบ claim reward และ stake กลับ (auto-compound) ในจังหวะที่คุ้มค่า gas ที่สุดให้เอง

> ⚠️ ระบบนี้เป็น **hot wallet**: private key ถูกเข้ารหัสแล้วเก็บบนเครื่องที่รันระบบ และ worker ใช้ key นั้นเซ็น transaction บน mainnet ด้วยเงินจริง อ่าน [คำเตือน / Threat model](#2-️-คำเตือน--threat-model) ให้จบก่อนใส่เงิน

**สารบัญ**: [1. ระบบนี้ทำอะไร](#1-ระบบนี้ทำอะไร) · [2. คำเตือน](#2-️-คำเตือน--threat-model) · [3. Quick start](#3-quick-start) ([go-live checklist](#4-ก่อนเปิดใช้จริง-go-live-checklist)) · [4. Trigger modes](#4-trigger-modes-optimal--threshold--schedule) · [5. Expose อย่างปลอดภัย](#5-เปิดให้เข้าจากที่อื่นอย่างปลอดภัย-expose-safely) · [6. Backup/restore](#6-backup--restore) · [7. อัปเดตเวอร์ชัน](#7-อัปเดตเวอร์ชัน) · [8. Troubleshooting](#8-troubleshooting) · [9. Development](#9-development) · [10. โครงสร้าง repo + env](#10-โครงสร้าง-repo--environment-variables)

---

## 1. ระบบนี้ทำอะไร

- เพิ่ม **wallet** ด้วย private key (หลายใบได้) → เห็น address และ balance
- ดูรายชื่อ **validator** ที่ active บน chain (ชื่อ/โลโก้จาก subgraph ถ้ามี) — ตัวที่ปิดรับ delegate จะกด delegate ใหม่ไม่ได้
- สร้าง **position** = wallet × validator แต่ละอันมีการตั้งค่า auto-compound ของตัวเอง
- สั่ง **delegate / undelegate / claim / compound now** จากหน้าเว็บ
- **Auto-compound** 3 โหมด: `optimal` (คำนวณจุดคุ้มที่สุด R\* = √(2·C·P)), `threshold` (ถึงจำนวนที่ตั้ง), `schedule` (ตามเวลา cron) — ดู [§4](#4-trigger-modes-optimal--threshold--schedule)
- ประวัติ action / tx (ลิงก์ kubscan) / snapshot ของแต่ละ position, แดชบอร์ดรวม, หน้าตั้งค่ากลาง
- `DRY_RUN=true` เป็นค่าเริ่มต้น: ทุกอย่าง **simulate อย่างเดียว ไม่ส่ง tx จริง** จนกว่าคุณจะเปลี่ยนเอง

### Architecture

```
  (เครื่อง host)
 +-----------+  HTTP   +--------------------------+
 |  Browser  | ------> |  web  (Next.js 16)       |  127.0.0.1:3000  (WEB_BIND:WEB_PORT)
 +-----------+         |  - setup + login (argon2)|
                       |  - UI + server actions   |
                       |  - ENCRYPT key only      |
                       |  - never calls RPC       |
                       +------------+-------------+
                                    | SQL: insert wallets.encrypted_key,
                                    |      enqueue rows in `actions`
                                    v
                       +--------------------------+
                       |  db  (Postgres 18)       |  no published port
                       |  volume kubstake_pgdata  |
                       +------------^-------------+
                                    | SQL: pick `actions`, write positions/txs/heartbeat
                       +------------+-------------+      JSON-RPC (HTTPS)      +----------------------+
                       |  worker  (Node)          | -------------------------> |  KUB Chain RPC       |
                       |  - DECRYPT key + sign    |                            |  rpc.kubchain.io     |
                       |  - tick every 30s        |                            |  chainId 96          |
                       |  - compound engine       |                            +----------------------+
                       +--------------------------+

  migrate (one-shot): SQL migrations + seed app_settings -> exit 0  ก่อน web/worker เริ่มทำงาน
```

| Service | หน้าที่ | Port | เห็น `MASTER_KEY` |
|---|---|---|---|
| `db` | PostgreSQL 18 (`postgres:18-alpine`), ข้อมูลอยู่ใน volume `kubstake_pgdata` | ไม่ publish (เฉพาะ network ภายใน compose) | ❌ |
| `migrate` | รัน migration + seed ตาราง `app_settings` ครั้งแรก แล้ว exit 0 | — | ❌ |
| `web` | UI ภาษาไทย, ตั้งรหัสครั้งแรก + login, **เข้ารหัส** private key ตอนเพิ่ม wallet, enqueue คำสั่ง | `${WEB_BIND}:${WEB_PORT}` → 3000 | ✅ (encrypt เท่านั้น) |
| `worker` | ทำ chain I/O ทั้งหมด: sync validator/balance, ตัดสินใจ compound, **ถอดรหัส key + เซ็น tx** | — | ✅ |

**Flow ของปุ่มในเว็บ:** server action ตรวจ session → แค่ insert แถวใน `actions` (`pending`) → worker หยิบไปทำ (`running`) → `done` / `failed` / `skipped` → หน้าเว็บ auto-refresh ทุก 15 วินาที — web ไม่ส่ง tx เองและไม่เคยถอดรหัส key, private key ไม่ถูกส่งกลับ browser และไม่อยู่ใน log

---

## 2. ⚠️ คำเตือน / Threat model

### Hot wallet — ใส่เงินเท่าที่จำเป็น
- ใช้ **wallet แยกเฉพาะสำหรับระบบนี้** อย่าใช้กระเป๋าหลัก และเก็บ private key ต้นฉบับไว้เองที่อื่นด้วย
- เงินที่ stake อยู่ **ไม่ได้ปลอดภัยกว่าเงินในกระเป๋า**: `undelegate()` คืน principal ใน tx เดียวกันทันที (ไม่มี unbonding) ใครได้ key ไปก็ถอนแล้วโอนออกได้ทั้งหมด → ความเสี่ยงรวม = balance + principal ที่ stake + reward ค้าง
- ระบบกัน `GAS_RESERVE_KUB` (≥ 0.05 KUB) ไว้ในกระเป๋าเสมอ ไม่ stake จนหมด

### Encryption ป้องกันอะไร / ไม่ป้องกันอะไร
private key เข้ารหัสด้วย AES-256-GCM (key = `MASTER_KEY` จาก `.env`, AAD = address) ก่อนลง DB

| สถานการณ์ | ปลอดภัยไหม |
|---|---|
| DB dump / backup / volume หลุดไป (แต่ `.env` ไม่หลุด) | ✅ private key ถอดรหัสไม่ได้ เพราะ `MASTER_KEY` อยู่นอก DB · ⚠️ ในนั้นมี argon2id hash ของรหัสผู้ดูแล คนที่ได้ไปเดารหัสแบบ offline ได้โดยไม่ติด rate limit จึงควรตั้งรหัสยาว ๆ และเปลี่ยนรหัสถ้า dump หลุด |
| คนเข้าหน้าเว็บได้ (รู้รหัสผู้ดูแล) | ⚠️ ดู key ไม่ได้ แต่ **สั่ง undelegate/claim/delegate ได้** (เงินยังอยู่ใน wallet เดิม) |
| Host ถูกยึด (root / อยู่ใน group `docker` / อ่าน `.env` ได้ / `docker inspect` ได้) | ❌ ไม่ป้องกัน — อ่าน `MASTER_KEY` + DB แล้วถอดรหัส key ได้ทั้งหมด |

### `MASTER_KEY` — สำรองแยกจาก backup ฐานข้อมูล
- **หาย = private key ที่เก็บใน DB กู้คืนไม่ได้** (backup DB ไร้ค่าถ้าไม่มี `MASTER_KEY` เดิม)
- เก็บไว้ใน password manager / offline **คนละที่กับไฟล์ backup** (ได้ทั้งสองอย่าง = ได้ key ทั้งหมด)
- **ห้ามเปลี่ยน `MASTER_KEY` หลังเพิ่ม wallet แล้ว** — ยังไม่รองรับ key rotation (re-encrypt) ถ้าจำเป็นต้องเปลี่ยน: ลบ wallet ทั้งหมด → เปลี่ยน key → เพิ่ม wallet ใหม่
- `.env` เก็บค่าลับทั้งหมด — `scripts/gen-secrets.sh` ตั้ง `chmod 600` ให้, ห้าม commit (`.gitignore` กันไว้แล้ว)

### อย่า expose port ตรง ๆ
- หน้าเว็บมีแค่ admin password เดียว (ไม่มี 2FA) และ bind `127.0.0.1` โดย default — **อย่าตั้ง `WEB_BIND=0.0.0.0` บนเครื่องที่มี public IP** ถ้าจะเข้าจากที่อื่นดู [§5](#5-เปิดให้เข้าจากที่อื่นอย่างปลอดภัย-expose-safely)
- **ตั้งรหัสผู้ดูแลก่อนเปิดเว็บออกเครือข่าย**: ช่วงที่ยังไม่มีรหัส (ติดตั้งใหม่, อัปเกรดจากรุ่นเดิม, หลังลบแถวเพื่อกู้รหัส) ใครเข้า `/setup` ก่อนจะได้สิทธิ์ผู้ดูแล ระบบไม่มี setup token จึงพึ่ง default bind `127.0.0.1` → ตั้งรหัสจากเครื่อง host หรือผ่าน SSH tunnel ให้เสร็จก่อน แล้วค่อยเปิด reverse proxy / tunnel
- Postgres ไม่ publish port เลย (อย่าเพิ่ม `ports:` ให้ `db`)
- **Login rate limit** = ล้มเหลว 5 ครั้ง / 15 นาที / IP (นับรวมการกรอกรหัสปัจจุบันผิดตอนเปลี่ยนรหัส) โดย IP มาจาก **ค่าแรกของ header `X-Forwarded-For`** (ไม่มี = `127.0.0.1`) → ถ้าใครเข้าถึง port ของ web ได้ตรง ๆ จะปลอม header นี้เพื่อเลี่ยง rate limit ได้ ใช้ reverse proxy ที่ **เขียนทับ** header นี้ และตั้งรหัสผู้ดูแลยาว ๆ
  - ถ้าเปิดเว็บผ่าน docker port mapping ตรง ๆ (ไม่มี reverse proxy) ทุก request จะมาจาก **IP ของ docker bridge** (เช่น `172.23.0.1`) → **ทุก browser บน host ใช้ rate-limit bucket เดียวกัน**: ใครพิมพ์ผิด 5 ครั้ง ทุกคนถูกล็อก 15 นาที
  - ปลดล็อกทันที (ลบเฉพาะครั้งที่ล้มเหลว; ใช้ค่า `POSTGRES_USER` / `POSTGRES_DB` ของคุณถ้าไม่ใช่ค่าเริ่มต้น `kubstake`):
    ```bash
    docker compose exec db psql -U kubstake -d kubstake -c "delete from login_attempts where success=false"
    ```

### `DRY_RUN=true` เป็นค่าเริ่มต้น
- worker จะ `estimateGas`/simulate เท่านั้น ไม่เซ็น ไม่ broadcast — action จะจบเป็น `done` พร้อมข้อความ `DRY_RUN: simulated only (gas ≈ N)` และแดชบอร์ดมี badge **DRY RUN**
- เปิดใช้จริง: แก้ `.env` เป็น `DRY_RUN=false` แล้ว `docker compose up -d worker` (ดู [§3 ขั้นที่ 6 และ go-live checklist](#4-ก่อนเปิดใช้จริง-go-live-checklist)) — เริ่มด้วยจำนวนน้อยก่อน

### เศรษฐศาสตร์: APR ต่ำมาก — ต้องไม่ให้ค่า gas กินกำไร
- reward มาจากค่าธรรมเนียม tx ของ chain ล้วน ๆ → **APR ≈ 0.58% ต่อปี** (ผันผวน, 0.55–0.62% ณ 2026-11) ระบบวัด APR สดจากการเพิ่มของ pending reward (EWMA) ไม่ได้ hard-code (ใช้ 0.58% จนกว่าจะมี sample)
- ค่า gas ต่อครั้ง (gasPrice ≈ 25 gwei, legacy tx):

| Action | gasUsed (โดยประมาณ) | ค่า gas @ 25 gwei |
|---|---|---|
| `claimRewards()` | ≈ 110,000 | ≈ 0.0027 KUB |
| compound 1-tx (`delegate{value: pending}` — contract จ่าย reward ใน tx เดียวกัน) | ≈ 207,000 | **≈ 0.005 KUB** |
| compound 2-tx (claim → delegate) | ≈ 301,000 | ≈ 0.0075 KUB |
| `undelegate()` | ≈ 180,000 | ≈ 0.0045 KUB |

- จุดคุ้มที่สุด (มาจาก loss rate `L(t) = C/t + P·r²·t/2`):
  - **R\* = √(2·C·P)** = reward ที่ควรรอให้ถึงก่อน compound (ไม่ขึ้นกับ APR)
  - **t\* = √(2·C / (P·r²))** = ระยะห่างของแต่ละรอบ
  - compound ดีกว่าไม่ compound เลย (มอง 1 ปี) เมื่อ **P > 8·C/r² ≈ 1,230 KUB** (1-tx) / ≈ 1,790 KUB (2-tx)
  - C = ค่า gas ต่อ compound, P = principal, r = APR
- ตัวอย่าง (1-tx, r = 0.58%, C = 25 gwei × 207,360 gas ≈ 0.005184 KUB):

| Principal P (KUB) | Reward / ปี | R\* (KUB) | t\* (ระยะห่างแต่ละรอบ) | ได้เพิ่มจาก compound / ปี |
|---:|---:|---:|---:|---:|
| 100 | 0.58 | 1.02 | ≈ 641 วัน | ≈ 0 |
| 1,000 | 5.8 | 3.22 | ≈ 203 วัน | ≈ 0 |
| 10,000 | 58 | 10.18 | ≈ 64 วัน | ≈ +0.11 KUB |
| 100,000 | 580 | 32.2 | ≈ 20 วัน | ≈ +1.5 KUB |
| 1,000,000 | 5,800 | 101.8 | ≈ 6.4 วัน | ≈ +16.3 KUB |

- ตัวเลขข้างบนเป็นตัวอย่าง — ระบบคำนวณใหม่ทุกครั้งที่ตรวจ position ด้วย **gas price สดจาก RPC** × gas ของ path ที่จะใช้จริง (`GAS_EST` 1-tx = 210,000 / 2-tx = 301,000 / claim = 110,000) และ P, R จาก chain (ที่ 25 gwei หน้าเว็บจึงแสดง R\*(10,000 KUB) ≈ 10.25 ไม่ใช่ 10.18)
- **สรุป**: ระบบไม่ตัดสินแทนว่า position ไหน "ไม่คุ้ม" — ทุก position ที่เปิด auto-compound จะ compound เองเมื่อ reward ถึงจุดที่คุ้มค่า gas ที่สุด เงินต้นน้อยจะรอนานและได้เพิ่มน้อยตามตาราง ประโยชน์หลักของระบบคือ **ไม่ให้ค่า gas กินกำไร** — เช่น compound ทุกวันที่ 10,000 KUB เสีย gas ≈ 1.9 KUB/ปี มากกว่ากำไรจาก compound (≈ 0.17 KUB/ปี)

### เรื่องอื่นที่ควรรู้
- เจ้าของ validator เปลี่ยน `delegation` / `minDelegated` / pause ได้ทุกเมื่อ → ระบบอ่าน flag สดก่อนส่ง tx ทุกครั้ง ถ้าปิดรับ delegate position จะเป็น **claim-only** (claim ได้, undelegate ได้, แต่ stake เพิ่มไม่ได้)
- `undelegate` จนเหลือต่ำกว่า `minDelegated` ของ validator = contract **ถอนทั้งหมด**
- principal ไม่โดน slash (ตาม contract ที่ตรวจสอบ ณ 2026-11) แต่ reward ขึ้นกับ fee ของ chain
- ยังไม่มี: notification (LINE/Telegram/email), backup อัตโนมัติ, `MASTER_KEY` rotation, multi-user/2FA

---

## 3. Quick start

ต้องมี: Docker Engine + Docker Compose v2 (`docker compose`), `bash`, `openssl`, internet (build ต้อง `npm ci`, runtime ต้องต่อ RPC), พื้นที่ว่าง ~1 GB สำหรับ images

### 1) Clone + ตั้งค่า

```bash
git clone <repo-url> kubstake && cd kubstake
cp .env.example .env
bash scripts/gen-secrets.sh
```

`gen-secrets.sh` เติมเฉพาะค่าที่ยังว่าง (รันซ้ำได้ ไม่เขียนทับ): `POSTGRES_PASSWORD`, `MASTER_KEY`, `SESSION_SECRET` แล้ว **สำรอง `MASTER_KEY` ทันที** · รหัสผู้ดูแลไม่อยู่ใน `.env`: ตั้งที่หน้าเว็บตอนเข้าครั้งแรก (ขั้นที่ 3)

หรือสร้างเองแล้วใส่ใน `.env`:

```bash
# POSTGRES_PASSWORD (hex เท่านั้น — อยู่ใน DATABASE_URL)
openssl rand -hex 24
# MASTER_KEY (base64 ของ 32 bytes)
openssl rand -base64 32
# SESSION_SECRET (≥ 32 ตัวอักษร)
openssl rand -base64 48
```

ตรวจว่า `.env` มี `DRY_RUN=true` (ค่าเริ่มต้น) ถ้า port 3000 ถูกใช้อยู่ให้ตั้ง `WEB_PORT=3100` (หรือ port อื่น)

### 2) Start

```bash
docker compose up -d --build
docker compose ps -a
# {"ok":true,"db":"ok","worker":{...,"fresh":true,"dryRun":true}}
curl -fsS http://127.0.0.1:3000/api/health
# ควรเห็น "chainId 96 OK", "leader lock acquired", "validator sync n=…"
docker compose logs worker --tail 50
```

`docker compose ps -a` ควรเห็น migrate = Exited (0), db/web/worker = Up (healthy)

build ครั้งแรกใช้เวลาหลายนาที, `worker.fresh` เป็น `true` ภายใน ~90 วินาทีหลัง start

### 3) ใช้งานผ่านเว็บ — เปิด <http://127.0.0.1:3000>

1. **ตั้งรหัสผู้ดูแล**: เข้าครั้งแรกระบบพาไปหน้า `/setup` ให้ตั้งรหัสเอง (8–1024 ตัวอักษร ไม่บังคับชนิดตัวอักษร ช่องว่างนับรวมด้วย) ตั้งเสร็จเข้าสู่ระบบทันที → แดชบอร์ด: header มี chip เขียว "worker ทำงาน" (จอกว้างไม่ถึง 640px แสดงแค่ "ทำงาน") + badge **DRY RUN**
   - ครั้งต่อไปกรอกรหัสนี้ที่ `/login` · เปลี่ยนรหัสได้ที่หน้า **ตั้งค่า** (อุปกรณ์อื่นที่เข้าสู่ระบบไว้จะถูกออกจากระบบ) · ลืมรหัสดู [§8](#8-troubleshooting)
2. **กระเป๋า** → เพิ่ม wallet: ตั้งชื่อ (label) + วาง private key → เห็น address ทันที, balance ขึ้นภายใน ~30 วินาที (worker sync ให้)
3. **Validators** → รายชื่อแบบการ์ด สลับเป็นตารางได้ด้วยปุ่มมุมมองหรือ `/validators?view=list` (จอกว้างตั้งแต่ 768px; จอเล็กกว่านั้นแสดงการ์ดเสมอ) · worker sync ครั้งแรกตอน start; กด "รีเฟรชรายชื่อ" ได้ → กด **Delegate** ที่ validator ที่เปิดรับ
4. **สร้าง position**: เลือก wallet + validator + จำนวน KUB เริ่มต้น (ไม่บังคับ; ครั้งแรกต้อง ≥ `minDelegated` ของ validator และ ≤ balance − reserve − ค่า gas) → ระบบ enqueue `delegate` ให้
   - ถ้า wallet นี้ delegate validator นี้ไว้แล้วจากที่อื่น ให้เว้นจำนวนว่าง — worker อ่าน principal/pending จาก chain เอง
5. **หน้า position**: เลือก trigger mode (`optimal` / `threshold` / `schedule`), เปิด/ปิด auto-compound, ดู R\* + ETA, next check / next run, ผลรอบล่าสุด, ประวัติ tx; มีปุ่ม delegate / undelegate (มี "ถอนทั้งหมด") / claim / compound now
6. **เมื่อพร้อมใช้เงินจริง**: ใน DRY_RUN ทุกคำสั่งจบเป็น `done` + `DRY_RUN: simulated only …` และ principal ยังเป็น 0 — ถ้าผลการ simulate ถูกต้องแล้ว:

```bash
# แก้ .env: DRY_RUN=false
docker compose up -d worker
# ต้องเห็น "DRY_RUN=false: the worker WILL sign and broadcast real transactions to rpc.kubchain.io (chainId 96)"
docker compose logs worker --tail 20
```

badge DRY RUN จะหายไปจากแดชบอร์ด — เริ่มจาก delegate จำนวนน้อยแล้วเช็ค tx ใน kubscan ก่อน · กลับไปโหมดจำลอง: `DRY_RUN=true` แล้ว `docker compose up -d worker`

> ปุ่มทุกปุ่มจะ disabled / ถูกปฏิเสธเมื่อ worker ไม่สด (ไม่ได้ tick เกิน 90 วินาที) เพราะไม่มีใครทำคำสั่งให้

- **ธีม**: ปุ่มธีม (สว่าง / มืด / ตามระบบ) อยู่มุมขวาของ header และมุมขวาบนของหน้า login — จอกว้างไม่ถึง 1024px (รวมมือถือ) ปุ่มใน header ย้ายไปอยู่ในเมนู hamburger ส่วนหน้า login ยังอยู่มุมขวาบน · ค่าเก็บใน cookie `theme` (ไม่ใช่ข้อมูลลับ) ค่าเริ่มต้นตามระบบปฏิบัติการ

### 4) ก่อนเปิดใช้จริง (go-live checklist)

1. **สำรอง `MASTER_KEY`** ไว้ใน password manager / offline คนละที่กับ backup DB ([§2](#master_key--สำรองแยกจาก-backup-ฐานข้อมูล)) — หาย = key ใน DB กู้ไม่ได้
2. **เติมเงิน hot wallet เท่าที่จำเป็น**: จำนวนที่จะ stake + เงินลอยในกระเป๋า **≥ R\* + 0.05 KUB (reserve) + ค่า gas (~0.01)** (R\* ของแต่ละ position ดูได้ในหน้า position) — compound แบบ 1-tx ต้องจ่าย `delegate{value: pending}` จากกระเป๋าก่อน (contract คืน reward ใน tx เดียวกัน) ถ้าเงินลอยไม่พอระบบจะใช้ 2-tx ที่แพงกว่า
3. (optional) **`npm run e2e:fork`** — ทดสอบ path ส่ง tx จริงบน anvil fork (ไม่ใช้เงินจริง, ไม่แตะ `.env`/volume ของคุณ — ดู [§9](#9-development))
4. แก้ `.env` เป็น **`DRY_RUN=false`** แล้ว **`docker compose up -d worker`** — log ต้องมี `DRY_RUN=false: the worker WILL sign and broadcast real transactions to rpc.kubchain.io (chainId 96)`
5. **ดู compound แรก** ในหน้า position (ประวัติ tx + ลิงก์ kubscan) และ log: `docker compose logs -f --no-log-prefix worker | npx pino-pretty` — เริ่มจากจำนวนน้อยก่อน

---

## 4. Trigger modes (`optimal` / `threshold` / `schedule`)

ตั้งต่อ position ในหน้า position (การ์ดตั้งค่า auto-compound) — ทุกโหมดแสดง R\* + ETA เป็น hint ให้เทียบเสมอ

| Mode | Trigger เมื่อ | Parameter |
|---|---|---|
| `optimal` (ค่าเริ่มต้น, แนะนำ) | pending reward **R ≥ max(R\*, `R_FLOOR_KUB`)** โดย R\* = isqrt(2·C·P) ด้วย C ของ path ที่จะใช้จริง | — (R floor ตั้งที่หน้า settings, เริ่มต้น 0.5 KUB) |
| `threshold` | **R ≥ จำนวน KUB ที่ตั้ง** (next check คำนวณจาก ETA ถึงจำนวนนี้) | threshold KUB (≥ 0.01) |
| `schedule` | ถึงเวลา cron (`next_run_at`) **และ** R ≥ min reward | preset หรือ cron 5 ฟิลด์ + `min_reward_kub` (ไม่บังคับ, ค่าเริ่มต้น = 2 × ค่า gas ของ path) |

**Schedule presets** (เวลาเป็น `APP_TIMEZONE`, ค่าเริ่มต้น `Asia/Bangkok`; ระยะห่างระหว่างรอบต้อง ≥ 1 ชั่วโมง เช่น `*/5 * * * *` จะถูกปฏิเสธ):

| Preset | ตัวอย่าง | cron ที่เก็บ |
|---|---|---|
| ทุก N ชั่วโมง (N = 1–23 หรือพหุคูณของ 24 ถึง 168) | ทุก 6 ชม. / ทุก 48 ชม. | `0 */6 * * *` / `0 0 */2 * *` |
| ทุก N วัน เวลา HH:mm | ทุก 7 วัน 09:00 | `0 9 */7 * *` (นับตามวันที่ของเดือน → วันที่ 1, 8, 15, 22, 29 แล้วเริ่มใหม่ต้นเดือน) |
| ทุกวัน เวลา HH:mm | ทุกวัน 09:00 | `0 9 * * *` |
| ทุกสัปดาห์ วัน + HH:mm | วันอาทิตย์ 09:00 | `0 9 * * 0` |
| Custom cron | วันที่ 1 ของเดือน 08:30 | `30 8 1 * *` |

ถึงเวลาแล้ว reward < min reward → **`skipped: dust_reward`** (ไม่ใช่ error) และ `next_run_at` เลื่อนไปรอบถัดไป — รอบที่ถึงเวลาแต่ติด guard อื่นก็ถูกข้ามแล้วรอรอบถัดไปเช่นกัน

### Guards ที่ใช้กับทุก mode
ลำดับการตัดสินใจ (`decideCompound`): `no_principal` → `zero_pending` → เลือก path → `backoff` → `min_interval` → `gas_too_high` → เงื่อนไขของ mode → `insufficient_gas` → ทำ

- **Path**: 1-tx ถ้า `liquid − reserve − C_1tx ≥ pending` (ถูกกว่า — ต้องมี KUB ว่างในกระเป๋าเท่ากับ reward ที่จะ compound) → ไม่งั้น 2-tx (claim แล้ว delegate ส่วนที่ได้) ถ้า `liquid − reserve ≥ C_2tx` → ไม่งั้น `insufficient_gas` · **เคล็ดลับ**: เก็บ KUB ว่างไว้ ≈ reserve + R\* + 0.01 จะได้ใช้ 1-tx
- **Gas reserve** `GAS_RESERVE_KUB` (≥ 0.05) ไม่เคยถูก stake
- **Max gas price** `MAX_GAS_PRICE_GWEI` (50) — สูงกว่านี้ข้ามรอบ (`gas_too_high`) แล้วลองใหม่รอบหน้า
- **Min interval** `MIN_INTERVAL_SEC` (≥ 3600) นับจาก compound ล่าสุดของ position
- **Backoff** หลังล้มเหลว = min(2^level × 15 นาที, 24 ชม.) — reset เมื่อสำเร็จ
- **Pre-flight**: อ่าน flag ของ validator สดจาก chain + simulate (`eth_call` + `estimateGas`) tx เดียวกันก่อนเซ็นทุกครั้ง, gas limit = max(estimate × 1.25, floor), ไม่ส่ง value = 0, verify receipt + decode event
- **Validator ปิดรับ delegate / paused / official pool / ไม่ active** → claim-only (threshold = R\* ที่ C = ค่า claim) + แจ้งเตือนแดงในหน้า position
- **Compound now** (สั่งเอง) ไม่สน mode/threshold, min interval, max gas price, backoff แต่ยังเคารพ reserve + simulation + validator flags; delegate/undelegate/claim ที่สั่งเองก็ไม่ติด max gas price
- ปิด auto-compound (switch) → worker ยังอัปเดตตัวเลขให้ แต่ไม่ compound

### ตัวอย่างการตั้งค่า

| สถานการณ์ | ตั้งค่า |
|---|---|
| stake 10,000 KUB อยากได้ผลตอบแทนสุทธิสูงสุด | `optimal` → compound เมื่อ reward ≈ 10.2 KUB (≈ ทุก 64 วัน) |
| อยาก compound ทุกครั้งที่ reward ถึง 5 KUB | `threshold` = `5` |
| อยากให้ทำวันอาทิตย์ 09:00 เท่านั้น และไม่ทำถ้า reward < 1 KUB | `schedule` → ทุกสัปดาห์ วันอาทิตย์ 09:00 (`0 9 * * 0`), min reward = `1` |
| stake 1,000 KUB | ปล่อย `optimal` (R\* ≈ 3.2 KUB ≈ 200 วัน) — **อย่า** schedule รายวัน: reward ≈ 0.016 KUB/วัน แต่ gas ≈ 0.005 KUB/ครั้ง (เสียไป ~1/3) |

### อ่านสถานะ
**Action** (ตาราง "ประวัติคำสั่ง"): `pending` → `running` → `done` | `failed` | `skipped`

| Status | ความหมาย |
|---|---|
| `pending` | รอ worker (หรือ wallet มี tx อื่นค้างอยู่ — worker ส่งทีละ 1 tx แล้วจะลองใหม่) |
| `running` | กำลังทำ / tx broadcast แล้วรอ receipt (worker ปิดสถานะให้เองแม้ restart) |
| `done` | สำเร็จ — ถ้า DRY_RUN จะมีข้อความ `DRY_RUN: simulated only (gas ≈ N)` |
| `failed` | ล้มเหลว + เหตุผล (revert reason, ยอดไม่พอ, validator ปิดรับ ฯลฯ) |
| `skipped` | ไม่มีอะไรให้ทำ — **ไม่ใช่ error** เช่น `no_principal: ยังไม่มีเงิน stake…`, `zero_pending: ไม่มี reward ค้าง`, undelegate ตอน principal = 0 |

**ผลรอบล่าสุด** (`last_run_result` ในหน้า position/แดชบอร์ด; คำสั่งที่กดเองขึ้นต้นด้วย `manual: `):

| ข้อความ | ความหมาย |
|---|---|
| `compounded 1-tx X KUB` / `compounded 2-tx X KUB (claimed Y KUB)` | compound สำเร็จ |
| `claimed X KUB (claim-only: validator not accepting delegation)` | validator ปิดรับ delegate — claim อย่างเดียว |
| `claimed only (insufficient for restake)` | 2-tx: claim แล้วแต่ KUB ไม่พอ delegate กลับ (เหลือในกระเป๋า) |
| `dry-run: would … (gas ≈ N)` | DRY_RUN — จำลองว่าจะทำอะไร |
| `skipped: <reason>` | ข้ามรอบ: `dust_reward`, `gas_too_high`, `min_interval`, `backoff`, `insufficient_gas`, `zero_pending`, `no_principal`, `tx_in_flight` (มี tx ค้าง), `invalid_schedule` (cron ผิด) |
| `pending: … awaiting confirmation` | ส่ง tx แล้ว รอ receipt |
| `failed: …` | ล้มเหลว → เพิ่ม backoff level |
| `error: …` | RPC/เครือข่ายสะดุดชั่วคราว → ลองใหม่รอบหน้า (ไม่นับ backoff) |

`below_threshold` / `not_due` (ยังไม่ถึงเกณฑ์/เวลา) ไม่ถูกบันทึกเป็นผลรอบ — ดู ETA / next run แทน

---

## 5. เปิดให้เข้าจากที่อื่นอย่างปลอดภัย (Expose safely)

หลักการ: **คง `WEB_BIND=127.0.0.1`** แล้วให้ตัวกลางที่มี TLS/การยืนยันตัวตนบนเครื่องเดียวกันต่อเข้า `127.0.0.1:${WEB_PORT}` — ห้าม publish port 3000 ตรงสู่ internet · **ตั้งรหัสผู้ดูแลให้เสร็จก่อนเปิดตัวกลาง** ([§2](#อย่า-expose-port-ตรง-ๆ))

### Reverse proxy + TLS (Caddy)
Caddy รันบน host เดียวกัน ขอ/ต่ออายุ certificate ให้อัตโนมัติ:

```caddyfile
# /etc/caddy/Caddyfile
kubstake.example.com {
	reverse_proxy 127.0.0.1:3000
	# ชั้นที่สอง (แนะนำ): basic_auth { admin <hash จาก `caddy hash-password`> }
}
```

แล้วใน `.env`: `COOKIE_SECURE=true` (cookie ส่งเฉพาะ HTTPS) → `docker compose up -d web`

- Caddy เขียนทับ `X-Forwarded-For` ด้วย IP จริงของ client (ไม่เชื่อ header จาก client) → login rate limit ทำงานถูก
- ใช้ nginx: ตั้ง `proxy_set_header X-Forwarded-For $remote_addr;` (**ไม่ใช่** `$proxy_add_x_forwarded_for` ซึ่งต่อท้ายค่าที่ client ปลอมมา) และ `proxy_set_header Host $host;`
- ถ้า proxy อยู่คนละเครื่อง/คนละ network: bind `WEB_BIND` กับ IP ภายใน (LAN/VPN) + firewall ให้รับเฉพาะ proxy — ไม่ใช่ `0.0.0.0` บนเครื่องที่มี public IP

### ทางเลือกที่ไม่ต้องเปิด port เลย

| วิธี | คำสั่ง / การตั้งค่า | `COOKIE_SECURE` |
|---|---|---|
| SSH tunnel | `ssh -N -L 3000:127.0.0.1:3000 user@server` แล้วเปิด <http://127.0.0.1:3000> บนเครื่องตัวเอง | `false` |
| Tailscale | `sudo tailscale serve --bg 3000` → `https://<host>.<tailnet>.ts.net` (เข้าได้เฉพาะเครื่องใน tailnet) — **อย่าใช้ `tailscale funnel`** (เปิดสู่ public) | `true` |
| Cloudflare Tunnel | named tunnel ชี้ `http://127.0.0.1:3000` + **บังคับ Cloudflare Access** (allowlist email) — อย่าใช้ quick tunnel `trycloudflare.com` ที่เปิด public; Cloudflare ต่อท้าย `X-Forwarded-For` จาก client ทำให้ rate limit เชื่อไม่ได้ จึงต้องพึ่ง Access | `true` |

---

## 6. Backup / Restore

ข้อมูลทั้งหมดอยู่ใน volume `pgdata` (ชื่อจริง `kubstake_pgdata`, mount ที่ `/var/lib/postgresql`) — **backup ไร้ค่าถ้าไม่มี `MASTER_KEY` เดิม** (สำรอง `.env` หรืออย่างน้อย `MASTER_KEY` แยกไว้คนละที่) · ตัวอย่างใช้ค่าเริ่มต้น `POSTGRES_USER=kubstake` / `POSTGRES_DB=kubstake` ถ้าเปลี่ยนไว้ให้แก้ `-U` / `-d`

### Backup (ทำได้ระหว่างระบบทำงาน)

```bash
docker compose exec -T db pg_dump -U kubstake -d kubstake --clean --if-exists --no-owner \
  > kubstake-$(date +%Y%m%d-%H%M).sql
chmod 600 kubstake-*.sql
```

ไฟล์มี private key ที่เข้ารหัสแล้ว + argon2id hash ของรหัสผู้ดูแล + address + ประวัติ — เก็บให้ปลอดภัย (ห้ามเก็บรวมกับ `MASTER_KEY`)

### Restore (เครื่องเดิม)

```bash
docker compose stop web worker
docker compose exec -T db psql -U kubstake -d kubstake -v ON_ERROR_STOP=1 < kubstake-YYYYMMDD-HHMM.sql
docker compose up -d
```

รหัสผู้ดูแลอยู่ใน DB จึงกลับเป็นรหัส ณ ตอนทำ dump ด้วย และ session ใช้ได้เมื่อออกด้วย hash ตรงกับใน dump: session ที่ออกหลังเปลี่ยนรหัสจะหลุด ส่วน session เก่าที่เคยถูกเตะตอนเปลี่ยนรหัสจะกลับมาใช้ได้ถ้า restore ไปก่อนการเปลี่ยนนั้นและ cookie ยังไม่หมดอายุ → ถ้าเคยเปลี่ยนรหัสเพราะรหัสหลุด ให้เปลี่ยนใหม่ทันทีหลัง restore

### ย้ายไปเครื่องใหม่

```bash
git clone <repo-url> kubstake && cd kubstake
# MASTER_KEY ต้องเป็นค่าเดิม
cp /path/to/old/.env .env
# รอ db healthy (volume ใหม่ใช้ POSTGRES_PASSWORD จาก .env นี้)
docker compose up -d --wait db
docker compose exec -T db psql -U kubstake -d kubstake -v ON_ERROR_STOP=1 < kubstake-YYYYMMDD-HHMM.sql
# migrate apply เฉพาะ migration ที่ dump ยังไม่มี
docker compose up -d --build
```

> ⚠️ `docker compose down -v` **ลบ volume = ลบข้อมูลทั้งหมด** (รวม key ที่เข้ารหัส) — ใช้ `docker compose down` (ไม่มี `-v`) เมื่อแค่จะหยุดระบบ

---

## 7. อัปเดตเวอร์ชัน

แนะนำให้สำรอง DB ก่อนอัปเดต:

```bash
docker compose exec -T db pg_dump -U kubstake -d kubstake --clean --if-exists --no-owner > before-update.sql
chmod 600 before-update.sql
```

**ตรวจด้วย `ls -l before-update.sql` ว่าไฟล์ไม่ใช่ 0 byte ก่อนไปต่อ** เพราะถ้า `pg_dump` ล้ม `chmod` ยังสำเร็จ จากนั้นอัปเดต:

```bash
git pull
docker compose up -d --build
docker compose ps -a
```

`docker compose ps -a` ควรเห็น migrate = Exited (0), web/worker = healthy

- `migrate` รันเองทุกครั้งก่อน web/worker (`depends_on: service_completed_successfully`) และ apply เฉพาะ migration ใหม่
- เช็คว่า `.env.example` มีตัวแปรใหม่ไหม: `diff <(grep -o '^[A-Z_]*' .env.example) <(grep -o '^[A-Z_]*' .env)`
- ค่า seed ของหน้าตั้งค่า (`GAS_RESERVE_KUB` … `VALIDATOR_SYNC_SEC`) มีผลเฉพาะครั้งแรก — หลังจากนั้นแก้ที่หน้า **ตั้งค่า** ในเว็บ
- ลบ image เก่า: `docker image prune`

### อัปเกรดจากรุ่นที่ตั้งรหัสด้วย `ADMIN_PASSWORD`

รหัสผู้ดูแลย้ายจาก `.env` ไปเก็บเป็น argon2id hash ในตาราง `admin_credentials` แล้ว และรุ่นนี้ไม่อ่าน `ADMIN_PASSWORD` อีก

- **ต้องตั้งรหัสใหม่ทันทีหลังอัปเกรด**: `/` และ `/login` จะพาไป `/setup` และ session เดิมหลุดทั้งหมด ระหว่างที่ยังไม่ตั้ง ใครเข้า `/setup` ก่อนจะได้สิทธิ์ผู้ดูแล → ถ้าเปิดเว็บผ่าน reverse proxy / tunnel ให้ปิดก่อนอัปเกรด แล้วตั้งรหัสจาก `127.0.0.1` หรือ SSH tunnel
- **ลบบรรทัด `ADMIN_PASSWORD` เดิมออกจาก `.env`**: ค่านี้ไม่มีผลแล้ว จึงไม่ควรเก็บรหัสเก่าค้างไว้ในไฟล์
- **restore dump กลับรหัสตาม dump ด้วย**: dump ที่ทำหลังตั้งรหัส → รหัสกลับเป็นรหัส ณ ตอนทำ dump · dump ที่ทำก่อนอัปเกรดไม่มีตารางนี้ จึงไม่มี migration `0001` ในประวัติ → `migrate` จะ apply `0001` ให้ · restore ทับ DB ที่ตั้งรหัสแล้ว รหัสปัจจุบันยังอยู่ แต่ restore ลงเครื่องใหม่จะเข้า `/setup`

---

## 8. Troubleshooting

ดู log: `docker compose logs <service> --tail 100` (service = `db` / `migrate` / `web` / `worker`) · log ของ worker เป็น JSON (pino) อ่านง่ายขึ้นด้วย:

```bash
docker compose logs -f --no-log-prefix worker | npx pino-pretty
```

(ต้องมี `--no-log-prefix` ไม่งั้น prefix `worker-1 |` ทำให้ pino-pretty แปลงไม่ได้; ต้องมี Node บน host)

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `docker compose up` หยุดทันทีพร้อม "ยังไม่ได้ตั้ง POSTGRES_PASSWORD ใน .env" (หรือ `MASTER_KEY` / `SESSION_SECRET`) | ยังไม่ได้ตั้งค่าลับ → `bash scripts/gen-secrets.sh` |
| `service "migrate" didn't complete successfully` — web/worker ไม่ขึ้น | `docker compose logs migrate`: `password authentication failed` → ดูแถว POSTGRES_PASSWORD ด้านล่าง · `invalid settings seed environment` → ค่า seed ผิดช่วง (ช่วงเดียวกับหน้าตั้งค่า: `GAS_RESERVE_KUB` < 0.05, `MAX_GAS_PRICE_GWEI` นอก 1–1000, `MIN_INTERVAL_SEC` < 3600, `CHECK_MIN_SEC` / `CHECK_MAX_SEC` / `VALIDATOR_SYNC_SEC` < 300, ค่าวินาทีเกิน 31536000, `CHECK_MIN_SEC` > `CHECK_MAX_SEC` …) แก้ `.env` แล้ว `docker compose up -d` |
| `POSTGRES_PASSWORD` ถูกเปลี่ยนหลังรันครั้งแรก | ค่านี้มีผลเฉพาะตอนสร้าง volume ครั้งแรก → ใส่ค่าเดิมกลับ **หรือ** ตั้งรหัสใหม่ใน Postgres: `docker compose exec db psql -U kubstake -d kubstake` แล้วพิมพ์ `\password kubstake` (ใส่ค่าใหม่จาก `.env`) → `docker compose up -d` · ใช้เฉพาะตัวอักษร hex/URL-safe (`openssl rand -hex 24`) เพราะอยู่ใน `DATABASE_URL` |
| web restart วน / `docker compose logs web` มี `[web] refusing to start` | `MASTER_KEY` ต้องเป็น base64 ของ 32 bytes, `SESSION_SECRET` ≥ 32 ตัว |
| worker ไม่สด: chip แดง "worker ไม่ตอบสนอง", `/api/health` → `"fresh":false`, ปุ่มกดไม่ได้ | `docker compose ps worker` + `docker compose logs worker --tail 100` ควรเห็น `chainId 96 OK` → `leader lock acquired` → `tick` · ติดที่ `… not ready; retrying` = RPC/DB ยังไม่พร้อม · `another worker holds the leader lock; standing by` = มี worker อีกตัวใช้ DB เดียวกัน · `TICK_INTERVAL_SEC` ต้อง ≤ 30 (เว็บถือว่า stale ที่ 90 วินาที) |
| log มี `-32005` / `Rate limit` | RPC สาธารณะจำกัด burst — worker retry + backoff ให้เอง ถ้าเจอบ่อยลด `RPC_CONCURRENCY=2` (หรือ 1) → `docker compose up -d worker`; อย่ารัน `npm run smoke:mainnet` ถี่ ๆ จาก IP เดียวกัน; จะใช้ RPC อื่นได้ถ้าเป็น chainId 96 |
| `ValidatorShare: delegation is disabled` | เจ้าของ validator ปิดรับ delegate → position เป็น claim-only (claim/undelegate ยังได้) ถ้าอยาก compound ต่อ: undelegate แล้วสร้าง position กับ validator ที่เปิดรับ |
| tx `reverted` / out of gas | ดู tx ในตารางประวัติ (ลิงก์ kubscan) — ระบบใช้ gas limit = max(estimate × 1.25, floor: delegate 260k / claim 140k / undelegate 230k) แล้ว ถ้ายังเกิดให้ดู revert reason ใน `failed: …`; ล้มเหลวแล้วจะ backoff เอง |
| `skipped: insufficient_gas` / `ยอด KUB ไม่พอ` | เติม KUB เข้า wallet: ต้องมี ≥ reserve (0.05) + ค่า gas (~0.01) และสำหรับ 1-tx ต้องมีเพิ่มเท่ากับ reward ที่จะ compound |
| ลืมรหัสผู้ดูแล | `docker compose exec db psql -U kubstake -d kubstake -c "delete from admin_credentials"` แล้วเปิดเว็บ → ระบบพาไป `/setup` ให้ตั้งใหม่ · session เดิมหลุดทั้งหมด, wallet / position ไม่ถูกแตะ · ระหว่างนี้ใครเข้า `/setup` ก่อนจะได้สิทธิ์ผู้ดูแล จึงต้องตั้งให้เสร็จก่อนเปิดออกเครือข่าย ([§2](#อย่า-expose-port-ตรง-ๆ)) |
| `/login` หรือ `/setup` ขึ้น "ระบบยังไม่พร้อม" / `/` พาไป `/login` ทั้งที่เข้าสู่ระบบอยู่ | web อ่านฐานข้อมูลไม่ได้: `docker compose ps -a` (`db` ต้อง healthy, `migrate` ต้อง Exited (0)) และ `docker compose logs web --tail 50` (ดู `[auth] reading admin credential failed`) · ระหว่างนี้ login ไม่ได้และ `/setup` ไม่แสดงฟอร์ม · เมื่อ DB กลับมาให้รีเฟรช session เดิมใช้ต่อได้ · ถ้า `db` healthy แล้วแต่รีเฟรชยังขึ้นเหมือนเดิม ให้ `docker compose restart web` |
| login ไม่ได้ "ใส่รหัสผ่านผิดเกิน 5 ครั้งใน 15 นาที — กรุณารอ…" | รอ 15 นาที หรือ `docker compose exec db psql -U kubstake -d kubstake -c "delete from login_attempts where success=false"` · ถ้าเข้าผ่าน docker port mapping ตรง ๆ ทุก browser บน host นับเป็น IP เดียว (docker bridge) จึงโดนล็อกพร้อมกัน ([§2](#อย่า-expose-port-ตรง-ๆ)) |
| `port is already allocated` / port 3000 ไม่ว่าง | ตั้ง `WEB_PORT=3100` ใน `.env` → `docker compose up -d web` → <http://127.0.0.1:3100> |
| หน้า Validators ว่าง / ไม่มีชื่อ | worker sync ครั้งแรกหลัง start (RPC ช้า/rate limit อาจใช้ ~1 นาที) กด "รีเฟรชรายชื่อ" · subgraph ล่มแค่ไม่มีชื่อ (แสดง `#id`) ระบบยังทำงาน |
| balance ขึ้น "รอ worker" | worker อัปเดต balance ทุก tick (≤ `TICK_INTERVAL_SEC`) — ถ้าไม่ขึ้นดูแถว worker ไม่สด |
| หลัง proxy กดปุ่มแล้ว error "Invalid Server Actions request" | proxy ต้องส่ง `Host` เดิมของ browser ต่อ (nginx `proxy_set_header Host $host;`) |
| `docker compose stop` แล้ว web exit 143 | ปกติ (SIGTERM) ไม่ใช่ error |
| อยากรัน 2 ชุดบนเครื่องเดียว | compose project ถูกตั้งชื่อ `kubstake` ไว้ → ชุดที่สองใช้ `docker compose -p kubstake2 …` + `WEB_PORT` อื่น |

ตรวจฐานข้อมูลตรง ๆ: `docker compose exec db psql -U kubstake -d kubstake` (เช่น `select id, type, status, error from actions order by created_at desc limit 10;`)

---

## 9. Development

ต้องมี Node ≥ 26 + npm (ไม่มี corepack/pnpm/yarn), Docker (สำหรับ Postgres)

```bash
npm install

# Postgres สำหรับ dev (port 55432 บน localhost เท่านั้น)
docker run -d --name kubstake-devdb -e POSTGRES_PASSWORD=dev -p 127.0.0.1:55432:5432 postgres:18-alpine

# env สำหรับ dev — .env.dev ถูก ignore ทั้ง git และ docker แล้ว
cat > .env.dev <<EOF
DATABASE_URL=postgres://postgres:dev@127.0.0.1:55432/postgres
MASTER_KEY=$(openssl rand -base64 32)
SESSION_SECRET=$(openssl rand -base64 48)
DRY_RUN=true
EOF
# ทำในทุก terminal (web กับ worker ต้องใช้ MASTER_KEY เดียวกัน)
set -a; . ./.env.dev; set +a

# migration + seed app_settings
npm run migrate -w @kubstake/worker
# terminal 1 → http://localhost:3000 (PORT=3100 npm run dev:web ถ้า 3000 ไม่ว่าง)
npm run dev:web
# terminal 2 (tsx watch)
npm run dev:worker | npx pino-pretty
```

`next dev` ไม่อ่าน `.env` ที่ root (อ่านเฉพาะใน `apps/web`) จึงใช้ `set -a; . ./.env.dev` แทน · เปิดเว็บครั้งแรกจะเข้า `/setup` ให้ตั้งรหัสของ DB dev · **ห้ามตั้ง `DRY_RUN=false` ตอน dev กับ RPC mainnet** · ลบ DB dev: `docker rm -f kubstake-devdb`

| คำสั่ง (จาก root) | ทำอะไร |
|---|---|
| `npm run typecheck` | `tsc --noEmit` ทุก workspace (web = `next typegen && tsc --noEmit`) |
| `npm run lint` | ESLint 9 (root config + config ของ web) |
| `npm test` | vitest (`packages/**/*.test.ts`, `apps/worker/**/*.test.ts`) — เฉพาะ package: `npx vitest run packages/core` |
| `npm run build` | `next build` (standalone) + esbuild bundle worker → `apps/worker/dist/{worker,migrate,healthcheck}.cjs` |
| `npm run db:generate -- --name <tag>` | หลังแก้ `packages/db/src/schema.ts` → สร้าง SQL migration ใน `packages/db/drizzle/` (commit ด้วย) |
| `npm run smoke:mainnet` | ทดสอบกับ mainnet แบบ **read-only** (chainId, block, gas price, รายชื่อ validator) ไม่ใช้ key ไม่ส่ง tx — RPC มี rate limit อย่ารันถี่ |
| `npm run e2e:fork` | (optional, แนะนำก่อนเปิดใช้จริง) e2e ของ path ส่ง tx จริงบน **anvil fork ของ mainnet** — ดูด้านล่าง |

**`npm run e2e:fork`** (= `bash scripts/e2e-fork.sh`, ~45 วินาทีไม่รวม pull/build ครั้งแรก) — ต้องมี Docker + `npm install` ที่ root + internet (anvil อ่าน state จาก `https://rpc.kubchain.io` แบบ read-only; tx ทั้งหมดรันใน anvil ไม่ถูกส่งออกไป)
- รัน worker จริงด้วย `DRY_RUN=false` กับ **anvil fork ของ KUB mainnet** (chainId 96) ใน compose project แยก `kubstake-e2e` (volume/network/env ของตัวเอง, ลบทิ้งเมื่อจบ) ใช้ key ใหม่ที่สร้างทิ้ง (throwaway) เติมเงินเฉพาะบน fork (`anvil_setBalance`) → **ไม่แตะเงินจริง ไม่แตะ `.env` และ volume `kubstake_pgdata` ของคุณ**
- flow: delegate → ฉีด reward บน fork → compound now → auto-compound โดย engine → claim → undelegate ทั้งหมด แล้วตรวจ tx/receipt/event/DB/balance ทุก wei → จบด้วย `E2E OK`
- ครั้งแรกจะ pull `ghcr.io/foundry-rs/foundry:v1.5.1` (~585 MB) และ build image `kubstake-worker:e2e`
- knobs: `E2E_ANVIL_PORT` (18545) / `E2E_DB_PORT` (15432) — bind `127.0.0.1` เท่านั้น · `E2E_SKIP_BUILD=1` (ใช้ image เดิม) · `E2E_KEEP=1` (ไม่ลบ stack ไว้ debug — script พิมพ์คำสั่ง clean-up ให้)
- gas ที่วัดได้บน fork ใช้กฎของ anvil (Prague, base fee ~1 gwei) ไม่เท่ากับ mainnet — ใช้ยืนยันความถูกต้อง ไม่ใช่ประมาณค่า gas

**Gotchas / conventions**
- `next dev` + Playwright (MCP) อาจ **reload วนไม่จบ** เพราะ `.playwright-mcp/` ถูกเขียนใน Turbopack root (= repo root) → ทดสอบ browser กับ standalone build หรือ compose แทน:
  ```bash
  npm run build -w @kubstake/web
  cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
  cp -r apps/web/public apps/web/.next/standalone/apps/web/public
  PORT=3100 node apps/web/.next/standalone/apps/web/server.js
  ```
- ทุก page/server action ใต้ `(app)` ต้องเรียก `await requireSession()` บรรทัดแรก (ไม่อยู่ใน try/catch; `/login` และ `/setup` อยู่นอก group นี้และป้องกันในตัวเอง); mutation ทำได้แค่ enqueue แถวใน `actions`
- `decryptPrivateKey` ใช้ได้เฉพาะใน `apps/worker` และ `packages/core` — web ห้าม import, ห้าม select `wallets.encrypted_key`
- `"use client"` component ต้อง import จาก `@kubstake/core/browser` (ตัว `index` ดึง `node:crypto`)
- จำนวนเงินเป็น wei `bigint` ↔ `numeric(78,0)` เสมอ แสดงผลด้วย `formatKub` (ไม่ใช้ float)
- ฟอนต์ Anuphan Variable bundle ผ่าน `@fontsource-variable/anuphan` (OFL) — build ไม่ต้องใช้เน็ตเพื่อโหลดฟอนต์จากภายนอก (ไฟล์ woff2 มากับ package ที่ติดตั้งจาก lockfile)
- theme ใช้ cookie + CSS `prefers-color-scheme` ไม่มี inline script — server อ่าน cookie `theme` (whitelist ด้วย `parseTheme`) แล้วใส่ class บน `<html>` จึงไม่กระพริบตอนโหลด

---

## 10. โครงสร้าง repo + Environment variables

```
.
├── apps/
│   ├── web/                      Next.js 16 (App Router, server actions, output: standalone)
│   │   └── src/
│   │       ├── app/login/                  หน้า login
│   │       ├── app/setup/                  ตั้งรหัสผู้ดูแลครั้งแรก (เปิดเฉพาะตอนยังไม่มีรหัส)
│   │       ├── app/(app)/page.tsx          แดชบอร์ด
│   │       ├── app/(app)/wallets/          กระเป๋า: เพิ่ม (encrypt key) / ลบ
│   │       ├── app/(app)/validators/       รายชื่อ validator + รีเฟรช
│   │       ├── app/(app)/positions/        new + [id]: delegate/undelegate/claim/compound, trigger mode, ประวัติ
│   │       ├── app/(app)/settings/         ค่ากลางของ engine + ข้อมูล worker + เปลี่ยนรหัสผ่าน
│   │       ├── app/api/health/route.ts     GET /api/health (ไม่ต้อง login, ใช้กับ healthcheck)
│   │       ├── lib/                        env, db, session, auth (รหัสผู้ดูแล, login rate limit), format, worker status
│   │       └── proxy.ts                    gate เบื้องต้น → /login
│   └── worker/src/               worker.ts (entry), tick.ts, engine.ts (compound), executor.ts (actions),
│                                 txManager.ts (sign → persist → broadcast → receipt), validatorSync.ts,
│                                 wallets.ts, keys.ts (decrypt), lock.ts (leader lock), migrate.ts, healthcheck.ts
├── packages/
│   ├── core/                     env (zod), crypto (AES-256-GCM), chain (viem client, ABIs, validator discovery,
│   │                             tx encode, events), compound (R* math, cron schedule, decideCompound), format
│   │                             + scripts/smoke-mainnet.ts
│   └── db/                       Drizzle schema + wei column + repo helpers; drizzle/ = SQL migrations
├── scripts/gen-secrets.sh        เติมค่าลับที่ว่างใน .env
├── Dockerfile                    targets: web, worker (image worker ใช้รัน migrate + healthcheck ด้วย)
├── docker-compose.yml            services: db, migrate, web, worker · volume pgdata
├── .env.example                  ตัวแปรทั้งหมดพร้อมคำอธิบาย
└── tasks/                        แผนงาน/บันทึกการพัฒนา (ไม่เข้า image)
```

ตารางใน DB: `wallets`, `validators`, `positions`, `actions`, `txs`, `position_snapshots`, `app_settings`, `worker_heartbeat`, `login_attempts`, `admin_credentials`

### Environment variables (`.env`)

ค่าว่าง (`VAR=`) = ใช้ default (ยกเว้น `SUBGRAPH_URL` ที่ค่าว่าง = ปิด) · `DATABASE_URL` ไม่ต้องตั้ง — compose ประกอบให้เป็น `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}` · แก้ค่าแล้ว `docker compose up -d` (recreate เฉพาะ service ที่เปลี่ยน)

| Variable | Default | จำเป็น | ใช้โดย | คำอธิบาย |
|---|---|---|---|---|
| `POSTGRES_USER` | `kubstake` | | db, migrate, web, worker | ชื่อผู้ใช้ Postgres |
| `POSTGRES_DB` | `kubstake` | | db, migrate, web, worker | ชื่อฐานข้อมูล |
| `POSTGRES_PASSWORD` | — | ✅ | db, migrate, web, worker | รหัส DB (`openssl rand -hex 24`, hex/URL-safe) — มีผลเฉพาะตอนสร้าง volume ครั้งแรก |
| `MASTER_KEY` | — | ✅ | web (encrypt), worker (decrypt) | base64 ของ 32 bytes (`openssl rand -base64 32`) — สำรองแยก, ห้ามเปลี่ยนหลังเพิ่ม wallet |
| `SESSION_SECRET` | — | ✅ | web | กุญแจ session cookie ≥ 32 ตัว (`openssl rand -base64 48`) |
| `WEB_BIND` | `127.0.0.1` | | compose (ports) | IP บน host ที่ bind port เว็บ — คงไว้ `127.0.0.1` (ดู §5) |
| `WEB_PORT` | `3000` | | compose (ports) | port บน host ของหน้าเว็บ |
| `COOKIE_SECURE` | `false` | | web | `true` เมื่อเข้าผ่าน HTTPS (reverse proxy / Tailscale / Cloudflare) |
| `SESSION_TTL_SEC` | `43200` | | web | อายุ session (วินาที, ≥ 60) ค่าเริ่มต้น 12 ชม. |
| `EXPLORER_URL` | `https://www.kubscan.com` | | web | ฐาน URL ลิงก์ tx/address |
| `RPC_URL` | `https://rpc.kubchain.io` | | worker | KUB mainnet RPC (web ไม่เรียก RPC) |
| `CHAIN_ID` | `96` | | worker | ต้องเป็น `96` เท่านั้น — ค่าอื่น worker ไม่ยอมเริ่ม |
| `SUBGRAPH_URL` | `https://gateway.bitkubgraph.io/subgraphs/name/bitkubchain/pos` | | worker | ชื่อ/โลโก้ validator (best-effort) — ค่าว่าง = ปิด |
| `APP_TIMEZONE` | `Asia/Bangkok` | | worker (cron), web (แสดงเวลา), migrate | IANA timezone ของโหมด schedule และเวลาในเว็บ |
| `TZ` | `Asia/Bangkok` | | ทุก container | timezone ของระบบ/log — ปกติตั้งตรงกับ `APP_TIMEZONE` |
| `DRY_RUN` | `true` | | worker | `true` = simulate เท่านั้น; `false` = ส่ง tx จริงบน mainnet |
| `TICK_INTERVAL_SEC` | `30` | | worker | รอบ tick (5–3600) — **ควร ≤ 30** เพราะเว็บถือว่า worker stale ที่ 90 วินาที |
| `RPC_CONCURRENCY` | `4` | | worker | RPC request พร้อมกันสูงสุด (1–4) — ลดถ้าโดน `-32005` บ่อย |
| `LOG_LEVEL` | `info` | | worker | `fatal` / `error` / `warn` / `info` / `debug` / `trace` / `silent` |
| `GAS_RESERVE_KUB` | `0.05` | | seed `app_settings` | KUB ที่กันไว้เป็นค่า gas เสมอ (≥ 0.05) |
| `MAX_GAS_PRICE_GWEI` | `50` | | seed `app_settings` | gas price สูงสุดที่ auto-compound ยอมส่ง (1–1000) |
| `MIN_INTERVAL_SEC` | `3600` | | seed `app_settings` | ระยะห่างขั้นต่ำระหว่าง auto-compound ของ position เดียวกัน (≥ 3600) |
| `R_FLOOR_KUB` | `0.5` | | seed `app_settings` | reward ขั้นต่ำของโหมด optimal: trigger ที่ max(R\*, ค่านี้) |
| `CHECK_MIN_SEC` | `900` | | seed `app_settings` | ตรวจ position ถี่สุด (วินาที, ≥ 300; ≤ `CHECK_MAX_SEC`) |
| `CHECK_MAX_SEC` | `21600` | | seed `app_settings` | ตรวจ position ห่างสุด (วินาที, ≥ 300) — next check = clamp(ETA/4, min, max) |
| `VALIDATOR_SYNC_SEC` | `1800` | | seed `app_settings` | ซิงก์รายชื่อ validator ทุก ๆ (วินาที, ≥ 300) |

ตัวแปร "seed `app_settings`" ส่งให้ทั้ง `migrate` และ `worker` (ช่วงค่าที่รับได้ตรงกับหน้า **ตั้งค่า** ทุกตัว ค่าวินาทีไม่เกิน 31536000 = 365 วัน) แต่ **มีผลเฉพาะครั้งแรก** (ตอนสร้างแถว `app_settings`) — หลังจากนั้นแก้ที่หน้า **ตั้งค่า** ในเว็บ (มีผลในรอบถัดไปของ worker)
