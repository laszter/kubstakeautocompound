# RECON — KUB Stake Auto-Compound (Phase 1 findings, verified 2026-11-04)

> Source: 3 read-only Explore sub-agents (Opus 5.5). Everything verified on-chain / npm / Docker Hub unless marked UNVERIFIED.
> This file is reference material for TASK.md. Implementers: treat these numbers/addresses/ABIs as the source of truth.

## 0. User decisions (resolved)
- Multiple wallets AND each wallet can delegate to multiple validators (position = wallet × validator).
- **KUB Mainnet only** (chainId 96). No testnet support in UI. (Testnet facts kept below only for reference.)
- Auth: single admin password + web bound to 127.0.0.1 by default.
- Stack: TypeScript end-to-end (Next.js + Node worker + PostgreSQL + Drizzle + viem).
- Auto-compound: system computes an optimal claim/compound threshold; user may override.

---

## 1. Chain & contracts (KUB Mainnet, chainId 96)

| Item | Value |
|---|---|
| RPC | `https://rpc.kubchain.io` (works; `-32005 Rate limit exceeded` on huge getLogs → chunk ≤ 50k blocks, backoff). viem built-in `bitkub` chain uses `https://rpc.bitkubchain.io` → override RPC via env |
| Explorer | `https://www.kubscan.com` (Blockscout v2 API: `/api/v2/...`), tx link `https://www.kubscan.com/tx/<hash>` |
| Block time / gas | ~3s, gasPrice 25 gwei, **no baseFeePerGas → send LEGACY txs (`type: 'legacy'`, `gasPrice`)** |
| StakeManager (StakeManagerV2, not proxy) | `0x443502b3F7C0934576F49CDa084f78640f56A80F` |
| StakeManagerStorage (V2) | `0xfd98aac1fbc57e6bc16a167452dba7af2b6a4c0d` |
| StakeManagerVault (pays KUB out) | `0xcf726f7fe91d0f2373904d350b926830784e810c` |
| Staking NFT | `0x8ae4cb6a020121bcbd855fffc79a11984be62b39` |
| ValidatorShareFactory | `0x275d0cf1384b782db4212e074f147de9b7b2e6b2` |
| Validator names (off-chain) | Subgraph `https://gateway.bitkubgraph.io/subgraphs/name/bitkubchain/pos` (introspection disabled). Example query: `{ validators(where:{isDelegation:true}){ validatorId blockSigner validatorShareContract status minDelegated poolType commissionRate totalDelegator totalPower profile{name image} } }` — optional/best-effort, app must work without it |

Testnet (reference only, NOT used): chainId 25925, RPC `https://rpc-testnet.bitkubchain.io` (docs URL rpc-testnet.kubchain.io is NXDOMAIN), StakeManager V3 `0xd4a1478020092e624db300714E41b3D39fc6313f`, storage `0xc339c3abc4db5a730c6610058535dbec52763dd6`.

### Reward mechanics (from verified source)
- Every block with fees, the producer calls `StakeManager.distributeReward{value: fees}` → split pro-rata by stake, commissions (bps) taken, delegator part accrues to the validator's pool. **Rewards accrue per block**, not per checkpoint.
- Delegator rewards = **tx fees only** → APR is very low (~0.18–0.27% sampled, UNVERIFIED long-run).
- `getLiquidRewards(user)` is already net of commission. Principal never slashed (only validator self-stake).

### Validator discovery algorithm
1. `n = Storage.getValidatorListLength()` (mainnet: 46).
2. For id in `0..n-1`: `Storage.getValidatorInfoByIndex(id)` → keep if `status == 1 && validatorShareContract != 0x0`.
3. For each share: read `delegation()`, `minDelegated()`, `isOfficialPool()`, `paused()`, `totalSupply()`. Offer for delegation only if `delegation && !paused && !isOfficialPool`.
4. Optional: `Storage.isInMinimalValidatorListByValidatorId(id)` (in block-producing set), subgraph for name/logo.
5. **Key validators by `validatorId` + share address** (signers repeat across ids).
- Use multicall-less batching (Promise.all with modest concurrency) — viem `bitkub` chain has no multicall3 defined.

`Validator` struct (status: 0 Uninit, 1 Active, 2 Unstaked; rates in bps, MAX 10000):
`(uint128 amount, uint128 delegatedAmount, uint128 reward, uint128 delegatorsReward, uint128 infraCommissionAmount, uint128 validatorCommissionAmount, uint128 delegatorCommissionAmount, uint128 minDeposit, address signer, address validatorShareContract, uint8 status, uint16 infraCommissionRate, uint16 commissionRate)`

