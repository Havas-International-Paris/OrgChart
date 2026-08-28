import { splitPersonName, toTitleCase, type InputN1Row, type InputNRow } from './timeImportParsing';
import { employeeNameSimilarity, etpFractionToPct } from './timeEstimationMath';
import type { TimeActualUpsertRow } from '../services/timeEstimationService';
import type { TimeManualEditMarker } from '../types/domain';

// Pure logic for ImportTimeActualsWizard.tsx's resolution/diff/selection half
// — the counterpart to timeImportParsing.ts (which handles the *parsing*
// half). Kept framework/Supabase-free so it's testable without a DB, and
// kept separate from timeEstimationMath.ts (generic name/month/number math
// shared across the whole Time Estimation feature) since everything here is
// specific to this one wizard's resolution/selection/import-planning shape.

export interface EmployeeResolution {
  status: 'auto' | 'needs-review';
  employeeId: string | null;
  decision: 'match' | 'create' | 'ignore' | null;
  // Editable proposal shown when decision === 'create', seeded from
  // toTitleCase(splitPersonName(rawName)) — the admin can freely correct it
  // (e.g. force "Alice" alone, fix an unusual capitalization) before commit.
  createFirstName?: string;
  createLastName?: string;
}

// A raw import name that doesn't exact-match any registry employee (that
// path resolves with no review row at all, see matchesEmployeeName in
// ImportTimeActualsWizard.tsx's handleFileSelected) but comes very close —
// a likely typo, or a name variant normalizeNameForMatch doesn't catch —
// still defaults its review row to the closest existing employee rather
// than to creating a new one, since silently creating a duplicate person is
// the costlier mistake. Only a DEFAULT: the row stays fully visible and
// editable on Screen 2, the admin can switch to Create/a different
// match/Ignore before continuing.
export const HIGH_CONFIDENCE_MATCH_THRESHOLD = 0.85;

// The initial resolution proposed for a raw employee name that has zero or
// several exact matches (so it needs a review row at all) — extracted as
// its own pure function so the "prefer a strong fuzzy match over creating a
// duplicate" rule has a direct unit test, matching this codebase's general
// preference for pulling non-trivial decision logic out of the component.
export function seedNeedsReviewEmployeeResolution(
  rawName: string,
  registryEmployees: Array<{ id: string; first_name: string; last_name: string }>,
): EmployeeResolution {
  let bestId: string | null = null;
  let bestScore = 0;
  for (const e of registryEmployees) {
    const score = employeeNameSimilarity(rawName, e.first_name, e.last_name);
    if (score > bestScore) {
      bestScore = score;
      bestId = e.id;
    }
  }
  if (bestId && bestScore >= HIGH_CONFIDENCE_MATCH_THRESHOLD) {
    return { status: 'needs-review', employeeId: bestId, decision: 'match' };
  }
  const seeded = splitPersonName(rawName);
  return {
    status: 'needs-review',
    employeeId: null,
    decision: 'create',
    createFirstName: toTitleCase(seeded.firstName),
    createLastName: toTitleCase(seeded.lastName),
  };
}

export interface ClientResolution {
  status: 'auto' | 'needs-review';
  clientMissionId: string | null;
  decision: 'match' | 'create' | null;
  // Editable proposal shown when decision === 'create', seeded from
  // toTitleCase(rawName).
  createName?: string;
}

// An untouched row (decision === null) is allowed through — handleImport
// already treats it exactly like an explicit "ignore" (writes a null alias, the
// row's data is skipped on import), so it must never block Continue. Only a
// genuinely half-finished explicit choice (picked "create" but left the name
// blank) is real invalid state that should still block.
export function employeeResolutionAllowsContinue(r: EmployeeResolution): boolean {
  if (r.decision === 'create') return Boolean(r.createFirstName?.trim()) && Boolean(r.createLastName?.trim());
  return true;
}

export function clientResolutionAllowsContinue(r: ClientResolution): boolean {
  if (r.decision === 'create') return Boolean(r.createName?.trim());
  return true;
}

// Which categories of parsed data to actually persist on import — all true
// by default. Letting the user uncheck a category (e.g. re-importing only
// N-1 totals without touching this year's actuals/forecast) is the whole
// point: every checked category is written unconditionally (see
// buildImportRowPlan below), no more per-row "keep the existing value" choice.
export interface ImportFieldSelection {
  n1: boolean;
  actuals: boolean;
  forecast: boolean;
}

