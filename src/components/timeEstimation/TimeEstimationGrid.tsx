import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEmployees } from '../../hooks/useEmployees';
import { useAssignments } from '../../hooks/useAssignments';
import * as assignmentService from '../../services/assignmentService';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useTimeEstimation } from '../../hooks/useTimeEstimation';
import { averageOverRange, sumMetricRows } from '../../lib/timeEstimationMath';
import { TrendSparkline } from './TrendSparkline';
import { AddTimeEstimationRowModal } from './AddTimeEstimationRowModal';
import type { Assignment, ClientMission, Employee, RemunerationModel } from '../../types/domain';
import { useTimeEstimationHistoryStore } from '../../stores/timeEstimationHistoryStore';
import { withSuppressedRecording } from '../../stores/historyStore';

type GroupBy = 'client' | 'employee';

export interface LineItem {
  employeeId: string;
  clientMissionId: string;
  assignmentId: string | null;
  remunerationModel: RemunerationModel | null;
  vendu: number | null;
  prevu: number | null;
  n1Total: number | null;
  // "% sold N+1"/"% expected N+1" — same shared-column-plus-model-flag
  // mechanism as vendu/prevu above, but with its own independent
  // remunerationModelNextYear flag (0027) so an N+1 edit never touches N's
  // own remuneration_model. Stay null (not 0) until remunerationModelNextYear
  // is actually set, so a row with no forecast ever entered reads as blank.
  remunerationModelNextYear: RemunerationModel | null;
  venduNextYear: number | null;
  prevuNextYear: number | null;
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
  // True iff a time_manual_rows entry exists for this pair — the row was
  // added by hand via "+ Ajouter une ligne", not derived from an assignment
  // or an import. Drives the "Origine" column's badge only; nothing else
  // reads it (no separate boolean anywhere in the DB — existence of the
  // time_manual_rows row IS the flag, see 0029_time_manual_rows.sql).
  isManual: boolean;
}

function employeeName(employee: Employee | undefined): string {
  return employee ? `${employee.first_name} ${employee.last_name}` : '?';
}

// Rounded to the nearest whole percent — per user feedback, decimals aren't
// of interest here. Still routed through one function so every cell (grey
// disabled span, group-header aggregate, or an editable field's own
// resting/blurred display) rounds identically and stays column-aligned.
// A value that rounds to 0 displays the same as null (blank dash) — per
// user feedback, 0 and "nothing entered" are equivalent to them, and
// showing zeroes as blank makes the genuinely non-zero cells stand out.
// This is display-only: 0 and null stay distinct in the underlying data
// (e.g. vendu/prevu's mutual-exclusivity bucketing still needs a real 0 to
// tell "committed to this model, nothing entered" apart from "no
// assignment at all") — only how they're PRESENTED is unified here.
function fmt(value: number | null | undefined): string {
  if (value == null) return '—';
  const rounded = Math.round(value);
  return rounded === 0 ? '—' : `${rounded}%`;
}

// Same whole-percent rounding and zero-as-blank rule as fmt(), without the
// "%" — what a CascadeCell's <input> shows outside of an active edit, so a
// value carrying float noise (e.g. an average like 12.333333) doesn't
// visually stretch the column and break the row's alignment.
function roundedInputValue(value: number | null | undefined): string {
  if (value == null) return '';
  const rounded = Math.round(value);
  return rounded === 0 ? '' : String(rounded);
}

