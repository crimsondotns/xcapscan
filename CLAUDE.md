# CLAUDE.md

XCap Scan — static multi-wallet transaction list (React 19 + Vite, GitHub Pages, no backend, no auth).

## Design system — mandatory: shadcn/ui (user decision, 2026-10-01)

**Before any UI change, new element, or edit: read `.agents/skills/shadcn/SKILL.md` and the rule files it links (`rules/styling.md`, `rules/forms.md`, `rules/composition.md`, `rules/icons.md`, `rules/base-vs-radix.md`, `customization.md`) and follow them.** They are the single source of truth for colour, type, spacing, radius, components, forms, icons and accessibility. The old OpenAI-based `docs/design-system.md` was deleted on purpose; never bring it or its rules back.

Key rules: semantic tokens only (`background`, `foreground`, `primary`, `muted`, `muted-foreground`, `border`, `ring`, `destructive`…), never raw colours and no manual dark overrides; use existing shadcn components and their built-in variants before custom markup; `className` for layout, not for restyling components; `flex` + `gap-*` (no `space-*`); `size-*` for equal sides; forms use `FieldGroup` + `Field`, option sets use `ToggleGroup`, buttons inside inputs use `InputGroup`; overlays (`Dialog`, `Sheet`, `Drawer`) always have a title; empty states `Empty`, loading `Skeleton`, labels `Badge`, dividers `Separator`; icons in buttons use `data-icon`, no sizing classes on icons. Both light and dark theme must work, and `prefers-reduced-motion` is honoured.

Stack (migrated 2026-10-01): Tailwind 4 + shadcn `base-nova` on Base UI (`components.json`, alias `@/`, `cn` from `@/lib/utils` — never the `cn` npm package the CLI sometimes writes; fix the import after every `shadcn add`). Components live in `src/components/ui/` (add with `pnpm dlx shadcn@latest add <name>`, never hand-copy). Colours are shadcn tokens in `src/styles/tokens.css` (`--background` … `--ring`, plus `--positive` / `--warning`); old `--color-*` names are aliases kept only for the remaining legacy CSS. `src/styles/globals.css` = Tailwind + theme; `app.css` is imported into `@layer legacy` *below* Tailwind utilities, so shadcn classes always win — new UI uses Tailwind classes, not new rules in `app.css`. Dark mode = `data-theme='dark'` on `<html>` (custom variant `dark`). Mobile breakpoint hook: `src/hooks/useIsMobile.ts`.

## Before every delivery — mandatory audit

1. Re-read `.agents/skills/shadcn/SKILL.md` and the relevant rule files.
2. Audit every screen and state — default, hover, focus-visible, active/selected, disabled, error, empty, loading — **in both Light and Dark theme** against those rules.
3. Any mismatch = fix first, then re-run `pnpm typecheck && pnpm check && pnpm test && pnpm build`. Never skip, never deliver with a known deviation.

## Responsive (user spec, 2026-09-21)

Breakpoints: mobile < 640, tablet 640–1024, desktop > 1024. Tokens in `tokens.css` switch per breakpoint: body 14px below 1024 / 16px above; section spacing 12 / 16 / 24; controls 48px / 40px / 40px. Mobile: single column, full-width inputs, wallet-group rail becomes one full-width Select (sections Tags / Chains, user 2026-10-01), transaction table shows 2 columns (Type · Amount), fits the screen, no sideways scroll (user, 2026-10-01), dialogs are full-width bottom sheets, detail panel full-screen. Tablet: wallets panel collapsible via the header toggle, panel 80% width. Desktop: sticky wallets panel, all columns. `html, body { overflow-x: clip }` (never `hidden` — that makes body a scroll container and breaks every sticky element) — nothing may scroll the page sideways. Table header sticks under the 64px site header on wide screens; below 1024px the table scrolls inside its wrapper instead.

## Transaction table (user spec, 2026-09-21)

Four columns, all sortable: **Type** (token icon 40px, or two 28px overlapping icons for a swap, chain badge bottom-right; title = type, subtitle = wallet · token name or `OUT → IN`), **Submitted** (relative time: `29 min ago`, `15:04, yesterday`, `17:48, 17 Sep 26`), **Amount** (compact in the table, full precision only in the detail panel; incoming legs first in `--color-positive` green/medium, outgoing below in muted, same size and weight as incoming — user 2026-10-01), **Network fee** (USD, native amount; no hash link). No borders, no shadow; row click opens the detail panel.

## Wallets panel (user spec, 2026-09-21)