### Sample real mainnet validators (delegation enabled)
| id | name | ValidatorShare | delegated (KUB) | commission bps | minDelegated |
|---|---|---|---|---|---|
| 0 | KUB (official, 1614 delegators) | 0x89a587d40be5b1fe8c9d052c0bcda1a48c10fa20 | 5,668,489 | 500 | 1 KUB |
| 22 | DaddyKim & BearFaceTrader | 0x488023dff3f0b063e4c0c2d939d9a10b1aba72e7 | 1,039,601 | 400 | 10 |
| 24 | Bitkao | 0x1da3d9b03a6efd3d0b132dd6bdbe494bdb86e298 | 2,153,083 | 400 | 10 |
| 32 | Bitkub Blockchain Technology | 0x18dcc6ea272db3efc6e2c637cae5cd5534be6b1e | 1,078,016 | 500 | 10 |
| 33 | JFIN Chain | 0x0b5b8cecd23cd08b1e838615082508b102b15137 | 23,530 | 500 | 10 |
| 34 | SIX Network | 0xcb953d01453f5837cad0a5c5ac654196210a73b9 | 7,283 | 500 | 10 |
| 43 | Contribution DAO | 0x55a245e60258a622e14f7022686ecbfaf09eacf9 | 610 | 500 | 10 |
| 44 | DTC Group | 0x4ecd3e0078a2315d4cb26d6b8f07859f321bd2c0 | 120 | 500 | 10 |
| 45 | 9CAT GROUP | 0x57bba88d544da33b8932674e812b3a30eaf11a98 | 510 | 500 | 10 |
- id 10: status 2 (unstaked), delegation=false → delegate reverts "ValidatorShare: delegation is disabled", but claim/undelegate still work. UI must still show/allow exit for such positions.

### ValidatorShare (per-validator; also KAP20 token "BKC-D", 18 dec, 1 share = 1 KUB principal, NOT a proxy)
Write (any EOA; each **auto-claims pending reward to caller first**):
| Function | Selector | Effect | gasUsed |
|---|---|---|---|
| `delegate() payable returns (uint256)` | 0xc89e4361 | auto-claim, then mint shares = msg.value | 150k–261k |
| `undelegate(uint256 claimAmount_) returns (uint256)` | 0x6c68c0e1 | auto-claim, burn, **principal returned same tx (no unbonding)** | 180k–231k |
| `claimRewards() returns (uint256)` | 0x372500ab | send pending reward | 110k–115k |
- **Do NOT include** overloads `delegate(uint256,address)`, `undelegate(uint256,address)`, `claimRewards(address)` (onlyCallHelper) → avoids viem overload ambiguity.

Read: `getLiquidRewards(address) → uint256 wei`, `balanceOf(address)` = principal, `totalSupply()`, `validatorId()`, `delegation()`, `minDelegated()`, `isOfficialPool()`, `paused()`.

Events (emitted by the ValidatorShare itself):
- `Delegated(uint256 indexed validatorId, address indexed user, uint256 amount)`
- `Undelegated(uint256 indexed validatorId, address indexed user, uint256 amount)`
- `ClaimedRewards(uint256 indexed validatorId, address indexed user, uint256 amount)` — also emitted inside delegate/undelegate when reward > 0
- KUB arrives as native internal transfer from StakeManagerVault → use event `amount` for history (decode receipt logs).

### Compound mechanics (CRITICAL)
- **No `restake()` on ValidatorShare.** (StakeManager.restake is operator-only.)
- **Single-tx compound (preferred):** `r = getLiquidRewards(user)`; if `r >= threshold` → `delegate{value: r}`. Contract pays `r` (+ a few blocks more) back in the same tx then mints `r` shares ⇒ net effect: rewards restaked. **Precondition:** wallet free balance ≥ `r + gasCost` (msg.value debited before refund arrives).
- **Fallback two-tx compound** (when free balance < r + gas): `claimRewards()` → wait receipt → `delegate{value: claimed − gasReserve}`.
- `balanceOf + r >= minDelegated` always true for existing delegator ⇒ top-ups of any size OK.
- Undelegate gotcha: if `balanceOf − amount < minDelegated` ⇒ whole balance undelegated; amount > balance reverts "too much requested". Return value = actual undelegated.
- Minimum check is per-user: `balanceOf(user) + msg.value >= minDelegated` (first delegation must be ≥ minDelegated: 1 KUB for id 0, 10 KUB for others). No contract minimum for claim.
- Validator owner can switch `delegation=false` or raise `minDelegated` anytime → re-check before each compound; treat revert strings as non-fatal/skip.
- BKC-D share transfers auto-claim — app should not transfer shares.

