# TASK: ตั้งรหัสผู้ดูแลจากหน้าเว็บตอนเข้าครั้งแรก

> Status: COMPLETE · Created 2026-11-05 · Source: user request
> Skill: explore-plan-build

## Goal
เลิกกำหนดรหัสเข้าเว็บผ่าน `ADMIN_PASSWORD` ใน `.env` เมื่อเข้าเว็บครั้งแรกและยังไม่มีรหัส ระบบเปิดหน้าให้ user ตั้งรหัสเอง จากนั้นทุกครั้งเป็นหน้า login ถามรหัสตามปกติ คำขอของ user: "เวลาเข้ามาครั้งแรกจะให้ user ตั้งรหัสเองหลังจากนั้นค่อยเป็นการถาม"

## Acceptance criteria
- [x] ติดตั้งใหม่โดยไม่มี `ADMIN_PASSWORD`: `docker compose up` ขึ้นครบ, เปิด `/` หรือ `/login` แล้วไปถึง `/setup`
- [x] ตั้งรหัสสำเร็จแล้วเข้าสู่ระบบทันทีและอยู่ที่ `/`; เก็บเฉพาะ argon2id hash ใน DB ไม่มีรหัสจริงใน DB หรือ log
- [x] หลังตั้งรหัสแล้ว `/` ที่ไม่มี session ไปที่ `/login`, `/setup` ไปที่ `/login`, รหัสถูกเข้าได้, รหัสผิดถูกปฏิเสธและนับ rate limit
- [x] ยิง action ของ setup ซ้ำหลังตั้งรหัสแล้วเขียนทับ hash ไม่ได้ และถ้าส่งพร้อมกันมีคนชนะคนเดียว
- [x] DB อ่านไม่ได้ต้องไม่เปิดฟอร์มตั้งรหัส และไม่เกิด redirect loop
- [x] เปลี่ยนรหัสที่ `/settings` ได้ session อื่นหลุด session ปัจจุบันอยู่ต่อ; ลบแถวรหัสแล้ว session เก่าใช้ไม่ได้และกลับไป `/setup`
- [x] `ADMIN_PASSWORD` ไม่ถูกใช้ใน code, compose, `.env.example`, `gen-secrets.sh`, `e2e-fork.sh` อีก; README อธิบาย flow ใหม่ วิธีกู้รหัส และการอัปเกรด
- [x] `npm run typecheck && npm run lint && npm test && npm run build` ผ่าน
- [x] ข้อมูลจริงของ stack หลักไม่หาย: `wallets`=1 (`Test3`), `positions`=1, `DRY_RUN=true` คงเดิม

## Context (จากการสำรวจ code จริง)
**Key files & patterns**
- `apps/web/src/lib/auth.ts` — `requireSession`, `hasSession`, `verifyAdminPassword` (ปัจจุบัน hash จาก env แล้ว cache บน `globalThis`), rate limit
- `apps/web/src/lib/session.ts:7` — `SessionData`; `session-cookie.ts` แยกชื่อ cookie เพื่อให้ proxy import ได้
- `apps/web/src/proxy.ts:9` — gate หยาบ ไม่แตะ DB และยกเว้นเฉพาะ `/login`
- `apps/web/src/app/login/{page,actions,login-form}` — แบบอย่างของ route นอก `(app)`; `(app)/layout.tsx:21` เรียก `requireSession()` จึงต้องอยู่นอก group นี้
- `apps/web/src/app/(app)/wallets/{actions.ts,wallet-fields.ts,wallet-form.tsx}` — ฟิลด์ลับ: uncontrolled input, ส่งผ่าน FormData, ไม่คืนค่าใน state; `safeErrorCode()` อยู่ที่ `wallets/actions.ts:44-52`
- `apps/web/src/app/(app)/settings/{page.tsx,actions.ts,settings-form.tsx}` — ฟอร์ม `useActionState`, `ActionMessage`, `SubmitButton`, `fail/ok` จาก `lib/action-result.ts`
- `packages/db/src/schema.ts:259-276` — `worker_heartbeat` แบบอย่าง singleton ที่ไม่ seed; `:239-254` `app_settings` และ check `*_single_row_check`
- `packages/db/src/repo/settings.ts`, `repo/index.ts`, `repo/actions.test.ts` — pattern repo รับ `DbExecutor` และ test ด้วย fake executor
- `packages/core/src/env.ts:105-114` — `webSchema`; `packages/core/package.json` export `.` (server) และ `./browser` (client-safe)

