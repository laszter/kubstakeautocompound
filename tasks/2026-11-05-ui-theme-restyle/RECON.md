# RECON — UI restyle (clean/minimal) + dark/light mode (Phase 1, 2026-11-05)

> Source: 3 read-only Explore sub-agents (Opus 5.5). Paths relative to `apps/web/` unless absolute.
> Previous build plan/log (patterns & gotchas): `tasks/2026-11-04-kub-stake-autocompound/TASK.md`.

## B. Current web UI inventory

### Theme foundation
- `src/app/globals.css` (132 lines): imports `tailwindcss`, `tw-animate-css`, `shadcn/tailwind.css` (keyframes + data-* variants only). **Dark variant already declared line 5: `@custom-variant dark (&:is(.dark *));`** → class must be on `<html>` (Base UI portals render in body → inherit).
- `@theme inline` (7–51): maps `--color-*` → background, foreground, card(-fg), popover(-fg), primary(-fg), secondary(-fg), muted(-fg), accent(-fg), destructive, border, input, ring, chart-1..5 + sidebar-* (unused); fonts `--font-sans` (system stack + "Noto Sans Thai", "Sukhumvit Set", "Leelawadee UI", "Thonburi"), `--font-mono`, `--font-heading`; radii from `--radius` (0.625rem).
- `:root` (53–86) stock shadcn neutral oklch (achromatic). `.dark` (88–120) stock dark set exists but **nothing ever applies `.dark`** → all `dark:` classes are untested dead code.
- **No success / warning / info tokens** (only destructive). **No `color-scheme`** (native time/number inputs, scrollbars stay light).
- `src/app/layout.tsx`: `<html lang="th" className="h-full antialiased">`, `<body className="flex min-h-full flex-col font-sans">`; no suppressHydrationWarning, no theme script, no viewport/themeColor export. Root layout static; `(app)` layout + `/login` are `force-dynamic`.
- No CSP / headers → inline theme script not blocked. `src/proxy.ts` only redirects to /login.
- Deps: `@base-ui/react 1.9.0`, `class-variance-authority 0.7.1`, `cn 0.5.2`, `lucide-react 1.68.0` (**SunIcon, MoonIcon, MonitorIcon, SunMoonIcon exist**), `shadcn 4.23.0`, `tw-animate-css 1.4.0`. **No next-themes, no font packages.** New deps ⇒ pin exact + update root `package-lock.json` (Docker uses `npm ci`).

### shadcn ui (`src/components/ui/*`, use `cn` from `"cn"`, all token-based)
alert (default/destructive; AlertDescription default `text-muted-foreground`), badge (`"use client"`; default/secondary/destructive/outline/ghost/link), button (default/outline/secondary(color-mix)/ghost/destructive/link; sizes xs/sm/default/lg/icon*), card (`bg-card ring-1 ring-foreground/10 rounded-xl`, size sm), dialog (**overlay hard-coded `bg-black/10` line 34** — invisible on dark), input/textarea (`dark:bg-input/30`), label, radio-group, select (portal, bg-popover), separator, switch, table (`"use client"`; wrapper `overflow-x-auto`, cells nowrap, head h-10, rows `hover:bg-muted/50`).
→ add `success | warning | info` variants to `badge.tsx` and `alert.tsx`.

