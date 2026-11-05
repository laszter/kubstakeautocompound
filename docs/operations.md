# คู่มือดูแลระบบ

รวมขั้นตอนหลังติดตั้ง ถ้ายังไม่เคยติดตั้งให้เริ่มที่ [README](../README.md)

- [ติดตั้งด้วย docker compose โดยตรง](#ติดตั้งด้วย-docker-compose-โดยตรง)
- [การใช้งานหน้าเว็บโดยละเอียด](#การใช้งานหน้าเว็บโดยละเอียด)
- [ก่อนเติมเงินจริง](#ก่อนเติมเงินจริง-go-live-checklist)
- [เปิดให้เข้าจากที่อื่นอย่างปลอดภัย](#เปิดให้เข้าจากที่อื่นอย่างปลอดภัย)
- [Backup / Restore](#backup--restore)
- [อัปเดตเวอร์ชัน](#อัปเดตเวอร์ชัน)
- [Troubleshooting](#troubleshooting)

## ติดตั้งด้วย docker compose โดยตรง

`bash scripts/start.sh` ทำขั้นตอนเหล่านี้ให้อยู่แล้ว ใช้หัวข้อนี้เมื่ออยากทำเองทีละขั้น

ต้องมี: Docker Engine + Docker Compose v2 (`docker compose`), `bash`, `openssl`, internet (build ต้อง `npm ci`, runtime ต้องต่อ RPC), พื้นที่ว่าง ~1 GB สำหรับ images

### 1) Clone + ตั้งค่า

```bash
git clone https://github.com/laszter/kubstakeautocompound.git kubstake && cd kubstake
cp .env.example .env
bash scripts/gen-secrets.sh
```

`gen-secrets.sh` เติมเฉพาะค่าที่ยังว่าง (รันซ้ำได้ ไม่เขียนทับ): `POSTGRES_PASSWORD`, `MASTER_KEY`, `SESSION_SECRET` แล้ว **สำรอง `MASTER_KEY` ทันที** · รหัสผู้ดูแลไม่อยู่ใน `.env`: ตั้งที่หน้าเว็บตอนเข้าครั้งแรก

หรือสร้างเองแล้วใส่ใน `.env`:

```bash
# POSTGRES_PASSWORD (hex เท่านั้น — อยู่ใน DATABASE_URL)
openssl rand -hex 24
# MASTER_KEY (base64 ของ 32 bytes)
openssl rand -base64 32
# SESSION_SECRET (≥ 32 ตัวอักษร)
openssl rand -base64 48
```

ถ้า port 3000 ถูกใช้อยู่ให้ตั้ง `WEB_PORT=3100` (หรือ port อื่น)

### 2) Start

```bash
docker compose up -d --build
docker compose ps -a
# {"ok":true,"db":"ok","worker":{...,"fresh":true}}
curl -fsS http://127.0.0.1:3000/api/health
# ควรเห็น "chainId 96 OK", "leader lock acquired", "validator sync n=…"
docker compose logs worker --tail 50
```

`docker compose ps -a` ควรเห็น migrate = Exited (0), db/web/worker = Up (healthy)

build ครั้งแรกใช้เวลาหลายนาที, `worker.fresh` เป็น `true` ภายใน ~90 วินาทีหลัง start

## การใช้งานหน้าเว็บโดยละเอียด

เปิด <http://127.0.0.1:3000>

1. **ตั้งรหัสผู้ดูแล**: เข้าครั้งแรกระบบพาไปหน้า `/setup` ให้ตั้งรหัสเอง (8–1024 ตัวอักษร ไม่บังคับชนิดตัวอักษร ช่องว่างนับรวมด้วย) ตั้งเสร็จเข้าสู่ระบบทันที → แดชบอร์ด: header มี chip เขียว "worker ทำงาน" (จอกว้างไม่ถึง 640px แสดงแค่ "ทำงาน")
   - ครั้งต่อไปกรอกรหัสนี้ที่ `/login` · เปลี่ยนรหัสได้ที่หน้า **ตั้งค่า** (อุปกรณ์อื่นที่เข้าสู่ระบบไว้จะถูกออกจากระบบ) · ลืมรหัสดู [Troubleshooting](#troubleshooting)
2. **กระเป๋า** → เพิ่ม wallet: ตั้งชื่อ (label) + วาง private key → เห็น address ทันที, balance ขึ้นภายใน ~30 วินาที (worker sync ให้)
3. **Validators** → รายชื่อแบบการ์ด สลับเป็นตารางได้ด้วยปุ่มมุมมองหรือ `/validators?view=list` (จอกว้างตั้งแต่ 768px; จอเล็กกว่านั้นแสดงการ์ดเสมอ) · worker sync ครั้งแรกตอน start; กด "รีเฟรชรายชื่อ" ได้ → กด **Delegate** ที่ validator ที่เปิดรับ
4. **สร้าง position**: เลือก wallet + validator + จำนวน KUB เริ่มต้น (ไม่บังคับ; ครั้งแรกต้อง ≥ `minDelegated` ของ validator และ ≤ balance − reserve − ค่า gas) → ระบบ enqueue `delegate` ให้
   - ถ้า wallet นี้ delegate validator นี้ไว้แล้วจากที่อื่น ให้เว้นจำนวนว่าง — worker อ่าน principal/pending จาก chain เอง
5. **หน้า position**: เลือก trigger mode (`optimal` / `threshold` / `schedule`), เปิด/ปิด auto-compound, ดู R\* + ETA, next check / next run, ผลรอบล่าสุด, ประวัติ tx; มีปุ่ม delegate / undelegate (มี "ถอนทั้งหมด") / claim / compound now
6. **ทุกคำสั่งใช้เงินจริง**: เริ่มจาก delegate จำนวนน้อยแล้วเช็ค tx ใน kubscan ก่อน

> ปุ่มทุกปุ่มจะ disabled / ถูกปฏิเสธเมื่อ worker ไม่สด (ไม่ได้ tick เกิน 90 วินาที) เพราะไม่มีใครทำคำสั่งให้

- **ธีม**: ปุ่มธีม (สว่าง / มืด / ตามระบบ) อยู่มุมขวาของ header และมุมขวาบนของหน้า login — จอกว้างไม่ถึง 1024px (รวมมือถือ) ปุ่มใน header ย้ายไปอยู่ในเมนู hamburger ส่วนหน้า login ยังอยู่มุมขวาบน · ค่าเก็บใน cookie `theme` (ไม่ใช่ข้อมูลลับ) ค่าเริ่มต้นตามระบบปฏิบัติการ

## ก่อนเติมเงินจริง (go-live checklist)

1. **สำรอง `MASTER_KEY`** ไว้ใน password manager / offline คนละที่กับ backup DB ([อ่านเพิ่ม](security.md#master_key--สำรองแยกจาก-backup-ฐานข้อมูล)) — หาย = key ใน DB กู้ไม่ได้
2. **เติมเงิน hot wallet เท่าที่จำเป็น**: จำนวนที่จะ stake + เงินลอยในกระเป๋า **≥ R\* + 0.05 KUB (reserve) + ค่า gas (~0.01)** (R\* ของแต่ละ position ดูได้ในหน้า position) — compound แบบ 1-tx ต้องจ่าย `delegate{value: pending}` จากกระเป๋าก่อน (contract คืน reward ใน tx เดียวกัน) ถ้าเงินลอยไม่พอระบบจะใช้ 2-tx ที่แพงกว่า
3. (optional) **`npm run e2e:fork`** — ทดสอบ path ส่ง tx จริงบน anvil fork (ไม่ใช้เงินจริง, ไม่แตะ `.env`/volume ของคุณ — ดู [คู่มือนักพัฒนา](development.md#คำสั่งที่ใช้บ่อย))
4. ตรวจ log ของ worker ด้วย `docker compose logs worker --tail 20` — ต้องมี `the worker WILL sign and broadcast real transactions to rpc.kubchain.io (chainId 96)`
5. **ดู compound แรก** ในหน้า position (ประวัติ tx + ลิงก์ kubscan) และ log: `docker compose logs -f --no-log-prefix worker | npx pino-pretty` — เริ่มจากจำนวนน้อยก่อน

## เปิดให้เข้าจากที่อื่นอย่างปลอดภัย

หลักการ: **คง `WEB_BIND=127.0.0.1`** แล้วให้ตัวกลางที่มี TLS/การยืนยันตัวตนบนเครื่องเดียวกันต่อเข้า `127.0.0.1:${WEB_PORT}` — ห้าม publish port 3000 ตรงสู่ internet · **ตั้งรหัสผู้ดูแลให้เสร็จก่อนเปิดตัวกลาง** ([อ่านเหตุผล](security.md#อย่า-expose-port-ตรง-ๆ))

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

## Backup / Restore

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
git clone https://github.com/laszter/kubstakeautocompound.git kubstake && cd kubstake
# MASTER_KEY ต้องเป็นค่าเดิม
cp /path/to/old/.env .env
# รอ db healthy (volume ใหม่ใช้ POSTGRES_PASSWORD จาก .env นี้)
docker compose up -d --wait db
docker compose exec -T db psql -U kubstake -d kubstake -v ON_ERROR_STOP=1 < kubstake-YYYYMMDD-HHMM.sql
# migrate apply เฉพาะ migration ที่ dump ยังไม่มี
docker compose up -d --build
```

> ⚠️ `docker compose down -v` **ลบ volume = ลบข้อมูลทั้งหมด** (รวม key ที่เข้ารหัส) — ใช้ `docker compose down` (ไม่มี `-v`) เมื่อแค่จะหยุดระบบ

## อัปเดตเวอร์ชัน

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

## Troubleshooting

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
| ลืมรหัสผู้ดูแล | `docker compose exec db psql -U kubstake -d kubstake -c "delete from admin_credentials"` แล้วเปิดเว็บ → ระบบพาไป `/setup` ให้ตั้งใหม่ · session เดิมหลุดทั้งหมด, wallet / position ไม่ถูกแตะ · ระหว่างนี้ใครเข้า `/setup` ก่อนจะได้สิทธิ์ผู้ดูแล จึงต้องตั้งให้เสร็จก่อนเปิดออกเครือข่าย ([อ่านเหตุผล](security.md#อย่า-expose-port-ตรง-ๆ)) |
| `/login` หรือ `/setup` ขึ้น "ระบบยังไม่พร้อม" / `/` พาไป `/login` ทั้งที่เข้าสู่ระบบอยู่ | web อ่านฐานข้อมูลไม่ได้: `docker compose ps -a` (`db` ต้อง healthy, `migrate` ต้อง Exited (0)) และ `docker compose logs web --tail 50` (ดู `[auth] reading admin credential failed`) · ระหว่างนี้ login ไม่ได้และ `/setup` ไม่แสดงฟอร์ม · เมื่อ DB กลับมาให้รีเฟรช session เดิมใช้ต่อได้ · ถ้า `db` healthy แล้วแต่รีเฟรชยังขึ้นเหมือนเดิม ให้ `docker compose restart web` |
| login ไม่ได้ "ใส่รหัสผ่านผิดเกิน 5 ครั้งใน 15 นาที — กรุณารอ…" | รอ 15 นาที หรือ `docker compose exec db psql -U kubstake -d kubstake -c "delete from login_attempts where success=false"` · ถ้าเข้าผ่าน docker port mapping ตรง ๆ ทุก browser บน host นับเป็น IP เดียว (docker bridge) จึงโดนล็อกพร้อมกัน ([อ่านเหตุผล](security.md#อย่า-expose-port-ตรง-ๆ)) |
| `port is already allocated` / port 3000 ไม่ว่าง | ตั้ง `WEB_PORT=3100` ใน `.env` → `docker compose up -d web` → <http://127.0.0.1:3100> |
| หน้า Validators ว่าง / ไม่มีชื่อ | worker sync ครั้งแรกหลัง start (RPC ช้า/rate limit อาจใช้ ~1 นาที) กด "รีเฟรชรายชื่อ" · subgraph ล่มแค่ไม่มีชื่อ (แสดง `#id`) ระบบยังทำงาน |
| balance ขึ้น "รอ worker" | worker อัปเดต balance ทุก tick (≤ `TICK_INTERVAL_SEC`) — ถ้าไม่ขึ้นดูแถว worker ไม่สด |
| หลัง proxy กดปุ่มแล้ว error "Invalid Server Actions request" | proxy ต้องส่ง `Host` เดิมของ browser ต่อ (nginx `proxy_set_header Host $host;`) |
| `docker compose stop` แล้ว web exit 143 | ปกติ (SIGTERM) ไม่ใช่ error |
| อยากรัน 2 ชุดบนเครื่องเดียว | compose project ถูกตั้งชื่อ `kubstake` ไว้ → ชุดที่สองใช้ `docker compose -p kubstake2 …` + `WEB_PORT` อื่น |

ตรวจฐานข้อมูลตรง ๆ: `docker compose exec db psql -U kubstake -d kubstake` (เช่น `select id, type, status, error from actions order by created_at desc limit 10;`)