export function employeeCreateDisplayName(rawName: string, res: EmployeeResolution): string {
  const firstName = res.createFirstName?.trim() || splitPersonName(rawName).firstName;
  const lastName = res.createLastName?.trim() || splitPersonName(rawName).lastName;
  return `${firstName} ${lastName}`.trim();
}

export function clientCreateDisplayName(rawName: string, res: ClientResolution): string {
  return res.createName?.trim() || toTitleCase(rawName);
}

export function isNewPairKey(employeeId: string, clientMissionId: string, existingPairKeys: Set<string>): boolean {
  return !existingPairKeys.has(`${employeeId}::${clientMissionId}`);
}

export interface PreviewResolvedIds {
  employeeIds: Map<string, string | null>;
  clientIds: Map<string, string | null>;
}

// Resolves every raw name to either a real id (decision === 'match'/'auto',
// where employeeId/clientMissionId is already the real one) or a unique
// placeholder string (decision === 'create') that can never collide with a
// real UUID and therefore never appears in existingPairKeys — this is what
// lets buildImportRowPlan/computeImportDiffSummary classify pair-newness
// correctly BEFORE anything has actually been created. handleImport itself
// never reaches the placeholder branch: it calls this only AFTER creating
// every 'create' row for real, passing 'match'-shaped resolutions with the
// freshly-created real id filled in instead.
export function previewResolvedIds(
  employeeResolutions: Record<string, EmployeeResolution>,
  clientResolutions: Record<string, ClientResolution>,
): PreviewResolvedIds {
  const employeeIds = new Map<string, string | null>();
  for (const [rawName, res] of Object.entries(employeeResolutions)) {
    employeeIds.set(
      rawName,
      res.decision === 'create'
        ? `__preview__:employee:${rawName}`
        : res.decision === 'match'
          ? res.employeeId
          : null,
    );
  }
  const clientIds = new Map<string, string | null>();
  for (const [rawName, res] of Object.entries(clientResolutions)) {
    clientIds.set(
      rawName,
      res.decision === 'create' ? `__preview__:client:${rawName}` : res.decision === 'match' ? res.clientMissionId : null,
    );
  }
  return { employeeIds, clientIds };
}

export interface RawPair {
  employeeName: string;
  clientName: string;
}

// Raw-name key format shared by every selection/plan set in this module —
// `${employeeName}::${clientName}`, always the raw file names, never
// resolved ids. Kept as raw names (not ids) specifically so a pair can be
// selected/deselected at Screen 3 even before its employee/client side has
// a real id — resolution (Screen 2/5) and selection (Screen 3) are
// deliberately independent steps that don't need to happen in a strict
// dependency order relative to each other for a given pair.
export function rawPairKey(employeeName: string, clientName: string): string {
  return `${employeeName}::${clientName}`;
}

// The union of (employee, client) combinations mentioned in either sheet —
// this exact computation used to live duplicated inline in
// buildImportRowPlan's cross-sheet zero-fill logic; lifted out so Screen 3's
// pair-selection UI and buildImportRowPlan can never disagree on what "every
// pair in this file" means.
export function computeDistinctRawPairs(n1Rows: InputN1Row[], nRows: InputNRow[]): RawPair[] {
  const seen = new Set<string>();
  const pairs: RawPair[] = [];
  for (const row of [...n1Rows, ...nRows]) {
    if (!row.employeeName || !row.annonceur) continue;
    const key = rawPairKey(row.employeeName, row.annonceur);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ employeeName: row.employeeName, clientName: row.annonceur });
  }
  return pairs;
}