Never collapses. Each row is a button: click = switch the active wallet (table filters to it; click again = all wallets); the eye icon toggles hide/show that wallet's data (`enabled` in the store = not hidden; the panel derives a `hiddenWallets` Set). Icons: `eye` (shown) / `eyeOff` (hidden). Trash removes. No checkboxes.

## Hard rules

- Never hardcode or name any external history source in code, comments, docs or tests — the user pastes URLs at runtime. `pnpm check` enforces this.
- Chain names/logos/explorer links come from the user-pasted **Chain list URL** in Settings first, then `<origin of each pasted source>/v1/chain/list` (`src/chains.ts`), cached 24h; failure is silent (lettered fallback). No chain list host may be hardcoded or bundled. Chain logo priority: chain list → feed `chain_logo_url` → initials; never the native token's logo.
- Data sources are added from a URL only: name and chain family are auto-detected (`detectEndpoint` in `store.ts`); never add manual name/chain fields back.
- **Zero hints to the client.** No placeholder text, helper text, example URLs, placeholder syntax (`{address}` etc.), chain explanations or request previews in the UI or README. Labels only; errors are generic ("Invalid URL"). The user is expected to know.
- All UI text goes through `t()` in `src/i18n.tsx` (Thai key + English pair). No literal Thai in `.tsx`.
- No `px` font-size in CSS; use `--size-*` tokens. No gradients.
- Icons are lucide-react: import from `lucide-react` directly in new code (`data-icon` inside buttons); `components/Icon.tsx` is a name→lucide map kept for existing callers.
- No `type="number"` inputs (spinner arrows banned): numeric fields are `type="text" inputMode="numeric"`, typed by hand.
- No native `<select>`; dropdowns use shadcn `Select` (`components/Dropdown.tsx` wraps it with the old API) / `DropdownMenu` / `Popover` + `Command`.

## Commands

```bash
pnpm dev · pnpm typecheck · pnpm check · pnpm test · pnpm build
```

Do not declare work done while any of these is red.

## Lazy loading (2026-09-22)

- (อัปเดต 2026-09-22) เปิดแดชบอร์ด → `loadStaggered`: โหลดกระเป๋าที่ยังไม่มีข้อมูล **ทีละ 5 พร้อมกัน เว้น 2 วิ** ระหว่างชุด (`useFeed` BATCH/BATCH_GAP_MS) เริ่มครั้งเดียวต่อชุดแหล่งข้อมูล; หยุดเองเมื่อเจอ HTTP 429; ผู้ใช้กด Cancel ได้; แสดง "N/M wallets loaded" ที่หัวตารางธุรกรรมล่าสุด — คลิกกระเป๋า/หน้า 2 ยังใช้ `ensure` (แคช) เหมือนเดิม
- `useFeed.feeds[walletId]` คือแคชในหน่วยความจำ: `ensure(w)` โหลดเฉพาะเมื่อยัง `loaded`/`loading` ไม่เป็นจริง; แหล่งข้อมูลเปลี่ยน → `reset()` ล้างแคช ไม่โหลดใหม่เอง
- สถานะโหลดต่อกระเป๋า: วงหมุน `.spinner` ในแถวกระเป๋า ตารางขึ้น "Loading…" ระหว่างรอ

## โครงหน้า 2 หน้า (2026-09-22)

- เส้นทางใน hash: `#/` = แดชบอร์ด, `#/w/<walletId>` = ธุรกรรมของกระเป๋า (ปุ่มย้อนกลับเบราว์เซอร์ใช้ได้; เปิด URL ตรงจะเลือกกระเป๋าให้)
- ไม่มี sidebar (ผู้ใช้ให้ลบ 2026-09-22) — Import/Add/Clear อยู่ที่หัวตารางกระเป๋าในหน้า 1
- หน้า 1 (`WalletTable` + `RecentTable`): ตารางกระเป๋า Label · Address · Transactions · ตา/ถังขยะ (เรียงได้, 7 แถว + Show all) คลิกแถว = หน้า 2; ตารางธุรกรรมล่าสุด 10 แถวจากทุกกระเป๋าที่โหลดแล้ว Type · From · To · Submitted · Amount · Network fee (+ ปุ่ม Load all wallets) คลิกแถว = แผงขวา
- หน้า 2: ปุ่มกลับ + ชื่อกระเป๋า + Reload, `TxTable` เดิม (Type · Submitted · Amount · Network fee + ตัวกรอง) เฉพาะกระเป๋านั้น, Load older; คลิกแถว = แผงขวา
- แผงขวา `DetailPanel` เป็น overlay ทั้งสองหน้า; ไม่มี checkbox ที่ไหนเลย
- ปุ่ม "View on <explorer>" ในแผงรายละเอียดต้องมีเสมอ: chain list → URL ที่แถวแนบมา → ปุ่ม disabled "No explorer for this chain"; chain list โหลดใหม่ไม่ได้ → ใช้ชุดเก่าต่อ

