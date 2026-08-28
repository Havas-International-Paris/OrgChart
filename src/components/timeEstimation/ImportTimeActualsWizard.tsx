import { useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import * as XLSX from 'xlsx';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabaseClient';
import { useEmployees } from '../../hooks/useEmployees';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useTimeEstimation } from '../../hooks/useTimeEstimation';
import * as employeeService from '../../services/employeeService';
import * as timeEstimationService from '../../services/timeEstimationService';
import type { TimeActualUpsertRow } from '../../services/timeEstimationService';
import { averageOverRange, employeeNameSimilarity, matchesClientName, matchesEmployeeName } from '../../lib/timeEstimationMath';
import {
  detectCutoffMonth,
  forwardFillHierarchy,
  isSubtotalRow,
  splitPersonName,
  toTitleCase,
  type CutoffDetectionResult,
  type InputN1Row,
  type InputNRow,
} from '../../lib/timeImportParsing';
import {
  buildImportRowPlan,
  clientResolutionAllowsContinue,
  computeDefaultPairSelection,
  computeDistinctRawPairs,
  computeImportDiffSummary,
  computeOnlyNewPairsSelection,
  computeRelevantUnresolvedNames,
  employeeResolutionAllowsContinue,
  previewResolvedIds,
  seedNeedsReviewEmployeeResolution,
  type ClientResolution,
  type EmployeeResolution,
  type ImportFieldSelection,
  type RawPair,
} from '../../lib/timeImportDiff';
import type { Employee } from '../../types/domain';
import { PairSelectionStep } from './PairSelectionStep';

// Revision 3: same two-tab workbook shape (one annual total per employee×
// client on "Input N-1", monthly detail on "Input N"), but both tabs
// changed to match Power BI's own "Exporter des données → Données
// résumées" export instead of the old manual "develop the whole hierarchy,
// copy-paste" procedure: no more METIERS/Annonceur left blank below a group
// header (every row is already fully filled) and no more per-group "Total"
// aggregate rows to filter out — forwardFillHierarchy/isSubtotalRow are
// still applied below as a cheap no-op safety net against Power BI ever
// reverting to the old shape, not because this format needs them. "Input
// N-1"'s columns were also renamed (ETPs 2025 -> ETP Fin N-1, ETPs 2026 ->
// ETP Fin Période) and "Input N" is no longer wide (one row per employee×
// client with 12 MTD columns) but long/unpivoted (one row per employee×
// client×month, a PeriodMonth + single ETP staffing column) — parseInputNSheet
// pivots it back to the same monthlyFractions[12] shape the rest of this
// file and timeImportParsing.ts already expect, so nothing downstream of
// parsing needed to change. Verified byte-for-byte identical against the
// last old-format export before switching (782/782 N-1 pairs, 476/476 N
// pairs, zero differing values on any month including the cutoff month).
// See CLAUDE.md for the full design.

const TEMPLATE_N1_HEADERS = ['METIERS', 'Annonceur', 'Employee Prenom Nom', 'ETP Fin N-1', 'ETP Fin Période', '.ETPs Havas Encours N', 'Var Etps', '.ETPs Clients N'];

function downloadTemplate() {
  const n1Sheet = XLSX.utils.aoa_to_sheet([
    TEMPLATE_N1_HEADERS,
    ['ADOPS', 'Client Exemple', 'Jean Dupont', 0.03, 0.16, 0.22, -0.06, 0.22],
  ]);
  const nSheet = XLSX.utils.aoa_to_sheet([
    ['METIERS', 'Annonceur', 'Employee Prenom Nom', 'PeriodMonth', 'ETP staffing'],
    ...Array.from({ length: 12 }, (_, i) => ['ADOPS', 'Client Exemple', 'Jean Dupont', `MTD${String(i + 1).padStart(2, '0')}`, 0.2]),
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, n1Sheet, 'Input N-1');
  XLSX.utils.book_append_sheet(wb, nSheet, 'Input N');
  XLSX.writeFile(wb, 'estimation-des-temps-template.xlsx');
}

function cellStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function cellNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function isBlankRow(row: unknown[]): boolean {
  return !row.some((c) => c != null && String(c).trim() !== '');
}

function findSheet(wb: XLSX.WorkBook, name: string): XLSX.WorkSheet | null {
  const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === name.toLowerCase());
  return sheetName ? wb.Sheets[sheetName] : null;
}

