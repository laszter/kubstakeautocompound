# Auto-compound ทำงานอย่างไร

หน้านี้อธิบายโหมดการทำงาน เงื่อนไขที่ระบบใช้ตัดสินใจ ความหมายของสถานะ และที่มาของตัวเลข

## Trigger modes (`optimal` / `threshold` / `schedule`)

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
| `done` | สำเร็จ |
| `failed` | ล้มเหลว + เหตุผล (revert reason, ยอดไม่พอ, validator ปิดรับ ฯลฯ) |
| `skipped` | ไม่มีอะไรให้ทำ — **ไม่ใช่ error** เช่น `no_principal: ยังไม่มีเงิน stake…`, `zero_pending: ไม่มี reward ค้าง`, undelegate ตอน principal = 0 |

**ผลรอบล่าสุด** (`last_run_result` ในหน้า position/แดชบอร์ด; คำสั่งที่กดเองขึ้นต้นด้วย `manual: `):

| ข้อความ | ความหมาย |
|---|---|
| `compounded 1-tx X KUB` / `compounded 2-tx X KUB (claimed Y KUB)` | compound สำเร็จ |
| `claimed X KUB (claim-only: validator not accepting delegation)` | validator ปิดรับ delegate — claim อย่างเดียว |
| `claimed only (insufficient for restake)` | 2-tx: claim แล้วแต่ KUB ไม่พอ delegate กลับ (เหลือในกระเป๋า) |
| `skipped: <reason>` | ข้ามรอบ: `dust_reward`, `gas_too_high`, `min_interval`, `backoff`, `insufficient_gas`, `zero_pending`, `no_principal`, `tx_in_flight` (มี tx ค้าง), `invalid_schedule` (cron ผิด) |
| `pending: … awaiting confirmation` | ส่ง tx แล้ว รอ receipt |
| `failed: …` | ล้มเหลว → เพิ่ม backoff level |
| `error: …` | RPC/เครือข่ายสะดุดชั่วคราว → ลองใหม่รอบหน้า (ไม่นับ backoff) |

`below_threshold` / `not_due` (ยังไม่ถึงเกณฑ์/เวลา) ไม่ถูกบันทึกเป็นผลรอบ — ดู ETA / next run แทน

## เศรษฐศาสตร์: APR ต่ำมาก — ต้องไม่ให้ค่า gas กินกำไร
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
- หน้า position มีการ์ด **เทียบ threshold** ให้ลองตัวเลขเอง: แต่ละ threshold compound ทุกกี่วัน คืนทุน gas ต่อครั้งกี่ปี ได้จากทบต้นเท่าไร และสุทธิเทียบกับไม่ compound ที่ 1 / 3 / 5 / 10 ปี (ค่าเริ่มต้นมาจาก position นั้น แก้แล้วไม่เปลี่ยนการตั้งค่าจริง)
- **สรุป**: ระบบไม่ตัดสินแทนว่า position ไหน "ไม่คุ้ม" — ทุก position ที่เปิด auto-compound จะ compound เองเมื่อ reward ถึงจุดที่คุ้มค่า gas ที่สุด เงินต้นน้อยจะรอนานและได้เพิ่มน้อยตามตาราง ประโยชน์หลักของระบบคือ **ไม่ให้ค่า gas กินกำไร** — เช่น compound ทุกวันที่ 10,000 KUB เสีย gas ≈ 1.9 KUB/ปี มากกว่ากำไรจาก compound (≈ 0.17 KUB/ปี)