// Screen 3's starting checkbox state, before the user touches anything: a
// pair defaults to SELECTED only when it's already known to the tool
// (existingPairKeys, real ids) — a routine monthly refresh should update
// what's already there without extra clicks. A pair that's new (or whose
// employee/client side isn't resolved to a real id yet — including a
// 'create' placeholder, which can never appear in existingPairKeys by
// construction) defaults to UNSELECTED: creating a brand-new pair is a more
// consequential action than updating an existing one, so it needs an
// explicit opt-in rather than happening silently by default.
export function computeDefaultPairSelection(
  rawPairs: RawPair[],
  employeeIds: Map<string, string | null>,
  clientIds: Map<string, string | null>,
  existingPairKeys: Set<string>,
): Set<string> {
  const selected = new Set<string>();
  for (const pair of rawPairs) {
    const employeeId = employeeIds.get(pair.employeeName);
    const clientMissionId = clientIds.get(pair.clientName);
    if (!employeeId || !clientMissionId) continue;
    if (!isNewPairKey(employeeId, clientMissionId, existingPairKeys)) {
      selected.add(rawPairKey(pair.employeeName, pair.clientName));
    }
  }
  return selected;
}

// The "Only new pairs" bulk action (Screen 3) — recomputes the WHOLE
// selection from scratch to the inverse of the default pattern (new
// checked, existing unchecked), rather than toggling in place, so it can
// never silently drift out of sync with prior manual edits: it's a one-shot
// "start over with this preset" action, not a persistent mode.
export function computeOnlyNewPairsSelection(
  rawPairs: RawPair[],
  employeeIds: Map<string, string | null>,
  clientIds: Map<string, string | null>,
  existingPairKeys: Set<string>,
): Set<string> {
  const selected = new Set<string>();
  for (const pair of rawPairs) {
    const employeeId = employeeIds.get(pair.employeeName);
    const clientMissionId = clientIds.get(pair.clientName);
    if (!employeeId || !clientMissionId) continue;
    if (isNewPairKey(employeeId, clientMissionId, existingPairKeys)) {
      selected.add(rawPairKey(pair.employeeName, pair.clientName));
    }
  }
  return selected;
}

// The "Select all" bulk action (Screen 3) — every pair whose employee and
// client sides both resolve to a real (or create-placeholder) id, regardless
// of new/existing. Same one-shot "start over with this preset" shape as
// computeOnlyNewPairsSelection/computeDefaultPairSelection, not a toggle.
export function computeAllResolvablePairsSelection(
  rawPairs: RawPair[],
  employeeIds: Map<string, string | null>,
  clientIds: Map<string, string | null>,
): Set<string> {
  const selected = new Set<string>();
  for (const pair of rawPairs) {
    const employeeId = employeeIds.get(pair.employeeName);
    const clientMissionId = clientIds.get(pair.clientName);
    if (!employeeId || !clientMissionId) continue;
    selected.add(rawPairKey(pair.employeeName, pair.clientName));
  }
  return selected;
}

// "Skip pairs whose forecast was manually edited" (dataOptions screen,
// nested under the forecast checkbox) — a pair is protected if
// time_manual_edit_markers has an entry THIS year on one of its own future
// months (m{cutoffMonth}..m11, 0-indexed the same way handleImport's own
// touchField does — see ImportTimeActualsWizard.tsx) or on avgRemaining
// (the "moyenne restante" cell). Deliberately does NOT check the `total`
// field: it blends past+future into one number, so a manual edit there
// doesn't necessarily mean the forecast side specifically was hand-set —
// could equally have been a past-only edit. Returns RESOLVED-id pair keys
// (`${employeeId}::${clientMissionId}`, same format as existingPairKeys/
// affectedPairKeys) since markers only ever carry real ids, never raw names.
export function computeManuallyEditedForecastPairs(
  markers: TimeManualEditMarker[],
  year: number,
  cutoffMonth: number,
): Set<string> {
  const protectedPairs = new Set<string>();
  for (const m of markers) {
    if (m.year !== year) continue;
    const monthMatch = /^m(\d+)$/.exec(m.field);
    const isFutureMonth = monthMatch != null && Number(monthMatch[1]) >= cutoffMonth;
    if (isFutureMonth || m.field === 'avgRemaining') {
      protectedPairs.add(`${m.employee_id}::${m.client_mission_id}`);
    }
  }
  return protectedPairs;
}