// Both tabs have one plain header row with unique column names, possibly
// preceded by Power BI's own "Filtres appliqués : ..." + blank rows — found
// by scanning for the METIERS cell rather than assuming row 0, so those
// leading rows (and column reordering) don't break parsing.
function parseInputN1Sheet(sheet: XLSX.WorkSheet): InputN1Row[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const headerIndex = rows.findIndex((r) => cellStr(r[0])?.toUpperCase() === 'METIERS');
  if (headerIndex === -1) throw new Error('missing-header-n1');
  const header = rows[headerIndex].map((h) => (cellStr(h) ?? '').toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const iMetiers = col('metiers');
  const iAnnonceur = col('annonceur');
  const iEmployee = col('employee prenom nom');
  const iN1 = col('etp fin n-1');
  const iCrossCheck = col('etp fin période');
  if ([iMetiers, iAnnonceur, iEmployee, iN1].some((i) => i === -1)) throw new Error('missing-columns-n1');
  return rows
    .slice(headerIndex + 1)
    .filter((r) => !isBlankRow(r))
    .map((r) => ({
      metiers: cellStr(r[iMetiers]),
      annonceur: cellStr(r[iAnnonceur]),
      employeeName: cellStr(r[iEmployee]),
      n1TotalFraction: cellNum(r[iN1]),
      n2026CrossCheckFraction: iCrossCheck === -1 ? null : cellNum(r[iCrossCheck]),
    }));
}

// Input N is long/unpivoted — one row per (employee, client, month), not
// one row per (employee, client) with 12 month columns — so rows are first
// read by name like Input N-1, then grouped by (annonceur, employeeName)
// and each PeriodMonth ("MTD01".."MTD12") written into the matching
// monthlyFractions slot, restoring the wide shape the rest of this file and
// timeImportParsing.ts's detectCutoffMonth already expect.
function parseInputNSheet(sheet: XLSX.WorkSheet): InputNRow[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const headerIndex = rows.findIndex((r) => cellStr(r[0])?.toUpperCase() === 'METIERS');
  if (headerIndex === -1) throw new Error('missing-header-n');
  const header = rows[headerIndex].map((h) => (cellStr(h) ?? '').toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const iMetiers = col('metiers');
  const iAnnonceur = col('annonceur');
  const iEmployee = col('employee prenom nom');
  const iPeriod = col('periodmonth');
  const iValue = col('etp staffing');
  if ([iMetiers, iAnnonceur, iEmployee, iPeriod, iValue].some((i) => i === -1)) throw new Error('missing-columns-n');

  const byPair = new Map<string, InputNRow>();
  for (const r of rows.slice(headerIndex + 1)) {
    if (isBlankRow(r)) continue;
    const metiers = cellStr(r[iMetiers]);
    const annonceur = cellStr(r[iAnnonceur]);
    const employeeName = cellStr(r[iEmployee]);
    const monthMatch = /^MTD(\d{1,2})$/i.exec(cellStr(r[iPeriod]) ?? '');
    if (!monthMatch) continue;
    const monthIndex = Number(monthMatch[1]) - 1;
    if (monthIndex < 0 || monthIndex > 11) continue;
    const key = `${(annonceur ?? '').trim().toUpperCase()}::${(employeeName ?? '').trim().toUpperCase()}`;
    if (!byPair.has(key)) byPair.set(key, { metiers, annonceur, employeeName, monthlyFractions: Array(12).fill(null) });
    byPair.get(key)!.monthlyFractions[monthIndex] = cellNum(r[iValue]);
  }
  return Array.from(byPair.values());
}

function parseCombinedWorkbook(buffer: ArrayBuffer): { n1Rows: InputN1Row[]; nRows: InputNRow[] } {
  const wb = XLSX.read(buffer, { type: 'array' });
  const n1Sheet = findSheet(wb, 'Input N-1');
  const nSheet = findSheet(wb, 'Input N');
  if (!n1Sheet || !nSheet) throw new Error('missing-sheet');
  const n1Filled = forwardFillHierarchy(parseInputN1Sheet(n1Sheet));
  const nFilled = forwardFillHierarchy(parseInputNSheet(nSheet));
  return {
    n1Rows: n1Filled.filter((r) => !isSubtotalRow(r.employeeName)),
    nRows: nFilled.filter((r) => !isSubtotalRow(r.employeeName)),
  };
}

// Splits a big upsert payload into fixed-size pieces sent as separate
// requests — turns one opaque, unbounded call the progress counter can't
// see inside of into several the counter can tick through as they land.
function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// supabase-js throws the raw PostgrestError object on a failed query — a
// plain object with a `message` (plus code/details/hint), NOT a real Error
// instance — so `err instanceof Error` is false for the exact errors this
// screen most needs to surface (RLS rejection, constraint violation, a
// dropped connection mid-import). Falling through to String(err) on one of
// those produced the literal text "[object Object]", which is worse than no
// message at all.
function formatImportError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// The new 6-screen flow (redesigned 2026-08-28, per a multi-turn design
// conversation with the user): 'resolveNames' decouples name resolution
// entirely from pair creation — every needs-review/previously-ignored name
// renders its own always-visible Create/Match/Ignore row directly (no
// search-then-expand step, removed 2026-08-28 per user feedback that the
// two-click reveal was "trop fastidieux"); 'selectPairs' is the real
// import-scoping step (PairSelectionStep.tsx) — checking a client or
// employee there selects only ITS OWN direct pairs, no propagation;
// 'dataOptions' is the old 'cutoff' step, unchanged content;
// 'resolveStragglers' is a narrow catch-up for names relevant to whatever
// got selected at Screen 3 but never resolved at Screen 2; 'review' is the
// existing diff/confirm screen. Replaces the old
// 'select' | 'cutoff' | 'resolve' | 'review' flow, where "Filtrer par
// client" only ever narrowed which UNRESOLVED names were shown for
// triage — never an actual data-scoping feature, which is exactly the
// misunderstanding that prompted this redesign.
type Step = 'select' | 'resolveNames' | 'selectPairs' | 'dataOptions' | 'resolveStragglers' | 'review';

export function ImportTimeActualsWizard({ registryOrgChartId, onClose }: { registryOrgChartId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  // useEmployees/useClientsMissions both keep their own realtime subscription
  // (unfiltered, per CLAUDE.md), so a create here is picked up automatically
  // by every mounted consumer, including this wizard's own — no manual
  // refresh() to call (neither hook exposes one).
  const { employees: registryEmployees, loading: employeesLoading } = useEmployees(registryOrgChartId);
  const { clientsMissions, findOrCreate: findOrCreateClientMission, loading: clientsMissionsLoading } = useClientsMissions();
  const {
    employeeAliases,
    clientAliases,
    timeActuals,
    timeActualN1Totals,
    timeForecasts,
    timeManualEditMarkers,
    timeManualRows,
    loading: estimationLoading,
    refresh: refreshEstimation,
  } = useTimeEstimation();

  // A pair (employee, client) already known to the tool, in ANY year —
  // Screen 3's default checkbox state is "checked" exactly for a pair in
  // this set (routine monthly refresh of something already known), and
  // "unchecked" otherwise (a brand-new pair needs an explicit opt-in).
  // time_manual_rows is included since a pair can be "known" with no
  // figures at all yet (added by hand from the grid, never imported).
  // Checked against every table that can carry a resolved identity rather
  // than just time_forecasts, so a pair with only N-1 data, or only a stray
  // actual, still counts as existing.
  const existingPairKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const f of timeForecasts) keys.add(`${f.employee_id}::${f.client_mission_id}`);
    for (const n of timeActualN1Totals) keys.add(`${n.employee_id}::${n.client_mission_id}`);
    for (const a of timeActuals) {
      if (a.resolved_employee_id && a.resolved_client_mission_id) keys.add(`${a.resolved_employee_id}::${a.resolved_client_mission_id}`);
    }
    for (const r of timeManualRows) keys.add(`${r.employee_id}::${r.client_mission_id}`);
    return keys;
  }, [timeForecasts, timeActualN1Totals, timeActuals, timeManualRows]);

  // handleFileSelected resolves every raw name against registryEmployees/
  // clientsMissions/employeeAliases/clientAliases — nothing stopped a file
  // from being picked while those were still in flight, so a fast "open the
  // wizard, immediately pick a file" click could run resolution against
  // near-empty arrays: no aliases match, no client pre-selects, and
  // previously-known names fall through to "needs review" as if new. Hit
  // for real once fetchTimeActuals started paginating (multiple sequential
  // requests past 1000 rows), which widened this race's window.
  const referenceDataLoading = employeesLoading || clientsMissionsLoading || estimationLoading;

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>('select');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [n1Rows, setN1Rows] = useState<InputN1Row[]>([]);
  const [nRows, setNRows] = useState<InputNRow[]>([]);

  const [cutoffDetection, setCutoffDetection] = useState<CutoffDetectionResult | null>(null);
  const [cutoffMonth, setCutoffMonth] = useState<number>(6);
  // All unchecked by default — an admin must actively opt each category
  // back in, rather than a re-import silently overwriting hand-edited data
  // (a manual grid edit, say) the moment they pick a file.
  const [importFields, setImportFields] = useState<ImportFieldSelection>({ n1: false, actuals: false, forecast: false });

  const [employeeResolutions, setEmployeeResolutions] = useState<Record<string, EmployeeResolution>>({});
  const [clientResolutions, setClientResolutions] = useState<Record<string, ClientResolution>>({});
  const [resolving, setResolving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [done, setDone] = useState<{ actualRows: number; n1Rows: number; forecastRows: number; skippedPairs: number; newPairs: number } | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);
  // "Items written so far" vs. "items planned" — recomputed per phase
  // (alias resolution, then the total_pct recompute pass), since each is a
  // separate batch of independent parallel writes with its own count known
  // up front. null between phases / during the few fast single-call batch
  // upserts, which aren't worth counting individually.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Screen 3 ("selectPairs") — the real import-scope selection, raw-name
  // keyed (rawPairKey, timeImportDiff.ts). Seeded from
  // computeDefaultPairSelection the moment the user leaves 'resolveNames'.
  // selectedClientNames/selectedEmployeeNames are a SEPARATE, smaller
  // signal — every client/employee the user has touched a pair for, used
  // only to decide Screen 5's relevance (see computeRelevantUnresolvedNames)
  // — deliberately monotonic (never un-marked by an individual toggle) so a
  // client stays "worth surfacing stragglers for" even after unchecking one
  // of its pairs.
  const [selectedPairKeys, setSelectedPairKeys] = useState<Set<string>>(new Set());
  const [selectedClientNames, setSelectedClientNames] = useState<Set<string>>(new Set());
  const [selectedEmployeeNames, setSelectedEmployeeNames] = useState<Set<string>>(new Set());

  const monthLabel = useMemo(() => {
    const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US';
    const fmtMonth = new Intl.DateTimeFormat(locale, { month: 'long' });
    return (month: number) => fmtMonth.format(new Date(year, month - 1, 1));
  }, [year, i18n.language]);

  // Computed lazily — only while the user is actually on the review step —
  // so a large workbook doesn't pay this cost on the earlier steps. Shares
  // buildImportRowPlan with handleImport's real commit (via
  // computeImportDiffSummary), so this preview can never disagree with what
  // actually gets written.
  const diffSummary = useMemo(
    () =>
      step === 'review'
        ? computeImportDiffSummary(employeeResolutions, clientResolutions, n1Rows, nRows, existingPairKeys, importFields, selectedPairKeys, year, cutoffMonth)
        : null,
    [step, employeeResolutions, clientResolutions, n1Rows, nRows, existingPairKeys, importFields, selectedPairKeys, year, cutoffMonth],
  );

  async function handleFileSelected(selected: File) {
    setFile(selected);
    setParsing(true);
    setParseError(null);
    setDone(null);
    setImportError(null);
    setProgress(null);
    setSelectedPairKeys(new Set());
    setSelectedClientNames(new Set());
    setSelectedEmployeeNames(new Set());
    setImportFields({ n1: false, actuals: false, forecast: false });
    try {
      const buffer = await selected.arrayBuffer();
      const { n1Rows: parsedN1, nRows: parsedN } = parseCombinedWorkbook(buffer);
      setN1Rows(parsedN1);
      setNRows(parsedN);

      const detection = detectCutoffMonth(parsedN1, parsedN);
      setCutoffDetection(detection);
      setCutoffMonth(detection.cutoffMonth ?? detection.candidates[0]?.month ?? 6);

      const distinctEmployeeNames = Array.from(
        new Set([...parsedN1.map((r) => r.employeeName), ...parsedN.map((r) => r.employeeName)].filter((n): n is string => n != null)),
      );
      const distinctClientNames = Array.from(
        new Set([...parsedN1.map((r) => r.annonceur), ...parsedN.map((r) => r.annonceur)].filter((n): n is string => n != null)),
      );

      const empResolutions: Record<string, EmployeeResolution> = {};
      for (const rawName of distinctEmployeeNames) {
        const alias = employeeAliases.find((a) => a.raw_name === rawName);
        if (alias) {
          empResolutions[rawName] = { status: 'auto', employeeId: alias.employee_id, decision: alias.employee_id ? 'match' : 'ignore' };
          continue;
        }
        const matches = registryEmployees.filter((e) => matchesEmployeeName(rawName, e.first_name, e.last_name));
        if (matches.length === 1) {
          empResolutions[rawName] = { status: 'auto', employeeId: matches[0].id, decision: 'match' };
          continue;
        }
        // No exact match (zero or several) — default this review row to the
        // closest existing employee if one stands out clearly, otherwise
        // default to creating a brand-new employee, pre-filled from the raw
        // name so a straight "Continue" already does the right thing for the
        // common case (a genuinely new hire).
        empResolutions[rawName] = seedNeedsReviewEmployeeResolution(rawName, registryEmployees);
      }
      setEmployeeResolutions(empResolutions);

      const cliResolutions: Record<string, ClientResolution> = {};
      for (const rawName of distinctClientNames) {
        const alias = clientAliases.find((a) => a.raw_name === rawName);
        if (alias && alias.client_mission_id) {
          cliResolutions[rawName] = { status: 'auto', clientMissionId: alias.client_mission_id, decision: 'match' };
          continue;
        }
        const matches = clientsMissions.filter((cm) => matchesClientName(rawName, cm.name));
        cliResolutions[rawName] =
          matches.length === 1
            ? { status: 'auto', clientMissionId: matches[0].id, decision: 'match' }
            : { status: 'needs-review', clientMissionId: null, decision: null };
      }
      setClientResolutions(cliResolutions);

      setStep('resolveNames');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setParseError(
        message === 'missing-sheet'
          ? t('timeEstimation.wizard.missingSheets')
          : message.startsWith('missing-')
            ? t('timeEstimation.wizard.missingColumns')
            : t('timeEstimation.wizard.parseError'),
      );
    } finally {
      setParsing(false);
    }
  }

  const rawPairs: RawPair[] = useMemo(() => computeDistinctRawPairs(n1Rows, nRows), [n1Rows, nRows]);

  // Preview-resolved ids (real id for match/auto, a never-colliding
  // placeholder for create, null for ignore/undecided) — used by Screen 3
  // to know which pairs are selectable at all, and by the default-selection
  // seeding below. The review screen's own diffSummary computes this again
  // internally (computeImportDiffSummary calls previewResolvedIds itself);
  // recomputing it here too is cheap and keeps Screen 3 from needing to
  // reach into review-screen internals.
  const { employeeIds: previewEmployeeIds, clientIds: previewClientIds } = useMemo(
    () => previewResolvedIds(employeeResolutions, clientResolutions),
    [employeeResolutions, clientResolutions],
  );

  const defaultPairSelection = useMemo(
    () => computeDefaultPairSelection(rawPairs, previewEmployeeIds, previewClientIds, existingPairKeys),
    [rawPairs, previewEmployeeIds, previewClientIds, existingPairKeys],
  );
  const onlyNewPairsSelection = useMemo(
    () => computeOnlyNewPairsSelection(rawPairs, previewEmployeeIds, previewClientIds, existingPairKeys),
    [rawPairs, previewEmployeeIds, previewClientIds, existingPairKeys],
  );

  // Alphabetical, for the "match an existing employee" dropdown's own
  // fallback group — the registry itself has no guaranteed order.
  const sortedRegistryEmployees = useMemo(
    () =>
      [...registryEmployees].sort((a, b) =>
        `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, 'fr'),
      ),
    [registryEmployees],
  );

  const clientsNeedingReviewAll = useMemo(
    () => Object.entries(clientResolutions).filter(([, r]) => r.status === 'needs-review'),
    [clientResolutions],
  );
  const employeesNeedingReviewAll = useMemo(
    () => Object.entries(employeeResolutions).filter(([, r]) => r.status === 'needs-review'),
    [employeeResolutions],
  );
  // A raw employee name that was explicitly marked "Ignorer" in a PAST
  // import gets an alias row with employee_id === null (handleFileSelected
  // above) — status: 'auto', decision: 'ignore', matching an
  // already-resolved 'match' alias in every way except its target. That
  // decision then silently repeats on every future import, forever, with
  // no way to reconsider it. This list surfaces them for reconsideration —
  // same Create/Match/Ignore controls as "needs review" rows.
  const employeesPreviouslyIgnoredAll = useMemo(
    () => Object.entries(employeeResolutions).filter(([, r]) => r.status === 'auto' && r.decision === 'ignore'),
    [employeeResolutions],
  );

  // No 'allResolved' gate anymore — Screen 2 no longer requires resolving
  // everything before continuing, only whatever's relevant to what gets
  // selected at Screen 3 (Screen 5, resolveStragglers, is the real safety
  // net now). The only thing that still blocks Continue is a genuinely
  // half-filled explicit choice (picked "Create" but cleared the name field).
  const resolveNamesHasInvalidState =
    Object.values(clientResolutions).some((r) => !clientResolutionAllowsContinue(r)) ||
    Object.values(employeeResolutions).some((r) => !employeeResolutionAllowsContinue(r));

  // Top-5 closest names per raw import name, ranked by Levenshtein
  // similarity (employeeNameSimilarity) — purely a UI ranking aid to help
  // find the right employee faster; never used to auto-resolve (that stays
  // matchesEmployeeName's strict equality check above). Computed for every
  // needs-review/previously-ignored name up front (not just expanded ones)
  // since the list is bounded by the file's own distinct name count and
  // this is cheap relative to the network round trips elsewhere in this
  // wizard.
  const suggestedMatchesByRawName = useMemo(() => {
    const map = new Map<string, Employee[]>();
    for (const [rawName] of [...employeesNeedingReviewAll, ...employeesPreviouslyIgnoredAll]) {
      const ranked = registryEmployees
        .map((e) => ({ e, score: employeeNameSimilarity(rawName, e.first_name, e.last_name) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((x) => x.e);
      map.set(rawName, ranked);
    }
    return map;
  }, [employeesNeedingReviewAll, employeesPreviouslyIgnoredAll, registryEmployees]);

  // Screen 5's whole reason to exist — names relevant to whatever the user
  // touched at Screen 3 but never resolved. See
  // computeRelevantUnresolvedNames's own comment for why this needs the
  // explicit selectedClientNames/selectedEmployeeNames signal rather than
  // being derivable from selectedPairKeys alone (a client whose employees
  // are ALL unresolved has no selectable pair to derive from in the first
  // place).
  const relevantUnresolved = useMemo(
    () => computeRelevantUnresolvedNames(selectedClientNames, selectedEmployeeNames, rawPairs, employeeResolutions, clientResolutions),
    [selectedClientNames, selectedEmployeeNames, rawPairs, employeeResolutions, clientResolutions],
  );
  const stragglersHasInvalidState =
    relevantUnresolved.clients.some((name) => !clientResolutionAllowsContinue(clientResolutions[name])) ||
    relevantUnresolved.employees.some((name) => !employeeResolutionAllowsContinue(employeeResolutions[name]));
  const stragglersUndecidedCount =
    relevantUnresolved.clients.filter((name) => (clientResolutions[name]?.decision ?? null) === null).length +
    relevantUnresolved.employees.filter((name) => (employeeResolutions[name]?.decision ?? null) === null).length;

  // Resolves every raw name to a real id (writing aliases, creating any new
  // employee/client along the way), then commits straight through. Every
  // checked category in `importFields` is written unconditionally for a
  // pair in `selectedPairKeys`: a fresh import always overwrites whatever
  // was there before (upsert on each table's own unique constraint),
  // whether that prior value came from a manual grid edit or an earlier
  // import. A pair NOT selected is left completely untouched — no write, no
  // marker-clearing, no total recompute — regardless of whether it's new or
  // already known; that decision was already made explicitly at Screen 3.
  async function handleImport() {
    setImportError(null);
    setResolving(true);
    const aliasTotal = Object.keys(employeeResolutions).length + Object.keys(clientResolutions).length;
    let aliasDone = 0;
    setProgress(aliasTotal > 0 ? { done: 0, total: aliasTotal } : null);
    // flushSync forces each individual tick to actually paint — most of
    // these calls resolve near-instantly (an "auto" match needs no network
    // call at all, see below) and React 18's automatic batching otherwise
    // collapses many state updates that land in the same microtask flush
    // into a single render, which made the counter appear to never move.
    const bumpAlias = () => {
      aliasDone += 1;
      flushSync(() => setProgress({ done: aliasDone, total: aliasTotal }));
    };
    let employeeIds: Map<string, string | null>;
    let clientIds: Map<string, string | null>;
    try {
      // Every raw name's alias write targets a distinct row (unique on
      // raw_name) and employee creation never dedupes against anything, so
      // the whole employee batch is safe to run concurrently — this used to
      // be a sequential for-loop (one network round trip per distinct raw
      // name) which is what made a large import take several minutes.
      const employeeEntries = await Promise.all(
        Object.entries(employeeResolutions).map(async ([rawName, res]): Promise<[string, string | null]> => {
          if (res.status === 'auto') {
            bumpAlias();
            return [rawName, res.employeeId];
          }
          if (res.decision === 'create') {
            const firstName = res.createFirstName?.trim() || splitPersonName(rawName).firstName;
            const lastName = res.createLastName?.trim() || splitPersonName(rawName).lastName;
            const created = await employeeService.createEmployee(registryOrgChartId, { first_name: firstName, last_name: lastName });
            await timeEstimationService.upsertTimeEmployeeAlias(rawName, created.id);
            bumpAlias();
            return [rawName, created.id];
          }
          if (res.decision === 'match') {
            await timeEstimationService.upsertTimeEmployeeAlias(rawName, res.employeeId);
            bumpAlias();
            return [rawName, res.employeeId];
          }
          await timeEstimationService.upsertTimeEmployeeAlias(rawName, null);
          bumpAlias();
          return [rawName, null];
        }),
      );
      employeeIds = new Map(employeeEntries);

      // Client resolutions split in two: "match"/untouched are independent
      // alias writes, safe in parallel like employees above. "create" goes
      // through findOrCreateClientMission, which dedupes against in-memory
      // catalog state that only reflects a create once ITS OWN refresh()
      // has landed — running two "create"s concurrently could both see no
      // existing match and both insert, creating duplicate client rows. So
      // creates alone stay a sequential loop; everything else runs at once.
      const clientEntries: Array<[string, string | null]> = [];
      const clientsToCreate: Array<[string, ClientResolution]> = [];
      await Promise.all(
        Object.entries(clientResolutions).map(async ([rawName, res]) => {
          if (res.status === 'auto') {
            clientEntries.push([rawName, res.clientMissionId]);
            bumpAlias();
            return;
          }
          if (res.decision === 'create') {
            clientsToCreate.push([rawName, res]);
            return;
          }
          await timeEstimationService.upsertTimeClientAlias(rawName, res.clientMissionId);
          clientEntries.push([rawName, res.clientMissionId]);
          bumpAlias();
        }),
      );
      for (const [rawName, res] of clientsToCreate) {
        const name = res.createName?.trim() || toTitleCase(rawName);
        const created = await findOrCreateClientMission(name, 'client');
        await timeEstimationService.upsertTimeClientAlias(rawName, created.id);
        clientEntries.push([rawName, created.id]);
        bumpAlias();
      }
      clientIds = new Map(clientEntries);
    } catch (err) {
      setResolving(false);
      setImportError(formatImportError(err));
      return;
    }
    setResolving(false);
    setProgress(null);

    setCommitting(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const batch = await timeEstimationService.createTimeImportBatch(year, file?.name ?? 'import.xlsx', nRows.length, authData.user?.id ?? null);

      // Build every row to write before writing anything, so the whole
      // committing phase's unit count (chunk writes + per-pair recompute
      // below) is known up front and the progress counter can run
      // continuously across it, rather than resetting or sitting blank
      // during whichever part happens to run first. The actual row-building
      // (N-1 totals, past/future months, the cross-sheet zero-fill for a
      // pair mentioned in only one tab, selectedPairKeys scoping) lives in
      // buildImportRowPlan (timeImportDiff.ts) — shared with the review
      // step's preview so the two can never disagree on this logic. batch_id
      // is attached here, not inside the plan, since the batch row doesn't
      // exist until the line above.
      const plan = buildImportRowPlan({ n1Rows, nRows, employeeIds, clientIds, existingPairKeys, importFields, selectedPairKeys, year, cutoffMonth });
      const n1UpsertRows = plan.n1UpsertRows;
      const actualUpsertRows: TimeActualUpsertRow[] = plan.actualUpsertRows.map((row) => ({ ...row, batch_id: batch.id }));
      const forecastUpsertRows = plan.forecastUpsertRows;
      const affectedKeys = plan.affectedPairKeys;

      // Recompute the stored time_forecasts.total_pct for every affected
      // (employee, client) so it can never drift out of sync with what was
      // just imported — same override-aware rule TimeEstimationGrid.tsx
      // uses for rendering (override ?? actual). Which pairs need this is
      // already known here (affectedKeys/timeForecasts need no network
      // call), even though the recompute itself runs after the writes below.
      const toRecompute = timeForecasts.filter(
        (forecast) => forecast.year === year && affectedKeys.has(`${forecast.employee_id}::${forecast.client_mission_id}`),
      );

      // A re-import always wins outright, so any "manually edited" marker
      // (TimeEstimationGrid.tsx's green highlight) on a field this import is
      // about to overwrite must be cleared — otherwise a stale marker would
      // keep implying "this is a manual value" for data that's no longer
      // manual. Computed entirely against markers already loaded via
      // useTimeEstimation() (no extra fetch), then cleared in ONE bulk
      // delete below — same "compute locally, one network call" shape as
      // the chunked writes, to avoid reintroducing the per-pair N+1
      // regression that was just removed from this same function.
      const touchedFieldsByPair = new Map<string, Set<string>>();
      const touchField = (employeeId: string, clientMissionId: string, field: string) => {
        const key = `${employeeId}::${clientMissionId}`;
        if (!touchedFieldsByPair.has(key)) touchedFieldsByPair.set(key, new Set());
        touchedFieldsByPair.get(key)!.add(field);
      };
      for (const row of n1UpsertRows) touchField(row.employee_id, row.client_mission_id, 'n1Total');
      for (const row of actualUpsertRows) {
        if (!row.resolved_employee_id || !row.resolved_client_mission_id) continue;
        touchField(row.resolved_employee_id, row.resolved_client_mission_id, `m${row.month - 1}`);
        touchField(row.resolved_employee_id, row.resolved_client_mission_id, 'avgPast');
        touchField(row.resolved_employee_id, row.resolved_client_mission_id, 'total');
      }
      for (const row of forecastUpsertRows) {
        touchField(row.employee_id, row.client_mission_id, `m${row.month - 1}`);
        touchField(row.employee_id, row.client_mission_id, 'avgRemaining');
        touchField(row.employee_id, row.client_mission_id, 'total');
      }
      const markerIdsToClear = timeManualEditMarkers
        .filter((m) => m.year === year && touchedFieldsByPair.get(`${m.employee_id}::${m.client_mission_id}`)?.has(m.field))
        .map((m) => m.id);

      // A pair whose "% total" was directly set by hand (one edit filling
      // all 12 months uniformly) is about to lose that marker above,
      // because "total" is always touched whenever any actuals/forecast
      // data changes. But on a genuinely PARTIAL reimport — only actuals,
      // or only forecast, never both — the untouched side's months still
      // hold exactly what the user set; only "total"'s own value actually
      // changed (it's a blend of both sides). Promote the untouched side's
      // own average field to a fresh direct marker before "total" is
      // cleared, so TimeEstimationGrid's editedTints picks it — and every
      // month it covers — back up as manually-sourced instead of losing
      // its color for no reason. Irrelevant when neither or both
      // categories are checked: nothing to preserve either way.
      const markersToPromote: Array<{ employeeId: string; clientMissionId: string; field: string }> = [];
      if (importFields.actuals !== importFields.forecast) {
        const untouchedField = importFields.actuals ? 'avgRemaining' : 'avgPast';
        const pairsWithDirectTotal = new Set(
          timeManualEditMarkers.filter((m) => m.year === year && m.field === 'total').map((m) => `${m.employee_id}::${m.client_mission_id}`),
        );
        for (const pairKey of touchedFieldsByPair.keys()) {
          if (!pairsWithDirectTotal.has(pairKey)) continue;
          const [employeeId, clientMissionId] = pairKey.split('::');
          markersToPromote.push({ employeeId, clientMissionId, field: untouchedField });
        }
      }

      // A pair this import touches is no longer "manually added" — its
      // origin should reflect current reality, not how the row first
      // appeared (TimeEstimationGrid.tsx's "a"/"i" marker). affectedKeys is
      // already exactly the set of resolved pairs this import writes SOME
      // data for (N-1, actuals, or forecast — see its own construction
      // above), so it's the right signal here too.
      const manualRowIdsToClear = timeManualRows
        .filter((r) => affectedKeys.has(`${r.employee_id}::${r.client_mission_id}`))
        .map((r) => r.id);

      // upsertTimeActuals's onConflict is (raw_employee_name, raw_client_name,
      // year, month) — a manually-entered row (raw name = the real display
      // name) or a row from an earlier import with a differently-spelled raw
      // name essentially never collides with THIS file's own raw name, so the
      // upsert below would just add a second row alongside it instead of
      // replacing it — and the grid sums every matching row per resolved
      // identity, so that silently double-counts. Deleting by resolved
      // identity first (any raw name) is what makes "Temps réel" actually
      // win outright on re-import, matching every other checked category —
      // one .or() call per chunk of pairs, not one delete per pair (see
      // deleteTimeActualsForPairsInMonths's own comment).
      const actualsPairKeys = new Set(
        actualUpsertRows
          .filter((row) => row.resolved_employee_id && row.resolved_client_mission_id)
          .map((row) => `${row.resolved_employee_id}::${row.resolved_client_mission_id}`),
      );
      const actualsPairs = Array.from(actualsPairKeys, (key) => {
        const [employeeId, clientMissionId] = key.split('::');
        return { employeeId, clientMissionId };
      });
      const actualsMonthsRange = Array.from({ length: cutoffMonth }, (_, i) => i + 1);
      const PAIR_CHUNK_SIZE = 25;
      const clearActualsChunks = chunkArray(actualsPairs, PAIR_CHUNK_SIZE);

      // Each big array is split into chunks so a many-thousand-row extract
      // becomes several parallel requests instead of one opaque, unbounded
      // call the progress counter can't see inside of — this is what was
      // silently eating most of "Importing…" with no visible movement.
      const CHUNK_SIZE = 300;
      const n1Chunks = chunkArray(n1UpsertRows, CHUNK_SIZE);
      const actualChunks = chunkArray(actualUpsertRows, CHUNK_SIZE);
      const forecastChunks = chunkArray(forecastUpsertRows, CHUNK_SIZE);

      const commitTotal =
        n1Chunks.length +
        actualChunks.length +
        forecastChunks.length +
        clearActualsChunks.length +
        toRecompute.length +
        (markerIdsToClear.length > 0 ? 1 : 0) +
        (manualRowIdsToClear.length > 0 ? 1 : 0) +
        markersToPromote.length;
      let commitDone = 0;
      setProgress(commitTotal > 0 ? { done: 0, total: commitTotal } : null);
      const bumpCommit = () => {
        commitDone += 1;
        flushSync(() => setProgress({ done: commitDone, total: commitTotal }));
      };

      // The stale-actuals clear must land before the fresh actuals upsert —
      // otherwise a manually-entered row with the same raw name the import
      // happens to reuse could get deleted right after being (re)written.
      // Every other write here targets a disjoint set of rows/tables, so
      // only this one pairing has a real ordering dependency.
      await Promise.all(
        clearActualsChunks.map(async (pairs) => {
          await timeEstimationService.deleteTimeActualsForPairsInMonths(pairs, year, actualsMonthsRange);
          bumpCommit();
        }),
      );

      await Promise.all([
        markerIdsToClear.length > 0
          ? timeEstimationService.deleteTimeManualEditMarkersByIds(markerIdsToClear).then(() => bumpCommit())
          : null,
        manualRowIdsToClear.length > 0
          ? timeEstimationService.deleteTimeManualRowsByIds(manualRowIdsToClear).then(() => bumpCommit())
          : null,
        ...markersToPromote.map(async (m) => {
          await timeEstimationService.upsertTimeManualEditMarker(m.employeeId, m.clientMissionId, year, m.field);
          bumpCommit();
        }),
        ...n1Chunks.map(async (rows) => {
          await timeEstimationService.upsertTimeActualN1Totals(rows);
          bumpCommit();
        }),
        ...actualChunks.map(async (rows) => {
          await timeEstimationService.upsertTimeActuals(rows);
          bumpCommit();
        }),
        ...forecastChunks.map(async (rows) => {
          await timeEstimationService.upsertTimeForecastMonths(rows);
          bumpCommit();
        }),
      ]);
      await refreshEstimation();

      if (affectedKeys.size > 0) {
        const [freshActuals, freshForecastMonths] = await Promise.all([
          timeEstimationService.fetchTimeActuals(),
          timeEstimationService.fetchTimeForecastMonths(),
        ]);
        await Promise.all(
          toRecompute.map(async (forecast) => {
            const effectiveMonths = Array.from({ length: 12 }, (_, i) => {
              const month = i + 1;
              const override = freshForecastMonths.find(
                (m) => m.year === year && m.month === month && m.employee_id === forecast.employee_id && m.client_mission_id === forecast.client_mission_id,
              );
              if (override) return override.pct;
              const matching = freshActuals.filter(
                (a) =>
                  a.year === year &&
                  a.month === month &&
                  a.resolved_employee_id === forecast.employee_id &&
                  a.resolved_client_mission_id === forecast.client_mission_id,
              );
              return matching.length > 0 ? matching.reduce((s, a) => s + a.etp_pct, 0) : null;
            });
            const totalPct = averageOverRange(effectiveMonths);
            await timeEstimationService.upsertTimeForecast(forecast.employee_id, forecast.client_mission_id, year, totalPct);
            bumpCommit();
          }),
        );
        setProgress(null);
        await refreshEstimation();
      }

      // A distinct raw pair whose data was actually written (affectedKeys)
      // and wasn't already in existingPairKeys BEFORE this import ran —
      // existingPairKeys is a snapshot from useTimeEstimation()'s data as
      // loaded when the wizard opened, untouched by this function's own
      // writes, so it still reflects pre-import state here.
      let newPairsAdded = 0;
      for (const key of affectedKeys) {
        if (!existingPairKeys.has(key)) newPairsAdded += 1;
      }
      const totalRawPairs = rawPairs.length;
      const skippedPairs = totalRawPairs - affectedKeys.size;

      setDone({
        actualRows: actualUpsertRows.length,
        n1Rows: n1UpsertRows.length,
        forecastRows: forecastUpsertRows.length,
        skippedPairs,
        newPairs: newPairsAdded,
      });
    } catch (err) {
      setImportError(formatImportError(err));
    } finally {
      setCommitting(false);
      setProgress(null);
    }
  }

  const sortedCandidates = cutoffDetection?.candidates ?? [];

  // Shared row for "Employees to resolve", "Previously ignored" (Screen 2)
  // AND Screen 5's employee catch-up list — identical Create/Match/Ignore
  // controls everywhere, since picking any of them just overwrites this one
  // entry in employeeResolutions. One line per employee (redesigned
  // 2026-08-28 per user feedback: the old card — name, a justification
  // paragraph listing every client/month the raw name appears against, then
  // controls below — was "trop fastidieux" for a list that can run to a
  // hundred-plus rows). The raw import name is shown split into its two
  // columns (same splitPersonName seed used for the create-fields default)
  // so it's legible at a glance without the removed paragraph; Create's own
  // first/last inputs stay visible unconditionally instead of only appearing
  // once "Create" is picked, since there's no vertical room being saved by
  // hiding them and one line means no layout jump when toggling decisions.
  function renderEmployeeRow(rawName: string, res: EmployeeResolution) {
    const importSplit = splitPersonName(rawName);
    return (
      <div key={rawName} className="flex flex-wrap items-center gap-1.5 rounded border border-slate-200 px-2 py-1.5 text-xs">
        <span className="w-20 shrink-0 truncate text-slate-500" title={importSplit.firstName}>
          {importSplit.firstName}
        </span>
        <span className="w-28 shrink-0 truncate font-medium text-slate-700" title={importSplit.lastName}>
          {importSplit.lastName}
        </span>
        <button
          type="button"
          onClick={() =>
            setEmployeeResolutions((prev) => {
              const seeded = splitPersonName(rawName);
              return {
                ...prev,
                [rawName]: {
                  status: 'needs-review',
                  employeeId: null,
                  decision: 'create',
                  createFirstName: prev[rawName]?.createFirstName ?? toTitleCase(seeded.firstName),
                  createLastName: prev[rawName]?.createLastName ?? toTitleCase(seeded.lastName),
                },
              };
            })
          }
          className={`shrink-0 rounded px-2 py-1 font-medium ${
            res.decision === 'create' ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {t('timeEstimation.wizard.acceptCreate')}
        </button>
        <input
          type="text"
          value={res.createFirstName ?? ''}
          onChange={(e) =>
            setEmployeeResolutions((prev) => ({
              ...prev,
              [rawName]: { ...prev[rawName], status: 'needs-review', decision: 'create', createFirstName: e.target.value },
            }))
          }
          placeholder={t('timeEstimation.wizard.firstNamePlaceholder')}
          className="w-20 shrink-0 rounded border border-slate-300 px-1.5 py-1"
        />
        <input
          type="text"
          value={res.createLastName ?? ''}
          onChange={(e) =>
            setEmployeeResolutions((prev) => ({
              ...prev,
              [rawName]: { ...prev[rawName], status: 'needs-review', decision: 'create', createLastName: e.target.value },
            }))
          }
          placeholder={t('timeEstimation.wizard.lastNamePlaceholder')}
          className="w-24 shrink-0 rounded border border-slate-300 px-1.5 py-1"
        />
        <select
          value={res.decision === 'match' ? (res.employeeId ?? '') : ''}
          onChange={(e) => {
            const value = e.target.value;
            setEmployeeResolutions((prev) => ({
              ...prev,
              [rawName]: value
                ? { status: 'needs-review', employeeId: value, decision: 'match' }
                : { ...prev[rawName], status: 'needs-review', employeeId: null, decision: null },
            }));
          }}
          className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1"
        >
          <option value="">{t('timeEstimation.wizard.matchExisting')}</option>
          {(() => {
            const suggestions = suggestedMatchesByRawName.get(rawName) ?? [];
            const suggestionIds = new Set(suggestions.map((e) => e.id));
            const rest = sortedRegistryEmployees.filter((e) => !suggestionIds.has(e.id));
            return (
              <>
                {suggestions.length > 0 && (
                  <optgroup label={t('timeEstimation.wizard.suggestedMatches')}>
                    {suggestions.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.first_name} {e.last_name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label={t('timeEstimation.wizard.allEmployees')}>
                  {rest.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.first_name} {e.last_name}
                    </option>
                  ))}
                </optgroup>
              </>
            );
          })()}
        </select>
        <button
          type="button"
          onClick={() =>
            setEmployeeResolutions((prev) => ({
              ...prev,
              [rawName]: { status: 'needs-review', employeeId: null, decision: 'ignore' },
            }))
          }
          className={`shrink-0 rounded px-2 py-1 font-medium ${
            res.decision === 'ignore' ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {t('timeEstimation.wizard.ignore')}
        </button>
      </div>
    );
  }

  // Shared row for "Clients to resolve" (Screen 2) and Screen 5's client
  // catch-up list — one line, no expand: the create-name field sits inline
  // instead of appearing below only once "create" is picked.
  function renderClientRow(rawName: string, res: ClientResolution) {
    return (
      <div key={rawName} className="flex flex-wrap items-center gap-1.5 rounded border border-slate-200 px-2 py-1.5 text-xs">
        <span className="w-40 shrink-0 truncate font-medium text-slate-700" title={rawName}>
          {rawName}
        </span>
        <select
          value={res.decision === 'match' ? (res.clientMissionId ?? '') : res.decision === 'create' ? '__create__' : ''}
          onChange={(e) => {
            const value = e.target.value;
            setClientResolutions((prev) => ({
              ...prev,
              [rawName]:
                value === '__create__'
                  ? { status: 'needs-review', clientMissionId: null, decision: 'create', createName: prev[rawName]?.createName ?? toTitleCase(rawName) }
                  : { status: 'needs-review', clientMissionId: value || null, decision: value ? 'match' : null },
            }));
          }}
          className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1"
        >
          <option value="">{t('timeEstimation.wizard.choose')}</option>
          <option value="__create__">{t('timeEstimation.wizard.createNew', { name: toTitleCase(rawName) })}</option>
          {clientsMissions.map((cm) => (
            <option key={cm.id} value={cm.id}>
              {cm.name}
            </option>
          ))}
        </select>
        {res.decision === 'create' && (
          <input
            type="text"
            value={res.createName ?? ''}
            onChange={(e) => setClientResolutions((prev) => ({ ...prev, [rawName]: { ...prev[rawName], createName: e.target.value } }))}
            placeholder={t('timeEstimation.wizard.clientNamePlaceholder')}
            className="w-40 shrink-0 rounded border border-slate-300 px-1.5 py-1"
          />
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
      {/* h-[85vh] (not just max-h) keeps the dialog's size stable regardless
          of how many rows a given step currently shows. */}
      <div className="flex h-[85vh] max-h-[85vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{t('timeEstimation.wizard.title')}</h2>
          <button
            onClick={onClose}
            disabled={resolving || committing}
            title={resolving || committing ? t('timeEstimation.wizard.closeDisabledHint') : undefined}
            className="text-slate-400 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {done ? (
            <>
              <p className="text-sm text-slate-700">
                {t('timeEstimation.wizard.done', { actual: done.actualRows, n1: done.n1Rows, forecast: done.forecastRows })}
              </p>
              {done.newPairs > 0 && (
                <p className="mt-1 text-sm text-slate-500">{t('timeEstimation.wizard.doneNewPairs', { count: done.newPairs })}</p>
              )}
              {done.skippedPairs > 0 && (
                <p className="mt-1 text-sm text-slate-500">{t('timeEstimation.wizard.doneSkippedPairs', { count: done.skippedPairs })}</p>
              )}
            </>
          ) : (
            <>
              {step === 'select' && (
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">{t('timeEstimation.wizard.yearLabel')}</label>
                    <input
                      type="number"
                      value={year}
                      onChange={(e) => setYear(Number(e.target.value))}
                      className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">{t('timeEstimation.wizard.fileLabel')}</label>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      disabled={referenceDataLoading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFileSelected(f);
                      }}
                      className="text-sm disabled:opacity-50"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={downloadTemplate}
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    {t('timeEstimation.wizard.downloadTemplate')}
                  </button>
                </div>
              )}

              {step === 'select' && referenceDataLoading && (
                <p className="mt-3 text-sm text-slate-400">{t('timeEstimation.wizard.loadingReferenceData')}</p>
              )}

              {parsing && <p className="mt-3 text-sm text-slate-400">{t('timeEstimation.wizard.parsing')}</p>}
              {parseError && <p className="mt-3 text-sm text-red-600">{parseError}</p>}

              {step === 'resolveNames' && (
                <>
                  {employeesNeedingReviewAll.length > 0 && (
                    <section className="mb-4">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {t('timeEstimation.wizard.employeesToResolve')}
                      </h3>
                      <div className="space-y-1">
                        {employeesNeedingReviewAll.map(([rawName]) => renderEmployeeRow(rawName, employeeResolutions[rawName]))}
                      </div>
                    </section>
                  )}

                  {employeesPreviouslyIgnoredAll.length > 0 && (
                    <section className="mb-4">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {t('timeEstimation.wizard.previouslyIgnoredToggle', { count: employeesPreviouslyIgnoredAll.length })}
                      </h3>
                      <div className="space-y-1">
                        {employeesPreviouslyIgnoredAll.map(([rawName]) => renderEmployeeRow(rawName, employeeResolutions[rawName]))}
                      </div>
                    </section>
                  )}

                  {clientsNeedingReviewAll.length > 0 && (
                    <section className="mb-4">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {t('timeEstimation.wizard.clientsToResolve')}
                      </h3>
                      <div className="space-y-1">
                        {clientsNeedingReviewAll.map(([rawName]) => renderClientRow(rawName, clientResolutions[rawName]))}
                      </div>
                    </section>
                  )}

                  {clientsNeedingReviewAll.length === 0 && employeesNeedingReviewAll.length === 0 && employeesPreviouslyIgnoredAll.length === 0 && (
                    <p className="text-sm text-slate-500">{t('timeEstimation.wizard.nothingToResolve')}</p>
                  )}
                </>
              )}

              {step === 'selectPairs' && (
                <PairSelectionStep
                  rawPairs={rawPairs}
                  existingPairKeys={existingPairKeys}
                  employeeIds={previewEmployeeIds}
                  clientIds={previewClientIds}
                  selectedPairKeys={selectedPairKeys}
                  onChangeSelectedPairKeys={setSelectedPairKeys}
                  onTouchClient={(name) => setSelectedClientNames((prev) => new Set(prev).add(name))}
                  onTouchEmployee={(name) => setSelectedEmployeeNames((prev) => new Set(prev).add(name))}
                  onlyNewPairsSelection={onlyNewPairsSelection}
                  defaultSelection={defaultPairSelection}
                />
              )}

              {step === 'dataOptions' && (
                <>
                  <section className="mb-5">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {t('timeEstimation.wizard.importFieldsTitle')}
                    </h3>
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={importFields.n1}
                          onChange={() => setImportFields((prev) => ({ ...prev, n1: !prev.n1 }))}
                        />
                        {t('timeEstimation.wizard.importFieldN1')}
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={importFields.actuals}
                          onChange={() => setImportFields((prev) => ({ ...prev, actuals: !prev.actuals }))}
                        />
                        {t('timeEstimation.wizard.importFieldActuals')}
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={importFields.forecast}
                          onChange={() => setImportFields((prev) => ({ ...prev, forecast: !prev.forecast }))}
                        />
                        {t('timeEstimation.wizard.importFieldForecast')}
                      </label>
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('timeEstimation.wizard.cutoffTitle')}</h3>
                    <p className="mb-3 text-xs text-slate-500">
                      {cutoffDetection?.cutoffMonth != null
                        ? t('timeEstimation.wizard.cutoffDetected', { month: monthLabel(cutoffDetection.cutoffMonth), sample: cutoffDetection.sampleSize })
                        : t('timeEstimation.wizard.cutoffAmbiguous')}
                    </p>
                    <select
                      value={cutoffMonth}
                      onChange={(e) => setCutoffMonth(Number(e.target.value))}
                      className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                        const candidate = sortedCandidates.find((c) => c.month === m);
                        return (
                          <option key={m} value={m}>
                            {monthLabel(m)}
                            {candidate ? ` (${candidate.matchingRows}/${cutoffDetection?.sampleSize ?? 0})` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </section>
                </>
              )}

              {step === 'resolveStragglers' && (
                <>
                  <p className="mb-3 text-xs text-slate-500">{t('timeEstimation.wizard.stragglersHint')}</p>
                  {relevantUnresolved.clients.length > 0 && (
                    <section className="mb-4">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {t('timeEstimation.wizard.clientsToResolve')}
                      </h3>
                      <div className="space-y-2">
                        {relevantUnresolved.clients.map((rawName) => renderClientRow(rawName, clientResolutions[rawName]))}
                      </div>
                    </section>
                  )}
                  {relevantUnresolved.employees.length > 0 && (
                    <section className="mb-4">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {t('timeEstimation.wizard.employeesToResolve')}
                      </h3>
                      <div className="space-y-3">
                        {relevantUnresolved.employees.map((rawName) => renderEmployeeRow(rawName, employeeResolutions[rawName]))}
                      </div>
                    </section>
                  )}
                  {relevantUnresolved.clients.length === 0 && relevantUnresolved.employees.length === 0 && (
                    <p className="text-sm text-slate-500">{t('timeEstimation.wizard.nothingToResolve')}</p>
                  )}
                </>
              )}

              {/* Diff/review step: an aggregate summary of what this import
                  is actually about to do — computed purely from state
                  already available before any network write
                  (computeImportDiffSummary, timeImportDiff.ts) — that the
                  user must explicitly confirm before handleImport runs. */}
              {step === 'review' && diffSummary && (
                <>
                  {(diffSummary.employeesToCreate.length > 0 || diffSummary.employeesMatchedCount > 0 || diffSummary.employeesIgnoredCount > 0) && (
                    <section className="mb-5">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {t('timeEstimation.wizard.reviewEmployeesTitle')}
                      </h3>
                      <div className="flex flex-col gap-1 text-sm text-slate-700">
                        {diffSummary.employeesToCreate.length > 0 && (
                          <p>
                            {t('timeEstimation.wizard.reviewEmployeesToCreate', { count: diffSummary.employeesToCreate.length })}{' '}
                            {diffSummary.employeesToCreate.join(', ')}
                          </p>
                        )}
                        {diffSummary.employeesMatchedCount > 0 && (
                          <p>{t('timeEstimation.wizard.reviewEmployeesMatched', { count: diffSummary.employeesMatchedCount })}</p>
                        )}
                        {diffSummary.employeesIgnoredCount > 0 && (
                          <p className="text-amber-600">{t('timeEstimation.wizard.reviewEmployeesIgnored', { count: diffSummary.employeesIgnoredCount })}</p>
                        )}
                      </div>
                    </section>
                  )}

                  {(diffSummary.clientsToCreate.length > 0 || diffSummary.clientsMatchedCount > 0 || diffSummary.clientsIgnoredCount > 0) && (
                    <section className="mb-5">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {t('timeEstimation.wizard.reviewClientsTitle')}
                      </h3>
                      <div className="flex flex-col gap-1 text-sm text-slate-700">
                        {diffSummary.clientsToCreate.length > 0 && (
                          <p>
                            {t('timeEstimation.wizard.reviewClientsToCreate', { count: diffSummary.clientsToCreate.length })}{' '}
                            {diffSummary.clientsToCreate.join(', ')}
                          </p>
                        )}
                        {diffSummary.clientsMatchedCount > 0 && (
                          <p>{t('timeEstimation.wizard.reviewClientsMatched', { count: diffSummary.clientsMatchedCount })}</p>
                        )}
                        {diffSummary.clientsIgnoredCount > 0 && (
                          <p className="text-amber-600">{t('timeEstimation.wizard.reviewClientsIgnored', { count: diffSummary.clientsIgnoredCount })}</p>
                        )}
                      </div>
                    </section>
                  )}

                  {(diffSummary.newPairsSelectedCount > 0 ||
                    diffSummary.existingPairsSelectedCount > 0 ||
                    diffSummary.newPairsSkippedCount > 0 ||
                    diffSummary.existingPairsSkippedCount > 0 ||
                    diffSummary.unresolvedPairsCount > 0) && (
                    <section className="mb-5">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('timeEstimation.wizard.reviewPairsTitle')}</h3>
                      <div className="flex flex-col gap-1 text-sm text-slate-700">
                        {diffSummary.newPairsSelectedCount > 0 && (
                          <p>{t('timeEstimation.wizard.reviewPairsNewSelected', { count: diffSummary.newPairsSelectedCount })}</p>
                        )}
                        {diffSummary.existingPairsSelectedCount > 0 && (
                          <p>{t('timeEstimation.wizard.reviewPairsExistingSelected', { count: diffSummary.existingPairsSelectedCount })}</p>
                        )}
                        {diffSummary.newPairsSkippedCount > 0 && (
                          <p className="text-slate-500">{t('timeEstimation.wizard.reviewPairsNewSkipped', { count: diffSummary.newPairsSkippedCount })}</p>
                        )}
                        {diffSummary.existingPairsSkippedCount > 0 && (
                          <p className="text-slate-500">{t('timeEstimation.wizard.reviewPairsExistingSkipped', { count: diffSummary.existingPairsSkippedCount })}</p>
                        )}
                        {diffSummary.unresolvedPairsCount > 0 && (
                          <p className="text-amber-600">{t('timeEstimation.wizard.reviewPairsUnresolved', { count: diffSummary.unresolvedPairsCount })}</p>
                        )}
                      </div>
                    </section>
                  )}

                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('timeEstimation.wizard.reviewDataTitle')}</h3>
                    <div className="flex flex-col gap-1 text-sm text-slate-700">
                      {/* Unlike the sections above, a CHECKED category showing 0
                          rows is shown, not hidden — that's a meaningful
                          "something's misconfigured" signal (e.g. the cutoff
                          month, or nothing selected at Screen 3), not noise
                          like an unremarkable "0 new employees" would be. An
                          unchecked category is simply absent, matching the
                          dataOptions step's own importFields checkboxes. */}
                      {importFields.n1 && (
                        <p>{t('timeEstimation.wizard.reviewDataN1', { year: year - 1, count: diffSummary.plannedRowCounts.n1 })}</p>
                      )}
                      {importFields.actuals && (
                        <p>
                          {t('timeEstimation.wizard.reviewDataActuals', {
                            from: monthLabel(1),
                            to: monthLabel(cutoffMonth),
                            count: diffSummary.plannedRowCounts.actuals,
                          })}
                        </p>
                      )}
                      {importFields.forecast && (
                        <p>
                          {t('timeEstimation.wizard.reviewDataForecast', {
                            from: monthLabel(Math.min(cutoffMonth + 1, 12)),
                            to: monthLabel(12),
                            count: diffSummary.plannedRowCounts.forecast,
                          })}
                        </p>
                      )}
                    </div>
                  </section>

                  {diffSummary.plannedRowCounts.n1 + diffSummary.plannedRowCounts.actuals + diffSummary.plannedRowCounts.forecast === 0 && (
                    <p className="mt-4 text-sm font-medium text-amber-600">{t('timeEstimation.wizard.reviewNothingToImport')}</p>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          {importError && <p className="mr-auto text-xs text-red-600">{t('timeEstimation.wizard.importError', { message: importError })}</p>}
          {step === 'resolveStragglers' && !importError && stragglersUndecidedCount > 0 && (
            <p className="mr-auto text-xs text-amber-600">{t('timeEstimation.wizard.undecidedWarning', { count: stragglersUndecidedCount })}</p>
          )}
          <button
            onClick={onClose}
            disabled={resolving || committing}
            title={resolving || committing ? t('timeEstimation.wizard.closeDisabledHint') : undefined}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('timeEstimation.wizard.close')}
          </button>

          {step === 'resolveNames' && (
            <button
              onClick={() => {
                setSelectedPairKeys(defaultPairSelection);
                setSelectedClientNames(new Set());
                setSelectedEmployeeNames(new Set());
                setStep('selectPairs');
              }}
              disabled={resolveNamesHasInvalidState}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {t('timeEstimation.wizard.continueLabel')}
            </button>
          )}

          {step === 'selectPairs' && (
            <button
              onClick={() => setStep('resolveNames')}
              disabled={resolving || committing}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('timeEstimation.wizard.back')}
            </button>
          )}
          {step === 'selectPairs' && (
            <button
              onClick={() => setStep('dataOptions')}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
            >
              {t('timeEstimation.wizard.continueLabel')}
            </button>
          )}

          {step === 'dataOptions' && (
            <button
              onClick={() => setStep('selectPairs')}
              disabled={resolving || committing}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('timeEstimation.wizard.back')}
            </button>
          )}
          {step === 'dataOptions' && (
            <button
              onClick={() => setStep('resolveStragglers')}
              disabled={!importFields.n1 && !importFields.actuals && !importFields.forecast}
              title={
                !importFields.n1 && !importFields.actuals && !importFields.forecast
                  ? t('timeEstimation.wizard.noDataSelectedHint')
                  : undefined
              }
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('timeEstimation.wizard.continueLabel')}
            </button>
          )}

          {step === 'resolveStragglers' && (
            <button
              onClick={() => setStep('dataOptions')}
              disabled={resolving || committing}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('timeEstimation.wizard.back')}
            </button>
          )}
          {step === 'resolveStragglers' && (
            <button
              onClick={() => setStep('review')}
              disabled={stragglersHasInvalidState}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {t('timeEstimation.wizard.continueLabel')}
            </button>
          )}

          {step === 'review' && !done && (
            <button
              onClick={() => setStep('resolveStragglers')}
              disabled={resolving || committing}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('timeEstimation.wizard.back')}
            </button>
          )}
          {step === 'review' && !done && (
            <button
              onClick={() => handleImport()}
              disabled={resolving || committing}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {resolving
                ? progress
                  ? t('timeEstimation.wizard.resolvingProgress', { done: progress.done, total: progress.total })
                  : t('timeEstimation.wizard.resolving')
                : committing
                  ? progress
                    ? t('timeEstimation.wizard.committingProgress', { done: progress.done, total: progress.total })
                    : t('timeEstimation.wizard.committing')
                  : t('timeEstimation.wizard.confirmImport')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