**สถานะจริงที่ต้องระวัง**
- Stack หลัก (compose project `kubstake`, `127.0.0.1:3100`) มี **wallet `Test3` และ position ที่ user สร้างเอง** ห้ามลบหรือแก้
- โฟลเดอร์นี้ไม่ใช่ git repo สำเนาก่อนแก้อยู่ที่ `/private/tmp/claude-501/-Users-earth-Playgrounds-kubstakeautocompound/b617bf45-6b74-4dfa-9ac5-36435022fad9/scratchpad/backup-pre-first-run-setup/` (ไม่มี `.env`)

**Do-not-touch / Gotchas**
- ห้ามแก้หรือพิมพ์ค่าใน `.env` จริง; ห้าม `docker compose down -v`; ห้ามแตะ `MASTER_KEY`, `wallets.encrypted_key`; ห้าม select `wallets.encryptedKey` ในฝั่ง web; ห้ามเพิ่ม `ports:` ให้ `db`; `/api/health` ต้อง public; `DRY_RUN=true` ต้องคงเดิม; ห้าม broadcast mainnet tx
- `docker compose` ที่ไม่มี `-p` คือ stack จริง งานทดสอบต้องใช้ `-p kubstake-setup-test --env-file <scratch>` ทุกคำสั่ง
- `docker compose config` ต้องใส่ `--quiet` เพราะไม่งั้นพิมพ์ secret
- `next dev` ใช้กับ Playwright ไม่ได้ (reload loop) ให้ทดสอบบน image ที่ build จาก compose
- `redirect()` และ `requireSession()` ห้ามอยู่ใน try/catch; page ที่ต้องครอบใช้ `unstable_rethrow`; `session.save()` ทำได้ใน server action หรือ route handler เท่านั้น
- `DrizzleQueryError.message` มี query params log ได้แค่ `safeErrorCode` ห้าม log `err.message` ในเส้นทางที่แตะ hash
- ห้าม `.trim()`/`.slice()` รหัสผ่าน; `login_attempts` นับทุก browser ผ่าน docker bridge เป็น IP เดียว (ล้มเหลว 5 ครั้ง / 15 นาที)
- `@node-rs/argon2` เป็น dependency ของ `apps/web` เท่านั้น `packages/db` รับและคืนเป็น string; image worker ไม่มี argon2
- `apps/web` ไม่อยู่ใน vitest include logic ที่ต้อง unit test ให้อยู่ใน `packages/*`
- สำรองไฟล์ก่อนแก้ทำแล้ว; test ทุกตัวต้องไม่พิมพ์รหัสหรือ key ออกจอ

## Design
**ตาราง `admin_credentials`** singleton: `id smallint PK default 1`, `password_hash text NOT NULL` (comment บอกรูปแบบ PHC argon2id), `created_at`, `updated_at`, check `admin_credentials_single_row_check`
ไม่มีแถว = ยังไม่ตั้งรหัส ไม่เก็บใน `app_settings` เพราะ `getSettings` select ทุกคอลัมน์และ worker อ่านทุก tick

**Repo `packages/db/src/repo/admin-credentials.ts`**
- `getAdminPasswordHash(db): Promise<string | null>`
- `createAdminCredential(db, passwordHash): Promise<boolean>` — `INSERT ... ON CONFLICT DO NOTHING RETURNING`; `true` = ผู้ชนะคนเดียว
- `replaceAdminPasswordHash(db, expectedHash, newHash): Promise<boolean>` — `UPDATE ... WHERE password_hash = expectedHash RETURNING`, ตั้ง `updatedAt`