### Minimal viem ABI (embed in packages/core)
```ts
export const stakeManagerStorageAbi = parseAbi([
  'struct Validator { uint128 amount; uint128 delegatedAmount; uint128 reward; uint128 delegatorsReward; uint128 infraCommissionAmount; uint128 validatorCommissionAmount; uint128 delegatorCommissionAmount; uint128 minDeposit; address signer; address validatorShareContract; uint8 status; uint16 infraCommissionRate; uint16 commissionRate; }',
  'function getValidatorInfoByIndex(uint256 index_) view returns (Validator)',
  'function getValidatorListLength() view returns (uint256)',
  'function isInMinimalValidatorListByValidatorId(uint256 validatorId_) view returns (bool)',
  'function minimumPoolDelegate() view returns (uint256)',
  'function totalStaked() view returns (uint256)',
]);
export const stakeManagerAbi = parseAbi([
  'function getValidators() view returns (address[])',
  'function getMinimalValidators() view returns ((address signer, uint256 power)[])',
  'function stakeManagerStorage() view returns (address)',
]);
export const validatorShareAbi = parseAbi([
  'function delegate() payable returns (uint256)',
  'function undelegate(uint256 claimAmount_) returns (uint256)',
  'function claimRewards() returns (uint256)',
  'function getLiquidRewards(address user_) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function validatorId() view returns (uint256)',
  'function delegation() view returns (bool)',
  'function minDelegated() view returns (uint256)',
  'function isOfficialPool() view returns (bool)',
  'function paused() view returns (bool)',
  'event Delegated(uint256 indexed validatorId, address indexed user, uint256 amount)',
  'event Undelegated(uint256 indexed validatorId, address indexed user, uint256 amount)',
  'event ClaimedRewards(uint256 indexed validatorId, address indexed user, uint256 amount)',
]);
```

---

## 2. Compound economics (mainnet, block ~36,723,000)

### Facts
- gasPrice 25 gwei (occasionally 26–30), legacy txs, block time exactly 3.0s.
- RPC is NOT archive (historical eth_call → "missing trie node"); getLogs OK for 5k–10k block ranges; rate limit `-32005 retryAfter 60` on bursts; no `eth_getBlockReceipts`.
- Rewards = 100% tx fees, distributed per block (no subsidy). ~179 KUB/day network-wide over 10.87M KUB staked.
- **Delegator APR ≈ 0.55–0.62% (~0.58%)**, volatile with fee volume → measure live, don't hard-code.

| Action | gasUsed | Cost @25 gwei |
|---|---|---|
| `claimRewards()` | 109,643 | 0.00274 KUB |
| `delegate()` with pending reward paid out (= 1-tx compound) | ~207,378 (198k–222k) | 0.00518 KUB |
| `delegate()` no reward payout | 148k–191k | 0.0037–0.0048 |
| `undelegate()` | ~179,600 | 0.00449 |
| 2-tx compound (claim + delegate) | ~301,000 | 0.00753 |
- **Gas-limit gotcha:** a real delegate tx ran out of gas (limit 154,245) because it was estimated when no reward was pending. Use gas limit floors: delegate ≥ 260k, claim ≥ 140k, undelegate ≥ 230k (or estimateGas×1.25 with these floors).

### Optimal compound formula (verified)
Loss rate L(t) = C/t + P·r²·t/2 → **t\* = √(2C/(P·r²))**, **R\* = P·r·t\* = √(2·C·P)** (independent of r!).
- Compounding beats never-compounding (1-yr horizon) only when **P > 8C/r²** ≈ 1,230 KUB (1-tx) / ≈1,790 KUB (2-tx).

Code (BigInt wei):
```
C      = gasPrice * GAS_EST          // GAS_EST = 210_000n (1-tx) or 301_000n (2-tx); use expected gasUsed, not limit
P      = share.balanceOf(user)
R      = share.getLiquidRewards(user)
R_star = isqrt(2n * C * P)
doCompound = R >= max(R_star, R_FLOOR) && gasPrice <= MAX_GAS_PRICE && now - lastCompound >= MIN_INTERVAL
r_est  = EWMA((R_now - R_prev) / (P * dt))   // between checks with no tx in between
t_next = max(0, R_star - R) / (P * r_est)    // ETA shown in UI, drives next check time
```
Worked (1-tx, r=0.58%, C=0.005184 KUB):
| P (KUB) | R\* | t\* | extra KUB/yr |
|---|---|---|---|
| 100 | 1.02 | ~641 d | ≈0 / negative |
| 1,000 | 3.22 | ~203 d | ≈0 / negative |
| 10,000 | 10.18 | ~64 d | +0.11 |
| 100,000 | 32.2 | ~20 d | +1.5 |
| 1,000,000 | 101.8 | ~6.4 d | +16.3 |

