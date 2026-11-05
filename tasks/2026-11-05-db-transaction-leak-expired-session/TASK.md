# TASK: ปิด connection รั่วใน `db.transaction` ทุกจุด และแก้หน้า error เมื่อ session หมด

> Status: COMPLETE (user ขอให้ลดขอบเขต QA ข้อที่ไม่ครบระบุไว้ท้ายแต่ละข้อ) · Created 2026-11-05 · Source: user request ("แก้ข้อ 1,2 ต่อเลย")
> Skill: explore-plan-build

## Goal
1. เมื่อ `db` restart ระหว่างมีงาน ทั้ง web และ worker ต้องฟื้นเอง โดยไม่เสีย connection ใน pool ถาวร ไม่ว่าจะเรียก `db.transaction` จากจุดไหน
2. กดปุ่มจากแท็บที่ไม่มี session cookie แล้วต้องไปหน้า `/login` ไม่ใช่หน้า error ภาษาอังกฤษ

## Acceptance criteria
- [x] Web: `db` restart ระหว่างมี load ผ่าน action จริงของ `deleteWallet`, `createPosition`, `enqueueClaim` และ `login` แล้ว slot กลับมาครบ 5 ทุกรอบ (baseline ก่อนแก้ของ `deleteWallet`: ลดจาก 5 เหลือ 0)
- [x] Web: จำนวน `uncaughtException` ใน log ภายใต้ load เดียวกันเป็น 0 ถ้าไม่เป็น 0 ต้องระบุที่มา (baseline: 14 บรรทัดใน 57 รอบ ไม่ทราบที่มา)
- [x] Worker: `db` restart ขณะมี action รอคิวแล้วฟื้นเอง: heartbeat กลับมา fresh, leader lock กลับมา, ไม่มี action ค้าง `running` ถาวร และไม่มีการ broadcast
- [ ] พฤติกรรม transaction ไม่เปลี่ยน: commit แล้ว connection อื่นเห็น, throw แล้ว rollback, nested transaction ของ `createPosition` ที่มีจำนวน ยังทำงาน, `enqueueAction` ขนานได้แถวเดียว, `idle in transaction`=0, advisory lock ไม่ค้าง **(ทดสอบบางส่วน: ไม่ได้รัน `enqueueAction` ขนาน และ rollback เมื่อ connection ตายกลาง `deleteWallet` บน action จริง)**
- [ ] Rate limit ของ login คงเดิม: ขนาน 20, 50, 200 ได้ failure 5 แถว **(ทดสอบบางส่วน: `reserveLoginAttempt` ขนาน 20 ผ่าน harness; 50 และ 200 ถูกตัด)**
- [ ] แท็บที่ไม่มี cookie: กดออกจากระบบ, บันทึกตั้งค่า, เปลี่ยนรหัส, เพิ่มและลบ wallet, ปุ่ม claim/compound, สร้าง position แล้วจบที่ `/login` ไม่มีหน้า error และข้อมูลไม่เปลี่ยน **(ทดสอบบางส่วน: ออกจากระบบ, บันทึกตั้งค่า, ลบ wallet, claim ผ่าน browser; action ทุกตัวผ่าน HTTP 13/13)**
- [ ] ความปลอดภัย: POST ที่ไม่มี cookie พร้อม `Next-Action` ไม่รัน action ที่ต้องมี session และไม่ส่งข้อมูลหน้าที่ต้องมี session กลับมา; GET และ POST ทั่วไปที่ไม่มี cookie ยังถูก redirect **(ทดสอบบางส่วน: ข้อ 1–5 ผ่าน; ยิงขนาน 200 ครั้ง และ `/api/health` ถูกตัด)**
- [x] `npm run typecheck && npm run lint && npm test && npm run build` ผ่าน
- [x] Stack จริงหลัง rebuild: ข้อมูลไม่หาย, `DRY_RUN=true`, ไม่มี agent ตั้งหรือเปลี่ยนรหัส