**Session binding** เพิ่ม claim `credentialTag` ลงใน session = SHA-256 (base64url) ของ `password_hash` hash ใหม่มี salt ใหม่เสมอ จึงทำให้ cookie เก่าหมดอายุทั้งตอนเปลี่ยนรหัสและตอนลบแถวรีเซ็ต โดยไม่ต้องมีคอลัมน์เพิ่ม `requireSession` และ `hasSession` ต้องใช้ตรรกะเดียวกัน ไม่งั้น `/login` กับ `/` จะวน redirect
เมื่ออ่าน DB ไม่ได้ ถือว่า session ไม่ valid (fail closed), log เฉพาะ `safeErrorCode`, แล้วไป `/login`

**Routing**
- Proxy ยกเว้น `/login` และ `/setup` (ไม่แตะ DB)
- `/login` page: อ่านสถานะก่อน; ไม่มีรหัส → `/setup`; มีรหัสและ session valid → `/`; อ่านสถานะไม่ได้ → แสดงฟอร์มพร้อม alert ว่าระบบยังไม่พร้อม **ห้ามไป `/setup`**
- `/setup` page: มีรหัสแล้ว → `/login`; อ่านสถานะไม่ได้ → แสดงข้อความระบบยังไม่พร้อม **ไม่แสดงฟอร์ม**; ยังไม่มี → ฟอร์ม
- ทั้งสองหน้า `force-dynamic`

**`setupAdmin` action** ไม่ต้องมี session และเรียกตรงได้ จึงต้องป้องกันในตัวเอง ลำดับ: validate → อ่านสถานะ ถ้ามีรหัสแล้ว redirect `/login` **ก่อนเรียก argon2** → hash → `createAdminCredential` → ถ้าแพ้ race redirect `/login` → ถ้าชนะตั้ง session แล้ว redirect `/`

**Argon2** hash ถูกเก็บถาวร และ DB dump ทำให้เดา offline ได้ จึงตั้ง `{ memoryCost: 19456, timeCost: 2, parallelism: 1 }` (ค่าขั้นต่ำของ OWASP สำหรับ argon2id) แทน default ของไลบรารี ตรวจว่า hash ขึ้นต้น `$argon2id$v=19$m=19456,t=2,p=1$`

**กู้รหัส** ลบแถว `admin_credentials` ด้วย `psql` แล้วเข้าเว็บ จะกลับเข้า `/setup` และ session เก่าหลุด ไม่แตะ wallet

## Open Questions / Assumptions
**Assumptions (ตัดสินใจเองด้วย default — user ทักท้วงได้)**
- 📌 รหัสอย่างเดียว ไม่มี username เพราะระบบมีผู้ดูแลคนเดียวตามที่ user เลือกตอนแรก ("Admin password + localhost")
- 📌 เอา `ADMIN_PASSWORD` ออกทั้งหมด ไม่เก็บไว้เป็นค่า seed เพราะงานนี้ยังไม่เคยถูกปล่อยออกไปและเป็น config ที่ทำให้สับสนว่าแก้ `.env` แล้วรหัสเปลี่ยน
- 📌 ไม่ใช้ setup token ตามที่ user ขอ ("เข้ามาครั้งแรกตั้งเอง") ช่วงก่อนตั้งรหัส ใครเข้าถึงก่อนจะได้สิทธิ์ admin จึงพึ่ง default bind `127.0.0.1` และเตือนใน README ให้ตั้งรหัสก่อนเปิดออกเครือข่าย
- 📌 เพิ่มฟอร์มเปลี่ยนรหัสที่ `/settings` เพราะการแก้ `.env` ใช้ไม่ได้อีก ถ้าไม่เพิ่มต้องใช้ `psql` อย่างเดียว
- 📌 รหัสยาว 8–1024 ตัว ไม่บังคับชนิดตัวอักษร คงขั้นต่ำ 8 ตามของเดิมและเพดาน 1024 ตาม `verifyAdminPassword`
- 📌 ตั้งรหัสสำเร็จแล้ว login ให้เลย
- 📌 install เดิมหลังอัปเกรดจะเข้า `/setup` ทันที session เดิมหลุด (รวม stack ของ user เอง ซึ่ง bind `127.0.0.1`)