export interface ImportRowPlan {
  n1UpsertRows: Array<{ employee_id: string; client_mission_id: string; year: number; total_pct: number }>;
  // batch_id is deliberately absent: the batch row doesn't exist yet at
  // preview time (createTimeImportBatch is a real network call, only ever
  // made from handleImport's own commit path) — the caller attaches it once
  // it does.
  actualUpsertRows: Array<Omit<TimeActualUpsertRow, 'batch_id'>>;
  forecastUpsertRows: Array<{ employee_id: string; client_mission_id: string; year: number; month: number; pct: number }>;
  // Every (employee, client) pair this plan actually writes SOME data for.
  affectedPairKeys: Set<string>;
  // Subset of affectedPairKeys not already in existingPairKeys.
  newPairKeys: Set<string>;
  // Pairs whose forecast was skipped because they're in
  // protectedForecastPairKeys AND the file actually had a future-month value
  // to write for them — actuals/N-1 for these pairs are unaffected.
  forecastSkippedProtectedPairKeys: Set<string>;
}

// Builds every row this import would write — the shared core between the
// review screen's preview (previewResolvedIds' placeholder ids) and
// handleImport's real commit (real ids, post-creation). Blind to which kind
// of id it's given, so the two callers can never disagree on the gnarliest
// part of this wizard: the cross-sheet "present in only one tab means 0 in
// the other" zero-fill rule. Only ever writes a pair explicitly present in
// selectedPairKeys (Screen 3's checklist) — this function no longer decides
// new-vs-existing skip logic itself, that decision already happened
// upstream, in the user's own selection.
export function buildImportRowPlan(params: {
  n1Rows: InputN1Row[];
  nRows: InputNRow[];
  employeeIds: Map<string, string | null>;
  clientIds: Map<string, string | null>;
  existingPairKeys: Set<string>;
  importFields: ImportFieldSelection;
  selectedPairKeys: Set<string>;
  // Resolved-id pair keys (computeManuallyEditedForecastPairs) whose
  // forecast months are skipped regardless of selection/importFields.forecast
  // — actuals/N-1 for the SAME pair are unaffected, this only ever narrows
  // forecastUpsertRows. Empty set = no protection (the checkbox unchecked).
  protectedForecastPairKeys: Set<string>;
  year: number;
  cutoffMonth: number;
}): ImportRowPlan {
  const { n1Rows, nRows, employeeIds, clientIds, existingPairKeys, importFields, selectedPairKeys, protectedForecastPairKeys, year, cutoffMonth } =
    params;

  const affectedPairKeys = new Set<string>();
  const newPairKeys = new Set<string>();
  const markAffected = (employeeId: string, clientMissionId: string) => {
    const key = `${employeeId}::${clientMissionId}`;
    affectedPairKeys.add(key);
    if (isNewPairKey(employeeId, clientMissionId, existingPairKeys)) newPairKeys.add(key);
  };

  // n1UpsertRows/forecastUpsertRows are built into a Map keyed by their own
  // upsert's RESOLVED-id conflict target (employee_id/client_mission_id/
  // year[/month] — see upsertTimeActualN1Totals/upsertTimeForecastMonths,
  // timeEstimationService.ts), summing on collision, rather than pushed
  // straight into an array. Two different raw names can resolve to the same
  // real employee (an unaliased spelling variant that both independently
  // matched/were matched to one registry employee) or client — ordinary and
  // expected, not a data error — and if pairs for both ended up selected at
  // Screen 3, two rows with an IDENTICAL conflict key would land in the same
  // upsert() call, which Postgres rejects outright ("ON CONFLICT DO UPDATE
  // command cannot affect row a second time"), not merges. time_actuals has
  // no such problem — its own onConflict is on the RAW name columns, so it
  // deliberately keeps one row per raw variant and sums them at read time
  // (see that table's own comments) — n1/forecast have no raw-name column at
  // all to disambiguate by, so the sum has to happen here, at write time,
  // instead.
  const n1UpsertByKey = new Map<string, ImportRowPlan['n1UpsertRows'][number]>();
  const addN1 = (employeeId: string, clientMissionId: string, totalYear: number, totalPct: number) => {
    const key = `${employeeId}::${clientMissionId}::${totalYear}`;
    const existing = n1UpsertByKey.get(key);
    if (existing) existing.total_pct += totalPct;
    else n1UpsertByKey.set(key, { employee_id: employeeId, client_mission_id: clientMissionId, year: totalYear, total_pct: totalPct });
  };
  const forecastUpsertByKey = new Map<string, ImportRowPlan['forecastUpsertRows'][number]>();
  const skippedProtectedPairKeys = new Set<string>();
  const addForecast = (employeeId: string, clientMissionId: string, forecastYear: number, month: number, pct: number) => {
    const pairKey = `${employeeId}::${clientMissionId}`;
    if (protectedForecastPairKeys.has(pairKey)) {
      skippedProtectedPairKeys.add(pairKey);
      return;
    }
    const key = `${pairKey}::${forecastYear}::${month}`;
    const existing = forecastUpsertByKey.get(key);
    if (existing) existing.pct += pct;
    else forecastUpsertByKey.set(key, { employee_id: employeeId, client_mission_id: clientMissionId, year: forecastYear, month, pct });
  };

  // 1. N-1 annual totals — one row per (employee, client), no month. A null
  // total on a real (employee, client) row means 0% that year, not "no
  // data" — the row only exists at all because this pair genuinely appears
  // in the file.
  if (importFields.n1) {
    for (const row of n1Rows) {
      if (!row.employeeName || !row.annonceur) continue;
      if (!selectedPairKeys.has(rawPairKey(row.employeeName, row.annonceur))) continue;
      const employeeId = employeeIds.get(row.employeeName);
      const clientMissionId = clientIds.get(row.annonceur);
      if (!employeeId || !clientMissionId) continue;
      addN1(employeeId, clientMissionId, year - 1, etpFractionToPct(row.n1TotalFraction ?? 0));
    }
  }

  // 2. Past months (1..cutoffMonth) → time_actuals.
  // 3. Future months (cutoffMonth+1..12) → time_forecast_months.
  const actualUpsertRows: ImportRowPlan['actualUpsertRows'] = [];

  for (const row of nRows) {
    if (!row.employeeName || !row.annonceur) continue;
    if (!selectedPairKeys.has(rawPairKey(row.employeeName, row.annonceur))) continue;
    const employeeId = employeeIds.get(row.employeeName);
    const clientMissionId = clientIds.get(row.annonceur);
    if (!employeeId || !clientMissionId) continue;
    markAffected(employeeId, clientMissionId);
    row.monthlyFractions.forEach((fraction, i) => {
      const month = i + 1;
      // A null cell on a real row means 0% that month (e.g. the person
      // moved to a different client that month), not "no data" — same
      // reasoning as the N-1 total above. Writing an explicit 0 instead of
      // skipping the month is also what lets the override-clearing pass in
      // handleImport actually reach every month being re-imported.
      const pct = etpFractionToPct(fraction ?? 0);
      if (month <= cutoffMonth) {
        if (!importFields.actuals) return;
        actualUpsertRows.push({
          year,
          month,
          raw_employee_name: row.employeeName ?? '',
          raw_client_name: row.annonceur ?? '',
          raw_sous_dossier: null,
          raw_group_annonceur: null,
          raw_payroll_name: null,
          raw_bu_name: row.metiers,
          etp_pct: pct,
          resolved_employee_id: employeeId,
          resolved_client_mission_id: clientMissionId,
        });
      } else {
        if (!importFields.forecast) return;
        addForecast(employeeId, clientMissionId, year, month, pct);
      }
    });
  }

  // A pair present in only ONE of the two sheets is still confirmed to be
  // in scope for this import (it's mentioned somewhere in the file), so its
  // total absence from the OTHER sheet is the file's own way of saying "0%
  // there" — not "no opinion," which is what leaving it completely
  // untouched would otherwise imply. This is the coarser, whole-row
  // counterpart of the null-cell-within-a-row → 0 rule above. Deliberately
  // scoped to pairs the file actually mentions AND the user selected: a
  // pair absent from BOTH sheets, or present but not selected, is never
  // touched.
  const n1PairKeys = new Set(n1Rows.filter((r) => r.employeeName && r.annonceur).map((r) => rawPairKey(r.employeeName!, r.annonceur!)));
  const nPairKeys = new Set(nRows.filter((r) => r.employeeName && r.annonceur).map((r) => rawPairKey(r.employeeName!, r.annonceur!)));

  if (importFields.n1) {
    for (const key of nPairKeys) {
      if (n1PairKeys.has(key)) continue;
      if (!selectedPairKeys.has(key)) continue;
      const [rawEmployeeName, rawAnnonceur] = key.split('::');
      const employeeId = employeeIds.get(rawEmployeeName);
      const clientMissionId = clientIds.get(rawAnnonceur);
      if (!employeeId || !clientMissionId) continue;
      addN1(employeeId, clientMissionId, year - 1, 0);
    }
  }

  for (const key of n1PairKeys) {
    if (nPairKeys.has(key)) continue;
    if (!selectedPairKeys.has(key)) continue;
    const [rawEmployeeName, rawAnnonceur] = key.split('::');
    const employeeId = employeeIds.get(rawEmployeeName);
    const clientMissionId = clientIds.get(rawAnnonceur);
    if (!employeeId || !clientMissionId) continue;
    markAffected(employeeId, clientMissionId);
    for (let month = 1; month <= 12; month += 1) {
      if (month <= cutoffMonth) {
        if (!importFields.actuals) continue;
        actualUpsertRows.push({
          year,
          month,
          raw_employee_name: rawEmployeeName,
          raw_client_name: rawAnnonceur,
          raw_sous_dossier: null,
          raw_group_annonceur: null,
          raw_payroll_name: null,
          raw_bu_name: null,
          etp_pct: 0,
          resolved_employee_id: employeeId,
          resolved_client_mission_id: clientMissionId,
        });
      } else {
        if (!importFields.forecast) continue;
        addForecast(employeeId, clientMissionId, year, month, 0);
      }
    }
  }

  return {
    n1UpsertRows: Array.from(n1UpsertByKey.values()),
    actualUpsertRows,
    forecastUpsertRows: Array.from(forecastUpsertByKey.values()),
    affectedPairKeys,
    newPairKeys,
    forecastSkippedProtectedPairKeys: skippedProtectedPairKeys,
  };
}