## Context (จากการสำรวจ code จริง)
**Root cause ของการรั่ว (ยืนยันแล้ว):** `node_modules/drizzle-orm/node-postgres/session.js` รัน `begin` นอก `try` ถ้า `begin` ล้ม `release()` ใน `finally` จะไม่ทำงาน drizzle 0.45.4 เป็นเวอร์ชันล่าสุด หลักฐาน: client ที่รั่วทุกตัวค้างที่ `begin` ดู `ψ/memory/learnings/2026-11-05_drizzle-transaction-บน-pg-pool-รั่ว-slot-เมื่อ-c.md`

**จุดที่ยังเรียก `db.transaction` บน pool (`Db` จาก `createDb`):**
- `apps/web/src/app/(app)/wallets/actions.ts:118` `deleteWallet`
- `apps/web/src/app/(app)/positions/new/actions.ts:103` `createPosition` (ข้างในเรียก `enqueueAction(tx, ...)` จึงเป็น savepoint)
- `packages/db/src/repo/actions.ts:34` `enqueueAction` (รับได้ทั้ง `Db` และ `tx`)
- `apps/worker/src/executor.ts:39` `claimNextAction`
- `packages/db/src/repo/login-attempts.ts:64` `reserveLoginAttempt` (แก้แล้วผ่าน `withDbClient` ใน `apps/web/src/lib/auth.ts`)

**ที่มีอยู่แล้ว:** `withDedicatedClient(pool, fn)` ใน `packages/db/src/client.ts` และ `withDbClient` ใน `apps/web/src/lib/db.ts` QA ยืนยันว่า client ที่ check out ไม่ถูก drizzle นับเป็น pool (`Client` หรือ `Client2` หลัง esbuild) จึงไม่เรียก `release()` ซ้ำ

**ฝั่ง worker (อ่านจาก code, ยังไม่ได้วัด):**
- `apps/worker/src/worker.ts:83` `uncaughtException` และ `unhandledRejection` → `process.exit(1)`; compose ตั้ง `restart: unless-stopped`
- client ที่ check out ไม่มี `error` listener ของ pool ดังนั้น connection ที่ตายอาจทำให้ worker **crash แล้ว restart** มากกว่าค้างเงียบๆ ต้องวัดจริง
- `apps/worker/src/lock.ts` ถือ leader lock บน client เฉพาะ มี `error` listener ของตัวเอง; lock หาย → `startLoop` จบ → รอ 5 วินาที → ขอ lock ใหม่
- `apps/worker/src/worker.ts:106` pool max 5 และไม่มี `connectionTimeoutMillis`; `scheduler.ts` ดัก error ของ tick
- `TICK_INTERVAL_SEC` ต่ำสุด 5 (`packages/core/src/env.ts:122`), `MAX_ACTIONS_PER_TICK`=5, healthcheck ดู heartbeat ไม่เกิน 3 เท่าของ tick

**Baseline ของ worker ก่อนแก้ (T1, วัดจริงบน stack ทดสอบ 138 รอบที่ใช้ได้, `txs`=0, ไม่มี `eth_sendRawTransaction`):**
| สถานการณ์ | รอบ | รอบที่ crash | เวลาฟื้นของ heartbeat (วินาที) |
|---|---|---|---|
| (a) `restart db` คิวว่าง | 10 | 0 | 5.76–10.40 |
| (b) `restart db` มีคิว | 10 | 0 | 6.33–9.60 |
| (b-wide) `restart db` มีคิว ช่วงเวลากว้างขึ้น | 10 | 8 | crash 0.75–1.36, ไม่ crash 6.69–9.29 |
| (c) kill backend ระหว่าง transaction หรือก่อน `begin` (`c-tx`, `c-prebegin`, `p2-tx`, `p2-prebegin`) | 50 | 50 | 0.51–1.46 |
| (d) `pause` 60 วินาที | 3 | 0 | 0.38–0.45 |
| `stop` 30 วินาที | 3 | 0 | 4.77–7.70 |