## Verify commands (ของจริงจากโปรเจกต์)
- Migration: `npm run db:generate -- --name admin_credentials`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Test: `npm test` หรือ `npx vitest run packages/db` / `npx vitest run packages/core`
- Build: `npm run build`
- Script: `bash -n scripts/gen-secrets.sh && bash -n scripts/e2e-fork.sh`
- Compose: `docker compose --env-file <scratch env> config --quiet`
- ถ้าต้อง npm install: `NPM_CONFIG_CACHE=/tmp/npm-cache-kubstake` (ห้าม sudo)

## Tasks
> สถานะ: [ ] = ยังไม่ทำ · [x] = เสร็จ+verify ผ่าน · [!] = ติด blocker (ดูหมายเหตุ)

- [x] **T1 — ตารางและ repo**
  - ทำอะไร: เพิ่มตาราง `adminCredentials` ใน `packages/db/src/schema.ts` (ก่อน relations) และ `AdminCredentialRow`; รัน generate; แก้ SQL ที่ generate ให้เป็น `CREATE TABLE IF NOT EXISTS` เพื่อให้ `migrate` ไม่ล้มหลัง restore dump เก่าด้วย `--clean --if-exists` (ตารางใหม่จะยังอยู่แต่ log ของ migration ย้อน); เพิ่ม repo ตาม Design และ export ใน `repo/index.ts`; เพิ่มตารางใน `schema.test.ts`; เขียน `repo/admin-credentials.test.ts`
  - ไฟล์: `packages/db/src/schema.ts`, `packages/db/drizzle/0001_admin_credentials.sql` + meta, `packages/db/src/repo/{admin-credentials.ts,admin-credentials.test.ts,index.ts}`, `packages/db/src/schema.test.ts`
  - เดินตาม pattern: `schema.ts:259-276`, `repo/settings.ts`, `repo/actions.test.ts`
  - ขึ้นกับ: — · ขนานได้กับ: T2
  - verify: `npx vitest run packages/db`; `when` ใน journal มากกว่า `1793810397282`; รัน migration สองรอบ (รวมกรณี log ถูกย้อน) กับ Postgres ชั่วคราว `docker run -d --name kubstake-setup-devdb -e POSTGRES_PASSWORD=dev -p 127.0.0.1:55432:5432 postgres:18-alpine` แล้วลบ container นี้เมื่อเสร็จ; ทดสอบ `createAdminCredential` พร้อมกันหลายตัวกับ DB นี้ว่ามี `true` ตัวเดียว
- [x] **T2 — Env, validator และ infra**
  - ทำอะไร: ลบ `ADMIN_PASSWORD` จาก `webSchema` และ fixture/assert ใน `env.test.ts`; เพิ่ม `packages/core/src/auth/admin-password.ts` มี `ADMIN_PASSWORD_MIN_LENGTH = 8`, `ADMIN_PASSWORD_MAX_LENGTH = 1024`, `validateNewAdminPassword(password: unknown, confirm: unknown): { password?: string; confirm?: string } | null` (ข้อความไทย, ไม่ trim, ไม่ echo ค่า) พร้อม test; export ทั้งจาก `index.ts` และ `browser.ts`; ลบบรรทัด 95 ของ compose, ลบจาก `.env.example` (รวมตัวอย่าง quote บรรทัด 11), เลิกสร้างและพิมพ์รหัสใน `gen-secrets.sh` และบอกว่าตั้งรหัสที่หน้าเว็บตอนเข้าครั้งแรก, ลบ `scripts/e2e-fork.sh:89`
  - ห้าม: แก้ `.env` จริง; `apps/web/src/lib/env.ts` ทำใน T3
  - ไฟล์: `packages/core/src/env.ts`, `packages/core/src/env.test.ts`, `packages/core/src/auth/{admin-password.ts,admin-password.test.ts}`, `packages/core/src/index.ts`, `packages/core/src/browser.ts`, `docker-compose.yml`, `.env.example`, `scripts/gen-secrets.sh`, `scripts/e2e-fork.sh`
  - ขึ้นกับ: — · ขนานได้กับ: T1
  - verify: `npx vitest run packages/core`; `bash -n` ทั้งสอง script; `ENV_FILE=<scratch>/fresh.env bash scripts/gen-secrets.sh` ไม่พิมพ์รหัส ไม่แตะ `.env` จริง; `docker compose --env-file <scratch>/fresh.env config --quiet` ผ่าน; `grep -rnw ADMIN_PASSWORD` นอก `apps/web/src`, `README.md`, `tasks/` ไม่พบ (ใช้ `-w` เพราะค่าคงที่ `ADMIN_PASSWORD_MIN_LENGTH`/`MAX_LENGTH` ตั้งใจให้คงชื่อนี้)
