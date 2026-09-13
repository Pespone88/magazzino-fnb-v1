# Magazzini F&B Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the zero-cost smartphone-first PWA foundation for the Magazzini F&B V1, ready for Supabase integration in the next milestone.

**Architecture:** A React + TypeScript + Vite single-page PWA with a small feature-oriented structure. This milestone contains no business persistence and no Supabase connection; it establishes navigation shell, store-aware application context interfaces, installable PWA metadata, automated tests, linting, and production build verification.

**Tech Stack:** React, TypeScript, Vite, Vitest, React Testing Library, vite-plugin-pwa, ESLint, Git.

**Spec:** `docs/superpowers/specs/2026-09-13-magazzini-fnb-design.md`

## Global Constraints

- Recurring infrastructure cost target: €0/month for V1.
- Smartphone-first PWA; desktop remains supported.
- Eccellenze della Costiera and Nonna Titti are always operationally separate.
- No OCR in V1.
- No barcode support.
- No stock at the point of sale; only warehouse stock is tracked.
- No physical deletion of operational history.

---

### Task 1: Create the application scaffold and quality gates

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/app/AppShell.tsx`
- Create: `src/app/navigation.ts`
- Create: `src/app/navigation.test.ts`
- Create: `src/styles.css`
- Create: `src/test/setup.ts`
- Create: `.gitignore`
- Create: `README.md`

**Interfaces:**
- Produces: `primaryNavigation` array consumed by `AppShell`.
- Produces: installable PWA build and baseline automated tests.

- [ ] **Step 1: Scaffold the generated Vite React TypeScript project and install pinned dependencies.**

Run the official Vite scaffold, then install Vitest, Testing Library, jsdom and vite-plugin-pwa. Commit the generated lockfile.

- [ ] **Step 2: Write the failing navigation contract test.**

```ts
import { describe, expect, it } from 'vitest'
import { primaryNavigation } from './navigation'

describe('primaryNavigation', () => {
  it('exposes the six approved top-level areas in the approved order', () => {
    expect(primaryNavigation.map((item) => item.label)).toEqual([
      'Home',
      'Articoli',
      'Ordini',
      'Movimenti',
      'Inventari',
      'Altro',
    ])
  })
})
```

- [ ] **Step 3: Run the test and verify RED.**

Run: `npm test -- --run src/app/navigation.test.ts`
Expected: FAIL because `primaryNavigation` does not exist.

- [ ] **Step 4: Implement the minimal navigation contract and AppShell.**

Create a typed navigation array with exactly the six approved areas, render a mobile bottom navigation and a desktop sidebar from the same source, and show a neutral placeholder content area for the selected section.

- [ ] **Step 5: Add PWA metadata and service worker generation.**

Configure `vite-plugin-pwa` with app name `Magazzini F&B`, standalone display, theme/background metadata, and automatic service-worker update registration. Do not add push notifications yet.

- [ ] **Step 6: Run unit tests.**

Run: `npm test -- --run`
Expected: all tests PASS.

- [ ] **Step 7: Run lint and production build.**

Run: `npm run lint && npm run build`
Expected: both commands exit 0.

- [ ] **Step 8: Commit the foundation.**

```bash
git add .
git commit -m "feat: scaffold Magazzini F&B PWA foundation"
```

### Task 2: Add store-aware application context contract

**Files:**
- Create: `src/domain/store.ts`
- Create: `src/domain/roles.ts`
- Create: `src/domain/access.ts`
- Create: `src/domain/access.test.ts`
- Modify: `src/app/AppShell.tsx`

**Interfaces:**
- Produces: `StoreId`, `GlobalRole`, `StoreRole`, `canSelectStore()` and `visibleStoreIds()` for the later Supabase/auth milestone.

- [ ] **Step 1: Write failing authorization-domain tests.**

```ts
import { describe, expect, it } from 'vitest'
import { canSelectStore, visibleStoreIds } from './access'

const eccellenze = 'eccellenze'
const nonnaTitti = 'nonna-titti'

describe('store visibility', () => {
  it('lets an admin select both stores', () => {
    expect(canSelectStore({ globalRole: 'ADMIN', memberships: [] })).toBe(true)
    expect(visibleStoreIds({ globalRole: 'ADMIN', memberships: [] }, [eccellenze, nonnaTitti]))
      .toEqual([eccellenze, nonnaTitti])
  })

  it('restricts a warehouse user to membership stores only', () => {
    const actor = {
      globalRole: 'USER' as const,
      memberships: [{ storeId: eccellenze, role: 'MAGAZZINIERE' as const }],
    }

    expect(canSelectStore(actor)).toBe(false)
    expect(visibleStoreIds(actor, [eccellenze, nonnaTitti])).toEqual([eccellenze])
  })
})
```

- [ ] **Step 2: Run the tests and verify RED.**

Run: `npm test -- --run src/domain/access.test.ts`
Expected: FAIL because domain access helpers do not exist.

- [ ] **Step 3: Implement the minimal domain types and helpers.**

Use explicit union types for `ADMIN | USER` and `RESPONSABILE | VICE | MAGAZZINIERE`. Keep these helpers pure; no Supabase dependency in this milestone.

- [ ] **Step 4: Wire a development-only sample actor into AppShell.**

Use the domain helpers to show a store picker only for the sample admin view and a direct store badge for the sample warehouse-user view. Do not persist user state yet.

- [ ] **Step 5: Run all tests, lint and build.**

Run: `npm test -- --run && npm run lint && npm run build`
Expected: all commands exit 0.

- [ ] **Step 6: Commit.**

```bash
git add .
git commit -m "feat: add store access domain contracts"
```

## Self-review

- Spec coverage for this milestone: smartphone-first PWA, approved six-area navigation, initial store isolation contracts, zero-cost-compatible static deployment architecture, no OCR/barcode.
- Explicitly deferred to later plans: Supabase project/schema/RLS, real login, persistence, stock engine, purchasing, receipts, store supplies, inventories, loans, push delivery, attachments.
- No placeholders or unowned cross-task types remain in this milestone plan.