- รวม crash 70 ครั้ง ทุกครั้งเป็น `uncaught exception` exit code 1 แล้ว Docker เปิดใหม่ ข้อความ: `Connection terminated unexpectedly` 34, `read ECONNRESET` 34, `terminating connection...` 2
- ทุกรอบที่วัดฟื้นเอง ไม่มี action ค้าง `running` ถาวร (ค้างนานสุดราว 10 วินาที) และไม่เห็น pool หมด เพราะ crash ล้าง pool ก่อน slot จะหายสะสม
- **F1 จะเปลี่ยนพฤติกรรมนี้โดยตั้งใจ:** connection ตายแล้ว worker ไม่ crash แต่ query reject และ tick จับ error แทน ดังนั้นต้องปิดการรั่วพร้อมกัน เพราะ crash จะไม่ช่วยล้าง pool แล้ว
- **ค้างเงียบจริงเฉพาะกรณีเดียว (นอกขอบเขตการแก้):** ตัด network โดยไม่มี FIN/RST ขณะ `claimNextAction` มี `UPDATE` ค้าง (`docker network disconnect` แล้ว `restart db`) ticks และ action หยุดนิ่ง, leader lock หาย แต่ pulse ยังอัปเดต heartbeat จึง `healthy` ตลอดอย่างน้อย 603 วินาทีที่วัด ไม่ทราบตอนจบเพราะปิดการวัดก่อน ถ้าตัด network 60 วินาทีโดยไม่มี query ค้าง จะฟื้นเองราว 50 วินาทีหลังต่อกลับ
- log และสรุป: `scratchpad/t1-worker/` (`results.jsonl`, `summarize.py`, `run-e1.log`, `run-e2.log`) ถ้าจะวัดซ้ำ `run.cjs` ใช้เทียบก่อน/หลังได้

**ฝั่ง proxy:**
- `apps/web/src/proxy.ts` เช็กแค่มี cookie ชื่อ session หรือไม่ cookie ปลอมผ่านได้อยู่แล้ว ตัวตรวจจริงคือ `requireSession()`
- ไม่มี cookie: proxy ตอบ 307 กับ POST ของ server action, browser ส่ง POST ซ้ำไป `/login` แล้ว client router ขึ้น `An unexpected response was received from the server.`
- cookie เสียหรือหมดอายุ (ยังมี cookie): `requireSession()` ใน action สั่ง `redirect("/login")` และทำงานถูกต้องอยู่แล้ว (QA ทดสอบแล้ว)
- ตรวจแล้ว: ทุก action ใต้ `(app)` เรียก `requireSession()` เป็นบรรทัดแรก (`settings/actions.ts`, `settings/password-actions.ts`, `positions/new/actions.ts`, `positions/[id]/actions.ts`, `wallets/actions.ts`, `validators/actions.ts`) ส่วน `login`, `logout`, `setupAdmin` เป็น public โดยตั้งใจ และทุก page กับ `(app)/layout.tsx` เรียก `requireSession()` เอง

**Do-not-touch / Gotchas**
- **ห้ามใช้ `query_timeout`:** วัดแล้วทำให้ pool รั่วและ write ที่รายงานว่าสำเร็จไม่ commit จริง ดู `ψ/memory/learnings/2026-11-05_pg-querytimeout-drizzle-dbtransaction-บน-poo-2.md`
- ห้าม patch `node_modules` และห้ามอัปเกรด library
- ห้ามเปลี่ยน logic ของ rate limit, argon2, session, `requireSession`, การ sign หรือ broadcast
- web ห้าม select `wallets.encrypted_key`; private key ผ่าน FormData เท่านั้น

## Design
**F1: แก้ที่จุดเดียวใน `createDb` (`packages/db/src/client.ts`)**
```ts
const pool = new pg.Pool(...);
pool.on("error", ...);                                     // เดิม
pool.on("connect", (client) => client.on("error", ignoreError)); // ใหม่
const db = drizzle(pool, { schema });
db.transaction = (fn, config) => withDedicatedClient(pool, (own) => own.transaction(fn, config));
```
- **ทำไม override จุดเดียว:** ครอบทุก caller และ caller ในอนาคต โดยไม่แก้โค้ดของ action ที่แตะ wallet; nested transaction เรียกบน `tx` จึงไม่ผ่าน override
- **ต่างจาก override ที่เคยปฏิเสธ:** รอบนั้นผูกกับ `query_timeout` ซึ่งทำให้ write หาย รอบนี้ไม่เพิ่ม timeout และเปลี่ยนแค่การคืน connection
- **ทำไม listener ระดับ pool:** ทำให้ client ไม่มีช่วงที่ไม่มี listener เลย รวมช่วงระหว่าง `pool.connect()` resolve กับ code ถัดไป query ที่ค้างหรือตามมายัง reject ตามปกติ จึงไม่กลบ error
- **ต้องตรวจจาก `node_modules/pg-pool/index.js`:** event `connect` ยิงกับ client ใหม่ทุกตัวก่อนส่งให้ผู้เรียก และ listener ไม่ถูกถอดตอน `release`
- **ลบของที่ไม่จำเป็นแล้ว:** `withDbClient` ใน `apps/web/src/lib/db.ts`; `auth.ts` กลับไปเรียก `reserveLoginAttempt(getDb(), ip)`; comment "production ต้องเรียกผ่าน helper" ใน `login-attempts.ts`; add/remove listener ใน `withDedicatedClient` และการ export จาก `packages/db/src/index.ts` (export จาก `client.ts` เพื่อ unit test ได้)