- [x] **T3 — Auth ฝั่ง web, หน้า setup และ login**
  - ทำอะไร: แก้ `lib/auth.ts`, `session.ts`, `lib/env.ts`, `proxy.ts` และ login ตาม Design; ย้าย `safeErrorCode` จาก `wallets/actions.ts` ไป `lib/safe-error.ts` แล้ว import กลับ; login action อ่าน hash ถ้าไม่มี redirect `/setup` ไม่นับ attempt, session ได้ `credentialTag`, log แค่ `safeErrorCode`; ลบข้อความ `ADMIN_PASSWORD` จาก `login-form.tsx`; แยก brand + card shell จาก `login/page.tsx` เป็น `components/auth-shell.tsx`; สร้าง `app/setup/{page.tsx,actions.ts,setup-form.tsx}` ฟิลด์ `password`, `confirm` (`autoComplete="new-password"`, uncontrolled, `noValidate`, แสดง error รายช่อง), ชื่อหน้า "ตั้งรหัสผ่านผู้ดูแล", คำอธิบาย "ยังไม่มีรหัสผ่านในระบบ ตั้งครั้งเดียว แล้วครั้งต่อไปใช้รหัสนี้เข้าสู่ระบบ", ปุ่ม "ตั้งรหัสผ่านและเข้าสู่ระบบ"
  - ขึ้นกับ: T1, T2
  - verify: `npm run typecheck && npm run lint`
- [x] **T4 — เปลี่ยนรหัสที่ `/settings`**
  - ทำอะไร: เพิ่ม card "เปลี่ยนรหัสผ่าน" ใน `settings/page.tsx` (แสดงเสมอแม้ settings โหลดไม่ได้); action แรกสุดเรียก `requireSession`, ตรวจ rate limit, verify รหัสปัจจุบันและบันทึก attempt, validate รหัสใหม่, `replaceAdminPasswordHash`, ตั้ง `credentialTag` ใหม่ให้ session ปัจจุบัน; ฟิลด์ `current` (`current-password`), `password`, `confirm` (`new-password`); คำอธิบาย "หลังเปลี่ยน อุปกรณ์อื่นที่เข้าสู่ระบบไว้จะถูกออกจากระบบ"
  - ไฟล์: `apps/web/src/app/(app)/settings/{page.tsx,password-actions.ts,password-form.tsx}`, `apps/web/src/lib/auth.ts`
  - ขึ้นกับ: T3
  - verify: `npm run typecheck && npm run lint`
- [x] **T5 — README**
  - ทำอะไร: แก้ทุกจุดจาก `grep -n ADMIN_PASSWORD README.md` (27, 74, 86, 146, 154, 172, 369, 372, 378, 406, 496); เพิ่มตารางใน `:483`; ปรับ threat model `:72-76` (dump มี hash จึงเดา offline ได้ private key ยังปลอดภัยเพราะ `MASTER_KEY` อยู่นอก DB); เพิ่มคำเตือนใน `:83-91` ให้ตั้งรหัสก่อนเปิดออกเครือข่าย; §7 เพิ่มหมายเหตุอัปเกรดจากรุ่นเดิม (ต้องตั้งรหัสใหม่ทันที, ลบบรรทัด `ADMIN_PASSWORD` เดิมจาก `.env`, restore dump กลับรหัสเก่าด้วย); แก้ "ลืมรหัส" เป็นวิธีลบแถวด้วย `psql`
  - ขึ้นกับ: T3, T4
  - verify: `grep -n ADMIN_PASSWORD README.md` เหลือเฉพาะหมายเหตุอัปเกรด; คำสั่งใน README รันได้จริงใน T6
