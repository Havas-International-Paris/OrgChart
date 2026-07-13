# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Internal org chart tool for Havas International: an editable spreadsheet (left) and a visual org chart (right) on one screen, backed directly by Supabase (Postgres + Auth + Realtime) with no custom backend server. Supports multi-reporting (an employee can have several managers, one flagged primary) and per-employee client/mission assignments with %ETP.

## Commands

```bash
npm run dev       # start Vite dev server (http://localhost:5173)
npm run build     # tsc -b (typecheck) && vite build — this is the primary correctness check, run it after any change
npm run lint      # oxlint
npm run preview   # preview a production build
```

There is no test suite in this repo. `npm run build` (which runs `tsc -b` first) is the main way to catch mistakes before manual verification.

The dev server requires `.env.local` (copy from `.env.example`) with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from a Supabase project that has had the migrations in `supabase/migrations/` applied (see README.md for the full setup sequence — order matters, `0004` in particular is easy to forget and silently breaks realtime). Without `.env.local`, the app renders a "Configuration Supabase requise" screen instead of crashing (see `isSupabaseConfigured` in `src/lib/supabaseClient.ts`).

## Architecture

**Data flow: services → hooks → components.** `src/services/*` are thin wrappers around `supabase-js` calls (one file per table). `src/hooks/use*` each own one table's full dataset: fetch on mount, subscribe to Postgres changes, and re-`fetch()` (not incremental patching) on any change. Because the whole org is a few hundred rows at most, every hook loads its entire table and consumers filter/derive in memory (e.g. `useReportingGraph().managersOf(employeeId)`, `useAssignments().totalEtpOf(employeeId)`) rather than querying per-employee. Don't add pagination or per-entity fetching without a real scale reason.

**Realtime channel names must be unique per mount.** Every hook subscribes with `` `table-changes-${crypto.randomUUID()}` `` rather than a fixed string. A fixed channel name breaks the moment two consumers of the same hook are mounted at once (e.g. `EmployeeGrid` and `OrgChartView` both call `useEmployees()`) or React StrictMode double-mounts in dev — Supabase's realtime client throws `cannot add postgres_changes callbacks ... after subscribe()` because the second `.channel(sameName)` call returns the already-subscribed channel object. If you add a new data hook, follow this pattern.

**Multi-reporting model.** `reporting_relationships` rows have `employee_id`, `manager_id`, `is_primary`. At most one primary manager per employee (partial unique index in `0001_init_schema.sql`). Primary edges form the tree used for the automatic dagre layout (`src/components/chart/layoutEngine.ts`); secondary edges are drawn afterward as a dashed overlay using the positions dagre already computed — they never participate in layout. `useVisibleGraph` walks the primary-edge tree from roots (employees with no primary manager) down through whichever nodes are in the `expandedNodeIds` set.

**Cycle prevention is deliberately doubled.** Client-side `wouldCreateCycle` (in `useReportingGraph.ts`) does a BFS from the proposed manager upward through existing edges before any write is attempted, so the UI can grey out invalid choices live. `0003_cycle_check_function.sql` adds the same check as a Postgres trigger with a recursive CTE, because the client-side check alone leaves a race window between two simultaneous users. Both must stay in sync if the reporting model changes.

**Cross-view state lives in one Zustand store**, not component state: `src/stores/selectionStore.ts` holds `selectedEmployeeId`, `searchQuery`, `expandedNodeIds`, and `assignmentsEmployeeId`. `EmployeeGrid` and `OrgChartView` both read/write it so that clicking a row centers the corresponding chart node (and vice versa), and so search highlights/auto-expands ancestors in the chart while filtering the grid via AG Grid's `quickFilterText`. `AssignmentEditorModal` is rendered once at the `AppShell` level (not inside the grid or the chart) and opens based on `assignmentsEmployeeId`, so either view can trigger the same modal instance.