**F3: `apps/worker/src/migrate.ts` (เพิ่มระหว่าง T2)**
- `migrate(db)` เรียก `session.transaction` ตรง จึงไม่ผ่าน override ของ F1 ถ้า `begin` ล้ม client จะรั่ว, `pool.end()` ไม่จบ และ process จบด้วย exit 0 ทั้งที่ migration ล้ม
- แก้เป็น `migrate(drizzle(lockClient), ...)` ให้ lock กับ migration อยู่ connection เดียวกัน; `ensureSettings(db, seed)` คงเดิม
- วัดแล้ว: kill ก่อน `begin` และกลาง transaction ได้ exit 1 และไม่มี schema ครึ่งๆ กลางๆ, รันซ้ำได้ exit 0, รัน 2 ตัวพร้อมกันได้ 0 ทั้งคู่ และ `pg_locks` เห็นตัวที่สองรอ lock

**F2: `apps/web/src/proxy.ts`**
- ไม่มี cookie และเป็น server action (`request.method === "POST"` และมี header `next-action`) → `NextResponse.next()` ให้ `requireSession()` ใน action สั่ง redirect ด้วยรูปแบบที่ client router เข้าใจ
- กรณีอื่นที่ไม่มี cookie redirect เหมือนเดิม
- ไม่เพิ่มช่องทางใหม่: วันนี้ส่ง cookie ปลอมก็ไปถึง code ชุดเดียวกันอยู่แล้ว
- ถ้าวันหนึ่ง Next เปลี่ยนชื่อ header ผลคือกลับไปเป็นหน้า error แบบเดิม ไม่ใช่ช่องโหว่

## Open Questions / Assumptions
- User สั่งให้แก้ต่อโดยไม่ถาม จึงเดินตาม assumption เหล่านี้ และรายงานในสรุป
- A1 (ตัดสินแล้ว): **ไม่เพิ่ม** `connectionTimeoutMillis` ให้ worker เพราะ T1 ไม่พบการค้างจาก pool เต็ม และกรณีที่ค้างจริงคือ query ค้างบน socket ซึ่ง timeout นี้ไม่ช่วย
- A2: `uncaughtException` ของ worker ยังคง exit(1) เป็น fail-safe ไม่เปลี่ยน
- A3: คงคำแนะนำ `docker compose restart web` ใน README §8 ไว้เป็นทางออกสำรอง
- A4: ค่าที่กรอกในฟอร์มหายเมื่อถูกพาไป `/login` ยอมรับได้ ไม่ทำ `?next=`

## Verify commands (ของจริงจากโปรเจกต์)
```bash
# จาก root
npm run typecheck && npm run lint && npm test && npm run build
```
- Stack ทดสอบใช้ project `kubstake-setup-test` เท่านั้น ใช้ env ทดสอบที่สร้างเอง ดูตัวอย่างใน `/private/tmp/claude-501/-Users-earth-Playgrounds-kubstakeautocompound/b617bf45-6b74-4dfa-9ac5-36435022fad9/scratchpad/setup-qa/prep.cjs`
- สคริปต์เดิมในโฟลเดอร์เดียวกัน: `lib.cjs`, `leak.cjs`, `exhaust.cjs`, `narrow.cjs`, `t6.cjs`, `t6b.cjs`, `extra.cjs`, `final.cjs`; ผลเดิมใน `run-*.log`; harness pool อยู่ที่ `scratchpad/f6/`
- กับดัก QA: `ψ/memory/learnings/2026-11-05_kubstake-first-run-admin-qa-กับดักตอนทดสอบบน-st.md`