- [x] **T6 — ทดสอบจริงบน stack แยก**
  - ทำอะไร: ใช้ project `kubstake-setup-test`, `WEB_PORT=3101`, env ที่สร้างด้วย `gen-secrets.sh`, และขึ้นเฉพาะ `web` (พร้อม db, migrate) ไม่ขึ้น worker; เขียนสคริปต์ Playwright ใน scratchpad รหัสสุ่มในสคริปต์และไม่พิมพ์ ครอบคลุม:
    1. volume ใหม่: `/` และ `/login` ไปถึง `/setup`; `/api/health` 200
    2. validation: สั้นเกิน, ไม่ตรงกัน, ยาวเกิน 1024
    3. รหัสที่มีช่องว่างหัวท้าย ตั้งแล้วเข้าสู่ `/` ทันที; DB มีแถวเดียว ขึ้นต้น PHC ตาม Design; log ของ web ไม่มีรหัสหรือ hash
    4. context ใหม่: `/` และ `/setup` ไป `/login`; รหัสผิดถูกปฏิเสธ, รหัสถูกเข้าได้ (ตรงตัว รวมช่องว่าง)
    5. แท็บ `/setup` ที่เปิดค้างก่อนตั้งรหัส กดส่งรหัสอื่นทีหลัง: ไป `/login` และ hash ไม่เปลี่ยน; รีเซ็ตแล้วส่งพร้อมกัน 2 แท็บรหัสต่างกัน: มีแถวเดียว และเข้าได้ด้วยรหัสเดียว
    6. เปลี่ยนรหัส: รหัสปัจจุบันผิดถูกปฏิเสธ; สำเร็จแล้ว context นี้อยู่ต่อ, context อื่นหลุด, รหัสเก่าใช้ไม่ได้, รหัสใหม่ใช้ได้
    7. กู้รหัสด้วยคำสั่งใน README: session เก่าไป `/setup` ไม่วนและเรียก action ไม่ได้
    8. หยุด `db`: `/login` แสดงฟอร์มและ alert ไม่ไป `/setup`, `/setup` ไม่มีฟอร์ม, `/` ไม่วน; เปิด `db` กลับแล้วใช้ได้
    9. restore dump ก่อนอัปเกรด (จำลองด้วย drop ตาราง + ย้อน log แล้ว dump) ทับ DB ที่มีตารางใหม่: `migrate` exit 0 และแถว wallet ปลอมในสคริปต์ยังอยู่ (ค่าปลอม ไม่ใช่ key จริง)
    10. screenshot `/setup`, `/login`, `/settings` light, dark, กว้าง 390px; 0 console error
    11. cookie รูปแบบเก่า (`{ loggedInAt }` ไม่มี `credentialTag`) ใช้ไม่ได้; จำลอง install เดิม (ไม่มีตาราง + log ย้อน + wallet ปลอม) แล้ว `up` ต้องเข้า `/setup` และ wallet อยู่ครบ; ข้อ 9 ตรวจแถวรหัสหลัง restore ให้ตรงกับ README §7; ข้อ 8 จับเวลาว่าหน้าไม่ค้าง
  - ล้างหลังจบ: `docker compose -p kubstake-setup-test --env-file <scratch> down -v` เท่านั้น แล้วยืนยันว่า stack หลัก `wallets`=1, `positions`=1
  - ดูสคริปต์เดิมที่ scratchpad `final/no-breakeven.cjs` เป็นตัวอย่าง
  - ขึ้นกับ: T3, T4, T5