## Infinite scroll (2026-09-22)

- `src/useInfinite.ts` + `MoreSentinel`: โชว์ทีละชุดจากรายการในเครื่อง (ตารางกระเป๋า 10 · ธุรกรรมของกระเป๋า 25) — **ตารางธุรกรรมล่าสุดในหน้า 1 คงที่ 10 แถว ไม่มีเลื่อนโหลด (กัน rate limit)** sentinel ท้ายตารางเข้าใกล้จอ (~80%) → เพิ่มชุดถัดไป; โชว์หมดแล้วและ `hasOlder` → ขอชุดเก่ากว่าจากแหล่ง (cursor ต่อกระเป๋าใน `feeds[id].next`) ระหว่างโหลดไม่ยิงซ้ำ ท้ายตารางมี "Loading more…" ความสูงคงที่ (ไม่กระโดด) และ "All loaded" เฉพาะเมื่อเคยโหลดเพิ่ม
- ปุ่ม Load older ถูกแทนด้วยการเลื่อน; `resetKey` (ตัวกรอง/เรียง/กระเป๋า) รีเซ็ตจำนวนที่โชว์

## Skeleton / header (2026-09-22)

- `components/Skeleton.tsx` (ห่อ shadcn `Skeleton`): `SkeletonRows` (แถวสูง 64px เท่าแถวจริง) ใช้ในตารางธุรกรรมตอนโหลดครั้งแรก, `SkeletonBar` ในช่องของตารางกระเป๋าตอนกระเป๋านั้นโหลด
- ปุ่ม Import file อยู่ที่หัวเว็บ (XCap · Import · Settings); ตารางกระเป๋ามี Add/Clear
- หัวคอลัมน์ตาราง padding 16px แนวตั้ง, เซลล์ 12px

## แผงขวา + Settings (2026-09-22)

- `DetailPanel` = shadcn `Sheet` (ขวา กว้าง 440px; มือถือ `side=bottom` เต็มจอ) ปุ่ม View = `DropdownMenu` เปิดขึ้นบน; **ห้ามมีกติกาดัน layout** — ตารางต้องนิ่งเมื่อเปิดแผง
- Settings = "settings panel": แถวแหล่งข้อมูลไม่มีกรอบรอบการ์ด คั่นด้วย hairline: grip ลากจัดลำดับ (`reorderEndpoints`) · ไอคอนชนิด · ชื่อ + dropdown รูปแบบที่อยู่ · "Priority N · URL" · สวิตช์ shadcn `Switch` · ลบ

## Rate limit (2026-09-22)
- ทุก fetch ผ่าน `limitedFetch` (`src/limiter.ts`): พร้อมกัน ≤2, เว้น 300ms, โดน 429 → พักทั้งคิว (Retry-After หรือ 5s×2ⁿ ≤60s) แล้วยิงซ้ำเองสูงสุด 4 ครั้ง — ห้ามเรียก fetch ตรง

## CORS / proxy (2026-09-22)
- ทุก fetch ไปแหล่งข้อมูล (history / metadata / price / chain list) ผ่าน `proxied()` ใน `src/proxy.ts`: ผู้ใช้ตั้ง **Proxy URL** ใน Settings (`{url}` หรือ prefix) → ใช้; ไม่ตั้ง + dev → `/__proxy?url=` ของ vite (plugin `devProxy` ใน vite.config.ts ส่งต่อ header ยกเว้น host/origin/referer/cookie); production static → ยิงตรง (ต้องเป็นแหล่งที่เปิด CORS หรือผู้ใช้มี proxy เอง)

- Settings → "Custom chains": ผู้ใช้ใส่ chain id + ชื่อ + โลโก้ + explorer เอง (`settings.chains`) → `useChains` merge ทับ chain list; ทางเดียวที่โลโก้/explorer ของเชนที่ chain list ไม่มี (เช่น sol) เข้ามาได้ — ห้ามฝัง URL โลโก้ในโค้ด

- รูปแบบคำตอบที่รองรับ: history_list (EVM), flat list, signature list, trade list, `{ transfers[], next }`, `{ "<address>": { userTrades[], next } }` — แหล่งที่ส่ง `next` มาให้ `{offset}`/`{next}` ใช้ token นั้นเลื่อนหน้า (ไม่ใช่จำนวนแถว)