**"+" buttons on chart nodes** (`EmployeeNode.tsx`) each open a small popover with two actions: create a brand-new employee and link them immediately (`quickAddManager`/`quickAddSubordinate` in `OrgChartView.tsx`), or link an existing employee via `LinkExistingEmployeeModal` (candidates filtered by `wouldCreateCycle`). When linking/creating a manager relationship, whether the new edge is primary is decided automatically: primary if the employee doesn't already have one, secondary otherwise. Double-clicking a node's first name, last name, or poste (same file) opens an inline editor (text input for name, a `<select>` sourced from `useJobTitles()` for poste, matching the grid's catalog-only constraint) — a single click keeps its existing role of selecting the node.

**No AG Grid master/detail.** That's an Enterprise-only feature. Per-employee assignments (client/mission + %ETP, one-to-many) are instead edited through the standalone `AssignmentEditorModal`, opened from a summary badge/cell in both the grid and the chart — not an expandable grid row.

**`useRowStabilizer` (`src/components/grid/useRowStabilizer.ts`) keeps grid rows from jumping under the user mid-edit**, shared by all 3 left-panel grids. Two mechanisms: a per-column `comparator` freezes a row being edited at its pre-edit value so an active sort doesn't reorder it while typing; a freshly-created row is pinned to the top via AG Grid's `pinnedTopRowData` (works even with no sort active, unlike a comparator trick alone) until the user leaves it. "Left the row" is detected via a document-level capture-phase `mousedown` listener walking up from the click target — deliberately *not* `onBlur`/`relatedTarget`, which false-positives the instant an AG Grid popup editor (e.g. `agSelectCellEditor`'s dropdown) mounts/unmounts. Any modal opened from a cell while a row might be mid-edit (`ManagerEditorModal`, `AssignmentEditorModal`) must carry a `data-row-stabilizer-ignore` attribute on its root element, or every click inside it reads as "clicked outside the grid" and prematurely unpins/unfreezes the row. `popupParent={containerRef.current}` on the grid is required for the same reason, scoping AG Grid's own popups inside the tracked container.

**Left pane is tabbed** (`LeftPanel.tsx`, local `useState`, not in the Zustand store): Employés (`EmployeeGrid`), Clients / Missions (`ClientsMissionsGrid`), Postes (`JobTitlesGrid`). The latter two are standalone catalog editors for tables that also back other features — `clients_missions` feeds `AssignmentEditorModal`'s autocomplete, `job_titles` feeds the "Poste" column's `agSelectCellEditor` in `EmployeeGrid` (`cellEditorParams.values` sourced live from `useJobTitles()`). `job_titles` has no FK from `employees.job_title` — it's a curated suggestion list enforced only at the UI layer (select-only editor, no free text), so deleting a job title never cascades or blocks. `clients_missions` does have a real FK from `assignments` (`on delete restrict`), so `ClientsMissionsGrid`'s delete handler must catch and surface that failure.

**`src/lib/database.types.ts` is hand-authored**, not generated by the Supabase CLI, and must be kept in sync with `supabase/migrations/*.sql` manually. Once a project is linked, prefer regenerating it with `supabase gen types typescript`. It must satisfy the `GenericSchema` shape from `@supabase/supabase-js` (each table needs `Relationships: []`, the schema needs `Views`/`Functions`) or the client's generic inference silently degrades and `.insert()`/`.update()` calls fail to typecheck.

**Library version notes:** AG Grid is v36 using the new Theming API (`theme={themeQuartz}` prop, no CSS imports, requires `ModuleRegistry.registerModules([AllCommunityModule])`) — don't add the old `ag-theme-*.css` imports. Tailwind is v4, configured via the `@tailwindcss/vite` plugin in `vite.config.ts`, not a `tailwind.config.js`/PostCSS setup.

## Deployment

Production: https://orgchart-dun.vercel.app, deployed by Vercel from `Havas-International-Paris/OrgChart` on GitHub — every push to `main` auto-deploys, no manual step. No separate staging environment: the same Supabase project backs both local dev and production. New SQL migrations must be applied by hand to that one project (see README.md's "Déploiement et mise à jour" section) — there's no automated migration pipeline.

**GitHub Actions + Supabase Postgres gotchas** (hit both when setting up `.github/workflows/supabase-backup.yml`, now documented inline in that file too):
- Supabase's "Direct connection" string (`db.<ref>.supabase.co`) is **IPv6-only**; GitHub's hosted runners have no IPv6 egress and fail with `Network is unreachable`. Use the **Session pooler** connection string instead (`aws-0-<region>.pooler.supabase.com`, found via the Connect modal's "Direct" tab).
- `pg_dump` refuses to dump from a server newer than itself. Supabase currently runs Postgres 17, but Ubuntu's default `postgresql-client` package is older — install `postgresql-client-17` from the official PGDG apt repo and invoke it by full path (`/usr/lib/postgresql/17/bin/pg_dump`), since the older bundled one stays first on `PATH`.
- The three repo secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`) have similar names — easy to edit the wrong one via GitHub's secrets UI (it happened once already). `SUPABASE_URL` must stay a plain `https://` URL (used by the keep-alive ping); the Postgres connection string belongs only in `SUPABASE_DB_URL`.

## Known issues

- No optimistic locking: if two users edit the same field at the same moment, last write wins silently.
- No granular roles — every authenticated user can edit or delete anything.