- [x] **T6b — แก้สิ่งที่ T6 พบ แล้วทดสอบซ้ำ**
  - F1 (B1, regression): `logout` ใน `app/login/actions.ts` ไม่เรียก `requireSession` ลบ cookie เสมอ เพราะตอน DB ล่ม `requireSession` redirect ก่อนถึง `destroy` แล้ว session กลับมาใช้ได้
  - F2 (B2, regression ของ `/login`): `createDb` เพิ่มเฉพาะ `connectionTimeoutMillis` (web ใช้ 5,000 ms, worker ไม่เปลี่ยน) และ `readStoredHash` ใน `lib/auth.ts` จำกัดเวลาอ่าน 5,000 ms แล้วคืน `undefined` **ไม่ใช้ `query_timeout`** เพราะวัดแล้วทำให้ `db.transaction` บน pool รั่ว slot และคืน client ทั้งที่ transaction เปิดอยู่ ส่วนการครอบ `db.transaction` ทั้งระบบเสี่ยงเกินกว่าเหตุสำหรับกรณี DB ถูก pause; `/api/health` และ server action ตอน DB ค้างคงพฤติกรรมเดิมก่อนงานนี้
  - F3 (B3): `attemptAdminPassword` จองสิทธิ์แบบ atomic ต่อ IP: transaction → `pg_advisory_xact_lock(<class ใหม่>, hashtext(ip))` แบบ two-int4 ตาม `packages/db/src/repo/actions.ts:36` → นับ limit → ถ้าผ่าน insert แถว failure → commit แล้วจึง verify นอก transaction → ถ้าถูกค่อย insert แถว success และ prune ตามเดิม เหตุผล: รหัสเลือกเองอาจเดาง่ายกว่ารหัสที่ `gen-secrets.sh` เคยสุ่ม
  - F4: ฟอร์มเปลี่ยนรหัสไม่แสดงข้อความรหัสปัจจุบันผิดซ้ำ; alert กว้างเท่าช่องกรอก
  - F5: README §6 บรรทัด 328 (session หลัง restore ผูกกับ hash ใน dump), บรรทัด 337 (`migrate` apply เฉพาะ migration ที่ dump ยังไม่มี), §7 เพิ่ม `chmod 600 before-update.sql`
  - F6 (B6, regression จาก F3): `reserveLoginAttempt` ใช้ `db.transaction` บน pool ซึ่ง drizzle 0.45.4 รัน `begin` นอก `try` ถ้า `db` restart ตอนนั้น slot จะไม่ถูกคืน เมื่อครบ 5 ช่องเว็บใช้ไม่ได้จนกว่าจะ restart web แก้ด้วย helper ที่ check out client เอง คืนเสมอ และทำลาย connection เมื่อล้ม ใช้เฉพาะเส้นทาง login; `db.transaction` อื่นทั้ง 4 จุด (`positions/new/actions.ts`, `wallets/actions.ts`, `repo/actions.ts`, `worker/executor.ts`) เป็นความเสี่ยงเดิม ไม่แก้และรายงาน user
  - F7 (README): ย้าย comment ท้ายคำสั่งออกจาก code block เพราะ zsh แบบ interactive มอง `#` เป็น argument จน `pg_dump` ใน §7 ได้ไฟล์ 0 byte; เพิ่มให้ตรวจขนาด backup; §8 เพิ่ม `docker compose restart web` เมื่อ `db` healthy แล้วแต่ยังขึ้น "ระบบยังไม่พร้อม"
  - ไม่แก้: B4 (รหัสเกิน 1 MB ได้หน้า error ของ Next, ไม่เกิดแถว), ข้อความ "ผิดเกิน 5 ครั้ง" เดิม และ B5 (POST จากแท็บที่ไม่มี cookie ได้ 307 แล้วขึ้นหน้า error, logic ใน `proxy.ts` เดิมมีมาก่อนงานนี้และการแก้แตะขอบเขต auth; รายงาน user)
  - verify: gate รวม; รัน QA เต็มซ้ำ รวม B1, B2 (`pause`/`unpause`), B3 (ตรวจรหัสจริงไม่เกิน 5 ครั้ง); หลัง F6 รันเฉพาะ `leak.cjs` และชุด login, rate limit, เปลี่ยนรหัส
  - ขึ้นกับ: T6
- [x] **T7 — Completion gate และ rebuild stack หลัก**
  - ทำอะไร (Main ทำเอง): gate รวม; backup DB จริงตาม README §7 ไปที่ scratchpad `chmod 600`; `docker compose up -d --build`; ตรวจ `migrate` Exit 0, health 200, `/login` ไป `/setup` ด้วย `curl` เท่านั้น **ห้ามตั้งรหัสบน stack จริง ให้ user ตั้งเอง**; ยืนยัน `wallets`=1, `positions`=1, `DRY_RUN=true`
  - ขึ้นกับ: T6b

