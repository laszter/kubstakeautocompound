# คู่มือนักพัฒนา

## Architecture

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

## ตั้งค่าเครื่องสำหรับพัฒนา

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

`next dev` ไม่อ่าน `.env` ที่ root (อ่านเฉพาะใน `apps/web`) จึงใช้ `set -a; . ./.env.dev` แทน · เปิดเว็บครั้งแรกจะเข้า `/setup` ให้ตั้งรหัสของ DB dev · **`npm run dev:worker` ส่ง tx จริงบน mainnet (RPC ค่าเริ่มต้น) — ตอน dev ใช้เฉพาะ key ที่ไม่มีเงิน** · ลบ DB dev: `docker rm -f kubstake-devdb`

## คำสั่งที่ใช้บ่อย

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
- รัน worker จริงกับ **anvil fork ของ KUB mainnet** (chainId 96) ใน compose project แยก `kubstake-e2e` (volume/network/env ของตัวเอง, ลบทิ้งเมื่อจบ) ใช้ key ใหม่ที่สร้างทิ้ง (throwaway) เติมเงินเฉพาะบน fork (`anvil_setBalance`) → **ไม่แตะเงินจริง ไม่แตะ `.env` และ volume `kubstake_pgdata` ของคุณ**
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

## โครงสร้าง repo

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
├── docs/                         คู่มือ: ความปลอดภัย, auto-compound, ดูแลระบบ, นักพัฒนา
├── scripts/start.sh              เริ่มระบบด้วยคำสั่งเดียว
├── scripts/gen-secrets.sh        เติมค่าลับที่ว่างใน .env
├── Dockerfile                    targets: web, worker (image worker ใช้รัน migrate + healthcheck ด้วย)
├── docker-compose.yml            services: db, migrate, web, worker · volume pgdata
├── .env.example                  ตัวแปรทั้งหมดพร้อมคำอธิบาย
└── tasks/                        แผนงาน/บันทึกการพัฒนา (ไม่เข้า image)
```

ตารางใน DB: `wallets`, `validators`, `positions`, `actions`, `txs`, `position_snapshots`, `app_settings`, `worker_heartbeat`, `login_attempts`, `admin_credentials`

## Environment variables

ค่าว่าง (`VAR=`) = ใช้ default (ยกเว้น `SUBGRAPH_URL` ที่ค่าว่าง = ปิด) · `DATABASE_URL` ไม่ต้องตั้ง — compose ประกอบให้เป็น `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}` · แก้ค่าแล้ว `docker compose up -d` (recreate เฉพาะ service ที่เปลี่ยน)

| Variable | Default | จำเป็น | ใช้โดย | คำอธิบาย |
|---|---|---|---|---|
| `POSTGRES_USER` | `kubstake` | | db, migrate, web, worker | ชื่อผู้ใช้ Postgres |
| `POSTGRES_DB` | `kubstake` | | db, migrate, web, worker | ชื่อฐานข้อมูล |
| `POSTGRES_PASSWORD` | — | ✅ | db, migrate, web, worker | รหัส DB (`openssl rand -hex 24`, hex/URL-safe) — มีผลเฉพาะตอนสร้าง volume ครั้งแรก |
| `MASTER_KEY` | — | ✅ | web (encrypt), worker (decrypt) | base64 ของ 32 bytes (`openssl rand -base64 32`) — สำรองแยก, ห้ามเปลี่ยนหลังเพิ่ม wallet |
| `SESSION_SECRET` | — | ✅ | web | กุญแจ session cookie ≥ 32 ตัว (`openssl rand -base64 48`) |
| `WEB_BIND` | `127.0.0.1` | | compose (ports) | IP บน host ที่ bind port เว็บ — คงไว้ `127.0.0.1` (ดู [คู่มือดูแลระบบ](operations.md#เปิดให้เข้าจากที่อื่นอย่างปลอดภัย)) |
| `WEB_PORT` | `3000` | | compose (ports) | port บน host ของหน้าเว็บ |
| `COOKIE_SECURE` | `false` | | web | `true` เมื่อเข้าผ่าน HTTPS (reverse proxy / Tailscale / Cloudflare) |
| `SESSION_TTL_SEC` | `43200` | | web | อายุ session (วินาที, ≥ 60) ค่าเริ่มต้น 12 ชม. |
| `EXPLORER_URL` | `https://www.kubscan.com` | | web | ฐาน URL ลิงก์ tx/address |
| `RPC_URL` | `https://rpc.kubchain.io` | | worker | KUB mainnet RPC (web ไม่เรียก RPC) |
| `CHAIN_ID` | `96` | | worker | ต้องเป็น `96` เท่านั้น — ค่าอื่น worker ไม่ยอมเริ่ม |
| `SUBGRAPH_URL` | `https://gateway.bitkubgraph.io/subgraphs/name/bitkubchain/pos` | | worker | ชื่อ/โลโก้ validator (best-effort) — ค่าว่าง = ปิด |
| `APP_TIMEZONE` | `Asia/Bangkok` | | worker (cron), web (แสดงเวลา), migrate | IANA timezone ของโหมด schedule และเวลาในเว็บ |
| `TZ` | `Asia/Bangkok` | | ทุก container | timezone ของระบบ/log — ปกติตั้งตรงกับ `APP_TIMEZONE` |
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
