import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEmployees } from '../../hooks/useEmployees';
import { useAssignments } from '../../hooks/useAssignments';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useTimeEstimation } from '../../hooks/useTimeEstimation';
import { averageOverRange, sumMetricRows } from '../../lib/timeEstimationMath';
import { TrendSparkline } from './TrendSparkline';
import type { Employee, RemunerationModel } from '../../types/domain';
import { useTimeEstimationHistoryStore } from '../../stores/timeEstimationHistoryStore';
import { withSuppressedRecording } from '../../stores/historyStore';

type GroupBy = 'client' | 'employee';

interface LineItem {
  employeeId: string;
  clientMissionId: string;
  assignmentId: string | null;
  remunerationModel: RemunerationModel | null;
  vendu: number | null;
  prevu: number | null;
  n1Total: number | null;
  // Index i = month i+1. actualByMonth sums every resolved time_actuals row
  // for that month (several raw imports can resolve to the same month —
  // summed, not overwritten). overrideByMonth is the manual correction/
  // forecast from time_forecast_months. effectiveByMonth = override ?? actual
  // ?? null — the value used everywhere (cells, averages, trend).
  actualByMonth: (number | null)[];
  overrideByMonth: (number | null)[];
  effectiveByMonth: (number | null)[];
  total: number;
  avgPast: number;
  avgRemaining: number;
}

function employeeName(employee: Employee | undefined): string {
  return employee ? `${employee.first_name} ${employee.last_name}` : '?';
}