## Out of scope (รอบนี้ไม่ทำ)
- หลายบัญชี, username, role, 2FA
- Setup token, Host allowlist หรือการกัน DNS rebinding (ความเสี่ยงช่วงก่อนตั้งรหัสระบุใน README)
- แก้ rate limit ที่ใช้ bucket เดียวผ่าน docker bridge (แก้เฉพาะ race ใน T6b)
- แก้ `.env` จริงของ user (บรรทัด `ADMIN_PASSWORD` เดิมจะค้าง แต่ไม่มีผล ให้ user ลบเอง)

## Progress log (Main Agent อัปเดตระหว่าง build)
- 2026-11-05 T7 ✅ — gate ผ่าน (246 tests); backup DB จริงที่ scratchpad `real-db-backup/before-first-run-setup-20261105-164613.sql` (mode 600, dump สมบูรณ์); `up -d --build` สำเร็จ: `migrate` Exited (0), migrations=2, health 200, ทุกหน้าไป `/setup`, `admin_credentials`=0, `wallets`=1 (`Test3`), `positions`=1, `txs`=0, `DRY_RUN=true`; ไม่ได้ตั้งรหัสบน stack จริง รอ user ตั้งเอง
- 2026-11-05 T6b ✅ — F6, F7 เสร็จ; QA รอบแคบผ่าน 7 ข้อ: เส้นทาง login slot เป็น 5 ทุกรอบตลอด 57 รอบ; ยังมี `uncaughtException` 14 บรรทัด (ไม่ทราบที่มา, web ไม่ตาย); `deleteWallet` ยังรั่วจน slot เหลือ 0 ตอนทดสอบหนัก ต้องมี session เป็นความเสี่ยงเดิม รายงาน user; ไม่ได้รัน 11 ข้อเต็มซ้ำหลัง F6
- 2026-11-05 สำรวจเสร็จ, สำรองซอร์สแล้ว, เขียน TASK.md
- 2026-11-05 T1 ✅ — db 26 tests ผ่าน; migration `0001_admin_credentials` ใช้ `CREATE TABLE IF NOT EXISTS`; ทดสอบกับ Postgres ชั่วคราวแล้ว: รันซ้ำ, ย้อน log, ส่งพร้อมกันมีผู้ชนะคนเดียว; ยังไม่ได้ทดสอบ pg_dump/restore จริงและ bundle ใน image (อยู่ใน T6)
- 2026-11-05 T6b QA รอบ 2 — 11 ข้อเดิมและ F1–F5 ผ่าน; ข้อ `restart db` ระหว่าง login ขนานไม่ผ่าน (B6) พบ B5 เพิ่ม; กำลังแก้ F6, F7; stack จริงไม่ถูกแตะ
- 2026-11-05 T6b แก้โค้ดแล้ว — F1–F5 เสร็จ, gate ผ่าน (239 tests); F2 เปลี่ยนจาก `query_timeout` เป็นจำกัดเวลาใน `readStoredHash`; กำลังรัน QA เต็มซ้ำ
- 2026-11-05 T6 ✅ — 11 ข้อผ่านบน stack แยก พบ bug นอกเกณฑ์ 4 ข้อ และ README ไม่ตรง 2 ประโยค ดู T6b; stack จริงไม่ถูกแตะ
- 2026-11-05 T3–T5 ✅ — root gate ผ่าน (230 tests, build ไม่ใช้ DB); smoke กรณี DB อ่านไม่ได้ผ่านด้วย curl; ยังไม่ได้ทดสอบ flow จริงใน browser (T6); เพิ่ม `components/password-field.tsx` และ `attemptAdminPassword` รวม rate limit
- 2026-11-05 T2 ✅ — core 171 tests ผ่าน, gen-secrets ผ่านกับ env ใหม่และ env เดิมที่มีบรรทัดรหัสเก่า; `validateNewAdminPassword` คืน error ทั้งสองช่องพร้อมกัน และ export `AdminPasswordErrors`
