# KUB Stake Auto-Compound

ระบบช่วย stake KUB บน KUB Chain แล้วนำ reward กลับไป stake ต่อให้อัตโนมัติ ในจังหวะที่คุ้มค่า gas ที่สุด ใช้งานผ่านหน้าเว็บที่รันบนเครื่องของคุณเอง

> ⚠️ **ระบบนี้ใช้เงินจริงและไม่มีโหมดทดลอง** ทุกคำสั่งส่ง transaction จริงบน KUB Chain mainnet และ private key ถูกเก็บไว้บนเครื่องนี้ ให้ใช้ wallet ใหม่ที่ใส่เงินเท่าที่จำเป็น อย่าใช้กระเป๋าหลัก

## ทำอะไรได้บ้าง

- ใช้ได้หลาย wallet และหลาย validator
- สั่ง delegate, undelegate, claim และ compound จากหน้าเว็บ
- compound อัตโนมัติได้ 3 แบบ: หาจุดที่คุ้มค่า gas ที่สุด (`optimal`), เมื่อ reward ถึงจำนวนที่ตั้ง (`threshold`) หรือตามเวลา (`schedule`)
- ดูยอดเงินและประวัติ transaction ได้ในที่เดียว

## เริ่มใช้งาน

ต้องมีอินเทอร์เน็ตและพื้นที่ว่างประมาณ 1 GB

### 1. ติดตั้ง Docker