// Which raw employee/client names still need a decision but are relevant to
// what the user has already opted into at Screen 3 — Screen 5's whole
// reason to exist. "Relevant" is driven by two small, EXPLICIT tracking
// sets (selectedClientNames/selectedEmployeeNames — see
// ImportTimeActualsWizard.tsx's Screen 3 state), not derived from
// selectedPairKeys alone: a client whose employees are ALL still
// unresolved has literally no selectable pair checkbox yet (nothing to
// derive from), so the user opting into that client at all has to be
// tracked as its own signal, separate from which individual pairs ended up
// checkable.
export function computeRelevantUnresolvedNames(
  selectedClientNames: Set<string>,
  selectedEmployeeNames: Set<string>,
  rawPairs: RawPair[],
  employeeResolutions: Record<string, EmployeeResolution>,
  clientResolutions: Record<string, ClientResolution>,
): { employees: string[]; clients: string[] } {
  const employees = new Set<string>();
  const clients = new Set<string>();
  for (const pair of rawPairs) {
    if (selectedClientNames.has(pair.clientName) && (employeeResolutions[pair.employeeName]?.decision ?? null) === null) {
      employees.add(pair.employeeName);
    }
    if (selectedEmployeeNames.has(pair.employeeName) && (clientResolutions[pair.clientName]?.decision ?? null) === null) {
      clients.add(pair.clientName);
    }
  }
  return { employees: [...employees].sort((a, b) => a.localeCompare(b, 'fr')), clients: [...clients].sort((a, b) => a.localeCompare(b, 'fr')) };
}