### Recommended worker policy
- Prefer **1-tx compound**: `delegate{value: X}` with `X = min(pending, liquidBalance − gasReserve)`; needs one-time liquid float ≥ R\*. If liquid < pending + reserve → fallback 2-tx (`claimRewards` → wait receipt → `delegate{value: claimed}` keeping reserve). Use C for the path actually chosen.
- Check cadence: cheap eth_calls every ~1h, or adaptive `clamp(t_next/4, 15min, 6h)`. Respect rate limits (sequential reads, small concurrency, retry/backoff on -32005).
- Threshold: `R >= max(√(2·C·P), R_FLOOR)` with C from live eth_gasPrice. User may override with a fixed threshold (KUB) per position.
- UI warning when P < ~1,200 KUB or t\* > 180 days: "auto-compound not worth it yet".
- Guards: gas reserve ≥ 0.05 KUB never staked; MAX_GAS_PRICE ~50 gwei (skip cycle if higher); MIN_INTERVAL ≥ 1h; exponential backoff after revert; never send value=0; simulate (`estimateGas`/`eth_call`) exact tx first; pre-check `delegation()`, `!paused()`, `!isOfficialPool()`, validator status==1; verify receipt status + `Delegated`/`ClaimedRewards` logs; re-read share address from Storage at startup; if delegation disabled/validator inactive → claim-only mode + alert in UI.

---

## 3. Tech stack & Docker (verified versions 2026-11-04)

| Package | Version to pin | Notes |
|---|---|---|
| next / create-next-app | 16.4.5 | node ≥20.9; `proxy.ts` replaces deprecated `middleware.ts`; `output:'standalone'` |
| react / react-dom | 19.3.1 | |
| viem | 2.57.16 | built-in `bitkub` (96) chain, no multicall3 |
| drizzle-orm / drizzle-kit | 0.45.4 / 0.31.11 | do NOT use v1 RC; docs site shows v1 RC folder layout — stable uses flat `NNNN_tag.sql` + `meta/_journal.json` |
| pg / @types/pg | 8.23.1 | |
| tailwindcss / @tailwindcss/postcss | 4.3.4 | |
| shadcn CLI | 4.23.0 | default lib is now Base UI; `npx shadcn@4.23.0 init -d --no-monorepo` (or `-b radix`) |
| zod | 4.6.7 | |
| pino | 10.4.0 | no transports |
| iron-session | 9.0.1 | `getIronSession(await cookies(), opts)` |
| @node-rs/argon2 | 2.2.2 | argon2id; in Next default serverExternalPackages |
| croner | 11.0.0 | `protect: true` overrun protection |
| esbuild | 0.28.2 | bundle worker + migrate to CJS |
| tsx | 4.23.15 | dev |
| **typescript** | **~6.0.3** | TS 7 breaks typescript-eslint (peer <6.1.0); create-next-app writes `^5` → change |

Rejected: Prisma (8.0 RC is `latest`, client 7.x mismatch, needs CLI in image), pnpm (Node 26 image has no corepack), pg-boss (overkill for single job type), TS 7.

Base images: **`node:26-slim`** (Node 26 = Active LTS since 2026-10-28; **no corepack/yarn in Node 26 images → use npm**), **`postgres:18-alpine`** (PG18: mount volume at **`/var/lib/postgresql`**, NOT `/var/lib/postgresql/data`).