**macOS**
1. ติดตั้งและเปิด [Docker Desktop](https://www.docker.com/products/docker-desktop/) รอจนขึ้นว่าพร้อมใช้งาน
2. เปิดโปรแกรม Terminal ถ้าเครื่องถามให้ติดตั้ง developer tools ตอนรันคำสั่ง `git` ให้กดติดตั้ง

**Windows 10/11**
1. เปิด PowerShell แบบ Run as administrator รัน `wsl --install` แล้วรีสตาร์ตเครื่อง
2. ติดตั้งและเปิด [Docker Desktop](https://www.docker.com/products/docker-desktop/) แล้วเปิด Ubuntu ที่ Settings → Resources → WSL Integration
3. เปิดแอป **Ubuntu** แล้วรันคำสั่งทั้งหมดในขั้นถัดไปที่นี่

**Linux**: ติดตั้ง [Docker Engine](https://docs.docker.com/engine/install/) และ `git`

### 2. ดาวน์โหลดและเริ่มระบบ

```bash
git clone https://github.com/laszter/kubstakeautocompound.git
cd kubstakeautocompound
bash scripts/start.sh
```

คำสั่งนี้ตรวจ Docker, สร้างไฟล์ตั้งค่าและรหัสลับให้เอง แล้วเริ่มระบบ ครั้งแรกอาจใช้เวลาหลายนาที เมื่อเห็น `✅ ระบบพร้อมแล้ว` ให้เปิด <http://127.0.0.1:3000>

### 3. สำรอง `MASTER_KEY` ทันที

เปิดไฟล์ `.env` ในโฟลเดอร์โปรแกรม คัดลอกค่า `MASTER_KEY` ไปเก็บใน password manager **ถ้าค่านี้หาย private key ที่เก็บในระบบจะกู้คืนไม่ได้** และห้ามเปลี่ยนค่านี้หลังเพิ่ม wallet แล้ว

### 4. ตั้งค่าในหน้าเว็บ

1. **ตั้งรหัสผู้ดูแล** อย่างน้อย 8 ตัวอักษร ระบบจะพาไปหน้านี้เองตอนเข้าครั้งแรก
2. **เพิ่ม wallet** สร้างบัญชีใหม่ในโปรแกรมกระเป๋า เช่น MetaMask แล้วนำ private key ไปวางที่เมนู **กระเป๋า**
3. **โอน KUB เข้า wallet** ผ่าน KUB Chain โดยเผื่อค่า gas และเงินสำรองอย่างน้อย 0.06 KUB นอกเหนือจากจำนวนที่จะ stake
4. **เริ่ม stake** ไปที่เมนู **Validators** กด **Delegate** ที่ตัวที่เปิดรับ แล้วกรอกจำนวน KUB ซึ่งต้องไม่ต่ำกว่าขั้นต่ำของ validator ตัวนั้น
5. **ตรวจผล** ที่หน้า position ดูประวัติ transaction และเปิดลิงก์ไปเช็กใน kubscan

เริ่มจากจำนวนน้อยก่อน position ใหม่เปิด auto-compound แบบ `optimal` ไว้ให้แล้ว ถ้าไม่ต้องการให้ปิดได้ที่หน้า position

> ระบบทำงานเฉพาะตอนที่เครื่องและ Docker เปิดอยู่ ระหว่างปิดเครื่องจะไม่มีการ compound แต่เงินที่ stake ยังอยู่และ reward ยังสะสมตามปกติ

## คำสั่งที่ใช้บ่อย

รันในโฟลเดอร์โปรแกรม

| ต้องการ | คำสั่ง |
|---|---|
| เริ่มระบบ | `bash scripts/start.sh` |
| หยุดระบบ (ข้อมูลไม่หาย) | `docker compose down` |
| ดูสถานะ | `docker compose ps -a` |
| ดู log | `docker compose logs worker --tail 50` |
| สำรองและอัปเดต | ดู[ขั้นตอนอัปเดต](docs/operations.md#อัปเดตเวอร์ชัน) |

⚠️ **ห้ามใช้ `docker compose down -v`** เพราะจะลบข้อมูลทั้งหมด รวมถึง private key ที่เก็บไว้

## คำศัพท์

| คำ | ความหมาย |
|---|---|
| Delegate / Stake | นำ KUB ไปวางกับ validator เพื่อรับ reward |
| Undelegate | ถอน KUB กลับเข้า wallet ได้ทันทีใน transaction เดียว |
| Claim | รับ reward เข้า wallet |
| Compound | นำ reward กลับไป stake ต่อ |
| Position | คู่ของ wallet กับ validator ที่คุณ stake อยู่ |
| Gas | ค่าธรรมเนียมส่ง transaction จ่ายเป็น KUB |

## ผลตอบแทนที่ควรคาดหวัง

reward อยู่ที่ประมาณ 0.58% ต่อปี (ณ พฤศจิกายน 2026) และ compound แต่ละครั้งเสีย gas ประมาณ 0.005 KUB ถ้า compound ถี่เกินไป ค่า gas จะกินกำไร ระบบจึงรอให้ reward ถึงจุดที่คุ้มค่า gas ที่สุดก่อน

| Stake (KUB) | Reward ต่อปี (KUB) | Compound เมื่อ reward ถึง (KUB) | ความถี่โดยประมาณ | ได้เพิ่มจาก compound ต่อปี (KUB) |
|---:|---:|---:|---:|---:|
| 1,000 | 5.8 | 3.22 | ทุก 203 วัน | ≈ 0 |
| 10,000 | 58 | 10.18 | ทุก 64 วัน | ≈ 0.11 |
| 100,000 | 580 | 32.2 | ทุก 20 วัน | ≈ 1.5 |

ตัวเลขเป็นตัวอย่างที่ gas price 25 gwei ระบบคำนวณใหม่จากค่าจริงทุกครั้ง อ่านเพิ่มที่ [Auto-compound ทำงานอย่างไร](docs/compound.md)

## ความปลอดภัย

- **ใช้ wallet แยกเฉพาะระบบนี้** และเก็บ private key ต้นฉบับไว้เองด้วย
- **เงินที่ stake มีความเสี่ยงเท่าเงินในกระเป๋า** เพราะใครได้ private key ไปก็ถอนและโอนออกได้ทันที
- **อย่าเปิดเว็บสู่อินเทอร์เน็ตตรง ๆ** ค่าเริ่มต้นเข้าได้จากเครื่องนี้เท่านั้น ถ้าจะเข้าจากที่อื่นให้ทำตาม[วิธีที่ปลอดภัย](docs/operations.md#เปิดให้เข้าจากที่อื่นอย่างปลอดภัย)
- **สำรองข้อมูลแยกจาก `MASTER_KEY`** ดู[วิธี Backup / Restore](docs/operations.md#backup--restore) ระบบไม่สำรองให้อัตโนมัติ และไม่มีการแจ้งเตือนเมื่อเกิดปัญหา
- **เครื่องที่รันระบบต้องไว้ใจได้** ถ้าเครื่องถูกยึด private key ทั้งหมดอาจหลุด

อ่านรายละเอียดก่อนใส่เงินจำนวนมากที่ [ความปลอดภัยและความเสี่ยง](docs/security.md)

## แก้ปัญหาเบื้องต้น

| อาการ | วิธีแก้ |
|---|---|
| `เชื่อมต่อ Docker ไม่ได้` | เปิด Docker Desktop รอจนพร้อม แล้วรัน `bash scripts/start.sh` อีกครั้ง |
| port 3000 ไม่ว่าง (`port is already allocated`) | ตั้ง `WEB_PORT=3100` ในไฟล์ `.env` รัน `bash scripts/start.sh` อีกครั้ง แล้วเปิด <http://127.0.0.1:3100> |
| หน้าเว็บขึ้น worker ไม่ตอบสนอง และกดปุ่มไม่ได้ | รอสักครู่ ถ้ายังไม่หายให้ดู log ด้วย `docker compose logs worker --tail 50` |
| `ยอด KUB ไม่พอ` หรือ `insufficient_gas` | โอน KUB เข้า wallet เพิ่ม |
| ลืมรหัสผู้ดูแล | ดู[วิธีตั้งรหัสใหม่](docs/operations.md#troubleshooting) |

อาการอื่นดูได้ที่ [Troubleshooting](docs/operations.md#troubleshooting)

## เอกสารเพิ่มเติม

| เอกสาร | เนื้อหา |
|---|---|
| [ความปลอดภัยและความเสี่ยง](docs/security.md) | การเข้ารหัส key, สิ่งที่ระบบป้องกันได้และไม่ได้ |
| [Auto-compound ทำงานอย่างไร](docs/compound.md) | โหมดทำงาน, เงื่อนไข, ความหมายของสถานะ, ที่มาของตัวเลข |
| [คู่มือดูแลระบบ](docs/operations.md) | ติดตั้งเอง, เปิดใช้จากที่อื่น, สำรองข้อมูล, อัปเดต, แก้ปัญหา |
| [คู่มือนักพัฒนา](docs/development.md) | สถาปัตยกรรม, การพัฒนา, การทดสอบ, ตัวแปรใน `.env` |
