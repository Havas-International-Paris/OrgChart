import { splitPersonName, toTitleCase, type InputN1Row, type InputNRow } from './timeImportParsing';
import { etpFractionToPct } from './timeEstimationMath';
import type { TimeActualUpsertRow } from '../services/timeEstimationService';

// Pure logic for ImportTimeActualsWizard.tsx's resolution/diff half — the
// counterpart to timeImportParsing.ts (which handles the *parsing* half).
// Kept framework/Supabase-free so it's testable without a DB, and kept
// separate from timeEstimationMath.ts (generic name/month/number math shared
// across the whole Time Estimation feature) since everything here is
// specific to this one wizard's resolution/import-planning shape.

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
// lets buildImportRowPlan classify pair-newness correctly BEFORE anything
// has actually been created (the review screen's whole reason to exist).
// handleImport itself never reaches the placeholder branch: it calls this
// only AFTER creating every 'create' row for real, passing 'match'-shaped
// resolutions with the freshly-created real id filled in instead.
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
  // A resolvable pair skipped outright because onlyNewPairs is on and it's
  // already known to the tool.
  skippedExistingPairKeys: Set<string>;
  // Subset of affectedPairKeys not already in existingPairKeys.
  newPairKeys: Set<string>;
}

// Builds every row this import would write, plus the pair-classification
// sets — the shared core between the review screen's preview
// (previewResolvedIds' placeholder ids) and handleImport's real commit
// (real ids, post-creation). Blind to which kind of id it's given, so the
// two callers can never disagree on the gnarliest part of this wizard: the
// cross-sheet "present in only one tab means 0 in the other" zero-fill rule
// and onlyNewPairs skip logic.
export function buildImportRowPlan(params: {
  n1Rows: InputN1Row[];
  nRows: InputNRow[];
  employeeIds: Map<string, string | null>;
  clientIds: Map<string, string | null>;
  existingPairKeys: Set<string>;
  importFields: ImportFieldSelection;
  onlyNewPairs: boolean;
  year: number;
  cutoffMonth: number;
}): ImportRowPlan {
  const { n1Rows, nRows, employeeIds, clientIds, existingPairKeys, importFields, onlyNewPairs, year, cutoffMonth } = params;

  const isNewPair = (employeeId: string, clientMissionId: string) => isNewPairKey(employeeId, clientMissionId, existingPairKeys);
  const skippedExistingPairKeys = new Set<string>();
  const affectedPairKeys = new Set<string>();
  const newPairKeys = new Set<string>();
  const markAffected = (employeeId: string, clientMissionId: string) => {
    const key = `${employeeId}::${clientMissionId}`;
    affectedPairKeys.add(key);
    if (isNewPair(employeeId, clientMissionId)) newPairKeys.add(key);
  };

  // 1. N-1 annual totals — one row per (employee, client), no month. A null
  // total on a real (employee, client) row means 0% that year, not "no
  // data" — the row only exists at all because this pair genuinely appears
  // in the file.
  const n1UpsertRows: ImportRowPlan['n1UpsertRows'] = [];
  if (importFields.n1) {
    for (const row of n1Rows) {
      const employeeId = row.employeeName ? employeeIds.get(row.employeeName) : null;
      const clientMissionId = row.annonceur ? clientIds.get(row.annonceur) : null;
      if (!employeeId || !clientMissionId) continue;
      if (onlyNewPairs && !isNewPair(employeeId, clientMissionId)) {
        skippedExistingPairKeys.add(`${employeeId}::${clientMissionId}`);
        continue;
      }
      n1UpsertRows.push({ employee_id: employeeId, client_mission_id: clientMissionId, year: year - 1, total_pct: etpFractionToPct(row.n1TotalFraction ?? 0) });
    }
  }

  // 2. Past months (1..cutoffMonth) → time_actuals.
  // 3. Future months (cutoffMonth+1..12) → time_forecast_months.
  const actualUpsertRows: ImportRowPlan['actualUpsertRows'] = [];
  const forecastUpsertRows: ImportRowPlan['forecastUpsertRows'] = [];

  for (const row of nRows) {
    const employeeId = row.employeeName ? employeeIds.get(row.employeeName) : null;
    const clientMissionId = row.annonceur ? clientIds.get(row.annonceur) : null;
    if (!employeeId || !clientMissionId) continue;
    if (onlyNewPairs && !isNewPair(employeeId, clientMissionId)) {
      skippedExistingPairKeys.add(`${employeeId}::${clientMissionId}`);
      continue;
    }
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
        forecastUpsertRows.push({ employee_id: employeeId, client_mission_id: clientMissionId, year, month, pct });
      }
    });
  }

  // A pair present in only ONE of the two sheets is still confirmed to be
  // in scope for this import (it's mentioned somewhere in the file), so its
  // total absence from the OTHER sheet is the file's own way of saying "0%
  // there" — not "no opinion," which is what leaving it completely
  // untouched would otherwise imply. This is the coarser, whole-row
  // counterpart of the null-cell-within-a-row → 0 rule above. Deliberately
  // scoped to pairs the file actually mentions: a pair absent from BOTH
  // sheets is never touched, so a genuinely partial/filtered extract (one
  // Business Unit's own file, say) can never zero out a pair that simply
  // isn't its concern.
  const n1PairKeys = new Set(n1Rows.filter((r) => r.employeeName && r.annonceur).map((r) => `${r.employeeName}::${r.annonceur}`));
  const nPairKeys = new Set(nRows.filter((r) => r.employeeName && r.annonceur).map((r) => `${r.employeeName}::${r.annonceur}`));

  if (importFields.n1) {
    for (const key of nPairKeys) {
      if (n1PairKeys.has(key)) continue;
      const [rawEmployeeName, rawAnnonceur] = key.split('::');
      const employeeId = employeeIds.get(rawEmployeeName);
      const clientMissionId = clientIds.get(rawAnnonceur);
      if (!employeeId || !clientMissionId) continue;
      if (onlyNewPairs && !isNewPair(employeeId, clientMissionId)) {
        skippedExistingPairKeys.add(`${employeeId}::${clientMissionId}`);
        continue;
      }
      n1UpsertRows.push({ employee_id: employeeId, client_mission_id: clientMissionId, year: year - 1, total_pct: 0 });
    }
  }

  for (const key of n1PairKeys) {
    if (nPairKeys.has(key)) continue;
    const [rawEmployeeName, rawAnnonceur] = key.split('::');
    const employeeId = employeeIds.get(rawEmployeeName);
    const clientMissionId = clientIds.get(rawAnnonceur);
    if (!employeeId || !clientMissionId) continue;
    if (onlyNewPairs && !isNewPair(employeeId, clientMissionId)) {
      skippedExistingPairKeys.add(`${employeeId}::${clientMissionId}`);
      continue;
    }
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
        forecastUpsertRows.push({ employee_id: employeeId, client_mission_id: clientMissionId, year, month, pct: 0 });
      }
    }
  }

  return { n1UpsertRows, actualUpsertRows, forecastUpsertRows, affectedPairKeys, skippedExistingPairKeys, newPairKeys };
}