### Custom components (`src/components/*`)
- `nav.tsx` ("use client", NAV_ITEMS /, /wallets, /validators, /settings; active `bg-primary text-primary-foreground`; /positions/* = dashboard) — tokens only.
- `worker-status.tsx` (**`import "server-only"`**; `WorkerStatus` chip + `DryRunBadge`): hard-coded `bg-yellow-300 text-yellow-950 hover:bg-yellow-300 dark:bg-yellow-400` (20), `bg-emerald-600 text-white` (47), dot `bg-white` (50); stale/db-error = destructive.
- `action-message.tsx`: success Alert `border-emerald-600/30 text-emerald-700 dark:text-emerald-400` (12).
- `kub.tsx`, `submit-button.tsx`, `auto-refresh.tsx`: tokens/no UI.

### Hard-coded palette colors: 23 lines in 15 files (22 outside ui/) — must become semantic tokens/variants
| File:line | What |
|---|---|
| `components/worker-status.tsx:20,47,50` | DRY RUN yellow, fresh emerald, white dot |
| `components/action-message.tsx:12` | success emerald |
| `(app)/page.tsx:93,134` | success alert emerald; "ทำงาน" badge emerald |
| `(app)/wallets/page.tsx:185` | hot-wallet warning yellow-400 recipe |
| `(app)/wallets/delete-wallet-button.tsx:84` | confirm box yellow-400 recipe |
| `(app)/validators/page.tsx:71,75` | open emerald, paused yellow (local `StatusChips` duplicate) |
| `(app)/settings/page.tsx:91` | worker fresh text emerald |
| `(app)/positions/new/page.tsx:138` | unknown validator warning yellow-500/40 recipe |
| `(app)/positions/new/new-position-form.tsx:117` | existing-position info sky box |
| `(app)/positions/[id]/page.tsx:165,246` | success emerald; "ไม่คุ้ม" warning yellow |
| `(app)/positions/[id]/action-buttons.tsx:96` | DRY RUN text yellow |
| `(app)/positions/[id]/undelegate-form.tsx:124,149` | warning yellow |
| `(app)/positions/[id]/position-settings-form.tsx:149` | mode hint sky text |
| `(app)/positions/_components/badges.tsx:23-25` | constants `GREEN`/`BLUE`/`YELLOW` (used ~7×) |
No `[#..]`/`rgb(`/`hsl(` arbitrary values.

### Status semantics map (define tokens once)
| Meaning | Where | Now |
|---|---|---|
| Worker fresh/stale | worker-status.tsx:45-60, (app)/page.tsx:133-137, settings/page.tsx:90-94 | emerald / destructive |
| DB error | worker-status.tsx:35 | destructive |
| DRY RUN | `DryRunBadge` (dashboard:138, [id]/page:202,328, settings:80), action-buttons:96 | yellow |
| Action status pending/running/done/failed/skipped | badges.tsx:27-33 `ACTION_STATUS` | secondary/BLUE/GREEN/destructive/outline |
| Tx status signed/broadcast/confirmed/reverted/failed | badges.tsx:44-50 `TX_STATUS` | secondary/BLUE/GREEN/destructive/destructive |
| Warn (backoff, ไม่คุ้ม) | badges.tsx:61-67 `WarnBadge` | YELLOW |
| Position chips disabled/claim-only/auto | badges.tsx:93-116 | secondary/destructive/GREEN |
| Validator chips | badges.tsx:70-90 `ValidatorChips` **and duplicate** validators/page.tsx:64-80 `StatusChips` — **inconsistent** (closed destructive vs secondary; paused destructive vs yellow) | → unify into one component |
| claim-only alert | [id]/page.tsx:213-219 | destructive |
| Warning alerts | [id]:246, undelegate:124,149, new/page:138 (yellow-500/40 recipe); wallets:185, delete-wallet:84 (yellow-400 recipe) | 2 recipes → 1 `warning` variant |
| Success alerts | action-message:12, (app)/page:93, [id]/page:165 | emerald |
| Info | new-position-form:117, position-settings-form:149, [id]/page:173 | sky |

### Layout
- Header `(app)/layout.tsx:17-31`: `border-b bg-background/95`, not sticky, `max-w-6xl px-4 py-3 flex-wrap`; text brand "KUB Stake" (not a link, no logo), `<Nav/>`, `ml-auto` `<WorkerStatus/>` + logout form (ghost sm SubmitButton). No mobile menu (wraps). Theme toggle → separate client component beside logout.
- Login page (`login/page.tsx:22-23`): centered `Card max-w-sm`, no header → needs its own toggle placement (corner).
- Main `mx-auto w-full max-w-6xl flex-1 px-4 py-6`, no footer. Page pattern `flex flex-col gap-6`, h1 `text-xl font-semibold` + muted subtitle.
- Dashboard: 4 stat tiles (`Stat` = Card size sm, CardTitle text-xl, grid sm:2 lg:4), worker card, positions table 10 cols. Position detail: mini-stats `grid-cols-3` **not responsive** ([id]/page.tsx:230); 3 tables (6/8/6 cols); danger card `ring-destructive/30`. Validators table 8 cols, wallets 5 cols. Tables scroll horizontally on mobile (no card fallback).
- Mode radio cards: selected `border-primary bg-primary/5` (position-settings-form:141-142); cron preview `bg-muted/40 rounded-lg border p-3`.

### Verify & gotchas
- Gate: `npm run typecheck && npm run lint && npm test && npm run build` (web: `next typegen && tsc --noEmit`, `eslint .`). **No web tests, no visual tests.**
- **Lint: eslint-plugin-react-hooks 7.1.1 `set-state-in-effect: error`** → theme toggle must NOT use `useEffect(()=>setMounted(true))`; use `useSyncExternalStore` or render both icons and toggle visibility with `dark:hidden` / `hidden dark:inline`.
- Browser checks: **NOT `next dev` + Playwright** (reload loop). Use compose (`WEB_PORT=3100`, `.env` exists, DRY_RUN=true) or standalone build (must copy `.next/static` → `.next/standalone/apps/web/.next/static` and `public`; needs all web env vars because of boot-check). Playwright MCP browser is shared between parallel agents → only one agent uses it at a time (others use isolated headless script). Login rate-limit shared bucket → unlock `delete from login_attempts where success=false`.
- Do-not-touch / behaviour: `await requireSession()` first line (never in try/catch); `"use server"` files export only async fns (no theme code there); `worker-status.tsx` is server-only (don't import into client); client comps import `@kubstake/core/browser` only; never select `wallets.encryptedKey`; private-key input stays uncontrolled `type=password` via FormData with its 1p-ignore attrs; keep aria-*, `data-testid="next-runs"`, `suppressHydrationWarning` on next-runs, `prefetch={false}` on Delegate links, `<AutoRefresh/>`, disabled-reason texts, `bind(null,id)` wiring, `startTransition`; bigint formatted server-side (`formatKub`) → strings to client.
- `cn` from `"cn"` is tailwind-merge compatible; custom color tokens like `bg-success` merge fine.
- Root layout reading `cookies()` makes all pages dynamic — they already are (acceptable); `api/health` doesn't use layout.

## A. Reference design (staking.kubchain.com)
Stack: Next.js + antd v5 (seed colorPrimary #0EB366). **Light theme only** (no dark, no toggle, no prefers-color-scheme). Screenshots: `tasks/2026-11-05-ui-theme-restyle/design-ref/*.png` (ref-light-desktop.png, ref-light-desktop-full.png, ref-light-desktop-poolnode-listview.png, ref-light-desktop-validator-detail-full.png, ref-light-desktop-my-delegation.png, ref-light-desktop-delegate-click.png, ref-light-mobile.png, ref-light-mobile-full.png, ref-light-mobile-menu-open.png, ref-emulated-dark-desktop.png).

### Observed look (light)
- Page bg **#FBFAFC**; header #FFFFFF fixed 80px with bottom hairline `inset 0 -1px 0 rgba(0,0,0,.06)`; cards #FFFFFF **1px solid #E8E8E8, no shadow**, radius 8 (sections) / 12 (tiles); inner dividers #F0F0F0; input border #D9D9D9; row hover #FAFAFA; muted fill #F0F0F0; modal mask rgba(0,0,0,.45); modal shadow antd default.
- Text: primary #1A1D21, secondary #606060, muted #919191 (**fails AA 3.15:1**).
- Accent **#0EB366** (hover #2EBF77/#02D767, active #048C51, tint #E1FFEF, subtle border rgba(14,179,102,.24)) — **as text/white-on-fill = 2.74:1, fails AA**.
- Font Roboto 400/500/700 (no tabular-nums). Section title 20/24 w700; big stat number 24/28 w500 centered with 14px muted label + info icon below (gap 8); nav 16px w400, active w500 accent, gap 32; card name 16/24 w700; key-value rows label 14 muted left / value 14 right; buttons 14/22 **w700, pill radius 32, height 40**, letter-spacing .03em; table th 14 w600 #606060, cells 14, rows divided by #F0F0F0, no zebra, hover #FAFAFA.
- Layout: container max-width 1260 + 32px padding (16px mobile), breakpoint 768; 24px vertical rhythm between blocks; section card padding 24 (16 mobile) with title row + 1px #E8E8E8 underline, then toolbar (search left max 450px h48; sort select + view toggle right); top nav bar (logo left, links, pill CTA right; hamburger dropdown on mobile); footer = one centered line.
- Components: **stats strip** = one card with 3 equal columns separated by 1px #F0F0F0 (stacked on mobile); validator grid `repeat(auto-fill,minmax(340px,1fr))` gap 24, tile padding 16 radius 12 border only, logo + name + address + 3 kv rows + full-width outline pill button; tables become cards on mobile; dialog 332px radius 8 with header divider → **bottom sheet on mobile**; detail header card with an 80px gradient banner `linear-gradient(90deg,#112534,#08643B)`; empty state = 96px #F0F0F0 circle + 56px grey icon + 16px #606060 text + primary pill CTA; chips 1px #E8E8E8 radius 8 padding 8/16; count badge solid accent pill.
- Focus: input border #2EBF77 + `0 0 0 2px rgba(8,168,68,.15)`.

### Emulate vs not copy
- Emulate: cool off-white page + white hairline-bordered cards (no shadows), one green accent used sparingly (active nav, primary CTA, outline buttons, toggles, focus), radius 8/12/pill, pill bold 40px buttons, 24px rhythm, big centered stat numbers with muted labels in one hairline-separated card, section title + hairline underline, table→cards on mobile, dialog→bottom sheet on mobile, calm grey type hierarchy, no glass/blur.
- **Do NOT copy:** KUB logo/wordmark, hero image, validator logos, "KUB Stake / Proof of Stake" hero text, copyright line, favicon/OG. Don't rebuild the identical header (logo-left + green nav + "Connect Wallet" pill) + image hero. Use our own name/mark + typographic header; if using a banner gradient, alter hue/angle.

### Proposed accessible LIGHT tokens (hex)
`--background` #FBFAFC · `--card`/`--popover` #FFFFFF · `--muted` #F0F0F0 · row hover #FAFAFA · `--border` #E8E8E8 · subtle divider #F0F0F0 · `--input` #D9D9D9 · `--foreground` #1A1D21 (16.9:1) · secondary #606060 (6.3:1) · `--muted-foreground` **#6B7280** (4.83:1) · `--primary` **#088048** (white text 5.01:1), hover #076B3D · brand accent **#0EB366 non-text only** (indicators/icons/tint borders; or #04140B text on it 6.9:1) · accent text/link #087A45 (5.41:1) · accent tint bg #E7F8EF + #087A45 text (4.92:1) · `--ring` #088048 · destructive #D92D20 (4.83:1) · warning #B54708 (5.43:1) · info #1570EF (4.57:1) · success = primary.

### Proposed DARK tokens (hex, ratios computed by agent)
`--background` #0E1114 · `--card` #15191D · `--popover` #1C2126 · `--muted` #1F252B · `--border` #2A3037 (decorative only; form-control borders ≈ #4A525C for ~3:1, UNVERIFIED) · subtle divider #22272D · `--input` #333A42 · `--foreground` #E6E8EB (14.4:1 on card) · secondary #A6ADB5 (7.8:1) · `--muted-foreground` #8A929B (5.6:1 card / 4.9:1 muted) · `--primary` #19C474 (fill) hover #3DD68C, `--primary-foreground` **#04140B** (8.3:1) · accent text #19C474 (7.7:1) · accent tint bg #12291F + #3DD68C text (8.2:1) · `--ring` #19C474 · success #34D399 · warning #F5B748 · destructive #F87171 (text on fill #1A0505) · info #60A5FA · card shadow none · dialog shadow `0 8px 32px rgba(0,0,0,.5)` · overlay rgba(0,0,0,.6) · banner gradient e.g. `linear-gradient(90deg,#0F1E2A,#075233)`.

## C. Theming tech

### Recommendation: cookie-based SSR theme + CSS-only `system` (no dependency)
- Rejected `next-themes@0.4.6` (last release 2025-03; open Next 16 issue #385 "Encountered a script tag while rendering React component", React 19.2 remount issues; needs suppressHydrationWarning + mounted guard + nonce for CSP).
- Follows Next 16.4 doc `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`. No inline script, no FOUC, no nonce; works unchanged in standalone Docker.
- `cookies()` in root layout makes every route dynamic — already true for all pages; route handlers (`/api/health`) don't use layouts.

Sketch:
1. `src/lib/theme.ts` (shared, NOT server-only): `THEMES = ['light','dark','system'] as const`, `type Theme`, `THEME_COOKIE='theme'`, `parseTheme(v?) → Theme` (whitelist, default `'system'`).
2. `src/app/layout.tsx`: async root layout reads cookie → `<html lang="th" className={\`h-full antialiased ${theme}\`}>`; `export async function generateViewport()` returns `colorScheme` (`'light dark'` for system) + `themeColor` (media-split for system).
3. `globals.css` — replace variant line:
```css
@custom-variant dark {
  &:is(.dark, .dark *) { @slot; }
  @media (prefers-color-scheme: dark) { &:is(.system, .system *) { @slot; } }
}
:root { color-scheme: light; /* light tokens */ }
:root.dark { color-scheme: dark; }
:root.system { color-scheme: light dark; }
:root { @variant dark { /* dark tokens written once */ } }
.theme-switching, .theme-switching *, .theme-switching *::before, .theme-switching *::after { transition: none !important; }
```
   (`:is()` keeps shadcn specificity; `:where()` would zero it.) **UNTESTED combo** → after build grep built CSS for the dark token selectors; fallback = keep `.dark{}` block + duplicate inside `@media (prefers-color-scheme: dark){ .system{…} }`.
4. `src/components/theme-toggle.tsx` ("use client"): prop `initial: Theme` from server (layout reads cookie). `apply(t)`: add `theme-switching` class → `classList.remove('light','dark','system'); add(t)` (never overwrite className) → `document.cookie = theme=t; Path=/; Max-Age=31536000; SameSite=Lax(+Secure on https)` → flush styles → remove `theme-switching` next tick. Cookie NOT httpOnly; server whitelists via parseTheme. UI = 3-option radiogroup/segmented (ui/radio-group exists) or menu; Thai aria-label "ธีม", options "สว่าง / มืด / ตามระบบ" (icon + sr-only text). Lint: no `useEffect(setState)` (react-hooks `set-state-in-effect: error`) — initial value comes from server prop so no mounted guard needed.

### Fonts
- **Pick `@fontsource-variable/anuphan@5.3.0`** (OFL; Latin 35 KB + Thai 18.9 KB woff2, weights 100–700, fixed-width digits, compact metrics line-height ~1.30). Import `import "@fontsource-variable/anuphan";` in `src/app/layout.tsx` (unicode-range subsets; files → `.next/static/media`, Dockerfile already copies `.next/static`; no network at build beyond npm ci). Avoid `font-extrabold`/`font-black`.
- Stack: `--font-sans: "Anuphan Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans Thai", "Leelawadee UI", Thonburi, sans-serif;` keep `--font-mono` system (addresses/hashes). KUB amounts: `tabular-nums` + right-align.
- Alternatives: noto-sans-thai variable (58 KB), ibm-plex-sans-thai static (~90 KB for 3 weights), inter (no Thai).

### Base UI / shadcn dark gotchas
- Portals render into `document.body` → theme class MUST be on `<html>`.
- Dialog backdrop `bg-black/10` → needs dark override (e.g. `dark:bg-black/60` or token).
- Dark depth: shadows barely visible; card vs background contrast low → rely on 1px borders (matches reference style).
- **Focus ring** `outline-ring/50` / `focus-visible:ring-ring/50` = 1.54:1 light, 1.87:1 dark (< 3:1) → use full-opacity `--ring` with accessible color (light ≈ #088048, dark #19C474) and drop `/50`.
- Base UI 1.9 has `CSPProvider` if a CSP is added later.

### Icons (lucide-react 1.68): `SunIcon`, `MoonIcon`, `MonitorIcon`, `SunMoonIcon`, `LaptopMinimalIcon`, `ContrastIcon` (project uses `XxxIcon` form).

### A11y checklist
- Current light `--muted-foreground` on muted/secondary = 4.34:1 ✗ → darken (proposed #6B7280).
- Input borders ~1.3–1.5:1 < 3:1 (WCAG 1.4.11) → raise `--input` (light #D9D9D9 is still low; consider ≈ #C4C9CF or ensure focus/label carry meaning; dark ≈ #4A525C).
- Set `color-scheme` per class + viewport `colorScheme` meta.
- Instant theme switch (no transitions); if adding view-transition crossfade, skip on `prefers-reduced-motion`.
- Toggle = radiogroup/menu radio with visible selected state + Thai labels.
- Test every page in light, dark, system+OS-dark incl. dialog/select popups and focus-visible.
