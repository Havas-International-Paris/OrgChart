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
import { averageOverRange, employeeNameSimilarity, etpFractionToPct, matchesClientName, matchesEmployeeName } from '../../lib/timeEstimationMath';
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
import type { Employee } from '../../types/domain';
import { FilterDropdown, type FilterDropdownOption } from '../shared/FilterDropdown';

// Revision 2: a single workbook covers both years — "Input N-1" (shape of
// the real "Evol Etps" Havas export: one annual total per employee×client,
// no monthly detail) and "Input N" (shape of the real "ETPs Landing"
// export: two header rows, MTD01-12 monthly detail, past months = real
// timesheet, future months = an existing forecast to challenge). See
// CLAUDE.md for the full design — this replaces the old single-tab,
// single-year wizard entirely.

const TEMPLATE_N1_HEADERS = ['METIERS', 'Annonceur', 'Employee Prenom Nom', 'ETPs 2025', 'ETPs 2026', 'ETPs StaffPlan', 'Var Etps', 'ETPs Clients'];
const TEMPLATE_N_MONTH_HEADERS = Array.from({ length: 12 }, (_, i) => `MTD${String(i + 1).padStart(2, '0')}`);

function downloadTemplate() {
  const n1Sheet = XLSX.utils.aoa_to_sheet([
    TEMPLATE_N1_HEADERS,
    ['ADOPS', 'Total', null, 0.56, 0.69, 0.62, 0.07, 0.57],
    [null, 'Client Exemple', 'Total', 0.03, 0.16, 0.22, -0.06, 0.22],
    [null, null, 'Jean Dupont', 0.03, 0.16, 0.22, -0.06, 0.22],
  ]);
  const nSheet = XLSX.utils.aoa_to_sheet([
    ['PeriodMonth', null, null, ...TEMPLATE_N_MONTH_HEADERS],
    ['METIERS', 'Annonceur', 'Employee Prenom Nom', ...Array(12).fill('ETP staffing')],
    ['ADOPS', 'Total', null, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.62, 0.62, 0.62, 0.62, 0.62],
    [null, 'Client Exemple', 'Total', 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.22, 0.22, 0.22, 0.22, 0.22],
    [null, null, 'Jean Dupont', 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.22, 0.22, 0.22, 0.22, 0.22],
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

// Input N-1 has one plain header row with unique column names — resolved
// by name, so column reordering doesn't break parsing.
function parseInputN1Sheet(sheet: XLSX.WorkSheet): InputN1Row[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const headerIndex = rows.findIndex((r) => cellStr(r[0])?.toUpperCase() === 'METIERS');
  if (headerIndex === -1) throw new Error('missing-header-n1');
  const header = rows[headerIndex].map((h) => (cellStr(h) ?? '').toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const iMetiers = col('metiers');
  const iAnnonceur = col('annonceur');
  const iEmployee = col('employee prenom nom');
  const iN1 = col('etps 2025');
  const iCrossCheck = col('etps 2026');
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

// Input N has TWO header rows (PeriodMonth/MTD01-12, then
// METIERS/Annonceur/Employee/ETP staffing×12 — "ETP staffing" repeated 12
// times can't be resolved by name), so the 12 monthly columns are read
// positionally (index 3..14) once the METIERS row is located.
function parseInputNSheet(sheet: XLSX.WorkSheet): InputNRow[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const headerIndex = rows.findIndex((r) => cellStr(r[0])?.toUpperCase() === 'METIERS');
  if (headerIndex === -1) throw new Error('missing-header-n');
  return rows
    .slice(headerIndex + 1)
    .filter((r) => !isBlankRow(r))
    .map((r) => ({
      metiers: cellStr(r[0]),
      annonceur: cellStr(r[1]),
      employeeName: cellStr(r[2]),
      monthlyFractions: Array.from({ length: 12 }, (_, i) => cellNum(r[3 + i])),
    }));
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

interface EmployeeResolution {
  status: 'auto' | 'needs-review';
  employeeId: string | null;
  decision: 'match' | 'create' | 'ignore' | null;
  // Editable proposal shown when decision === 'create', seeded from
  // toTitleCase(splitPersonName(rawName)) — the admin can freely correct it
  // (e.g. force "Alice" alone, fix an unusual capitalization) before commit.
  createFirstName?: string;
  createLastName?: string;
}

interface ClientResolution {
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
function employeeResolutionAllowsContinue(r: EmployeeResolution): boolean {
  if (r.decision === 'create') return Boolean(r.createFirstName?.trim()) && Boolean(r.createLastName?.trim());
  return true;
}

function clientResolutionAllowsContinue(r: ClientResolution): boolean {
  if (r.decision === 'create') return Boolean(r.createName?.trim());
  return true;
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

type Step = 'select' | 'cutoff' | 'resolve';

// Which categories of parsed data to actually persist on import — all true
// by default. Letting the user uncheck a category (e.g. re-importing only
// N-1 totals without touching this year's actuals/forecast) is the whole
// point: every checked category is written unconditionally (see handleImport
// below), no more per-row "keep the existing value" choice.
interface ImportFieldSelection {
  n1: boolean;
  actuals: boolean;
  forecast: boolean;
}

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
    timeForecasts,
    timeManualEditMarkers,
    loading: estimationLoading,
    refresh: refreshEstimation,
  } = useTimeEstimation();

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
  const [importFields, setImportFields] = useState<ImportFieldSelection>({ n1: true, actuals: true, forecast: true });

  const [employeeResolutions, setEmployeeResolutions] = useState<Record<string, EmployeeResolution>>({});
  const [clientResolutions, setClientResolutions] = useState<Record<string, ClientResolution>>({});
  const [resolving, setResolving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [done, setDone] = useState<{ actualRows: number; n1Rows: number; forecastRows: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // "Items written so far" vs. "items planned" — recomputed per phase
  // (alias resolution, then the total_pct recompute pass), since each is a
  // separate batch of independent parallel writes with its own count known
  // up front. null between phases / during the few fast single-call batch
  // upserts, which aren't worth counting individually.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const [clientFilter, setClientFilter] = useState<Set<string>>(new Set());

  const monthLabel = useMemo(() => {
    const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US';
    const fmtMonth = new Intl.DateTimeFormat(locale, { month: 'long' });
    return (month: number) => fmtMonth.format(new Date(year, month - 1, 1));
  }, [year, i18n.language]);

  function justificationFor(rawEmployeeName: string): string {
    const parts: string[] = [];
    for (const row of nRows) {
      if (row.employeeName !== rawEmployeeName) continue;
      row.monthlyFractions.forEach((v, i) => {
        if (v == null) return;
        parts.push(`${(Math.round(etpFractionToPct(v) * 10) / 10).toString().replace('.', ',')}% ${row.annonceur ?? '?'} (${monthLabel(i + 1)})`);
      });
    }
    for (const row of n1Rows) {
      if (row.employeeName !== rawEmployeeName || row.n1TotalFraction == null) continue;
      parts.push(`${(Math.round(etpFractionToPct(row.n1TotalFraction) * 10) / 10).toString().replace('.', ',')}% ${row.annonceur ?? '?'} (N-1)`);
    }
    const shown = parts.slice(0, 5);
    const extra = parts.length > 5 ? t('timeEstimation.wizard.andMore', { count: parts.length - 5 }) : '';
    return [shown.join(', '), extra].filter(Boolean).join(' ');
  }

  async function handleFileSelected(selected: File) {
    setFile(selected);
    setParsing(true);
    setParseError(null);
    setDone(null);
    setImportError(null);
    setProgress(null);
    setClientFilter(new Set());
    setImportFields({ n1: true, actuals: true, forecast: true });
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
        empResolutions[rawName] =
          matches.length === 1
            ? { status: 'auto', employeeId: matches[0].id, decision: 'match' }
            : { status: 'needs-review', employeeId: null, decision: null };
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

      // Preselect the client filter to raw names that already resolve to a
      // real existing client_mission (auto-matched via alias or exact name)
      // — those are the ones most likely to be a genuine update rather than
      // a brand-new client, so they're the natural starting focus.
      const alreadyInBase = Object.entries(cliResolutions)
        .filter(([, res]) => res.status === 'auto' && res.clientMissionId != null)
        .map(([rawName]) => rawName);
      setClientFilter(new Set(alreadyInBase));

      setStep('cutoff');
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

  // Raw employee name -> set of raw client names it appears under in either
  // sheet, used to decide which employees the client filter below keeps.
  const employeeClientNames = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const row of [...n1Rows, ...nRows]) {
      if (!row.employeeName || !row.annonceur) continue;
      if (!map.has(row.employeeName)) map.set(row.employeeName, new Set());
      map.get(row.employeeName)!.add(row.annonceur);
    }
    return map;
  }, [n1Rows, nRows]);

  const clientFilterOptions: FilterDropdownOption[] = useMemo(() => {
    const names = new Set([...n1Rows.map((r) => r.annonceur), ...nRows.map((r) => r.annonceur)].filter((n): n is string => n != null));
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ key: name, label: name }));
  }, [n1Rows, nRows]);

  function toggleClientFilter(key: string) {
    setClientFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Alphabetical, for the "match an existing employee" dropdown's own
  // fallback group — the registry itself has no guaranteed order.
  const sortedRegistryEmployees = useMemo(
    () =>
      [...registryEmployees].sort((a, b) =>
        `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, 'fr'),
      ),
    [registryEmployees],
  );

  const employeesNeedingReviewAll = useMemo(
    () => Object.entries(employeeResolutions).filter(([, r]) => r.status === 'needs-review'),
    [employeeResolutions],
  );
  const clientsNeedingReviewAll = useMemo(
    () => Object.entries(clientResolutions).filter(([, r]) => r.status === 'needs-review'),
    [clientResolutions],
  );
  const employeesNeedingReview = useMemo(
    () =>
      clientFilter.size === 0
        ? employeesNeedingReviewAll
        : employeesNeedingReviewAll.filter(([rawName]) => {
            const clients = employeeClientNames.get(rawName);
            return clients != null && Array.from(clients).some((c) => clientFilter.has(c));
          }),
    [employeesNeedingReviewAll, employeeClientNames, clientFilter],
  );
  const clientsNeedingReview = useMemo(
    () => (clientFilter.size === 0 ? clientsNeedingReviewAll : clientsNeedingReviewAll.filter(([rawName]) => clientFilter.has(rawName))),
    [clientsNeedingReviewAll, clientFilter],
  );
  const allResolved =
    employeesNeedingReviewAll.every(([, r]) => employeeResolutionAllowsContinue(r)) &&
    clientsNeedingReviewAll.every(([, r]) => clientResolutionAllowsContinue(r));

  // Rows the user never explicitly touched — allowed to continue (treated
  // as ignored, see employeeResolutionAllowsContinue above), but worth a
  // heads-up before their data is silently skipped from the import.
  const undecidedEmployees = employeesNeedingReviewAll.filter(([, r]) => r.decision == null);
  const undecidedClients = clientsNeedingReviewAll.filter(([, r]) => r.decision == null);
  const undecidedCount = undecidedEmployees.length + undecidedClients.length;

  // Top-5 closest names per raw import name, ranked by Levenshtein
  // similarity (employeeNameSimilarity) — purely a UI ranking aid to help
  // find the right employee faster; never used to auto-resolve (that stays
  // matchesEmployeeName's strict equality check above).
  const suggestedMatchesByRawName = useMemo(() => {
    const map = new Map<string, Employee[]>();
    for (const [rawName] of employeesNeedingReview) {
      const ranked = registryEmployees
        .map((e) => ({ e, score: employeeNameSimilarity(rawName, e.first_name, e.last_name) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((x) => x.e);
      map.set(rawName, ranked);
    }
    return map;
  }, [employeesNeedingReview, registryEmployees]);

  // Resolves every raw name to a real id (writing aliases, creating any new
  // employee/client along the way), then commits straight through — no more
  // separate conflicts step. Every checked category in `importFields` is
  // written unconditionally: a fresh import always overwrites whatever was
  // there before (upsert on each table's own unique constraint), whether
  // that prior value came from a manual grid edit or an earlier import.
  // Unchecked categories are simply never written, leaving existing data
  // for them untouched.
  async function handleImport() {
    if (!allResolved) return;
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
      // during whichever part happens to run first.

      // 1. N-1 annual totals — one row per (employee, client), no month. A
      // null total on a real (employee, client) row means 0% that year, not
      // "no data" — the row only exists at all because this pair genuinely
      // appears in the file (isSubtotalRow/forward-fill already excluded
      // anything else upstream in timeImportParsing.ts).
      const n1UpsertRows: Array<{ employee_id: string; client_mission_id: string; year: number; total_pct: number }> = [];
      if (importFields.n1) {
        for (const row of n1Rows) {
          const employeeId = row.employeeName ? employeeIds.get(row.employeeName) : null;
          const clientMissionId = row.annonceur ? clientIds.get(row.annonceur) : null;
          if (!employeeId || !clientMissionId) continue;
          n1UpsertRows.push({ employee_id: employeeId, client_mission_id: clientMissionId, year: year - 1, total_pct: etpFractionToPct(row.n1TotalFraction ?? 0) });
        }
      }

      // 2. Past months (1..cutoffMonth) → time_actuals.
      // 3. Future months (cutoffMonth+1..12) → time_forecast_months.
      const actualUpsertRows: TimeActualUpsertRow[] = [];
      const forecastUpsertRows: Array<{ employee_id: string; client_mission_id: string; year: number; month: number; pct: number }> = [];
      const affectedKeys = new Set<string>();

      for (const row of nRows) {
        const employeeId = row.employeeName ? employeeIds.get(row.employeeName) : null;
        const clientMissionId = row.annonceur ? clientIds.get(row.annonceur) : null;
        if (!employeeId || !clientMissionId) continue;
        affectedKeys.add(`${employeeId}::${clientMissionId}`);
        row.monthlyFractions.forEach((fraction, i) => {
          const month = i + 1;
          // A null cell on a real row means 0% that month (e.g. the person
          // moved to a different client that month), not "no data" — same
          // reasoning as the N-1 total above. Writing an explicit 0 instead
          // of skipping the month is also what lets the override-clearing
          // pass below actually reach every month being re-imported.
          const pct = etpFractionToPct(fraction ?? 0);
          if (month <= cutoffMonth) {
            if (!importFields.actuals) return;
            actualUpsertRows.push({
              batch_id: batch.id,
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
        (markerIdsToClear.length > 0 ? 1 : 0);
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

      setDone({ actualRows: actualUpsertRows.length, n1Rows: n1UpsertRows.length, forecastRows: forecastUpsertRows.length });
    } catch (err) {
      setImportError(formatImportError(err));
    } finally {
      setCommitting(false);
      setProgress(null);
    }
  }

  const sortedCandidates = cutoffDetection?.candidates ?? [];

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
      {/* h-[85vh] (not just max-h) keeps the dialog's size stable regardless
          of how many rows the resolve step currently shows — without a
          fixed height, a narrow client filter result (few/no rows) let the
          flex column collapse to fit its content, and the "Filtrer par
          client" FilterDropdown's own absolutely-positioned popover (up to
          ~320px tall) then got clipped by that shrunken overflow-auto body,
          making the dropdown itself look tiny and hard to use. */}
      <div className="flex h-[85vh] max-h-[85vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
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
            <p className="text-sm text-slate-700">
              {t('timeEstimation.wizard.done', { actual: done.actualRows, n1: done.n1Rows, forecast: done.forecastRows })}
            </p>
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

              {step === 'cutoff' && (
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

              {step === 'resolve' && (
                <>
                  {(employeesNeedingReviewAll.length > 0 || clientsNeedingReviewAll.length > 0) && clientFilterOptions.length > 0 && (
                    <div className="mb-3">
                      <FilterDropdown
                        title={t('timeEstimation.wizard.filterByClient')}
                        options={clientFilterOptions}
                        selected={clientFilter}
                        onToggle={toggleClientFilter}
                        onSelectAll={() => setClientFilter(new Set(clientFilterOptions.map((o) => o.key)))}
                        onDeselectAll={() => setClientFilter(new Set())}
                        selectAllLabel={t('timeEstimation.wizard.selectAll')}
                        deselectAllLabel={t('timeEstimation.wizard.deselectAll')}
                      />
                    </div>
                  )}

                  {clientsNeedingReview.length > 0 && (
                    <section className="mb-4">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {t('timeEstimation.wizard.clientsToResolve')}
                      </h3>
                      <div className="space-y-2">
                        {clientsNeedingReview.map(([rawName, res]) => (
                          <div key={rawName} className="rounded border border-slate-200 px-2 py-1.5 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="w-40 shrink-0 truncate font-medium text-slate-700">{rawName}</span>
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
                                className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                              >
                                <option value="">{t('timeEstimation.wizard.choose')}</option>
                                <option value="__create__">{t('timeEstimation.wizard.createNew', { name: toTitleCase(rawName) })}</option>
                                {clientsMissions.map((cm) => (
                                  <option key={cm.id} value={cm.id}>
                                    {cm.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {res.decision === 'create' && (
                              <input
                                type="text"
                                value={res.createName ?? ''}
                                onChange={(e) =>
                                  setClientResolutions((prev) => ({ ...prev, [rawName]: { ...prev[rawName], createName: e.target.value } }))
                                }
                                placeholder={t('timeEstimation.wizard.clientNamePlaceholder')}
                                className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {employeesNeedingReview.length > 0 && (
                    <section className="mb-4">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {t('timeEstimation.wizard.employeesToResolve')}
                      </h3>
                      <div className="space-y-3">
                        {employeesNeedingReview.map(([rawName, res]) => (
                          <div key={rawName} className="rounded border border-slate-200 px-3 py-2 text-sm">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="font-medium text-slate-700">{rawName}</span>
                            </div>
                            <p className="mb-2 text-xs text-slate-400">{justificationFor(rawName)}</p>
                            <div className="flex flex-wrap items-center gap-2">
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
                                className={`rounded px-2 py-1 text-xs font-medium ${
                                  res.decision === 'create' ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
                                }`}
                              >
                                {t('timeEstimation.wizard.acceptCreate')}
                              </button>
                              <select
                                value={res.decision === 'match' ? (res.employeeId ?? '') : ''}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setEmployeeResolutions((prev) => ({
                                    ...prev,
                                    [rawName]: value
                                      ? { status: 'needs-review', employeeId: value, decision: 'match' }
                                      : { status: 'needs-review', employeeId: null, decision: null },
                                  }));
                                }}
                                className="rounded border border-slate-300 px-2 py-1 text-xs"
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
                                className={`rounded px-2 py-1 text-xs font-medium ${
                                  res.decision === 'ignore' ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
                                }`}
                              >
                                {t('timeEstimation.wizard.ignore')}
                              </button>
                            </div>
                            {res.decision === 'create' && (
                              <div className="mt-2 flex gap-2">
                                <input
                                  type="text"
                                  value={res.createFirstName ?? ''}
                                  onChange={(e) =>
                                    setEmployeeResolutions((prev) => ({ ...prev, [rawName]: { ...prev[rawName], createFirstName: e.target.value } }))
                                  }
                                  placeholder={t('timeEstimation.wizard.firstNamePlaceholder')}
                                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                                />
                                <input
                                  type="text"
                                  value={res.createLastName ?? ''}
                                  onChange={(e) =>
                                    setEmployeeResolutions((prev) => ({ ...prev, [rawName]: { ...prev[rawName], createLastName: e.target.value } }))
                                  }
                                  placeholder={t('timeEstimation.wizard.lastNamePlaceholder')}
                                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {employeesNeedingReview.length === 0 && clientsNeedingReview.length === 0 && (
                    <p className="text-sm text-slate-500">
                      {clientFilter.size > 0 && (employeesNeedingReviewAll.length > 0 || clientsNeedingReviewAll.length > 0)
                        ? t('timeEstimation.wizard.noMatchesForFilter')
                        : t('timeEstimation.wizard.nothingToResolve')}
                    </p>
                  )}
                </>
              )}

            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          {step === 'resolve' && importError && (
            <p className="mr-auto text-xs text-red-600">{t('timeEstimation.wizard.importError', { message: importError })}</p>
          )}
          {step === 'resolve' && !importError && undecidedCount > 0 && (
            <p className="mr-auto text-xs text-amber-600">
              {t('timeEstimation.wizard.undecidedWarning', { count: undecidedCount })}
              {clientFilter.size > 0 && (
                <>
                  {' '}
                  <button type="button" onClick={() => setClientFilter(new Set())} className="underline hover:text-amber-800">
                    {t('timeEstimation.wizard.clearFilterToReview')}
                  </button>
                </>
              )}
            </p>
          )}
          <button
            onClick={onClose}
            disabled={resolving || committing}
            title={resolving || committing ? t('timeEstimation.wizard.closeDisabledHint') : undefined}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('timeEstimation.wizard.close')}
          </button>
          {step === 'cutoff' && (
            <button
              onClick={() => setStep('resolve')}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
            >
              {t('timeEstimation.wizard.continueLabel')}
            </button>
          )}
          {step === 'resolve' && !done && (
            <button
              onClick={() => {
                if (undecidedCount > 0 && !window.confirm(t('timeEstimation.wizard.confirmSkipUndecided', { count: undecidedCount }))) return;
                handleImport();
              }}
              disabled={!allResolved || resolving || committing}
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