## Guardrails (ทุก agent)
- **ห้ามแตะ stack จริง** (project `kubstake`, volume `kubstake_pgdata`) ทั้ง restart, exec ที่เขียน, `down`; อ่านสถานะได้
- `down -v` ใช้ได้เฉพาะคู่กับ `-p kubstake-setup-test`
- ห้ามอ่านหรือแก้ค่าใน `.env` จริง, ห้าม `docker compose config` โดยไม่ใส่ `--quiet`, ห้ามพิมพ์ secret, hash หรือ private key
- **ห้าม broadcast ธุรกรรมจริง:** stack ทดสอบต้อง `DRY_RUN=true` และตรวจจาก log ก่อนเริ่มทุกครั้ง ใช้ key ที่สุ่มใหม่และไม่มีเงินเท่านั้น RPC ใช้อ่านอย่างเดียวและอย่ายิงถี่เกินจำเป็น
- ห้ามแตะ `MASTER_KEY` ของจริงและ `wallets.encrypted_key` ของจริง; ห้ามตั้งรหัสบน stack จริง
- ห้ามแก้ไฟล์ `.env` จริง, ห้าม commit, ห้ามใช้ `next dev` กับ Playwright
- เมื่อจบต้องล้าง stack ทดสอบ และยืนยันว่า stack จริงมีเวลาเริ่ม restart count และ image ID เดิม
- `build` ของ stack ทดสอบจะย้าย tag `kubstake-web:local` และ `kubstake-worker:local` จึงห้ามรัน `docker compose up` บน stack จริงในงานย่อย

## Tasks
- [x] **T1: วัดฝั่ง worker ก่อนแก้ (read-only ต่อ source)** (user สั่งปิดระหว่างทาง ผลอยู่ใน Baseline ของ worker ด้านล่าง)
  - ใช้ source ปัจจุบัน ขึ้น db, migrate, web, worker บน stack ทดสอบ `DRY_RUN=true`, `TICK_INTERVAL_SEC=5`; สร้าง wallet สุ่มที่ไม่มีเงินและ position; ใส่ action รอคิวให้ `claimNextAction` ทำงานต่อเนื่อง
  - วัด 4 สถานการณ์: (a) `restart db` ตอนคิวว่าง, (b) `restart db` ตอนมีคิว, (c) `pg_terminate_backend` backend ของ worker ถี่ๆ เพื่อให้โดน `begin`, (d) `pause` 60 วินาทีแล้ว `unpause`
  - บันทึกต่อรอบ: exit code และ restart count ของ worker, log `uncaught exception`, เวลาจน heartbeat fresh, leader lock กลับมาไหม, action ค้าง `running` ไหม, จำนวน connection, ค้างถาวรไหม
  - ขึ้นกับ: ไม่มี
- [x] **T2: Implement F1 และ F2** (เพิ่ม F3 จาก regression ที่พบ)
  - ตาม Design, แก้ unit test ใน `packages/db/src/client.test.ts` ให้ครอบ `createDb` (override ถูกเรียก, `begin` ล้มแล้วคืน slot, nested transaction ไม่ผ่าน override) และเพิ่ม test ของ proxy ถ้าโครงเดิมรองรับ
  - verify: gate รวม และ fault จริงบน stack ทดสอบผ่าน harness ที่ `scratchpad/f6/`
  - ขึ้นกับ: T1
- [x] **T3: QA บน stack ทดสอบ** (ลดขอบเขตตามที่ user ขอ)
  - รันตาม Acceptance criteria ทุกข้อด้วย image จริงและ browser จริง, `t6.cjs` 11 ข้อเดิมเป็น regression, ทวน T1 ทั้ง 4 สถานการณ์เทียบก่อน/หลัง
  - พฤติกรรม `deleteWallet`: `busy`, `needs_confirm`, ลบสำเร็จแบบ cascade; `createPosition` ทั้งมีและไม่มีจำนวน; worker รัน action จนจบด้วย `DRY_RUN`
  - ความปลอดภัยของ F2: action id จริงทุกตัวแบบไม่มี cookie, action id ปลอม, action public ที่ส่งไปยัง path ที่ต้องมี session, GET ที่มี header `next-action`, POST ทั่วไป, `Origin` ข้ามโดเมน
  - ขึ้นกับ: T2
