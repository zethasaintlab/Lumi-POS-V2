# Aplikasi Kosong di Tauri dengan Design System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold `apps/kasir` (Vite + React 19 + TypeScript, wrapped by Tauri 2) and `packages/ds` (thin wrapper over `ds-bundle` with self-hosted Inter font) so an empty screen renders the design system correctly — closing the F0 gate criterion "aplikasi kosong berjalan di Tauri dengan token design system terpasang".

**Architecture:** `apps/kasir` is scaffolded via the official `create-tauri-app` tool (verified to run without a Rust toolchain — it only fails at actual Rust compilation, which is out of scope here), then customized: `packages/ds` re-exports every `ds-bundle` component via relative import (zero files copied, `ds-bundle` untouched) and replaces `ds-bundle/tokens/fonts.css`'s Google Fonts `@import` with `@fontsource/inter` (self-hosted, bundled by Vite). COOP/COEP headers are added to both `vite.config.ts` and `tauri.conf.json`.

**Tech Stack:** Vite 7, React 19, TypeScript 5.8, Tauri 2, `@fontsource/inter`, npm workspaces (existing `apps/*`/`packages/*` glob).

## Global Constraints

- `ds-bundle/` at repo root is **final and must not be edited** — every requirement here is satisfied by wrapping it from `packages/ds`, never by modifying its files.
- Frontend code is TypeScript, not plain JS (KEP-08, "TypeScript end-to-end").
- React 19 + Vite SPA wrapped by Tauri 2 (CLAUDE.md stack table — locked, do not substitute).
- Font: self-hosted Inter, weights 400/500/600 only (matches what `ds-bundle/tokens/fonts.css` already declared) — no CDN/Google Fonts request at runtime.
- COOP/COEP headers required in two places per `ARCH-lumi-pos-v1.md` §7: Vite config and `tauri.conf.json`. Exact header values: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`.
- **Rust/Cargo is not installed in this environment.** `cargo tauri dev`/`build` cannot be run or verified here — that is an explicit, accepted gap, not something to work around by guessing. Every step in this plan that CAN be verified (Vite/TypeScript/Node-level) must actually be run and confirmed.
- No real POS screens, no `packages/domain` wiring, no `apps/server`/`apps/backoffice` changes — out of scope (see design doc).

---

### Task 1: Scaffold `apps/kasir` (Tauri 2 + Vite + React 19 + TS), verify baseline build

**Files:**
- Create (via `create-tauri-app`, then two name fixups): `apps/kasir/package.json`, `apps/kasir/index.html`, `apps/kasir/src/main.tsx`, `apps/kasir/src/App.tsx`, `apps/kasir/src/App.css`, `apps/kasir/src/assets/react.svg`, `apps/kasir/src/vite-env.d.ts`, `apps/kasir/tsconfig.json`, `apps/kasir/tsconfig.node.json`, `apps/kasir/vite.config.ts`, `apps/kasir/.vscode/extensions.json`, `apps/kasir/public/tauri.svg`, `apps/kasir/public/vite.svg`, `apps/kasir/src-tauri/Cargo.toml`, `apps/kasir/src-tauri/build.rs`, `apps/kasir/src-tauri/tauri.conf.json`, `apps/kasir/src-tauri/src/lib.rs`, `apps/kasir/src-tauri/src/main.rs`, `apps/kasir/src-tauri/capabilities/default.json`, `apps/kasir/src-tauri/.gitignore`, `apps/kasir/src-tauri/icons/*` (16 files — generated automatically by the scaffold tool, do not hand-craft)
- Modify: `apps/kasir/README.md` (scaffold overwrites the existing placeholder; restore project-appropriate content)

**Interfaces:**
- Produces: a working `apps/kasir` npm workspace package (name `"kasir"`) with `npm run build` (= `tsc && vite build`) as the verification command Task 2 will reuse. Produces `apps/kasir/src-tauri` with Cargo package name `kasir` / lib name `kasir_lib` — Task 2's Rust-adjacent edits (`tauri.conf.json`) depend on this naming.

- [ ] **Step 1: Confirm pre-scaffold state**

  Run from repo root:
  ```bash
  ls apps/kasir
  ```
  Expected: only `README.md` exists (no `package.json`, no `src/`, no `src-tauri/`) — confirms nothing to conflict with the scaffold.

- [ ] **Step 2: Run the official Tauri scaffolding tool**

  From repo root:
  ```bash
  npx create-tauri-app@latest apps/kasir -m npm -t react-ts --identifier com.lumipos.kasir -y --tauri-version 2 --force
  ```
  `--force` is required because `apps/kasir/README.md` already exists (non-empty directory). This does **not** run `npm install` or require Rust — it only writes files. Expected output ends with:
  ```
  Template created!

  Your system is missing dependencies (or they do not exist in $PATH):
  ╭──────┬───────────────────────────────────────────────────────────────────╮
  │ Rust │ ...
  ╰──────┴───────────────────────────────────────────────────────────────────╯
  ```
  This Rust warning is expected and correct — ignore it, it is exactly the accepted gap from Global Constraints.

  Passing `apps/kasir` (a path with a slash) as the project name makes the tool derive the package/crate name as `appskasir` (slash stripped, not "kasir") — Step 3 fixes this.

- [ ] **Step 2b: Fix package/crate naming (the scaffold derived "appskasir" from the path, not "kasir")**

  In `apps/kasir/package.json`, change:
  ```json
    "name": "appskasir",
  ```
  to:
  ```json
    "name": "kasir",
  ```

  In `apps/kasir/src-tauri/Cargo.toml`, change:
  ```toml
  name = "appskasir"
  ```
  to:
  ```toml
  name = "kasir"
  ```
  and change:
  ```toml
  name = "appskasir_lib"
  ```
  to:
  ```toml
  name = "kasir_lib"
  ```

  In `apps/kasir/src-tauri/src/main.rs`, change:
  ```rust
  fn main() {
      appskasir_lib::run()
  }
  ```
  to:
  ```rust
  fn main() {
      kasir_lib::run()
  }
  ```

  In `apps/kasir/src-tauri/tauri.conf.json`, change both occurrences of `"appskasir"` (`productName` and the window `title`) to `"Lumi POS — Kasir"`. (The `identifier` field is already correct — `"com.lumipos.kasir"` — because it came from the `--identifier` flag, not the path-derived name.)

- [ ] **Step 3: Restore `apps/kasir/README.md`**

  The scaffold's `--force` overwrote it with a generic template. Replace its contents with:
  ```markdown
  # kasir

  React 19 + Vite SPA, dibungkus Tauri 2. SELURUH layar offline-capable. Komponen dari `/ds-bundle` lewat `packages/ds` (lihat README di sana) — jangan import `ds-bundle` langsung.

  ```bash
  npm run dev          # Vite dev server saja (browser)
  npm run build         # tsc + vite build -> dist/
  npm run tauri dev     # app desktop penuh -- BUTUH Rust/Cargo terpasang
  ```
  ```

- [ ] **Step 4: Install dependencies at the workspace root**

  From repo root (not inside `apps/kasir` — npm workspaces resolves the new package automatically since it matches the `apps/*` glob in the root `package.json`):
  ```bash
  npm install
  ```
  Expected: exits 0, no errors. `apps/kasir` now has its dependencies (`react`, `react-dom`, `@tauri-apps/api`, `@tauri-apps/plugin-opener`, and dev deps) resolved via the workspace `node_modules`.

- [ ] **Step 5: Verify the baseline build**

  ```bash
  cd apps/kasir && npm run build
  ```
  Expected: exits 0. Output ends with a Vite build summary (`✓ built in ...`), and `apps/kasir/dist/index.html` + `apps/kasir/dist/assets/*.js` exist. This is still the scaffold's default demo screen (Tauri+Vite+React greet button) — Task 2 replaces it. The point of this step is proving the toolchain (Vite, TypeScript, the workspace wiring) works before adding any custom code.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/kasir
  git commit -m "Scaffold apps/kasir: Tauri 2 + Vite + React 19 + TypeScript

Rust/Cargo tidak terpasang di lingkungan ini -- cargo tauri dev/build
tidak bisa dijalankan/diverifikasi di sini, itu langkah manual untuk
dilakukan setelah Rust terpasang. npm run build (tsc + vite build)
sudah diverifikasi jalan.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 2: `packages/ds` wrapper (self-hosted font + re-exports), wire empty AppShell screen, COOP/COEP headers

**Files:**
- Create: `packages/ds/package.json`, `packages/ds/index.ts`, `packages/ds/styles.css`
- Modify: `apps/kasir/package.json` (add `"ds": "*"` dependency)
- Modify: `apps/kasir/tsconfig.json` (add `"allowJs": true` — required because `packages/ds/index.ts` re-exports plain `.jsx` files with no type declarations; verified this is the exact fix needed, `tsc --noEmit` fails with `TS7016` without it)
- Modify: `apps/kasir/src/App.tsx` (replace demo content with `AppShell` + status line)
- Delete: `apps/kasir/src/App.css`, `apps/kasir/src/assets/react.svg` (only used by the demo content being replaced)
- Modify: `apps/kasir/vite.config.ts` (add COOP/COEP headers to both `server` and `preview`)
- Modify: `apps/kasir/src-tauri/tauri.conf.json` (add COOP/COEP headers under `app.security.headers`)

**Interfaces:**
- Consumes: `apps/kasir` package name `kasir` and its `npm run build` command from Task 1.
- Produces: the `"ds"` npm workspace package, importable as `import { AppShell, ... } from 'ds'` and `import 'ds/styles.css'` — this is the final public interface; no further tasks in this plan depend on it, but future F1+ work (real POS screens) will import components from `"ds"` the same way.

- [ ] **Step 1: Create `packages/ds/package.json`**

  ```json
  {
    "name": "ds",
    "private": true,
    "version": "0.0.0",
    "type": "module",
    "main": "index.ts",
    "dependencies": {
      "@fontsource/inter": "^5.3.0"
    }
  }
  ```

- [ ] **Step 2: Create `packages/ds/index.ts` — named re-export of all 20 `ds-bundle` components**

  Every `ds-bundle` component uses a named `export function ComponentName(...)` (verified: no default exports anywhere in `ds-bundle/components/`). Re-export each by name, importing relatively — no files copied, `ds-bundle` stays the single source of truth:

  ```ts
  export { Avatar } from '../../ds-bundle/components/data/Avatar.jsx';
  export { Badge } from '../../ds-bundle/components/data/Badge.jsx';
  export { Card } from '../../ds-bundle/components/data/Card.jsx';
  export { EmptyState } from '../../ds-bundle/components/data/EmptyState.jsx';
  export { StatCard } from '../../ds-bundle/components/data/StatCard.jsx';
  export { SyncIndicator } from '../../ds-bundle/components/data/SyncIndicator.jsx';
  export { Table } from '../../ds-bundle/components/data/Table.jsx';
  export { Button } from '../../ds-bundle/components/forms/Button.jsx';
  export { Chip } from '../../ds-bundle/components/forms/Chip.jsx';
  export { Field } from '../../ds-bundle/components/forms/Field.jsx';
  export { Icon, iconNames } from '../../ds-bundle/components/forms/Icon.jsx';
  export { SegmentedControl } from '../../ds-bundle/components/forms/SegmentedControl.jsx';
  export { Stepper } from '../../ds-bundle/components/forms/Stepper.jsx';
  export { Switch } from '../../ds-bundle/components/forms/Switch.jsx';
  export { AppShell } from '../../ds-bundle/components/navigation/AppShell.jsx';
  export { Tabs } from '../../ds-bundle/components/navigation/Tabs.jsx';
  export { ConfirmDialog } from '../../ds-bundle/components/overlays/ConfirmDialog.jsx';
  export { Modal } from '../../ds-bundle/components/overlays/Modal.jsx';
  export { CartRow } from '../../ds-bundle/components/pos/CartRow.jsx';
  export { ProductCard } from '../../ds-bundle/components/pos/ProductCard.jsx';
  export { Ticket } from '../../ds-bundle/components/pos/Ticket.jsx';
  ```

  (`Icon.jsx` additionally exports `iconNames` — the only non-component named export in the bundle, included above.)

- [ ] **Step 3: Create `packages/ds/styles.css` — mirrors `ds-bundle/styles.css` except the font line**

  `ds-bundle/styles.css` is:
  ```css
  @import url('./tokens/fonts.css');
  @import url('./tokens/colors.css');
  @import url('./tokens/typography.css');
  @import url('./tokens/spacing.css');
  @import url('./tokens/effects.css');
  @import url('./base.css');
  @import url('./components.css');
  ```
  `packages/ds/styles.css` replaces the first line (Google Fonts `@import`, blocked offline) with `@fontsource/inter`, weights 400/500/600 only (matching what `tokens/fonts.css` declared):

  ```css
  /* Entry point design system untuk konsumen apps/* -- mirror ds-bundle/styles.css
     persis, KECUALI tokens/fonts.css (yang @import Google Fonts, tidak bisa
     dipakai offline). Baris font diganti @fontsource/inter (self-hosted,
     di-bundle Vite ke output build). ds-bundle sendiri tidak diubah. */
  @import '@fontsource/inter/400.css';
  @import '@fontsource/inter/500.css';
  @import '@fontsource/inter/600.css';
  @import '../../ds-bundle/tokens/colors.css';
  @import '../../ds-bundle/tokens/typography.css';
  @import '../../ds-bundle/tokens/spacing.css';
  @import '../../ds-bundle/tokens/effects.css';
  @import '../../ds-bundle/base.css';
  @import '../../ds-bundle/components.css';
  ```

- [ ] **Step 4: Wire `apps/kasir` to depend on `packages/ds`, install**

  In `apps/kasir/package.json`, add to `"dependencies"` (alongside the existing `react`/`react-dom`/`@tauri-apps/api`/`@tauri-apps/plugin-opener`):
  ```json
      "ds": "*",
  ```

  From repo root:
  ```bash
  npm install
  ```
  Expected: exits 0. This links `apps/kasir/node_modules/ds` to `packages/ds` (npm workspace symlink) and installs `@fontsource/inter` into the workspace.

- [ ] **Step 5: Add `allowJs` to `apps/kasir/tsconfig.json`**

  In the `compilerOptions` block, add (next to `"skipLibCheck": true,`):
  ```json
      "allowJs": true,
  ```
  Without this, `tsc --noEmit` fails with `TS7016: Could not find a declaration file for module '../../ds-bundle/components/.../X.jsx'` — verified directly before writing this plan. `allowJs` lets TypeScript process the plain-JS/JSX component files it needs to resolve types for, instead of demanding a `.d.ts`.

- [ ] **Step 6: Replace `apps/kasir/src/App.tsx` with the empty AppShell screen**

  ```tsx
  import { AppShell } from 'ds';
  import 'ds/styles.css';

  function App() {
    return (
      <AppShell brand={{ name: 'Lumi POS' }}>
        <p className="t-caption">Lumi POS — F0</p>
      </AppShell>
    );
  }

  export default App;
  ```

  `.t-caption` is a real typography utility class from `ds-bundle/tokens/typography.css:40` (12px, regular weight) — used here instead of `.num` because `.num` (`ds-bundle/base.css:21`) is specifically for tabular monetary figures per design system rule #4, and this status line is not a money value.

  Delete the now-unused demo files (only referenced by the App.tsx content just replaced):
  ```bash
  rm apps/kasir/src/App.css
  rm apps/kasir/src/assets/react.svg
  rmdir apps/kasir/src/assets
  ```

- [ ] **Step 7: Add COOP/COEP headers to `apps/kasir/vite.config.ts`**

  The scaffolded `vite.config.ts` has a `server: { ... }` block (port/strictPort/host/hmr/watch — leave all of that unchanged). Add a `headers` key inside `server`, and add a new top-level `preview` block (used by the verification step below, and by anyone running `vite preview` to sanity-check a production build):

  ```ts
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  ```
  (Only the `headers` key inside `server` and the new `preview` block are additions — every other line already exists in the scaffolded file from Task 1.)

- [ ] **Step 8: Add COOP/COEP headers to `apps/kasir/src-tauri/tauri.conf.json`**

  In the `"app"` object, add a `"headers"` key inside `"security"` (alongside the existing `"csp": null`):
  ```json
    "app": {
      "windows": [
        {
          "title": "Lumi POS — Kasir",
          "width": 800,
          "height": 600
        }
      ],
      "security": {
        "csp": null,
        "headers": {
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp"
        }
      }
    },
  ```
  (Confirmed against current Tauri 2 docs: `app.security.headers` accepts exactly these two header names among its fixed allow-list, and this is the documented example value pairing for enabling `SharedArrayBuffer`/OPFS.)

  Validate the JSON is syntactically correct (can't compile-verify the Rust side, but JSON syntax is fully checkable):
  ```bash
  node -e "JSON.parse(require('fs').readFileSync('apps/kasir/src-tauri/tauri.conf.json', 'utf8')); console.log('valid JSON')"
  ```
  Expected: prints `valid JSON`.

- [ ] **Step 9: Verify TypeScript + build**

  ```bash
  cd apps/kasir
  npx tsc --noEmit
  ```
  Expected: exits 0, no output (this is the check that would have failed with `TS7016` before Step 5's `allowJs` fix).

  ```bash
  npm run build
  ```
  Expected: exits 0, `dist/` regenerated.

- [ ] **Step 10: Verify the font is actually self-hosted (no CDN reference, local asset present)**

  From `apps/kasir`:
  ```bash
  ! grep -r "fonts.googleapis.com" dist/assets/*.css
  grep -o "url(/assets/inter[^)]*\.woff2)" dist/assets/*.css | head -3
  ```
  Expected: first command exits 0 (meaning: NOT found — no Google Fonts reference anywhere in the built CSS). Second command prints at least one line referencing a locally-bundled `inter-*.woff2` asset path.

- [ ] **Step 11: Verify COOP/COEP headers are actually served**

  From `apps/kasir`:
  ```bash
  npx vite preview --port 4173 --strictPort > /tmp/kasir-preview.log 2>&1 &
  sleep 2
  curl -sI http://localhost:4173/ | grep -i "cross-origin"
  ```
  Expected: prints both
  ```
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```

  Then stop the preview server (on Windows/git-bash, `kill $!` does not reliably stop an `npx`-spawned child — find the real listening PID via `netstat` instead):
  ```bash
  PID=$(netstat -ano | grep ":4173" | grep LISTENING | awk '{print $5}' | head -1)
  taskkill //PID $PID //F //T
  ```
  Expected: `SUCCESS: The process with PID ... has been terminated.`

- [ ] **Step 12: Commit**

  ```bash
  git add packages/ds apps/kasir
  git commit -m "Wire packages/ds (self-hosted font + re-exports) into apps/kasir empty screen

App.tsx sekarang render AppShell dari packages/ds (bukan demo Tauri
bawaan). Font Inter self-hosted lewat @fontsource/inter, terverifikasi
tidak ada request ke fonts.googleapis.com di build output. Header
COOP/COEP terverifikasi benar-benar dikirim server (vite preview +
curl), dan tauri.conf.json sisi konfigurasi (tidak bisa dijalankan --
Rust tidak terpasang di lingkungan ini).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

## Manual verification (outside this plan — requires Rust)

After both tasks are merged, once Rust/Cargo + platform prerequisites are installed:
```bash
cd apps/kasir
npm run tauri dev
```
Expected: a desktop window opens titled "Lumi POS — Kasir" showing the AppShell sidebar (brand "Lumi POS", empty nav, "User" placeholder) and the body text "Lumi POS — F0" in the design system's typography. This is the actual F0 gate proof and cannot be substituted by anything in this plan — record the result in `HANDOFF.md` once done.