### Monorepo layout (npm workspaces)
```
/package.json            {"private":true,"workspaces":["apps/*","packages/*"]}
/apps/web                Next.js 16 (App Router, server actions, proxy.ts, /api/health)
/apps/worker             src/worker.ts, src/migrate.ts → esbuild → dist/worker.cjs, dist/migrate.cjs
/packages/db             drizzle schema + client + committed migrations (drizzle/)
/packages/core           env (zod), crypto (AES-256-GCM), chain (viem client, ABIs, validator discovery), compound math
/Dockerfile (multi-target: web, worker)  /docker-compose.yml  /.env.example  /.dockerignore
```
- Workspace packages may export TS source directly (Turbopack transpiles them).
- `apps/web/next.config.mjs`: `output:'standalone'`, `outputFileTracingRoot` + `turbopack.root` = repo root → server at `.next/standalone/apps/web/server.js` (verify after first build).
- Worker build: `esbuild src/worker.ts src/migrate.ts --bundle --platform=node --target=node26 --format=cjs --outdir=dist --out-extension:.js=.cjs --external:pg-native` (if pino fails to bundle → mark external & copy).
- Standalone needs manual copy of `.next/static` and `public`; set `HOSTNAME=0.0.0.0` in web image.
- `NEXT_PUBLIC_*` inlined at build → keep runtime config server-side only.

### Dockerfile (single file, targets `web` and `worker`) — see sub-agent skeleton
stages: `deps` (copy all package.json + lock, `npm ci`) → `build` (copy all, build web + worker) → `web` (standalone, USER node, `node apps/web/server.js`) → `worker` (dist + drizzle folder, USER node, `node dist/worker.cjs`).

### Migrations
- One-shot `migrate` compose service (worker image, `node dist/migrate.cjs`) using `drizzle-orm/node-postgres/migrator` `migrate(db,{migrationsFolder})` wrapped in `pg_advisory_lock`. web & worker `depends_on: migrate: condition: service_completed_successfully`.
- Dev: `npx drizzle-kit generate --name <x>` in packages/db; commit SQL + meta.

### Worker scheduling
- Only the worker decrypts keys and signs. Web inserts rows into an `actions` queue table (delegate / undelegate / claim / compound-now); worker executes.
- Leader lock: dedicated `pg.Client` holding `pg_try_advisory_lock(hashtext('kubstake-worker'))` for process lifetime.
- Tick loop every 30–60s (croner `protect:true` or recursive setTimeout). Select due work `FOR UPDATE SKIP LOCKED`.
- Idempotent tx state machine: sign locally (`account.signTransaction`), **persist tx hash before `sendRawTransaction`**, on restart wait for receipt instead of resend; explicit nonce from `getTransactionCount({blockTag:'pending'})`; assert `getChainId()==96` before signing.
- Heartbeat row updated each tick; web shows worker status. SIGTERM → finish current step; compose `stop_grace_period: 60s`.

### docker-compose essentials
- Services: `db` (postgres:18-alpine, healthcheck `pg_isready`, volume `pgdata:/var/lib/postgresql`, NOT published), `migrate` (one-shot), `web` (ports `${WEB_BIND:-127.0.0.1}:${WEB_PORT:-3000}:3000`, healthcheck via `node -e fetch(...)` — slim has no curl), `worker`.
- Required env with `${VAR:?msg}` fail-fast: `POSTGRES_PASSWORD`, `MASTER_KEY` (`openssl rand -base64 32`), `SESSION_SECRET` (`openssl rand -base64 48`), `ADMIN_PASSWORD`.
- Defaults: `CHAIN_ID=96`, `RPC_URL=https://rpc.kubchain.io`.

### Security checklist
- MASTER_KEY: 32 bytes base64; assert length at boot or refuse to start.
- AES-256-GCM: fresh 12-byte IV per encryption, 16-byte tag, AAD = `walletId|address` (or address), store `v1:iv:tag:ct` (base64). Derive address with `privateKeyToAccount` on import; store address plaintext.
- Threat model doc in README: encryption protects DB dumps/backups, not a compromised host. Back up MASTER_KEY separately — losing it = keys unrecoverable.
- Key never leaves server: `server-only` modules, never returned from server actions/RSC props, never `NEXT_PUBLIC_*`. Web only *encrypts* on import; only worker decrypts.
- Auth check inside every server action & route handler (don't rely on proxy.ts alone).
- iron-session cookie: httpOnly, sameSite lax/strict, short TTL, `secure` from `COOKIE_SECURE` env (default false for localhost http).
- Admin password: argon2id hash of `ADMIN_PASSWORD` at boot (or compare via argon2 verify); login rate limit.
- pino redact: `privateKey, *.privateKey, encryptedKey, *.encryptedKey, password, *.password, masterKey, req.headers.cookie, req.headers.authorization`.
- Bind web to 127.0.0.1, don't publish Postgres, containers run as `node`, `.dockerignore` excludes `.env*`, no secrets in build args.
- Chain safety: chainId check, explicit nonce, persist hash pre-broadcast, keep gas reserve (never delegate full balance).