- [x] **T4: Completion gate และ rebuild stack จริง (Main ทำเอง)**
  - gate รวม; backup DB จริงลง scratchpad `chmod 600`; `docker compose up -d --build`; ตรวจ `migrate` Exit 0, health 200, `wallets`/`positions`/`txs` ไม่ลด, `DRY_RUN=true`; นับแถว `admin_credentials` โดยไม่อ่าน hash; ห้ามตั้งรหัส
  - ขึ้นกับ: T3

## Out of scope (รอบนี้ไม่ทำ)
- `error.tsx` ภาษาไทยสำหรับ error ทั่วไป และหน้า error ของรหัสเกิน 1 MB
- เก็บค่าฟอร์มหรือพากลับหน้าเดิมหลัง login
- restart web อัตโนมัติเมื่อ unhealthy, การเปลี่ยน healthcheck
- worker ค้างเมื่อ network ถูกตัดแบบไม่มี FIN/RST ขณะมี query ค้าง (รายงาน user)
- การ login ที่ไม่ผ่าน JavaScript

## Progress log (Main Agent อัปเดตระหว่าง build)
- 2026-11-05 T4 ✅ — gate ผ่าน (252 tests); backup `real-db-backup/before-tx-leak-fix-20261105-204418.sql` (mode 600); `up -d --build` สำเร็จ: health 200, `dryRun:true`, `wallets`=1, `positions`=1, `txs`=0, `admin_credentials`=1 แถวของ user คงเดิม, POST ไม่มี cookie พร้อม `next-action` ปลอมได้ 400, POST ธรรมดาได้ 307, restart 0, uncaught 0
- 2026-11-05 T3 ✅ (ลดขอบเขต) — A, B, C, D ข้อ 1–5, E, G ย่อ ผ่าน; web slot 5 ทุกรอบ, worker crash 0 จาก 39 รอบ แต่เวลาฟื้นกรณี kill ช้าลงจาก <1 วินาทีเป็นสูงสุด 4.87 วินาที (tick 5 วินาที); ผล `stop`/`start` รอบแรก `5,4,0,0,1,1` ถูกทิ้งเพราะสคริปต์ 2 ตัวรันซ้อนและ web ถูก restart กลางรอบ รันใหม่ได้ 5 ทุกรอบ; ตัด F, H, 11 ข้อเต็ม, restore dump, `pause`
- 2026-11-05 T2 ✅ — F3 เสร็จ, `migrate` ที่ล้มได้ exit 1 ครบทุกกรณี, gate ผ่าน (252 tests); เริ่ม T3 โดยกำหนดจำนวนรอบและเพดานเวลาตายตัว
- 2026-11-05 T2 แก้โค้ดแล้ว — F1, F2 เสร็จ, gate ผ่าน (252 tests); kill ก่อน `begin` 12 ครั้ง: usable จาก 0/5 เป็น 5/5, uncaught จาก 10 เป็น 0; พบ regression: `migrate` เรียก `session.transaction` ตรง ไม่ผ่าน override ถ้า `begin` ล้ม `pool.end()` ค้างแล้ว process จบด้วย exit 0 ทำให้ web/worker ขึ้นบน DB ไม่มี schema; กำลังแก้ให้ migrator รันบน `lockClient`
- 2026-11-05 T1 ✅ (ปิดตามคำสั่ง user หลังวัด 2 ชั่วโมงกว่า) — worker crash แล้ว restart ฟื้นเอง ไม่ค้างจาก pool เต็ม; พบกรณีค้างเงียบเมื่อ network ถูกตัดแบบไม่มี FIN/RST; ลบ stack ทดสอบแล้ว, stack จริงไม่ถูกแตะ, source ไม่เปลี่ยน; เริ่ม T2
- 2026-11-05 สำรวจ code เสร็จ เขียน TASK.md เริ่ม T1