## Token metadata + สลิป (2026-09-22)
- แหล่งข้อมูลแต่ละอันมี `metaUrl` (เลือกใส่) — หลังโหลดหน้า โทเคนที่ยังไม่รู้ชื่อ/สัญลักษณ์/โลโก้ (`unknownTokens`) ถูกขอเป็นชุด ≤50 ที่อยู่ เว้น 1.5 วิ (`src/tokens.ts`, แคช localStorage 7 วัน `xcap.scan.tokens`) แล้วเติมลงแถวก่อนแสดง (`applyTokenMeta`) — ไม่ยิงขอราคา/metadata แยกตอน render
- Solana-family ที่ไม่มี placeholder ประกอบเป็น `?ownerAddress={address}&limit={count}`; แหล่งที่ใช้ path/พารามิเตอร์อื่นให้ผู้ใช้วาง URL ที่มี `{address}` `{count}` `{cursor}` เอง
- สลิป (`src/slip.ts`): แบบ Thermal receipt (mock 2a ผู้ใช้เลือก 2026-09-22) กว้าง 320 ขอบล่างหยัก เส้นประ — XCap Scan กลาง → เช็คเขียว/กากบาทแดง + Transaction successful/failed → Received/Sent ตัวเลขใหญ่ (เขียวเฉพาะขาเข้า ตรงนี้ที่เดียว) → บล็อกสินทรัพย์ (โลโก้โทเคน + ตราเชน จำนวนสีหมึก) + fee/ส่วนต่างสวอป → Wallet/To/Status → hash เต็ม → QR → รหัส; ไม่มีจุด/สัญลักษณ์สีเชน; วาดด้วย Canvas 2D พื้นขาวเสมอ + QR (`qrcode`) ของลิงก์ explorer หรือ hash; รหัสยืนยัน = SHA-256 ของฟิลด์เนื้อหา (ชื่อเชน/ป้ายกระเป๋า/ลิงก์ไม่อยู่ในแฮช); สำเนาใน `xcap.scan.slips` ไม่เขียนทับ; ลิงก์แชร์ `#/v/<code>.<base64url(json)>` พกข้อมูลไปเอง → ตรวจได้ทุกเครื่องที่เปิดแอปนี้ ไม่มีเซิร์ฟเวอร์ ไม่มี RPC
- ชั้นโมดัลทุกชนิดเป็น Base UI ของ shadcn (`Dialog`/`Drawer` ผ่าน `components/Dialog.tsx`, `AlertDialog` ใน ConfirmDialog, `Sheet` ใน DetailPanel, `Dialog` ใน SlipLightbox) — Base UI จัด portal/โฟกัส/inert/ล็อกสกรอลล์/Esc เอง; ห้ามเขียนชั้นโมดัลหรือตั้ง body.style.overflow เอง (`src/modal.ts` ถูกลบแล้ว)
- สลิปของแถวที่ติดธง (`row.flagged`, mock S4 ผู้ใช้เลือก 2026-09-22): แถบเหลืองเฉียงบน, สามเหลี่ยมเตือนสีเหลือง "Review before trusting", กล่องเหลือง "Why this is flagged" จาก `src/risk.ts` (สัญลักษณ์เลียนแบบ / ธงจากแหล่ง / airdrop / ไม่มีราคา — เหตุผลจริงเท่านั้น ไม่เดา), ตัวเลขใหญ่สีเทา, ⚠ แดงหลังสัญลักษณ์, QR จาง + ป้าย "Verify first"; `flagged` อยู่ในแฮชรหัสยืนยัน สี `--color-warn*` ใช้ในภาพสลิปเท่านั้น
- ภาพสลิปแสดงผ่าน `SlipPicture`: PNG + ชั้น `<span>` โปร่งใสวางตามพิกัดที่ `renderSlip` จดไว้ (`texts`) แล้ว scale ตามความกว้างจริง → ลากเลือก/ไฮไลต์/คัดลอกข้อความบนสลิปได้ (สีไฮไลต์ `--color-selection`)
- Settings → "Slip labels": สวิตช์ซ่อน/แสดง 13 ส่วนของสลิป (`settings.slipShow`, `SLIP_FIELDS` ใน store.ts) — `renderSlip(..., show)` ข้ามส่วนที่ปิดและไม่วาดเส้นประของกลุ่มว่าง
- ปุ่ม Slip ท้ายแผงขวา (คู่กับ View on explorer) → เปิดภาพสลิปแบบ **lightbox** (`SlipLightbox`: shadcn `Dialog` โปร่ง ภาพ 360px กลาง ปุ่มปิดมุมขวาบน ไม่มีแถบปุ่มใดๆ; Esc/คลิกม่านปิด) — ไม่สลับเนื้อหาแผง; ตรวจสลิปจากไอคอนโล่บนหัว (`#/v/<code>.<data>` เปิดไดอะล็อกตรวจ)