export interface ImportDiffSummary {
  employeesToCreate: string[];
  employeesMatchedCount: number;
  employeesIgnoredCount: number;
  clientsToCreate: string[];
  clientsMatchedCount: number;
  clientsIgnoredCount: number;
  // A pair actually being written this run, split by whether it's brand
  // new or already known (both are real writes — the distinction is just
  // "create" vs "update" in wording).
  newPairsSelectedCount: number;
  existingPairsSelectedCount: number;
  // A resolvable pair NOT selected — deliberately left untouched. Split the
  // same way, since "N new pairs available but not created" and "N known
  // pairs left as-is" read very differently to a reviewer.
  newPairsSkippedCount: number;
  existingPairsSkippedCount: number;
  // A pair whose employee or client side never resolved to any id at all —
  // its data is silently dropped from this import (distinct from "resolved
  // but not selected," which is a deliberate choice, not a gap).
  unresolvedPairsCount: number;
  plannedRowCounts: { n1: number; actuals: number; forecast: number };
  undecidedCount: number;
  // Pairs whose forecast was left untouched this run specifically because
  // they're protected (skip-manually-edited-forecast checkbox) — a subset of
  // the pairs that WOULD otherwise have had a forecast row written.
  forecastSkippedManuallyEditedCount: number;
}