function lineItemMetrics(li: LineItem): Record<string, number | null> {
  const record: Record<string, number | null> = {
    vendu: li.vendu,
    prevu: li.prevu,
    n1Total: li.n1Total,
    venduNextYear: li.venduNextYear,
    prevuNextYear: li.prevuNextYear,
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
// the year total) — all editable, some visually grey. No confirmation
// prompt before committing an edit that overwrites imported/derived data —
// there used to be one, but the green highlight below now gives that same
// "this value came from a manual edit" signal visually, making a modal
// redundant. `disabled` is used on a "cumul" row (a drag-grouped aggregate
// across several employees), which has no single well-defined write target.
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
// - greenDirect / greenDerived: the exact cell the user typed a value into,
//   and every OTHER cell that changed as a mechanical side effect of that
//   one action (a recomputed average/total, or a month filled by an
//   average/total cascade) — greenDerived is the lighter of the two.
//   Persisted in time_manual_edit_markers (direct edits only; derived is
//   recomputed at render time from those — see editedTints below), cleared
//   automatically by ImportTimeActualsWizard whenever a re-import overwrites
//   the field it describes.
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

// Spreadsheet-style vertical navigation between cells of the SAME column —
// found geometrically (nearest input whose horizontal position matches, on
// the correct side of the current one) rather than via a 2D index threaded
// through props, since the grid's rows are dynamically grouped/collapsed/
// nested (cumul sub-rows) and a rigid row/col index would have to be kept
// in sync with all of that. Scoped to the grid's own scroll container via
// data-time-estimation-grid so this never reaches into an unrelated part of
// the page. Moving focus fires the current cell's blur naturally (same
// mechanism Tab already relies on for commit), so no explicit commit() call
// is needed here.
function moveFocusVertical(current: HTMLInputElement, direction: 1 | -1) {
  const container = current.closest('[data-time-estimation-grid]');
  if (!container) return;
  const currentRect = current.getBoundingClientRect();
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[data-cascade-input]'));
  const candidates = inputs
    .filter((el) => el !== current && Math.abs(el.getBoundingClientRect().left - currentRect.left) < 2)
    .filter((el) => {
      const top = el.getBoundingClientRect().top;
      return direction === 1 ? top > currentRect.top : top < currentRect.top;
    })
    .sort((a, b) => Math.abs(a.getBoundingClientRect().top - currentRect.top) - Math.abs(b.getBoundingClientRect().top - currentRect.top));
  candidates[0]?.focus();
}

function CascadeCell({
  value,
  tint,
  disabled,
  onCommit,
}: {
  value: number | null;
  tint?: CellTint;
  disabled?: boolean;
  onCommit: (value: number | null) => void | Promise<void>;
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
  // True once the user has actually typed into this field during the
  // CURRENT focus session (set in onChange, cleared on focus/blur/escape).
  // This is the one signal commit() and the prop-sync effect below trust —
  // not "is this field focused," which conflates two very different cases:
  // a field the user is actively mid-keystroke on (must not be clobbered by
  // an incoming value), and a field that's simply sitting there focused but
  // UNTOUCHED while its value changes for an unrelated reason — e.g. a
  // sibling vendu/prevu edit zeroing this one out from under a Tab-driven
  // pass-through. An earlier version tried to solve this by freezing a
  // "baseline" string at focus time and diffing against that, but the
  // freeze itself raced: a native focus event can fire before React's own
  // optimistic re-render has landed, so the frozen baseline could capture a
  // stale pre-update value — confirmed live via console instrumentation
  // (this exact case: %sold's edit fires, optimistic override sets the
  // sibling %expected to 0, but the native Tab's focus event reaches
  // %expected's onFocus BEFORE that render commits, freezing baseline at
  // the OLD "50" while the prop-sync effect still updates draft to "0" —
  // the resulting draft/baseline MISMATCH looked exactly like a real edit
  // and fired an unwanted write). Tracking actual keystrokes sidesteps the
  // whole timing question: an untouched field always mirrors the live
  // value regardless of when in the focus lifecycle it changes, and commit
  // only ever fires for a field the user is provably dirty on.
  const dirtyRef = useRef(false);

  // Keeps the field in sync with the underlying value (optimistic update,
  // realtime reconciliation, another cell's cascade fill) — EVEN WHILE
  // FOCUSED, as long as the user hasn't actually typed anything yet. Only
  // stops once dirty, so an in-progress edit is never clobbered out from
  // under the person typing it.
  useEffect(() => {
    if (!dirtyRef.current) {
      setDraft(roundedInputValue(value));
    }
  }, [value]);

  if (disabled) {
    return (
      <span className={`block rounded px-1 text-right text-xs tabular-nums text-slate-400 ${tint ? TINT_BG[tint] : ''}`}>{fmt(value)}</span>
    );
  }

  async function commit() {
    if (!dirtyRef.current) return; // never touched this session — nothing to commit
    const trimmed = draft.trim();
    dirtyRef.current = false;
    if (trimmed === '') {
      // Emptying the field is a real edit — commit null (clear) rather than
      // silently reverting to the previous value, which used to force the
      // user to type an explicit 0 to remove a figure.
      await onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(roundedInputValue(value));
      return;
    }
    // Reflect the just-committed value locally right away, rather than
    // waiting for the `value` prop to come back around through the write +
    // refetch. Needed because the prop-sync effect above only fires when
    // `value` actually CHANGES — committing 0 into a cell that was already
    // (numerically) 0 leaves the prop unchanged, so that effect never
    // re-runs and the input would otherwise keep showing the raw "0" the
    // user just typed until something unrelated forced a re-render (e.g. a
    // page reload) — reported live.
    setDraft(roundedInputValue(parsed));
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
        data-cascade-input
        placeholder="—"
        value={draft}
        onChange={(e) => {
          dirtyRef.current = true;
          setDraft(e.target.value);
        }}
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
            dirtyRef.current = false;
            setDraft(roundedInputValue(value));
            e.currentTarget.blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            moveFocusVertical(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
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

// Trailing "type a name to add a row" row at the bottom of each top-level
// group — generic over WHAT is being picked, since the two grouping modes
// need opposite halves of a pair: client-grouped sections already have a
// fixed client/mission and need to pick an employee; employee-grouped
// sections already have a fixed employee and need to pick a client/mission.
// Only existing catalog entries are offered — no create-on-the-fly here,
// unlike the header's "+ Ajouter une ligne" modal, which stays the only
// place to introduce a brand-new client/mission. `candidates` is
// pre-filtered by the caller to exclude whichever ones already have a
// visible row in that section, so a pick can never collide with one.
function QuickAddRow<T extends { id: string }>({
  candidates,
  matchesQuery,
  labelOf,
  onAdd,
  gridTemplateColumns,
  placeholder,
}: {
  candidates: T[];
  matchesQuery: (candidate: T, normalizedQuery: string) => boolean;
  labelOf: (candidate: T) => string;
  onAdd: (id: string) => Promise<void>;
  gridTemplateColumns: string;
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const matches = normalizedQuery === '' ? [] : candidates.filter((c) => matchesQuery(c, normalizedQuery)).slice(0, 8);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleSelect(id: string) {
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(id);
      setQuery('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid items-center gap-2 border-t border-dashed border-slate-200 px-3 py-1.5 text-sm" style={{ gridTemplateColumns }}>
      <div ref={containerRef} className="relative pl-5">
        <input
          type="text"
          value={query}
          disabled={submitting}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setError(null);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full rounded border border-dashed border-slate-300 bg-transparent px-1.5 py-0.5 text-xs text-slate-500 placeholder:text-slate-400 focus:border-solid focus:border-slate-400 focus:outline-none disabled:opacity-50"
        />
        {open && matches.length > 0 && (
          <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-auto rounded border border-slate-200 bg-white shadow-lg">
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleSelect(c.id)}
                className="block w-full truncate px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50"
              >
                {labelOf(c)}
              </button>
            ))}
          </div>
        )}
        {error && <p className="mt-0.5 text-[10px] text-red-600">{error}</p>}
      </div>
    </div>
  );
}

function employeeMatchesQuery(e: Employee, normalizedQuery: string): boolean {
  const first = e.first_name.toLowerCase();
  const last = e.last_name.toLowerCase();
  return first.startsWith(normalizedQuery) || last.startsWith(normalizedQuery) || `${first} ${last}`.startsWith(normalizedQuery);
}

function clientMissionMatchesQuery(cm: ClientMission, normalizedQuery: string): boolean {
  return cm.name.toLowerCase().startsWith(normalizedQuery);
}

// Small, discreet origin marker rendered right after a row's label — an
// "imported/default" glyph for every row, or a clickable "manually added"
// glyph (delete-with-confirm) when isManual. Replaces the old dedicated
// "Origine" column per user feedback: the badge column read as too heavy
// for something that's true of most rows' DEFAULT state, and having it
// right next to the name reads more naturally as "how did this row get
// here" than a whole extra column at the far right did. Deliberately
// icon-only with a native `title` tooltip (no on-screen text) — this
// mirrors the rest of the grid's minimal-chrome controls (CollapseBadge,
// the ungroup button) rather than introducing a new tooltip component.
function RowOriginIcon({ isManual, onRemove, t }: { isManual: boolean; onRemove?: () => void; t: (key: string) => string }) {
  if (isManual) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove?.();
        }}
        title={t('timeEstimation.grid.originManualTooltip')}
        className="shrink-0 text-slate-400 hover:text-red-600"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="8" cy="8" r="6.3" />
          <path d="M8 5v6M5 8h6" />
        </svg>
      </button>
    );
  }
  return (
    <span title={t('timeEstimation.grid.originImportedTooltip')} className="shrink-0 text-slate-300">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2v7.5M5 7l3 3 3-3M3 13h10" />
      </svg>
    </span>
  );
}