export interface ImportDiffSummary {
  employeesToCreate: string[];
  employeesMatchedCount: number;
  employeesIgnoredCount: number;
  clientsToCreate: string[];
  clientsMatchedCount: number;
  clientsIgnoredCount: number;
  newPairsCount: number;
  // Resolvable pairs already known before this import — whether they'll be
  // WRITTEN (overwritten) or SKIPPED depends only on the caller's own
  // onlyNewPairs flag, already in its own hands, so this stays one neutral
  // number and the wording lives entirely in the component's i18n strings.
  existingPairsCount: number;
  // A pair whose employee or client side didn't resolve to any id at all —
  // its data is silently dropped from this import.
  unresolvedPairsCount: number;
  plannedRowCounts: { n1: number; actuals: number; forecast: number };
  undecidedCount: number;
}

// The review screen's single entry point — computed purely from state
// already available before any network write, so it can run as soon as the
// user reaches the review step and never risks disagreeing with what
// handleImport actually ends up writing (same buildImportRowPlan core).
export function computeImportDiffSummary(
  employeeResolutions: Record<string, EmployeeResolution>,
  clientResolutions: Record<string, ClientResolution>,
  n1Rows: InputN1Row[],
  nRows: InputNRow[],
  existingPairKeys: Set<string>,
  importFields: ImportFieldSelection,
  onlyNewPairs: boolean,
  year: number,
  cutoffMonth: number,
): ImportDiffSummary {
  const { employeeIds, clientIds } = previewResolvedIds(employeeResolutions, clientResolutions);
  const plan = buildImportRowPlan({ n1Rows, nRows, employeeIds, clientIds, existingPairKeys, importFields, onlyNewPairs, year, cutoffMonth });

  const distinctRawPairKeys = new Set<string>();
  for (const row of n1Rows) {
    if (row.employeeName && row.annonceur) distinctRawPairKeys.add(`${row.employeeName}::${row.annonceur}`);
  }
  for (const row of nRows) {
    if (row.employeeName && row.annonceur) distinctRawPairKeys.add(`${row.employeeName}::${row.annonceur}`);
  }
  const resolvablePairsTotal = plan.affectedPairKeys.size + plan.skippedExistingPairKeys.size;

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
    newPairsCount: plan.newPairKeys.size,
    existingPairsCount: resolvablePairsTotal - plan.newPairKeys.size,
    unresolvedPairsCount: distinctRawPairKeys.size - resolvablePairsTotal,
    plannedRowCounts: { n1: plan.n1UpsertRows.length, actuals: plan.actualUpsertRows.length, forecast: plan.forecastUpsertRows.length },
    undecidedCount:
      Object.values(employeeResolutions).filter((r) => r.decision === null).length +
      Object.values(clientResolutions).filter((r) => r.decision === null).length,
  };
}