// The review screen's single entry point — computed purely from state
// already available before any network write, so it can run as soon as the
// user reaches the review step and never risks disagreeing with what
// handleImport actually ends up writing (same buildImportRowPlan core for
// the row counts; the pair-classification counts below are computed
// directly against the full pair list so every distinct pair in the file is
// accounted for exactly once, not just the ones actually written).
export function computeImportDiffSummary(
  employeeResolutions: Record<string, EmployeeResolution>,
  clientResolutions: Record<string, ClientResolution>,
  n1Rows: InputN1Row[],
  nRows: InputNRow[],
  existingPairKeys: Set<string>,
  importFields: ImportFieldSelection,
  selectedPairKeys: Set<string>,
  protectedForecastPairKeys: Set<string>,
  year: number,
  cutoffMonth: number,
): ImportDiffSummary {
  const { employeeIds, clientIds } = previewResolvedIds(employeeResolutions, clientResolutions);
  const plan = buildImportRowPlan({
    n1Rows,
    nRows,
    employeeIds,
    clientIds,
    existingPairKeys,
    importFields,
    selectedPairKeys,
    protectedForecastPairKeys,
    year,
    cutoffMonth,
  });

  const rawPairs = computeDistinctRawPairs(n1Rows, nRows);
  let newPairsSelectedCount = 0;
  let existingPairsSelectedCount = 0;
  let newPairsSkippedCount = 0;
  let existingPairsSkippedCount = 0;
  let unresolvedPairsCount = 0;
  for (const pair of rawPairs) {
    const employeeId = employeeIds.get(pair.employeeName);
    const clientMissionId = clientIds.get(pair.clientName);
    if (!employeeId || !clientMissionId) {
      unresolvedPairsCount += 1;
      continue;
    }
    const isNew = isNewPairKey(employeeId, clientMissionId, existingPairKeys);
    const isSelected = selectedPairKeys.has(rawPairKey(pair.employeeName, pair.clientName));
    if (isNew && isSelected) newPairsSelectedCount += 1;
    else if (!isNew && isSelected) existingPairsSelectedCount += 1;
    else if (isNew && !isSelected) newPairsSkippedCount += 1;
    else existingPairsSkippedCount += 1;
  }

  return {
    employeesToCreate: Object.entries(employeeResolutions)
      .filter(([, r]) => r.decision === 'create')
      .map(([rawName, r]) => employeeCreateDisplayName(rawName, r))
      .sort((a, b) => a.localeCompare(b, 'fr')),
    employeesMatchedCount: Object.values(employeeResolutions).filter((r) => r.decision === 'match').length,
    employeesIgnoredCount: Object.values(employeeResolutions).filter((r) => r.decision === 'ignore' || r.decision === null).length,
    clientsToCreate: Object.entries(clientResolutions)
      .filter(([, r]) => r.decision === 'create')
      .map(([rawName, r]) => clientCreateDisplayName(rawName, r))
      .sort((a, b) => a.localeCompare(b, 'fr')),
    clientsMatchedCount: Object.values(clientResolutions).filter((r) => r.decision === 'match').length,
    clientsIgnoredCount: Object.values(clientResolutions).filter((r) => r.decision === null).length,
    newPairsSelectedCount,
    existingPairsSelectedCount,
    newPairsSkippedCount,
    existingPairsSkippedCount,
    unresolvedPairsCount,
    plannedRowCounts: { n1: plan.n1UpsertRows.length, actuals: plan.actualUpsertRows.length, forecast: plan.forecastUpsertRows.length },
    undecidedCount:
      Object.values(employeeResolutions).filter((r) => r.decision === null).length +
      Object.values(clientResolutions).filter((r) => r.decision === null).length,
    forecastSkippedManuallyEditedCount: plan.forecastSkippedProtectedPairKeys.size,
  };
}