// Rounded to the nearest whole percent — per user feedback, decimals aren't
// of interest here. Still routed through one function so every cell (grey
// disabled span, group-header aggregate, or an editable field's own
// resting/blurred display) rounds identically and stays column-aligned.
function fmt(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value)}%`;
}

// Same whole-percent rounding as fmt(), without the "%" — what a
// CascadeCell's <input> shows outside of an active edit, so a value
// carrying float noise (e.g. an average like 12.333333) doesn't visually
// stretch the column and break the row's alignment.
function roundedInputValue(value: number | null | undefined): string {
  return value == null ? '' : String(Math.round(value));
}

function lineItemMetrics(li: LineItem): Record<string, number | null> {
  const record: Record<string, number | null> = {
    vendu: li.vendu,
    prevu: li.prevu,
    n1Total: li.n1Total,
    total: li.total,
    avgPast: li.avgPast,
    avgRemaining: li.avgRemaining,
  };
  li.effectiveByMonth.forEach((v, i) => {
    record[`m${i}`] = v;
  });
  return record;
}

// One cell in the 3-level cascade (a single month, a section average, or
// the year total) — all editable, some visually grey. `needsConfirm` gates
// a window.confirm() before committing, for any edit that would overwrite a
// value derived from an import (a past month, "moyenne mois passés", or
// "% total actual N" — see CLAUDE.md). `disabled` is used on a "cumul" row
// (a drag-grouped aggregate across several employees), which has no single
// well-defined write target.
//
// Always a real <input> (no click-to-arm step) — the grid used to render a
// button that only became an input once clicked, which meant every edit
// cost a click before the keyboard could even reach it and broke Tab
// navigation (a button in the tab order, not the field itself). Native
// number-input spin arrows removed and content auto-selected on focus, per
// user feedback, so tabbing/typing across a row works like a spreadsheet.
// - grey: already-imported/computed data (n1Total, vendu/prevu's own resting
//   look before pink was added, past-range cells, totals).
// - pink: % vendu/% prévu only — a manually-entered field an import never
//   writes to at all (assignments.etp_vendu is a separate table from every
//   time_* import target), so it reads as "safe to edit, permanently" rather
//   than tied to any particular edit.
// - greenDirect / greenDerived: the cell the user just typed a value into
//   this session, and every OTHER cell that changed as a mechanical side
//   effect of that one action (a recomputed average/total, or a month
//   filled by an average/total cascade) — greenDerived is the lighter of
//   the two. Session-local only (EditedCellsProvider-style plain state in
//   TimeEstimationGrid, not persisted), since there's no schema field that
//   could distinguish "the exact cell typed into" from "a cell a cascade
//   fill happened to also touch" — see markEdited below.
type CellTint = 'grey' | 'pink' | 'greenDirect' | 'greenDerived';

const TINT_BG: Record<CellTint, string> = {
  grey: 'bg-slate-100',
  pink: 'bg-rose-50',
  greenDirect: 'bg-emerald-100',
  greenDerived: 'bg-emerald-50',
};
const TINT_TEXT: Record<CellTint, string> = {
  grey: 'text-slate-600',
  pink: 'text-rose-700',
  greenDirect: 'text-emerald-800',
  greenDerived: 'text-emerald-700',
};

function CascadeCell({
  value,
  tint,
  disabled,
  needsConfirm,
  confirmMessage,
  onCommit,
}: {
  value: number | null;
  tint?: CellTint;
  disabled?: boolean;
  needsConfirm?: boolean;
  confirmMessage?: string;
  onCommit: (value: number) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(roundedInputValue(value));
  const inputRef = useRef<HTMLInputElement>(null);
  // A click's mousedown focuses the input (firing onFocus's select() below)
  // but the SAME click's mouseup then runs the browser's own native
  // click-to-position-caret logic, which collapses that selection right back
  // down to a single point — the classic reason `onFocus={e=>e.target.select()}`
  // alone only ever appears to work for keyboard (Tab) focus, never a mouse
  // click. Suppressing just the one mouseup that immediately follows a fresh
  // focus (via preventDefault) stops that collapse without blocking normal
  // re-click-to-reposition-the-caret behavior once the field is already
  // focused.
  const justFocusedRef = useRef(false);

  // Keeps the field in sync with the underlying value (optimistic update,
  // realtime reconciliation, another cell's cascade fill) — but never while
  // this exact field is focused, so an in-progress edit is never clobbered
  // out from under the person typing it.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(roundedInputValue(value));
    }
  }, [value]);

  if (disabled) {
    return (
      <span className={`block rounded px-1 text-right text-xs tabular-nums text-slate-400 ${tint ? TINT_BG[tint] : ''}`}>{fmt(value)}</span>
    );
  }

  async function commit() {
    const trimmed = draft.trim();
    if (trimmed === '') {
      setDraft(roundedInputValue(value));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed === value) {
      setDraft(roundedInputValue(value));
      return;
    }
    if (needsConfirm && !window.confirm(confirmMessage ?? '')) {
      setDraft(roundedInputValue(value));
      return;
    }
    await onCommit(parsed);
  }

  return (
    <div className={`relative rounded ${tint ? TINT_BG[tint] : ''}`}>
      <input
        ref={inputRef}
        // type="text" (not "number"): a number input silently normalizes its
        // own value attribute (drops a trailing ".0"), which put whole-
        // number cells one character narrower than their decimal neighbors
        // and broke the exact alignment this cell exists to preserve — text
        // + inputMode="decimal" keeps the numeric keyboard on mobile without
        // that normalization; numeric validity is still enforced in commit().
        type="text"
        inputMode="decimal"
        placeholder="—"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          e.target.select();
          justFocusedRef.current = true;
        }}
        onMouseUp={(e) => {
          if (justFocusedRef.current) {
            e.preventDefault();
            justFocusedRef.current = false;
          }
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(roundedInputValue(value));
            e.currentTarget.blur();
          }
          // Browsers give every text <input> its own native undo stack for
          // free (Cmd/Ctrl+Z) independent of React — reported live as
          // "erratic": it can move focus/selection back into the last-
          // edited field without touching this controlled input's actual
          // value, since React's own re-render just overwrites whatever the
          // native undo tried to set. This module intentionally isn't wired
          // into the header's real Undo/Redo (see useTimeEstimation.ts), so
          // rather than ship that confusing half-behavior, swallow the
          // shortcut here entirely.
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
          }
        }}
        className={`w-full rounded bg-transparent px-1 py-0.5 pr-3.5 text-right text-xs tabular-nums outline-none focus:ring-1 focus:ring-inset focus:ring-slate-400 ${tint ? TINT_TEXT[tint] : 'text-slate-700'}`}
      />
      <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
    </div>
  );
}

export function TimeEstimationGrid({ registryOrgChartId }: { registryOrgChartId: string }) {
  const { t, i18n } = useTranslation();
  const { employees } = useEmployees(registryOrgChartId);
  const { assignments, createAssignment, updateAssignmentEtpVendu, updateAssignmentRemuneration, deleteAssignment, restoreAssignment } =
    useAssignments(registryOrgChartId);
  const { clientsMissions } = useClientsMissions();
  const {
    timeActuals,
    timeForecastMonths,
    timeActualN1Totals,
    timeManualEditMarkers,
    loading: estimationLoading,
    forecastOf,
    groupsByPrimary,
    groupOfMember,
    createGroup,
    deleteGroup,
    saveMonthOverrides,
    restoreMonthOverrides,
    saveManualActuals,
    restoreManualActuals,
    saveN1Total,
    deleteN1Total,
    saveEditMarker,
    clearEditMarker,
  } = useTimeEstimation();

  const [year] = useState(() => new Date().getFullYear());
  const [groupBy, setGroupBy] = useState<GroupBy>('client');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedCumul, setCollapsedCumul] = useState<Set<string>>(new Set());
  const [dragEmployeeId, setDragEmployeeId] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const clientMissionById = useMemo(() => new Map(clientsMissions.map((cm) => [cm.id, cm])), [clientsMissions]);

  // How many months of `year` already have imported actual data — defines
  // the past/remaining split for every row (independent of any given row's
  // own overrides: it's driven purely by what's actually been imported).
  const lastMonth = useMemo(
    () =>
      timeActuals
        .filter((a) => a.year === year && a.resolved_employee_id && a.resolved_client_mission_id)
        .reduce((max, a) => Math.max(max, a.month), 0),
    [timeActuals, year],
  );

  // Persisted "you edited this" highlight — derived, not stored, mutated
  // state: the DB only ever records DIRECT edits (see the migration's own
  // comment), so every DERIVED cell (a recomputed average/total, or a month
  // a cascade fill also touched) is expanded here at render time from
  // whichever fields are directly marked, the same way it used to be
  // computed by hand inside handleFill before this became persisted. Direct
  // always wins if a field is somehow both (setTint below is a no-op once a
  // key is already greenDirect).
  const editedTints = useMemo(() => {
    const directByPair = new Map<string, Set<string>>();
    for (const m of timeManualEditMarkers) {
      if (m.year !== year) continue;
      const pairKey = `${m.employee_id}::${m.client_mission_id}`;
      if (!directByPair.has(pairKey)) directByPair.set(pairKey, new Set());
      directByPair.get(pairKey)!.add(m.field);
    }
    const tints = new Map<string, CellTint>();
    const setTint = (pairKey: string, field: string, tint: CellTint) => {
      const key = `${pairKey}::${field}`;
      if (tints.get(key) === 'greenDirect') return;
      tints.set(key, tint);
    };
    for (const [pairKey, directFields] of directByPair) {
      for (const field of directFields) setTint(pairKey, field, 'greenDirect');
      for (const field of directFields) {
        if (field === 'total') {
          for (let i = 0; i < 12; i += 1) setTint(pairKey, `m${i}`, 'greenDerived');
          setTint(pairKey, 'avgPast', 'greenDerived');
          setTint(pairKey, 'avgRemaining', 'greenDerived');
        } else if (field === 'avgPast') {
          for (let i = 0; i < lastMonth; i += 1) setTint(pairKey, `m${i}`, 'greenDerived');
          setTint(pairKey, 'total', 'greenDerived');
        } else if (field === 'avgRemaining') {
          for (let i = lastMonth; i < 12; i += 1) setTint(pairKey, `m${i}`, 'greenDerived');
          setTint(pairKey, 'total', 'greenDerived');
        } else if (/^m\d+$/.test(field)) {
          const monthIndex = Number(field.slice(1));
          setTint(pairKey, 'total', 'greenDerived');
          setTint(pairKey, monthIndex < lastMonth ? 'avgPast' : 'avgRemaining', 'greenDerived');
        }
      }
    }
    return tints;
  }, [timeManualEditMarkers, year, lastMonth]);

  function editedTint(li: LineItem, field: string): CellTint | undefined {
    return editedTints.get(`${li.employeeId}::${li.clientMissionId}::${field}`);
  }

  const monthLabel = useMemo(() => {
    const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US';
    const fmtMonth = new Intl.DateTimeFormat(locale, { month: 'short' });
    return (monthIndex0: number) => fmtMonth.format(new Date(year, monthIndex0, 1));
  }, [year, i18n.language]);

  const pastMonthLabels = useMemo(() => Array.from({ length: lastMonth }, (_, i) => monthLabel(i)), [lastMonth, monthLabel]);
  const remainingMonthLabels = useMemo(
    () => Array.from({ length: 12 - lastMonth }, (_, i) => monthLabel(lastMonth + i)),
    [lastMonth, monthLabel],
  );

  const lineItems = useMemo<Map<string, LineItem>>(() => {
    const map = new Map<string, LineItem>();
    const keyOf = (employeeId: string, clientMissionId: string) => `${employeeId}::${clientMissionId}`;

    const getOrCreate = (employeeId: string, clientMissionId: string): LineItem => {
      const key = keyOf(employeeId, clientMissionId);
      let li = map.get(key);
      if (!li) {
        li = {
          employeeId,
          clientMissionId,
          assignmentId: null,
          remunerationModel: null,
          vendu: null,
          prevu: null,
          n1Total: null,
          actualByMonth: new Array(12).fill(null),
          overrideByMonth: new Array(12).fill(null),
          effectiveByMonth: new Array(12).fill(null),
          total: 0,
          avgPast: 0,
          avgRemaining: 0,
        };
        map.set(key, li);
      }
      return li;
    };

    for (const a of assignments) {
      const li = getOrCreate(a.employee_id, a.client_mission_id);
      li.assignmentId = a.id;
      li.remunerationModel = a.remuneration_model;
      if (a.remuneration_model === 'commission') li.prevu = a.etp_vendu;
      else li.vendu = a.etp_vendu;
    }

    for (const row of timeActuals) {
      if (!row.resolved_employee_id || !row.resolved_client_mission_id || row.year !== year) continue;
      const li = getOrCreate(row.resolved_employee_id, row.resolved_client_mission_id);
      const idx = row.month - 1;
      li.actualByMonth[idx] = (li.actualByMonth[idx] ?? 0) + row.etp_pct;
    }

    // Total actual N-1 is a single annual figure from Input N-1's "ETPs
    // 2025" column (see TimeActualN1Total) — never a monthly average of
    // time_actuals, which no longer holds N-1 data under the combined
    // N-1+N import (revision 2).
    for (const t of timeActualN1Totals) {
      if (t.year !== year - 1) continue;
      const li = getOrCreate(t.employee_id, t.client_mission_id);
      li.n1Total = t.total_pct;
    }

    for (const m of timeForecastMonths) {
      if (m.year !== year) continue;
      const li = getOrCreate(m.employee_id, m.client_mission_id);
      li.overrideByMonth[m.month - 1] = m.pct;
    }

    for (const li of map.values()) {
      // Past months (i < lastMonth) never consult overrideByMonth — a past
      // month is entirely import/manual-edit-driven via time_actuals now,
      // no separate "surcharge" table (see CLAUDE.md). Only a remaining/
      // future month can still be a pure forecast with no actual yet, which
      // is the one case time_forecast_months still legitimately covers.
      li.effectiveByMonth = li.actualByMonth.map((actual, i) => (i < lastMonth ? actual : (li.overrideByMonth[i] ?? actual)));
      li.total = averageOverRange(li.effectiveByMonth);
      li.avgPast = averageOverRange(li.effectiveByMonth.slice(0, lastMonth));
      li.avgRemaining = averageOverRange(li.effectiveByMonth.slice(lastMonth, 12));
    }

    return map;
  }, [assignments, timeActuals, timeForecastMonths, timeActualN1Totals, lastMonth, year]);

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleCumul(key: string) {
    setCollapsedCumul((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // The one write path behind every cascade cell: fills `months` (1-indexed)
  // with `value`, recomputes % total actual N from the resulting 12-month
  // array, persists both, and records an undo Command onto this screen's own
  // independent history store (useTimeEstimationHistoryStore — never the
  // org-chart/grid screen's useHistoryStore, see CLAUDE.md).
  //
  // "% total" fills all 12 months in one call, which can span both past and
  // future — past months (<= lastMonth) write to time_actuals via
  // saveManualActuals/restoreManualActuals, future months write to
  // time_forecast_months via saveMonthOverrides/restoreMonthOverrides as
  // before. Both halves are captured/applied together so one click undoes
  // whichever combination actually ran.
  async function handleFill(li: LineItem, months: number[], value: number, label: string, sourceField: string) {
    const newEffective = [...li.effectiveByMonth];
    months.forEach((m) => {
      newEffective[m - 1] = value;
    });
    const totalPct = averageOverRange(newEffective);
    const priorTotalPct = forecastOf(li.employeeId, li.clientMissionId, year)?.total_pct ?? null;

    const pastMonths = months.filter((m) => m <= lastMonth);
    const futureMonths = months.filter((m) => m > lastMonth);
    const priorOverrideEntries = futureMonths.map((m) => ({ month: m, pct: li.overrideByMonth[m - 1] }));
    const priorActualRows = timeActuals.filter(
      (a) =>
        a.year === year &&
        a.resolved_employee_id === li.employeeId &&
        a.resolved_client_mission_id === li.clientMissionId &&
        pastMonths.includes(a.month),
    );
    const employeeDisplayName = employeeName(employeeById.get(li.employeeId));
    const clientDisplayName = clientMissionById.get(li.clientMissionId)?.name ?? '';

    // Every OTHER field this fill overwrites the value of — the recomputed
    // total, whichever average(s) cover the touched months, and any other
    // month a total/average fill swept along with it. If one of THOSE
    // fields already carried its own direct marker from an earlier, separate
    // edit, that marker is now stale: the value it used to explain has just
    // been overwritten by THIS edit, so the field must fall back to
    // derived (or nothing) rather than keep reading as "you directly typed
    // this," which was the exact desync the user reported. Captured before
    // the write so undo can restore precisely the markers this edit clears.
    const affectedFields = new Set<string>();
    if (sourceField !== 'total') affectedFields.add('total');
    if (sourceField !== 'avgPast' && pastMonths.length > 0) affectedFields.add('avgPast');
    if (sourceField !== 'avgRemaining' && futureMonths.length > 0) affectedFields.add('avgRemaining');
    months.forEach((m) => {
      const f = `m${m - 1}`;
      if (f !== sourceField) affectedFields.add(f);
    });
    const isDirectMarker = (field: string) =>
      timeManualEditMarkers.some(
        (m) => m.employee_id === li.employeeId && m.client_mission_id === li.clientMissionId && m.year === year && m.field === field,
      );
    const staleDirectFields = Array.from(affectedFields).filter(isDirectMarker);
    // Whether sourceField was ALREADY a direct edit before this one — if so,
    // undoing this edit must leave it marked (it's still manually-sourced,
    // just from an earlier edit); only clear it if this edit was what
    // created the marker in the first place.
    const hadPriorDirectMarker = isDirectMarker(sourceField);

    async function apply() {
      // Value writes and marker writes run in the SAME Promise.all —
      // previously the marker save happened strictly after the value
      // writes resolved, which on a slow connection left a visible window
      // where the number had updated but the color hadn't (or vice versa).
      // Both still each do their own optimistic local update before their
      // own network round trip, so running them together makes those two
      // optimistic updates land together too.
      await Promise.all([
        futureMonths.length > 0 ? saveMonthOverrides(li.employeeId, li.clientMissionId, year, futureMonths, value, totalPct) : null,
        pastMonths.length > 0
          ? saveManualActuals(li.employeeId, li.clientMissionId, year, pastMonths, value, totalPct, employeeDisplayName, clientDisplayName)
          : null,
        saveEditMarker(li.employeeId, li.clientMissionId, year, sourceField),
        ...staleDirectFields.map((f) => clearEditMarker(li.employeeId, li.clientMissionId, year, f)),
      ]);
    }
    async function undo() {
      await Promise.all([
        futureMonths.length > 0 ? restoreMonthOverrides(li.employeeId, li.clientMissionId, year, priorOverrideEntries, priorTotalPct) : null,
        pastMonths.length > 0 ? restoreManualActuals(li.employeeId, li.clientMissionId, year, pastMonths, priorActualRows, priorTotalPct) : null,
        hadPriorDirectMarker ? null : clearEditMarker(li.employeeId, li.clientMissionId, year, sourceField),
        ...staleDirectFields.map((f) => saveEditMarker(li.employeeId, li.clientMissionId, year, f)),
      ]);
    }

    await apply();
    useTimeEstimationHistoryStore.getState().push({ label, undo, redo: apply });
  }

  async function handleEditN1Total(li: LineItem, value: number) {
    const priorValue = li.n1Total;
    const hadPriorDirectMarker = timeManualEditMarkers.some(
      (m) => m.employee_id === li.employeeId && m.client_mission_id === li.clientMissionId && m.year === year && m.field === 'n1Total',
    );
    async function apply() {
      await Promise.all([
        saveN1Total(li.employeeId, li.clientMissionId, year - 1, value),
        saveEditMarker(li.employeeId, li.clientMissionId, year, 'n1Total'),
      ]);
    }
    async function undo() {
      await Promise.all([
        priorValue == null
          ? deleteN1Total(li.employeeId, li.clientMissionId, year - 1)
          : saveN1Total(li.employeeId, li.clientMissionId, year - 1, priorValue),
        hadPriorDirectMarker ? null : clearEditMarker(li.employeeId, li.clientMissionId, year, 'n1Total'),
      ]);
    }
    await apply();
    useTimeEstimationHistoryStore.getState().push({ label: t('timeEstimation.history.editN1Total'), undo, redo: apply });
  }

  // "% vendu"/"% prévu" both read/write the same assignments.etp_vendu
  // column, bucketed into one column or the other by remuneration_model
  // (see CLAUDE.md) — editing whichever one is currently empty on a line
  // with no assignment yet creates one; editing an existing assignment's
  // already-populated column just updates its value in place.
  //
  // Every call to updateAssignmentEtpVendu/createAssignment/deleteAssignment
  // here is wrapped in the MAIN store's withSuppressedRecording — those
  // mutators (see useAssignments.ts) self-push onto the org-chart/grid
  // screen's own useHistoryStore unconditionally, which would otherwise leak
  // a Time Estimation edit into the org chart's undo stack. This screen
  // records its own Command onto useTimeEstimationHistoryStore instead.
  // Creating an assignment must never be replayed via createAssignment again
  // on redo — per CLAUDE.md's identity-stable-undo convention, a fresh
  // create would mint a new row id — so redo uses restoreAssignment(created)
  // instead, same as every other create-then-undo path in this app.
  // A vendu value entered by hand always means the "Retainer" remuneration
  // model — the DB's own check constraint already forbids etp_vendu +
  // 'commission' together, but a fresh assignment or one created some other
  // way could still sit at remuneration_model = null; fix that up in the
  // same edit rather than leaving vendu populated with no explicit model.
  async function handleEditVendu(li: LineItem, value: number) {
    const label = t('timeEstimation.history.editVendu');
    if (li.assignmentId) {
      const priorValue = li.vendu;
      const priorModel = li.remunerationModel;
      const assignmentId = li.assignmentId;
      const needsModelFix = priorModel !== 'retainer';
      await withSuppressedRecording(async () => {
        await updateAssignmentEtpVendu(assignmentId, value);
        if (needsModelFix) await updateAssignmentRemuneration(assignmentId, 'retainer', false);
      });
      useTimeEstimationHistoryStore.getState().push({
        label,
        undo: () =>
          withSuppressedRecording(async () => {
            await updateAssignmentEtpVendu(assignmentId, priorValue);
            if (needsModelFix) await updateAssignmentRemuneration(assignmentId, priorModel, false);
          }),
        redo: () =>
          withSuppressedRecording(async () => {
            await updateAssignmentEtpVendu(assignmentId, value);
            if (needsModelFix) await updateAssignmentRemuneration(assignmentId, 'retainer', false);
          }),
      });
    } else {
      const created = await withSuppressedRecording(() => createAssignment(li.employeeId, li.clientMissionId, value, null, 'retainer'));
      useTimeEstimationHistoryStore.getState().push({
        label,
        undo: () => withSuppressedRecording(() => deleteAssignment(created.id)),
        redo: () => restoreAssignment(created).then(() => {}),
      });
    }
  }

  async function handleEditPrevu(li: LineItem, value: number) {
    const label = t('timeEstimation.history.editPrevu');
    if (li.assignmentId) {
      const priorValue = li.prevu;
      const assignmentId = li.assignmentId;
      await withSuppressedRecording(() => updateAssignmentEtpVendu(assignmentId, value));
      useTimeEstimationHistoryStore.getState().push({
        label,
        undo: () => withSuppressedRecording(() => updateAssignmentEtpVendu(assignmentId, priorValue)),
        redo: () => withSuppressedRecording(() => updateAssignmentEtpVendu(assignmentId, value)),
      });
    } else {
      const created = await withSuppressedRecording(() =>
        createAssignment(li.employeeId, li.clientMissionId, value, null, 'commission'),
      );
      useTimeEstimationHistoryStore.getState().push({
        label,
        undo: () => withSuppressedRecording(() => deleteAssignment(created.id)),
        redo: () => restoreAssignment(created).then(() => {}),
      });
    }
  }

  async function handleDrop(clientMissionId: string, targetEmployeeId: string, sourceEmployeeId: string) {
    if (targetEmployeeId === sourceEmployeeId) return;
    // Refuse to nest a primary-with-members under another row, and refuse a
    // target that is itself already someone else's member — keeps groups a
    // single flat level (see CLAUDE.md's grouping explanation).
    if (groupsByPrimary(clientMissionId, sourceEmployeeId).length > 0) return;
    if (groupOfMember(clientMissionId, targetEmployeeId)) return;
    const existing = groupOfMember(clientMissionId, sourceEmployeeId);
    if (existing) await deleteGroup(existing.id);
    await createGroup(clientMissionId, targetEmployeeId, sourceEmployeeId);
  }

  const pastColTemplate = pastMonthLabels.map(() => '56px').join(' ');
  const remainingColTemplate = remainingMonthLabels.map(() => '56px').join(' ');
  const gridTemplateColumns =
    `minmax(180px,1fr) 64px 64px 64px 72px ` +
    `72px ${pastColTemplate} ` +
    `72px ${remainingColTemplate} ` +
    `100px`;

  const loading = estimationLoading;
  const confirmMessage = t('timeEstimation.grid.confirmOverwrite');

  function renderRowCells(li: LineItem, cumulDisabled: boolean, labelSlot: React.ReactNode) {
    const points = li.effectiveByMonth.map((v, i) => ({ key: `m${i}`, value: v }));
    return (
      <>
        {labelSlot}
        <CascadeCell
          value={li.n1Total}
          tint={editedTint(li, 'n1Total') ?? 'grey'}
          disabled={cumulDisabled}
          onCommit={(v) => handleEditN1Total(li, v)}
        />
        <CascadeCell value={li.vendu} tint="pink" disabled={cumulDisabled} onCommit={(v) => handleEditVendu(li, v)} />
        <CascadeCell value={li.prevu} tint="pink" disabled={cumulDisabled} onCommit={(v) => handleEditPrevu(li, v)} />
        <CascadeCell
          value={li.total}
          tint={editedTint(li, 'total') ?? 'grey'}
          disabled={cumulDisabled}
          needsConfirm
          confirmMessage={confirmMessage}
          onCommit={(v) =>
            handleFill(li, Array.from({ length: 12 }, (_, i) => i + 1), v, t('timeEstimation.history.editTotal'), 'total')
          }
        />
        <CascadeCell
          value={lastMonth > 0 ? li.avgPast : null}
          tint={editedTint(li, 'avgPast') ?? 'grey'}
          disabled={cumulDisabled || lastMonth === 0}
          needsConfirm
          confirmMessage={confirmMessage}
          onCommit={(v) =>
            handleFill(
              li,
              Array.from({ length: lastMonth }, (_, i) => i + 1),
              v,
              t('timeEstimation.history.editAvgPast'),
              'avgPast',
            )
          }
        />
        {li.effectiveByMonth.slice(0, lastMonth).map((v, i) => (
          <CascadeCell
            key={i}
            value={v}
            tint={editedTint(li, `m${i}`) ?? 'grey'}
            disabled={cumulDisabled}
            needsConfirm
            confirmMessage={confirmMessage}
            onCommit={(newValue) =>
              handleFill(li, [i + 1], newValue, t('timeEstimation.history.editMonth', { month: monthLabel(i) }), `m${i}`)
            }
          />
        ))}
        <CascadeCell
          value={lastMonth < 12 ? li.avgRemaining : null}
          tint={editedTint(li, 'avgRemaining')}
          disabled={cumulDisabled || lastMonth === 12}
          onCommit={(v) =>
            handleFill(
              li,
              Array.from({ length: 12 - lastMonth }, (_, i) => lastMonth + i + 1),
              v,
              t('timeEstimation.history.editAvgRemaining'),
              'avgRemaining',
            )
          }
        />
        {li.effectiveByMonth.slice(lastMonth, 12).map((v, i) => (
          <CascadeCell
            key={i}
            value={v}
            tint={editedTint(li, `m${lastMonth + i}`)}
            disabled={cumulDisabled}
            onCommit={(newValue) =>
              handleFill(
                li,
                [lastMonth + i + 1],
                newValue,
                t('timeEstimation.history.editMonth', { month: monthLabel(lastMonth + i) }),
                `m${lastMonth + i}`,
              )
            }
          />
        ))}
        <span className="flex justify-end text-slate-400">
          <TrendSparkline points={points} projectedFromIndex={lastMonth} width={90} height={24} />
        </span>
      </>
    );
  }

  // Builds the top-level groups for the active groupBy mode. In 'client'
  // mode, applies the drag-to-group nesting (cumul rows); in 'employee'
  // mode each employee IS already the top-level grouping unit, so members
  // just render inline like any other line — see CLAUDE.md for why nesting
  // is only meaningful in 'client' mode.
  const topGroups = useMemo(() => {
    type TopRow = { primary: LineItem; members: LineItem[] };
    type TopGroup = { key: string; label: string; rows: TopRow[] };
    const result: TopGroup[] = [];

    if (groupBy === 'client') {
      const byClient = new Map<string, LineItem[]>();
      for (const li of lineItems.values()) {
        const list = byClient.get(li.clientMissionId) ?? [];
        list.push(li);
        byClient.set(li.clientMissionId, list);
      }
      for (const [clientMissionId, items] of byClient) {
        const rows: TopRow[] = [];
        for (const li of items) {
          if (groupOfMember(clientMissionId, li.employeeId)) continue; // rendered nested under its primary
          const memberGroups = groupsByPrimary(clientMissionId, li.employeeId);
          const members = memberGroups
            .map((g) => lineItems.get(`${g.member_employee_id}::${clientMissionId}`))
            .filter((m): m is LineItem => m != null);
          rows.push({ primary: li, members });
        }
        rows.sort((a, b) => employeeName(employeeById.get(a.primary.employeeId)).localeCompare(employeeName(employeeById.get(b.primary.employeeId))));
        result.push({ key: clientMissionId, label: clientMissionById.get(clientMissionId)?.name ?? '?', rows });
      }
    } else {
      const byEmployee = new Map<string, LineItem[]>();
      for (const li of lineItems.values()) {
        const list = byEmployee.get(li.employeeId) ?? [];
        list.push(li);
        byEmployee.set(li.employeeId, list);
      }
      for (const [employeeId, items] of byEmployee) {
        const rows: TopRow[] = items.map((li) => ({ primary: li, members: [] }));
        rows.sort((a, b) => (clientMissionById.get(a.primary.clientMissionId)?.name ?? '').localeCompare(clientMissionById.get(b.primary.clientMissionId)?.name ?? ''));
        result.push({ key: employeeId, label: employeeName(employeeById.get(employeeId)), rows });
      }
    }

    return result.sort((a, b) => a.label.localeCompare(b.label));
  }, [groupBy, lineItems, employeeById, clientMissionById, groupOfMember, groupsByPrimary]);

  const allCollapsed = topGroups.length > 0 && topGroups.every((g) => collapsedGroups.has(g.key));

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{t('timeEstimation.grid.title')}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCollapsedGroups(allCollapsed ? new Set() : new Set(topGroups.map((g) => g.key)))}
            className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {allCollapsed ? t('timeEstimation.grid.expandAll') : t('timeEstimation.grid.collapseAll')}
          </button>
          <div className="flex overflow-hidden rounded border border-slate-300 text-xs">
            <button
              onClick={() => setGroupBy('client')}
              className={`px-2.5 py-1 font-medium ${groupBy === 'client' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {t('timeEstimation.grid.byClient')}
            </button>
            <button
              onClick={() => setGroupBy('employee')}
              className={`px-2.5 py-1 font-medium ${groupBy === 'employee' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {t('timeEstimation.grid.byEmployee')}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200">
        <div
          className="sticky top-0 z-10 grid items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500"
          style={{ gridTemplateColumns }}
        >
          <span>{groupBy === 'client' ? t('timeEstimation.grid.employeeHeader') : t('timeEstimation.grid.clientMissionHeader')}</span>
          <span className="text-right">{t('timeEstimation.grid.totalN1')}</span>
          <span className="rounded bg-rose-50 px-1 text-right text-rose-700">{t('timeEstimation.grid.vendu')}</span>
          <span className="rounded bg-rose-50 px-1 text-right text-rose-700">{t('timeEstimation.grid.prevu')}</span>
          <span className="text-right">{t('timeEstimation.grid.total')}</span>
          <span className="text-right">{t('timeEstimation.grid.avgPast')}</span>
          {pastMonthLabels.map((label, i) => (
            <span key={i} className="text-right capitalize">
              {label}
            </span>
          ))}
          <span className="text-right">{t('timeEstimation.grid.avgRemaining')}</span>
          {remainingMonthLabels.map((label, i) => (
            <span key={i} className="text-right capitalize">
              {label}
            </span>
          ))}
          <span className="text-right">{t('timeEstimation.grid.trend')}</span>
        </div>

        {loading && <p className="p-3 text-sm text-slate-400">{t('timeEstimation.grid.loading')}</p>}
        {!loading && topGroups.length === 0 && <p className="p-3 text-sm text-slate-400">{t('timeEstimation.grid.empty')}</p>}

        {!loading &&
          topGroups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.key);
            const groupAgg = sumMetricRows(group.rows.flatMap((r) => [r.primary, ...r.members].map(lineItemMetrics)));
            return (
              <div key={group.key} className="border-b border-slate-100 last:border-0">
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="grid w-full items-center gap-2 bg-neutral-700 px-3 py-2 text-left hover:bg-neutral-600"
                  style={{ gridTemplateColumns }}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="text-white">{isCollapsed ? '▸' : '▾'}</span>
                    <span className="truncate text-sm font-semibold text-white">{group.label}</span>
                    <span className="shrink-0 text-xs text-white">· {group.rows.length}</span>
                  </span>
                  <span className="text-right text-xs tabular-nums text-white">{fmt(groupAgg.n1Total)}</span>
                  <span className="text-right text-xs tabular-nums text-white">{fmt(groupAgg.vendu)}</span>
                  <span className="text-right text-xs tabular-nums text-white">{fmt(groupAgg.prevu)}</span>
                  <span className="text-right text-xs tabular-nums font-medium text-white">{fmt(groupAgg.total)}</span>
                  <span className="text-right text-xs tabular-nums text-white">{fmt(groupAgg.avgPast)}</span>
                  {pastMonthLabels.map((_, i) => (
                    <span key={i} className="text-right text-xs tabular-nums text-white">
                      {fmt(groupAgg[`m${i}`])}
                    </span>
                  ))}
                  <span className="text-right text-xs tabular-nums text-white">{fmt(groupAgg.avgRemaining)}</span>
                  {remainingMonthLabels.map((_, i) => (
                    <span key={i} className="text-right text-xs tabular-nums text-white">
                      {fmt(groupAgg[`m${lastMonth + i}`])}
                    </span>
                  ))}
                  <span />
                </button>

                {!isCollapsed &&
                  group.rows.map(({ primary, members }) => {
                    const hasGroup = members.length > 0;
                    const cumulKey = `${primary.clientMissionId}:${primary.employeeId}`;
                    const cumulCollapsed = collapsedCumul.has(cumulKey);
                    const cumulMetrics = hasGroup ? sumMetricRows([primary, ...members].map(lineItemMetrics)) : null;
                    const cumulLineItem: LineItem | null =
                      hasGroup && cumulMetrics
                        ? {
                            ...primary,
                            vendu: cumulMetrics.vendu,
                            prevu: cumulMetrics.prevu,
                            n1Total: cumulMetrics.n1Total,
                            total: cumulMetrics.total ?? 0,
                            avgPast: cumulMetrics.avgPast ?? 0,
                            avgRemaining: cumulMetrics.avgRemaining ?? 0,
                            effectiveByMonth: primary.effectiveByMonth.map((_, i) => cumulMetrics[`m${i}`] ?? null),
                          }
                        : null;
                    const rowKey = groupBy === 'client' ? primary.employeeId : primary.clientMissionId;
                    const rowLabel = groupBy === 'client' ? employeeName(employeeById.get(primary.employeeId)) : clientMissionById.get(primary.clientMissionId)?.name ?? '?';
                    const draggable = groupBy === 'client';
                    const dropKey = `${primary.clientMissionId}::${primary.employeeId}`;

                    return (
                      <div key={rowKey}>
                        <div
                          draggable={draggable}
                          onDragStart={() => setDragEmployeeId(primary.employeeId)}
                          onDragEnd={() => {
                            setDragEmployeeId(null);
                            setDropTargetKey(null);
                          }}
                          onDragOver={(e) => {
                            if (!draggable || !dragEmployeeId) return;
                            e.preventDefault();
                            setDropTargetKey(dropKey);
                          }}
                          onDragLeave={() => setDropTargetKey((k) => (k === dropKey ? null : k))}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDropTargetKey(null);
                            if (dragEmployeeId) handleDrop(primary.clientMissionId, primary.employeeId, dragEmployeeId);
                            setDragEmployeeId(null);
                          }}
                          className={`grid items-center gap-2 border-t border-slate-100 px-3 py-1.5 text-sm ${
                            dropTargetKey === dropKey ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-300' : ''
                          }`}
                          style={{ gridTemplateColumns }}
                        >
                          {renderRowCells(
                            cumulLineItem ?? primary,
                            hasGroup,
                            <span className="flex items-center gap-1.5 truncate pl-5 text-slate-700">
                              {hasGroup && (
                                <button
                                  type="button"
                                  onClick={() => toggleCumul(cumulKey)}
                                  className="text-slate-400 hover:text-slate-700"
                                >
                                  {cumulCollapsed ? '▸' : '▾'}
                                </button>
                              )}
                              <span className="truncate">{rowLabel}</span>
                              {hasGroup && <span className="shrink-0 text-xs italic text-slate-400">{t('timeEstimation.grid.cumulSuffix')}</span>}
                            </span>,
                          )}
                        </div>

                        {hasGroup &&
                          !cumulCollapsed &&
                          [primary, ...members].map((sub) => {
                            const isMember = sub.employeeId !== primary.employeeId;
                            const group = isMember ? groupOfMember(primary.clientMissionId, sub.employeeId) : null;
                            return (
                              <div
                                key={sub.employeeId}
                                className="grid items-center gap-2 border-t border-slate-50 bg-slate-50/50 px-3 py-1 text-sm"
                                style={{ gridTemplateColumns }}
                              >
                                {renderRowCells(
                                  sub,
                                  false,
                                  <span className="flex items-center gap-1.5 truncate pl-11 text-xs text-slate-600">
                                    <span className="truncate">{employeeName(employeeById.get(sub.employeeId))}</span>
                                    {isMember && group && (
                                      <button
                                        type="button"
                                        onClick={() => deleteGroup(group.id)}
                                        className="shrink-0 text-[10px] font-medium text-slate-400 hover:text-red-600"
                                      >
                                        {t('timeEstimation.grid.ungroup')}
                                      </button>
                                    )}
                                  </span>,
                                )}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
              </div>
            );
          })}
      </div>
    </div>
  );
}