export function TimeEstimationGrid({ registryOrgChartId }: { registryOrgChartId: string }) {
  const { t, i18n } = useTranslation();
  const { employees } = useEmployees(registryOrgChartId);
  const {
    assignments,
    createAssignment,
    updateAssignmentVenduAndModel,
    updateAssignmentVenduAndModelNextYear,
    deleteAssignment,
    restoreAssignment,
  } = useAssignments(registryOrgChartId);
  const { clientsMissions, findOrCreate, restoreClientMission, deleteClientMission } = useClientsMissions();
  const {
    timeActuals,
    timeForecastMonths,
    timeActualN1Totals,
    timeManualEditMarkers,
    timeManualRows,
    loading: estimationLoading,
    forecastOf,
    manualRowOf,
    groupsByPrimary,
    groupOfMember,
    createGroup,
    deleteGroup,
    createManualRow,
    deleteManualRow,
    restoreManualRow,
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
  const [addRowOpen, setAddRowOpen] = useState(false);
  // Optimistic override for vendu/prevu (both years), keyed by
  // employeeId::clientMissionId — useAssignments.refresh() is a full,
  // org-wide table refetch (deliberate architecture, see CLAUDE.md). Even
  // after combining each edit's value+model write into one atomic update
  // (see assignmentService), a Tab-driven edit still races the resulting
  // Postgres change event's own realtime-triggered refresh() against our
  // own explicit one — two unordered network round trips for the same row.
  // A vendu/prevu edit's own handler already KNOWS the sibling field's new
  // value the instant it starts (mutual exclusivity always zeroes the
  // other), so it's set here immediately, applied over lineItems' own
  // computed values below.
  //
  // Clearing is generation-tracked and time-bounded, NOT value-comparison
  // based — an earlier version cleared an override the first time the raw
  // data happened to match it, which turned out unsafe: a LATER, still
  // in-flight stale response could land afterward and overwrite the now-
  // unprotected cell anyway (reported live as %sold reverting to 0 on its
  // own after tabbing through an untouched %expected). Each override write
  // bumps a generation counter for its (row, field-pair) key; the timeout
  // scheduled right after that write only actually clears if it's still the
  // most recent one for that key — so a newer edit on the same field pair
  // silently supersedes an older pending clear instead of racing it.
  const [venduPrevuOverrides, setVenduPrevuOverrides] = useState<
    Map<string, Partial<Pick<LineItem, 'vendu' | 'prevu' | 'venduNextYear' | 'prevuNextYear'>>>
  >(new Map());
  const overrideGenerationRef = useRef(new Map<string, number>());
  function overrideGroupKey(li: LineItem, fields: Array<'vendu' | 'prevu' | 'venduNextYear' | 'prevuNextYear'>) {
    return `${li.employeeId}::${li.clientMissionId}::${[...fields].sort().join(',')}`;
  }
  function setVenduPrevuOverride(li: LineItem, patch: Partial<Pick<LineItem, 'vendu' | 'prevu' | 'venduNextYear' | 'prevuNextYear'>>) {
    const rowKey = `${li.employeeId}::${li.clientMissionId}`;
    const groupKey = overrideGroupKey(li, Object.keys(patch) as Array<'vendu' | 'prevu' | 'venduNextYear' | 'prevuNextYear'>);
    const generation = (overrideGenerationRef.current.get(groupKey) ?? 0) + 1;
    overrideGenerationRef.current.set(groupKey, generation);
    setVenduPrevuOverrides((prev) => {
      const next = new Map(prev);
      next.set(rowKey, { ...next.get(rowKey), ...patch });
      return next;
    });
    return generation;
  }
  // Fires ~2s after a write settles — comfortably longer than a normal
  // Supabase round trip plus realtime propagation, short enough that a
  // genuinely different concurrent edit (another admin, another tab) still
  // shows up promptly.
  function scheduleOverrideClear(li: LineItem, fields: Array<'vendu' | 'prevu' | 'venduNextYear' | 'prevuNextYear'>, generation: number) {
    const rowKey = `${li.employeeId}::${li.clientMissionId}`;
    const groupKey = overrideGroupKey(li, fields);
    window.setTimeout(() => {
      if (overrideGenerationRef.current.get(groupKey) !== generation) return;
      setVenduPrevuOverrides((prev) => {
        const existing = prev.get(rowKey);
        if (!existing) return prev;
        const next = new Map(prev);
        const updated = { ...existing };
        fields.forEach((f) => delete updated[f]);
        if (Object.keys(updated).length === 0) next.delete(rowKey);
        else next.set(rowKey, updated);
        return next;
      });
    }, 2000);
  }

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

  // Pure, override-free line items — see the lineItems memo below for why
  // this is kept as a separate step.
  const baseLineItems = useMemo<Map<string, LineItem>>(() => {
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
          remunerationModelNextYear: null,
          venduNextYear: null,
          prevuNextYear: null,
          actualByMonth: new Array(12).fill(null),
          overrideByMonth: new Array(12).fill(null),
          effectiveByMonth: new Array(12).fill(null),
          total: 0,
          avgPast: 0,
          avgRemaining: 0,
          isManual: false,
        };
        map.set(key, li);
      }
      return li;
    };

    for (const a of assignments) {
      const li = getOrCreate(a.employee_id, a.client_mission_id);
      li.assignmentId = a.id;
      li.remunerationModel = a.remuneration_model;
      // Vendu/prévu are mutually exclusive by construction (one shared
      // column, one model flag) — once an assignment exists at all, the
      // side that doesn't apply shows an explicit 0% rather than a blank
      // dash, so the two read as "you're committed to one or the other,"
      // not "nothing entered yet" (which stays blank/dash for a row with
      // no assignment at all — see getOrCreate's own defaults).
      if (a.remuneration_model === 'commission') {
        li.prevu = a.etp_vendu;
        li.vendu = 0;
      } else {
        li.vendu = a.etp_vendu;
        li.prevu = 0;
      }
      // Same bucketing as vendu/prevu above, but only once
      // remuneration_model_next_year has actually been set by an edit — a
      // row that predates this feature (flag still null) stays blank rather
      // than showing 0/0 for a forecast nobody ever entered.
      if (a.remuneration_model_next_year != null) {
        li.remunerationModelNextYear = a.remuneration_model_next_year;
        if (a.remuneration_model_next_year === 'commission') {
          li.prevuNextYear = a.etp_vendu_next_year;
          li.venduNextYear = 0;
        } else {
          li.venduNextYear = a.etp_vendu_next_year;
          li.prevuNextYear = 0;
        }
      }
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

    // 5th source: a pairing added by hand via "+ Ajouter une ligne" but with
    // no assignment/actual/forecast data entered yet would otherwise never
    // surface a row at all — getOrCreate below is what makes it appear (with
    // every metric still at its default null/0) so the admin has somewhere
    // to type N-1/N/N+1 values into.
    for (const r of timeManualRows) {
      const li = getOrCreate(r.employee_id, r.client_mission_id);
      li.isManual = true;
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
  }, [assignments, timeActuals, timeForecastMonths, timeActualN1Totals, timeManualRows, lastMonth, year]);

  // Overlays the optimistic vendu/prevu override on top of baseLineItems.
  // The override itself clears on a generation-tracked timeout (see
  // scheduleOverrideClear above), not by watching for this overlay to
  // "agree" with the raw data — a value-comparison approach looked
  // appealing but is unsound here: a still in-flight, stale refresh can
  // land AFTER a correct-looking one and silently regress the row once
  // nothing is protecting it anymore.
  const lineItems = useMemo<Map<string, LineItem>>(() => {
    if (venduPrevuOverrides.size === 0) return baseLineItems;
    const map = new Map(baseLineItems);
    for (const [key, patch] of venduPrevuOverrides) {
      const li = map.get(key);
      if (li) map.set(key, { ...li, ...patch });
    }
    return map;
  }, [baseLineItems, venduPrevuOverrides]);

  // Every (employee, client/mission) pair already rendered as a row today —
  // the duplicate-pair guard AddTimeEstimationRowModal uses to refuse
  // re-adding a pairing that already has a visible row via any source.
  const existingPairKeys = useMemo(() => new Set(lineItems.keys()), [lineItems]);

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
  async function handleFill(li: LineItem, months: number[], value: number | null, label: string, sourceField: string) {
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
        value === null
          ? clearEditMarker(li.employeeId, li.clientMissionId, year, sourceField)
          : saveEditMarker(li.employeeId, li.clientMissionId, year, sourceField),
        ...staleDirectFields.map((f) => clearEditMarker(li.employeeId, li.clientMissionId, year, f)),
      ]);
    }
    async function undo() {
      await Promise.all([
        futureMonths.length > 0 ? restoreMonthOverrides(li.employeeId, li.clientMissionId, year, priorOverrideEntries, priorTotalPct) : null,
        pastMonths.length > 0 ? restoreManualActuals(li.employeeId, li.clientMissionId, year, pastMonths, priorActualRows, priorTotalPct) : null,
        hadPriorDirectMarker
          ? saveEditMarker(li.employeeId, li.clientMissionId, year, sourceField)
          : clearEditMarker(li.employeeId, li.clientMissionId, year, sourceField),
        ...staleDirectFields.map((f) => saveEditMarker(li.employeeId, li.clientMissionId, year, f)),
      ]);
    }

    await apply();
    useTimeEstimationHistoryStore.getState().push({ label, undo, redo: apply });
  }

  async function handleEditN1Total(li: LineItem, value: number | null) {
    const priorValue = li.n1Total;
    const hadPriorDirectMarker = timeManualEditMarkers.some(
      (m) => m.employee_id === li.employeeId && m.client_mission_id === li.clientMissionId && m.year === year && m.field === 'n1Total',
    );
    async function apply() {
      await Promise.all([
        value === null
          ? deleteN1Total(li.employeeId, li.clientMissionId, year - 1)
          : saveN1Total(li.employeeId, li.clientMissionId, year - 1, value),
        value === null
          ? clearEditMarker(li.employeeId, li.clientMissionId, year, 'n1Total')
          : saveEditMarker(li.employeeId, li.clientMissionId, year, 'n1Total'),
      ]);
    }
    async function undo() {
      await Promise.all([
        priorValue == null
          ? deleteN1Total(li.employeeId, li.clientMissionId, year - 1)
          : saveN1Total(li.employeeId, li.clientMissionId, year - 1, priorValue),
        hadPriorDirectMarker
          ? saveEditMarker(li.employeeId, li.clientMissionId, year, 'n1Total')
          : clearEditMarker(li.employeeId, li.clientMissionId, year, 'n1Total'),
      ]);
    }
    await apply();
    useTimeEstimationHistoryStore.getState().push({ label: t('timeEstimation.history.editN1Total'), undo, redo: apply });
  }

  // Serializes concurrent edits to the SAME (employee, client) assignment
  // row. Tab moves focus — and fires the next cell's blur-commit — before
  // the previous edit's async write+refresh has landed. Without this, a
  // second edit fired that fast would decide its own remuneration_model
  // flip from the SAME stale `li` snapshot the first edit started from (or
  // race it to CREATE the row in the first place), letting vendu and prevu
  // end up non-zero at once even though they're bucketed from one physical
  // column + one flag — reported live via Kevin Binoy showing both %sold
  // and %expected simultaneously. Keyed by employee+client (not
  // assignmentId), since it must also serialize the very first edit that
  // creates the row. The function passed in always re-reads the row fresh
  // from Supabase (fetchAssignmentByPair) rather than trusting the `li`
  // argument or component state, since by the time a queued edit actually
  // runs, React's own state may not have caught up with the previous edit's
  // write yet even though the write itself is done.
  const rowLocksRef = useRef(new Map<string, Promise<unknown>>());
  function withRowLock<T>(li: LineItem, fn: () => Promise<T>): Promise<T> {
    const key = `${li.employeeId}::${li.clientMissionId}`;
    const queued = (rowLocksRef.current.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
    rowLocksRef.current.set(key, queued.catch(() => undefined));
    return queued;
  }

  // "% vendu"/"% prévu" both read/write the same assignments.etp_vendu
  // column, bucketed into one column or the other by remuneration_model
  // (see CLAUDE.md) — editing whichever one is currently empty on a line
  // with no assignment yet creates one; editing an existing assignment's
  // already-populated column just updates its value in place. The value and
  // the model are written in ONE atomic call (updateAssignmentVenduAndModel)
  // rather than two sequential ones — see assignmentService's own comment
  // for why splitting them caused real problems, not just extra requests.
  //
  // Every call to updateAssignmentVenduAndModel/createAssignment/
  // deleteAssignment here is wrapped in the MAIN store's
  // withSuppressedRecording — those mutators (see useAssignments.ts)
  // self-push onto the org-chart/grid screen's own useHistoryStore
  // unconditionally, which would otherwise leak a Time Estimation edit into
  // the org chart's undo stack. This screen records its own Command onto
  // useTimeEstimationHistoryStore instead. Creating an assignment must
  // never be replayed via createAssignment again on redo — per CLAUDE.md's
  // identity-stable-undo convention, a fresh create would mint a new row id
  // — so redo uses restoreAssignment(created) instead, same as every other
  // create-then-undo path in this app.
  async function handleEditVendu(li: LineItem, value: number | null) {
    const label = t('timeEstimation.history.editVendu');
    const generation = setVenduPrevuOverride(li, { vendu: value, prevu: 0 });
    await withRowLock(li, async () => {
      const current = await assignmentService.fetchAssignmentByPair(registryOrgChartId, li.employeeId, li.clientMissionId);
      if (current) {
        const priorValue = current.etp_vendu;
        const priorModel = current.remuneration_model;
        const assignmentId = current.id;
        // Clearing (value === null) removes the figure without forcing a
        // model flip — a real value always means "Retainer," but an empty
        // cell doesn't mean anything about the model, so it's left as-is.
        const newModel = value === null ? priorModel : 'retainer';
        await withSuppressedRecording(() => updateAssignmentVenduAndModel(assignmentId, value, newModel));
        useTimeEstimationHistoryStore.getState().push({
          label,
          undo: () => withSuppressedRecording(() => updateAssignmentVenduAndModel(assignmentId, priorValue, priorModel)),
          redo: () => withSuppressedRecording(() => updateAssignmentVenduAndModel(assignmentId, value, newModel)),
        });
      } else if (value !== null) {
        const created = await withSuppressedRecording(() => createAssignment(li.employeeId, li.clientMissionId, value, null, 'retainer'));
        useTimeEstimationHistoryStore.getState().push({
          label,
          undo: () => withSuppressedRecording(() => deleteAssignment(created.id)),
          redo: () => restoreAssignment(created).then(() => {}),
        });
      }
      // else: clearing a cell with no assignment yet — nothing to do.
    });
    scheduleOverrideClear(li, ['vendu', 'prevu'], generation);
  }

  // A prévu value entered by hand always means the "Commission" model —
  // mirrors handleEditVendu exactly (just the other direction).
  async function handleEditPrevu(li: LineItem, value: number | null) {
    const label = t('timeEstimation.history.editPrevu');
    const generation = setVenduPrevuOverride(li, { prevu: value, vendu: 0 });
    await withRowLock(li, async () => {
      const current = await assignmentService.fetchAssignmentByPair(registryOrgChartId, li.employeeId, li.clientMissionId);
      if (current) {
        const priorValue = current.etp_vendu;
        const priorModel = current.remuneration_model;
        const assignmentId = current.id;
        const newModel = value === null ? priorModel : 'commission';
        await withSuppressedRecording(() => updateAssignmentVenduAndModel(assignmentId, value, newModel));
        useTimeEstimationHistoryStore.getState().push({
          label,
          undo: () => withSuppressedRecording(() => updateAssignmentVenduAndModel(assignmentId, priorValue, priorModel)),
          redo: () => withSuppressedRecording(() => updateAssignmentVenduAndModel(assignmentId, value, newModel)),
        });
      } else if (value !== null) {
        const created = await withSuppressedRecording(() =>
          createAssignment(li.employeeId, li.clientMissionId, value, null, 'commission'),
        );
        useTimeEstimationHistoryStore.getState().push({
          label,
          undo: () => withSuppressedRecording(() => deleteAssignment(created.id)),
          redo: () => restoreAssignment(created).then(() => {}),
        });
      }
    });
    scheduleOverrideClear(li, ['vendu', 'prevu'], generation);
  }

  // "% sold N+1"/"% expected N+1" — mirrors handleEditVendu/handleEditPrevu
  // exactly, one shared etp_vendu_next_year column bucketed by its own
  // remuneration_model_next_year flag (0027), kept independent of the
  // current year's own remuneration_model so an N+1 edit never retroactively
  // reclassifies N. Uses the SAME row lock as the current-year handlers
  // (keyed only by employee+client, not by which year's columns are being
  // touched) — simplest correct choice since all 4 handlers write the same
  // physical row and these are infrequent manual admin edits.
  async function handleEditVenduNextYear(li: LineItem, value: number | null) {
    const label = t('timeEstimation.history.editVenduNextYear');
    const generation = setVenduPrevuOverride(li, { venduNextYear: value, prevuNextYear: 0 });
    await withRowLock(li, async () => {
      const current = await assignmentService.fetchAssignmentByPair(registryOrgChartId, li.employeeId, li.clientMissionId);
      if (current) {
        const priorValue = current.etp_vendu_next_year;
        const priorModel = current.remuneration_model_next_year;
        const assignmentId = current.id;
        const newModel = value === null ? priorModel : 'retainer';
        await withSuppressedRecording(() => updateAssignmentVenduAndModelNextYear(assignmentId, value, newModel));
        useTimeEstimationHistoryStore.getState().push({
          label,
          undo: () => withSuppressedRecording(() => updateAssignmentVenduAndModelNextYear(assignmentId, priorValue, priorModel)),
          redo: () => withSuppressedRecording(() => updateAssignmentVenduAndModelNextYear(assignmentId, value, newModel)),
        });
      } else if (value !== null) {
        const created = await withSuppressedRecording(() => createAssignment(li.employeeId, li.clientMissionId, null, null, null));
        await withSuppressedRecording(() => updateAssignmentVenduAndModelNextYear(created.id, value, 'retainer'));
        const createdWithForecast: Assignment = { ...created, etp_vendu_next_year: value, remuneration_model_next_year: 'retainer' };
        useTimeEstimationHistoryStore.getState().push({
          label,
          undo: () => withSuppressedRecording(() => deleteAssignment(created.id)),
          redo: () => restoreAssignment(createdWithForecast).then(() => {}),
        });
      }
    });
    scheduleOverrideClear(li, ['venduNextYear', 'prevuNextYear'], generation);
  }

  async function handleEditPrevuNextYear(li: LineItem, value: number | null) {
    const label = t('timeEstimation.history.editPrevuNextYear');
    const generation = setVenduPrevuOverride(li, { prevuNextYear: value, venduNextYear: 0 });
    await withRowLock(li, async () => {
      const current = await assignmentService.fetchAssignmentByPair(registryOrgChartId, li.employeeId, li.clientMissionId);
      if (current) {
        const priorValue = current.etp_vendu_next_year;
        const priorModel = current.remuneration_model_next_year;
        const assignmentId = current.id;
        const newModel = value === null ? priorModel : 'commission';
        await withSuppressedRecording(() => updateAssignmentVenduAndModelNextYear(assignmentId, value, newModel));
        useTimeEstimationHistoryStore.getState().push({
          label,
          undo: () => withSuppressedRecording(() => updateAssignmentVenduAndModelNextYear(assignmentId, priorValue, priorModel)),
          redo: () => withSuppressedRecording(() => updateAssignmentVenduAndModelNextYear(assignmentId, value, newModel)),
        });
      } else if (value !== null) {
        const created = await withSuppressedRecording(() => createAssignment(li.employeeId, li.clientMissionId, null, null, null));
        await withSuppressedRecording(() => updateAssignmentVenduAndModelNextYear(created.id, value, 'commission'));
        const createdWithForecast: Assignment = { ...created, etp_vendu_next_year: value, remuneration_model_next_year: 'commission' };
        useTimeEstimationHistoryStore.getState().push({
          label,
          undo: () => withSuppressedRecording(() => deleteAssignment(created.id)),
          redo: () => restoreAssignment(createdWithForecast).then(() => {}),
        });
      }
    });
    scheduleOverrideClear(li, ['venduNextYear', 'prevuNextYear'], generation);
  }

  // Removes a manually-added pairing (time_manual_rows) — never touches
  // assignments/time_actuals/time_forecast_months/time_actual_n1_totals, so
  // any real data since entered on the row survives; the row then simply
  // stops showing the "Ajout manuel" badge (it's still a real row via
  // whichever OTHER source now has data for the pair) or disappears
  // entirely if nothing else does. Not wrapped in withSuppressedRecording —
  // useTimeEstimation.ts's mutators never self-push onto any history store,
  // unlike useAssignments.ts's.
  async function handleDeleteManualRow(li: LineItem) {
    const row = manualRowOf(li.employeeId, li.clientMissionId);
    if (!row) return;
    if (!window.confirm(t('timeEstimation.grid.manualRowDeleteConfirm'))) return;
    await deleteManualRow(row.id);
    useTimeEstimationHistoryStore.getState().push({
      label: t('timeEstimation.history.deleteManualRow'),
      undo: () => restoreManualRow(row).then(() => {}),
      redo: () => deleteManualRow(row.id),
    });
  }

  // Creates a manual row for (employeeId, clientMissionId) straight from
  // QuickAddRow's trailing "type a name" row at the bottom of a group —
  // one half of the pair is already fixed by the section (the
  // client/mission in 'client' mode, the employee in 'employee' mode), so
  // unlike handleAdd in AddTimeEstimationRowModal there's no client/mission
  // picker/findOrCreate involved, hence no withSuppressedRecording wrapper
  // is needed here either (createManualRow/restoreManualRow/deleteManualRow
  // don't self-push, see useTimeEstimation.ts).
  async function handleQuickAddRow(employeeId: string, clientMissionId: string) {
    const created = await createManualRow(employeeId, clientMissionId);
    useTimeEstimationHistoryStore.getState().push({
      label: t('timeEstimation.history.addManualRow'),
      undo: () => deleteManualRow(created.id),
      redo: () => restoreManualRow(created).then(() => {}),
    });
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
    `64px 64px 100px`;

  const loading = estimationLoading;

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
          onCommit={(v) =>
            handleFill(li, Array.from({ length: 12 }, (_, i) => i + 1), v, t('timeEstimation.history.editTotal'), 'total')
          }
        />
        <CascadeCell
          value={lastMonth > 0 ? li.avgPast : null}
          tint={editedTint(li, 'avgPast') ?? 'grey'}
          disabled={cumulDisabled || lastMonth === 0}
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
        <CascadeCell
          value={li.venduNextYear}
          tint="pink"
          disabled={cumulDisabled}
          onCommit={(v) => handleEditVenduNextYear(li, v)}
        />
        <CascadeCell
          value={li.prevuNextYear}
          tint="pink"
          disabled={cumulDisabled}
          onCommit={(v) => handleEditPrevuNextYear(li, v)}
        />
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
            type="button"
            onClick={() => setAddRowOpen(true)}
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
          >
            {t('timeEstimation.grid.addRowButton')}
          </button>
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

      <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200" data-time-estimation-grid>
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
          <span className="rounded bg-rose-50 px-1 text-right text-rose-700">{t('timeEstimation.grid.venduNextYear')}</span>
          <span className="rounded bg-rose-50 px-1 text-right text-rose-700">{t('timeEstimation.grid.prevuNextYear')}</span>
          <span className="text-right">{t('timeEstimation.grid.trend')}</span>
        </div>

        {loading && <p className="p-3 text-sm text-slate-400">{t('timeEstimation.grid.loading')}</p>}
        {!loading && topGroups.length === 0 && <p className="p-3 text-sm text-slate-400">{t('timeEstimation.grid.empty')}</p>}

        {!loading &&
          topGroups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.key);
            const groupAgg = sumMetricRows(group.rows.flatMap((r) => [r.primary, ...r.members].map(lineItemMetrics)));
            // Feeds QuickAddRow's candidate exclusion below, one set per
            // grouping mode (only the relevant one is ever used per render).
            // 'client' mode: group.key IS the clientMissionId — every
            // employee already showing a row (primary or cumul-grouped
            // member) in this section. 'employee' mode: group.key IS the
            // employeeId, and members is always empty (see topGroups above),
            // so just every client/mission already shown for this employee.
            const presentEmployeeIds = new Set(group.rows.flatMap((r) => [r.primary.employeeId, ...r.members.map((m) => m.employeeId)]));
            const presentClientMissionIds = new Set(group.rows.map((r) => r.primary.clientMissionId));
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
                  <span className="text-right text-xs tabular-nums text-white">{fmt(groupAgg.venduNextYear)}</span>
                  <span className="text-right text-xs tabular-nums text-white">{fmt(groupAgg.prevuNextYear)}</span>
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
                            venduNextYear: cumulMetrics.venduNextYear,
                            prevuNextYear: cumulMetrics.prevuNextYear,
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
                              {/* Skipped on a cumul (drag-grouped) aggregate row — it mixes
                                  several employees' own rows, so a single icon here would
                                  misrepresent them; each member's own row below carries its
                                  own accurate icon instead. */}
                              {!hasGroup && (
                                <RowOriginIcon isManual={primary.isManual} onRemove={() => handleDeleteManualRow(primary)} t={t} />
                              )}
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
                                    <RowOriginIcon isManual={sub.isManual} onRemove={() => handleDeleteManualRow(sub)} t={t} />
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

                {!isCollapsed && groupBy === 'client' && (
                  <QuickAddRow
                    candidates={employees.filter((e) => !presentEmployeeIds.has(e.id))}
                    matchesQuery={employeeMatchesQuery}
                    labelOf={(e) => `${e.first_name} ${e.last_name}`}
                    onAdd={(employeeId) => handleQuickAddRow(employeeId, group.key)}
                    gridTemplateColumns={gridTemplateColumns}
                    placeholder={t('timeEstimation.grid.quickAddPlaceholder')}
                  />
                )}
                {!isCollapsed && groupBy === 'employee' && (
                  <QuickAddRow
                    candidates={clientsMissions.filter((cm) => !presentClientMissionIds.has(cm.id))}
                    matchesQuery={clientMissionMatchesQuery}
                    labelOf={(cm) => cm.name}
                    onAdd={(clientMissionId) => handleQuickAddRow(group.key, clientMissionId)}
                    gridTemplateColumns={gridTemplateColumns}
                    placeholder={t('timeEstimation.grid.quickAddClientMissionPlaceholder')}
                  />
                )}
              </div>
            );
          })}
      </div>

      {addRowOpen && (
        <AddTimeEstimationRowModal
          employees={employees}
          clientsMissions={clientsMissions}
          existingPairKeys={existingPairKeys}
          findOrCreate={findOrCreate}
          createManualRow={createManualRow}
          deleteManualRow={deleteManualRow}
          restoreManualRow={restoreManualRow}
          deleteClientMission={deleteClientMission}
          restoreClientMission={restoreClientMission}
          onClose={() => setAddRowOpen(false)}
        />
      )}
    </div>
  );
}
