import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as timeEstimationService from '../services/timeEstimationService';
import type {
  TimeActual,
  TimeActualGroup,
  TimeActualN1Total,
  TimeClientAlias,
  TimeEmployeeAlias,
  TimeForecast,
  TimeForecastMonth,
  TimeImportBatch,
  TimeManualEditMarker,
  TimeManualRow,
  TimeRowComment,
} from '../types/domain';

// What purgeManualDataForPair deleted (and restorePairData can put back) —
// see purgeManualDataForPair's own comment for why each field is scoped
// the way it is.
export interface PairDataSnapshot {
  actuals: TimeActual[];
  forecastMonths: TimeForecastMonth[];
  forecasts: TimeForecast[];
  n1Totals: TimeActualN1Total[];
  editMarkers: TimeManualEditMarker[];
}

// Data + mutations for the "Estimation des temps" module — deliberately
// thin, like useAssignments.ts: loads the module's tables in full (admin-only,
// a few hundred rows at most) and lets TimeEstimationGrid build the
// grouped/nested row structure itself, the same split AllocationsView keeps
// between its data hooks and its own groupBy logic. Not chart-relative
// (see useUserRoles.ts's identical reasoning). Mutations here never push to
// any history store themselves — TimeEstimationGrid.tsx owns recording
// Commands onto useTimeEstimationHistoryStore (its own independent history,
// separate from the org-chart/grid screen's useHistoryStore) after calling
// these, since it's the one holding the pre-edit snapshot a Command's undo
// body needs. Drag-to-group and the import wizard's alias resolution stay
// outside any undo history — deliberately out of scope.
export function useTimeEstimation() {
  const [timeActuals, setTimeActuals] = useState<TimeActual[]>([]);
  const [timeForecasts, setTimeForecasts] = useState<TimeForecast[]>([]);
  const [timeForecastMonths, setTimeForecastMonths] = useState<TimeForecastMonth[]>([]);
  const [timeActualN1Totals, setTimeActualN1Totals] = useState<TimeActualN1Total[]>([]);
  const [timeActualGroups, setTimeActualGroups] = useState<TimeActualGroup[]>([]);
  const [timeImportBatches, setTimeImportBatches] = useState<TimeImportBatch[]>([]);
  const [employeeAliases, setEmployeeAliases] = useState<TimeEmployeeAlias[]>([]);
  const [clientAliases, setClientAliases] = useState<TimeClientAlias[]>([]);
  const [timeManualEditMarkers, setTimeManualEditMarkers] = useState<TimeManualEditMarker[]>([]);
  const [timeManualRows, setTimeManualRows] = useState<TimeManualRow[]>([]);
  const [timeRowComments, setTimeRowComments] = useState<TimeRowComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stale-response guard — see useEmployees.ts for the full why. Short
  // version: every mutation below both awaits its own explicit refresh()
  // AND fires the realtime subscription's own refresh() (its writes hit
  // tables this hook is subscribed to), so any single edit can have 2-3
  // refresh() calls in flight at once; without this guard, whichever
  // response happens to resolve LAST wins even if it was the one that
  // started first (and so carries pre-edit data) — this is what made
  // committed edits look "erratic": the optimistic value would flash
  // correctly, then get clobbered by a late, stale fetch a moment later.
  const latestRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++latestRequestRef.current;
    try {
      const [actuals, forecasts, forecastMonths, n1Totals, groups, batches, empAliases, cliAliases, editMarkers, manualRows, comments] =
        await Promise.all([
          timeEstimationService.fetchTimeActuals(),
          timeEstimationService.fetchTimeForecasts(),
          timeEstimationService.fetchTimeForecastMonths(),
          timeEstimationService.fetchTimeActualN1Totals(),
          timeEstimationService.fetchTimeActualGroups(),
          timeEstimationService.fetchTimeImportBatches(),
          timeEstimationService.fetchTimeEmployeeAliases(),
          timeEstimationService.fetchTimeClientAliases(),
          timeEstimationService.fetchTimeManualEditMarkers(),
          timeEstimationService.fetchTimeManualRows(),
          timeEstimationService.fetchTimeRowComments(),
        ]);
      if (requestId !== latestRequestRef.current) return;
      setTimeActuals(actuals);
      setTimeForecasts(forecasts);
      setTimeForecastMonths(forecastMonths);
      setTimeActualN1Totals(n1Totals);
      setTimeActualGroups(groups);
      setTimeImportBatches(batches);
      setEmployeeAliases(empAliases);
      setClientAliases(cliAliases);
      setTimeManualEditMarkers(editMarkers);
      setTimeManualRows(manualRows);
      setTimeRowComments(comments);
      setError(null);
    } catch (err) {
      if (requestId !== latestRequestRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestId === latestRequestRef.current) setLoading(false);
    }
  }, []);

  // Debounced, unlike every other hook's realtime handler in this app —
  // deliberately, because this is the one place a single user action can
  // change thousands of rows at once (ImportTimeActualsWizard's bulk
  // upserts). Postgres's logical replication fires one postgres_changes
  // event PER CHANGED ROW, not per statement, so an import writing a few
  // thousand rows was firing a few thousand *unconditional* refresh() calls
  // — each its own 8-query Promise.all — which is what actually made the
  // "Importing…" phase look hung: the writes themselves finished quickly,
  // but the browser was left grinding through a self-inflicted queue of
  // redundant refetches for minutes afterward. Coalescing a burst of events
  // into one refresh after a short quiet window fixes that without changing
  // correctness — every mutator below still calls refresh() directly and
  // immediately after its own write, same as before; only the realtime-
  // triggered path is debounced.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedRefresh = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      refresh();
    }, 500);
  }, [refresh]);

  useEffect(() => {
    refresh();

    const channel = supabase
      .channel(`time-estimation-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_actuals' }, () => debouncedRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_forecasts' }, () => debouncedRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_forecast_months' }, () => debouncedRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_actual_n1_totals' }, () => debouncedRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_actual_groups' }, () => debouncedRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_import_batches' }, () => debouncedRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_manual_edit_markers' }, () => debouncedRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_manual_rows' }, () => debouncedRefresh())
      .subscribe();

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [refresh, debouncedRefresh]);

  const actualsOf = useCallback(
    (employeeId: string, clientMissionId: string, year: number) =>
      timeActuals.filter(
        (a) => a.resolved_employee_id === employeeId && a.resolved_client_mission_id === clientMissionId && a.year === year,
      ),
    [timeActuals],
  );

  const forecastOf = useCallback(
    (employeeId: string, clientMissionId: string, year: number) =>
      timeForecasts.find((f) => f.employee_id === employeeId && f.client_mission_id === clientMissionId && f.year === year) ??
      null,
    [timeForecasts],
  );

  const groupsByPrimary = useCallback(
    (clientMissionId: string, primaryEmployeeId: string) =>
      timeActualGroups.filter((g) => g.client_mission_id === clientMissionId && g.primary_employee_id === primaryEmployeeId),
    [timeActualGroups],
  );

  const groupOfMember = useCallback(
    (clientMissionId: string, memberEmployeeId: string) =>
      timeActualGroups.find((g) => g.client_mission_id === clientMissionId && g.member_employee_id === memberEmployeeId) ?? null,
    [timeActualGroups],
  );

  const n1TotalOf = useCallback(
    (employeeId: string, clientMissionId: string, year: number) =>
      timeActualN1Totals.find((t) => t.employee_id === employeeId && t.client_mission_id === clientMissionId && t.year === year)
        ?.total_pct ?? null,
    [timeActualN1Totals],
  );

  const manualRowOf = useCallback(
    (employeeId: string, clientMissionId: string) =>
      timeManualRows.find((r) => r.employee_id === employeeId && r.client_mission_id === clientMissionId) ?? null,
    [timeManualRows],
  );

  const commentOf = useCallback(
    (employeeId: string, clientMissionId: string) =>
      timeRowComments.find((c) => c.employee_id === employeeId && c.client_mission_id === clientMissionId) ?? null,
    [timeRowComments],
  );

  const monthOverridesOf = useCallback(
    (employeeId: string, clientMissionId: string, year: number) =>
      timeForecastMonths.filter((m) => m.employee_id === employeeId && m.client_mission_id === clientMissionId && m.year === year),
    [timeForecastMonths],
  );

  // Shared primitive behind every cell in the grid's 3-level cascade (a
  // single month, "moyenne mois passés", "moyenne mois restants", or "%
  // total actual N" — see CLAUDE.md), used both for the forward edit
  // (saveMonthOverrides, below — every entry's pct/totalPct is always a
  // number) and for undoing one (restoreMonthOverrides, below — a null
  // pct/totalPct means DELETE that row rather than upsert a value, since a
  // month/year that had no override before the edit being undone must go
  // back to having none — deferring to the imported actual — not a copy of
  // whatever the actual happened to equal at edit time).
  //
  // Updates local state optimistically before the writes resolve — the
  // previous sequential-awaited-upserts-then-refresh() shape read as a
  // visible lag on every edit (reported live). The writes still happen
  // (parallelized via Promise.all) and refresh() still runs after, so the
  // realtime subscription's own reconciliation is unaffected — this only
  // changes how soon the UI reflects what was just typed.
  const applyMonthOverrides = useCallback(
    async (
      employeeId: string,
      clientMissionId: string,
      year: number,
      entries: Array<{ month: number; pct: number | null }>,
      totalPct: number | null,
    ) => {
      const now = new Date().toISOString();
      setTimeForecastMonths((prev) => {
        let next = prev;
        for (const { month, pct } of entries) {
          const idx = next.findIndex(
            (m) => m.employee_id === employeeId && m.client_mission_id === clientMissionId && m.year === year && m.month === month,
          );
          if (pct == null) {
            if (idx >= 0) next = next.filter((_, i) => i !== idx);
          } else if (idx >= 0) {
            next = next.map((m, i) => (i === idx ? { ...m, pct, updated_at: now } : m));
          } else {
            next = [
              ...next,
              {
                id: `optimistic-${employeeId}-${clientMissionId}-${year}-${month}`,
                employee_id: employeeId,
                client_mission_id: clientMissionId,
                year,
                month,
                pct,
                created_at: now,
                updated_at: now,
              },
            ];
          }
        }
        return next;
      });
      setTimeForecasts((prev) => {
        const idx = prev.findIndex((f) => f.employee_id === employeeId && f.client_mission_id === clientMissionId && f.year === year);
        if (totalPct == null) return idx >= 0 ? prev.filter((_, i) => i !== idx) : prev;
        if (idx >= 0) return prev.map((f, i) => (i === idx ? { ...f, total_pct: totalPct, updated_at: now } : f));
        return [
          ...prev,
          {
            id: `optimistic-${employeeId}-${clientMissionId}-${year}`,
            employee_id: employeeId,
            client_mission_id: clientMissionId,
            year,
            total_pct: totalPct,
            created_at: now,
            updated_at: now,
          },
        ];
      });

      const toUpsert = entries.filter(
        (e): e is { month: number; pct: number } => e.pct != null,
      ).map((e) => ({ employee_id: employeeId, client_mission_id: clientMissionId, year, month: e.month, pct: e.pct }));
      const toDeleteMonths = entries.filter((e) => e.pct == null).map((e) => e.month);

      await Promise.all([
        timeEstimationService.upsertTimeForecastMonths(toUpsert),
        timeEstimationService.deleteTimeForecastMonths(employeeId, clientMissionId, year, toDeleteMonths),
        totalPct == null
          ? timeEstimationService.deleteTimeForecast(employeeId, clientMissionId, year)
          : timeEstimationService.upsertTimeForecast(employeeId, clientMissionId, year, totalPct),
      ]);
      await refresh();
    },
    [refresh],
  );

  const saveMonthOverrides = useCallback(
    async (employeeId: string, clientMissionId: string, year: number, months: number[], value: number | null, totalPct: number) => {
      await applyMonthOverrides(
        employeeId,
        clientMissionId,
        year,
        months.map((month) => ({ month, pct: value })),
        totalPct,
      );
    },
    [applyMonthOverrides],
  );

  // Undo body for a month-cascade edit — replays each affected month's
  // exact prior state (an override value, or null meaning no override
  // existed) plus the prior time_forecasts.total_pct (or null if no row
  // existed). The caller (TimeEstimationGrid.tsx) captures all of this
  // before the forward edit runs.
  const restoreMonthOverrides = useCallback(
    async (
      employeeId: string,
      clientMissionId: string,
      year: number,
      entries: Array<{ month: number; pct: number | null }>,
      totalPct: number | null,
    ) => {
      await applyMonthOverrides(employeeId, clientMissionId, year, entries, totalPct);
    },
    [applyMonthOverrides],
  );

  // Manual edit of a PAST month — writes straight into time_actuals instead
  // of time_forecast_months. No separate "surcharge" table/priority for past
  // months anymore (see CLAUDE.md): a re-import always wins outright, and a
  // hand correction here is just as authoritative as an import until the
  // next one. Unlike applyMonthOverrides above, forward and undo are NOT
  // the same function: the forward edit always collapses a month down to
  // exactly one fresh row — time_actuals sums every matching row by design
  // (several raw import names can resolve to the same employee), which is
  // exactly wrong for "set this month to X" — while undo must restore
  // whatever the exact prior row(s) were (zero, one, or several) under
  // their original ids, which the forward edit has no way to reconstruct.
  const saveManualActuals = useCallback(
    async (
      employeeId: string,
      clientMissionId: string,
      year: number,
      months: number[],
      value: number | null,
      totalPct: number,
      employeeDisplayName: string,
      clientDisplayName: string,
    ) => {
      const now = new Date().toISOString();
      setTimeActuals((prev) => [
        ...prev.filter(
          (a) =>
            !(
              a.resolved_employee_id === employeeId &&
              a.resolved_client_mission_id === clientMissionId &&
              a.year === year &&
              months.includes(a.month)
            ),
        ),
        ...(value == null
          ? []
          : months.map((month) => ({
              id: `optimistic-${employeeId}-${clientMissionId}-${year}-${month}`,
              batch_id: null,
              year,
              month,
              raw_employee_name: employeeDisplayName,
              raw_client_name: clientDisplayName,
              raw_sous_dossier: null,
              raw_group_annonceur: null,
              raw_payroll_name: null,
              raw_bu_name: null,
              etp_pct: value,
              resolved_employee_id: employeeId,
              resolved_client_mission_id: clientMissionId,
              created_at: now,
              updated_at: now,
            }))),
      ]);
      setTimeForecasts((prev) => {
        const idx = prev.findIndex((f) => f.employee_id === employeeId && f.client_mission_id === clientMissionId && f.year === year);
        if (idx >= 0) return prev.map((f, i) => (i === idx ? { ...f, total_pct: totalPct, updated_at: now } : f));
        return [
          ...prev,
          {
            id: `optimistic-${employeeId}-${clientMissionId}-${year}`,
            employee_id: employeeId,
            client_mission_id: clientMissionId,
            year,
            total_pct: totalPct,
            created_at: now,
            updated_at: now,
          },
        ];
      });

      // Clearing a past month (value === null) deletes the underlying row(s)
      // and leaves nothing behind — same "a manual edit is just as
      // authoritative as an import until the next one" rule already applies
      // to a real value (this function always collapses the month down to
      // exactly one fresh row, replacing whatever was imported); clearing is
      // the same replacement, just with zero rows instead of one.
      await timeEstimationService.deleteTimeActualsForMonths(employeeId, clientMissionId, year, months);
      if (value != null) {
        await timeEstimationService.insertManualTimeActuals(
          months.map((month) => ({
            employee_id: employeeId,
            client_mission_id: clientMissionId,
            year,
            month,
            pct: value,
            employee_name: employeeDisplayName,
            client_name: clientDisplayName,
          })),
        );
      }
      await timeEstimationService.upsertTimeForecast(employeeId, clientMissionId, year, totalPct);
      await refresh();
    },
    [refresh],
  );

  // Undo body for saveManualActuals — the caller (TimeEstimationGrid.tsx)
  // must have captured `priorRows` (via fetchTimeActualsForMonths) BEFORE
  // the forward edit ran, since this function's own delete-then-restore
  // can't reconstruct what was there beforehand.
  const restoreManualActuals = useCallback(
    async (
      employeeId: string,
      clientMissionId: string,
      year: number,
      months: number[],
      priorRows: TimeActual[],
      priorTotalPct: number | null,
    ) => {
      setTimeActuals((prev) => [
        ...prev.filter(
          (a) =>
            !(
              a.resolved_employee_id === employeeId &&
              a.resolved_client_mission_id === clientMissionId &&
              a.year === year &&
              months.includes(a.month)
            ),
        ),
        ...priorRows,
      ]);
      const now = new Date().toISOString();
      setTimeForecasts((prev) => {
        const idx = prev.findIndex((f) => f.employee_id === employeeId && f.client_mission_id === clientMissionId && f.year === year);
        if (priorTotalPct == null) return idx >= 0 ? prev.filter((_, i) => i !== idx) : prev;
        if (idx >= 0) return prev.map((f, i) => (i === idx ? { ...f, total_pct: priorTotalPct, updated_at: now } : f));
        return [
          ...prev,
          {
            id: `optimistic-${employeeId}-${clientMissionId}-${year}`,
            employee_id: employeeId,
            client_mission_id: clientMissionId,
            year,
            total_pct: priorTotalPct,
            created_at: now,
            updated_at: now,
          },
        ];
      });

      await timeEstimationService.deleteTimeActualsForMonths(employeeId, clientMissionId, year, months);
      await timeEstimationService.restoreTimeActuals(priorRows);
      if (priorTotalPct == null) await timeEstimationService.deleteTimeForecast(employeeId, clientMissionId, year);
      else await timeEstimationService.upsertTimeForecast(employeeId, clientMissionId, year, priorTotalPct);
      await refresh();
    },
    [refresh],
  );

  // Direct single-value edit for "Total N-1" — unlike the monthly cascade
  // above, this figure has no covered range to fan out into: it's the
  // source-of-truth import value itself, so a click-to-edit just overwrites
  // it. Same optimistic-then-write shape as saveMonthOverrides so the cell
  // updates immediately.
  const saveN1Total = useCallback(
    async (employeeId: string, clientMissionId: string, year: number, value: number) => {
      const now = new Date().toISOString();
      setTimeActualN1Totals((prev) => {
        const idx = prev.findIndex((n) => n.employee_id === employeeId && n.client_mission_id === clientMissionId && n.year === year);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], total_pct: value, updated_at: now };
          return next;
        }
        return [
          ...prev,
          {
            id: `optimistic-${employeeId}-${clientMissionId}-${year}`,
            employee_id: employeeId,
            client_mission_id: clientMissionId,
            year,
            total_pct: value,
            created_at: now,
            updated_at: now,
          },
        ];
      });
      await timeEstimationService.upsertTimeActualN1Totals([{ employee_id: employeeId, client_mission_id: clientMissionId, year, total_pct: value }]);
      await refresh();
    },
    [refresh],
  );

  // Undo body for a "Total N-1" edit that CREATED the row (no prior value
  // existed) — removes it entirely rather than upserting a stand-in.
  const deleteN1Total = useCallback(
    async (employeeId: string, clientMissionId: string, year: number) => {
      setTimeActualN1Totals((prev) =>
        prev.filter((n) => !(n.employee_id === employeeId && n.client_mission_id === clientMissionId && n.year === year)),
      );
      await timeEstimationService.deleteTimeActualN1Total(employeeId, clientMissionId, year);
      await refresh();
    },
    [refresh],
  );

  // Records that `field` (n1Total | total | avgPast | avgRemaining | m0..m11)
  // was the exact cell directly edited for (employeeId, clientMissionId,
  // year) — see the migration's own comment for why only direct edits are
  // persisted, never derived ones. Idempotent (upsert on the table's own
  // unique constraint), so calling it again for an already-marked field is
  // a safe no-op.
  const saveEditMarker = useCallback(
    async (employeeId: string, clientMissionId: string, year: number, field: string) => {
      const now = new Date().toISOString();
      setTimeManualEditMarkers((prev) => {
        if (prev.some((m) => m.employee_id === employeeId && m.client_mission_id === clientMissionId && m.year === year && m.field === field)) {
          return prev;
        }
        return [
          ...prev,
          { id: `optimistic-${employeeId}-${clientMissionId}-${year}-${field}`, employee_id: employeeId, client_mission_id: clientMissionId, year, field, edited_at: now },
        ];
      });
      await timeEstimationService.upsertTimeManualEditMarker(employeeId, clientMissionId, year, field);
      await refresh();
    },
    [refresh],
  );

  const clearEditMarker = useCallback(
    async (employeeId: string, clientMissionId: string, year: number, field: string) => {
      setTimeManualEditMarkers((prev) =>
        prev.filter((m) => !(m.employee_id === employeeId && m.client_mission_id === clientMissionId && m.year === year && m.field === field)),
      );
      await timeEstimationService.deleteTimeManualEditMarker(employeeId, clientMissionId, year, field);
      await refresh();
    },
    [refresh],
  );

  const createGroup = useCallback(
    async (clientMissionId: string, primaryEmployeeId: string, memberEmployeeId: string) => {
      await timeEstimationService.createTimeActualGroup(clientMissionId, primaryEmployeeId, memberEmployeeId);
      await refresh();
    },
    [refresh],
  );

  const deleteGroup = useCallback(
    async (id: string) => {
      await timeEstimationService.deleteTimeActualGroup(id);
      await refresh();
    },
    [refresh],
  );

  // Marks (employeeId, clientMissionId) as added by hand from the grid's
  // "+ Ajouter une ligne" action — see 0029_time_manual_rows.sql. Not
  // self-recording, same convention as every other mutator here:
  // TimeEstimationGrid.tsx captures the created row and pushes its own
  // undo/redo Command onto useTimeEstimationHistoryStore.
  const createManualRow = useCallback(
    async (employeeId: string, clientMissionId: string) => {
      const created = await timeEstimationService.createTimeManualRow(employeeId, clientMissionId);
      await refresh();
      return created;
    },
    [refresh],
  );

  const deleteManualRow = useCallback(
    async (id: string) => {
      await timeEstimationService.deleteTimeManualRow(id);
      await refresh();
    },
    [refresh],
  );

  // Undo body for deleteManualRow — re-inserts the exact captured row under
  // its original id (identity-stable-undo convention, see restoreAssignment/
  // restoreTimeActuals).
  const restoreManualRow = useCallback(
    async (row: TimeManualRow) => {
      const restored = await timeEstimationService.restoreTimeManualRow(row);
      await refresh();
      return restored;
    },
    [refresh],
  );

  // Creates or overwrites the row's comment (the unique constraint on
  // time_row_comments makes this a true upsert) — optimistic-then-write,
  // same shape as saveEditMarker below. TimeEstimationGrid.tsx captures the
  // prior comment itself and pushes its own undo/redo Command.
  const saveComment = useCallback(
    async (employeeId: string, clientMissionId: string, commentText: string) => {
      const now = new Date().toISOString();
      setTimeRowComments((prev) => {
        const idx = prev.findIndex((c) => c.employee_id === employeeId && c.client_mission_id === clientMissionId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], comment_text: commentText, updated_at: now };
          return next;
        }
        return [
          ...prev,
          {
            id: `optimistic-${employeeId}-${clientMissionId}`,
            employee_id: employeeId,
            client_mission_id: clientMissionId,
            comment_text: commentText,
            created_at: now,
            updated_at: now,
            created_by: null,
          },
        ];
      });
      const saved = await timeEstimationService.upsertTimeRowComment(employeeId, clientMissionId, commentText);
      await refresh();
      return saved;
    },
    [refresh],
  );

  const deleteComment = useCallback(
    async (employeeId: string, clientMissionId: string) => {
      setTimeRowComments((prev) => prev.filter((c) => !(c.employee_id === employeeId && c.client_mission_id === clientMissionId)));
      await timeEstimationService.deleteTimeRowComment(employeeId, clientMissionId);
      await refresh();
    },
    [refresh],
  );

  // Undo body for deleteComment — re-inserts the exact captured row under
  // its original id, same identity-stable-undo convention as restoreManualRow.
  const restoreComment = useCallback(
    async (comment: TimeRowComment) => {
      const restored = await timeEstimationService.restoreTimeRowComment(comment);
      await refresh();
      return restored;
    },
    [refresh],
  );

  // Deletes ONLY the manually-entered data for (employeeId, clientMissionId)
  // — an import must never lose data to this action (per user feedback: the
  // grid's "×" on a manually-added row originally purged everything for the
  // pair, which turned out to be wrong once real import data could also
  // land on a pair that started out manually added). Provenance is
  // determined per table, using the most precise signal each one actually
  // has:
  // - time_actuals: batch_id IS NULL is the table's own exact manual/
  //   import flag (deleteManualTimeActualsForPair) — an import always tags
  //   batch_id, a hand-typed row never does.
  // - time_actual_n1_totals / time_forecasts (the annual total_pct) /
  //   time_forecast_months have no such column, so this reuses
  //   time_manual_edit_markers instead: ImportTimeActualsWizard.tsx clears
  //   a field's marker the instant a re-import overwrites that exact
  //   field — confirmed true for 'total' too (any import touching a
  //   pair's actuals/forecast always also touches and re-derives 'total',
  //   clearing its marker along with it) — so a marker's mere presence for
  //   a given (year, field) is a reliable, never-stale signal that the
  //   value currently stored is still the hand-typed one. Only n1Total,
  //   total, and individual m0..m11 map to an actual stored row;
  //   avgPast/avgRemaining markers record that a SUMMARY field was the
  //   direct edit source but have no row of their own to act on — the
  //   individual months they fanned out to are left alone unless they
  //   separately carry their own m* marker. Real gap (a whole cascade-
  //   filled range with no later single-month edit on top of it won't be
  //   caught), but the safe direction: erring toward not deleting
  //   possibly-imported data, never the reverse.
  // Does NOT touch time_manual_rows (the caller handles that via
  // deleteManualRow, same call) or assignments (owned by useAssignments.ts,
  // out of this hook's reach, and unambiguously 100% manual by
  // construction — import never writes there at all — so the caller
  // deletes it unconditionally). Not self-recording, same convention as
  // every other mutator here. Returns exactly what it deleted so the
  // caller can build an undo Command from it (see restorePairData below).
  const purgeManualDataForPair = useCallback(
    async (employeeId: string, clientMissionId: string): Promise<PairDataSnapshot> => {
      const priorActuals = timeActuals.filter(
        (a) => a.resolved_employee_id === employeeId && a.resolved_client_mission_id === clientMissionId && a.batch_id === null,
      );
      const relevantMarkers = timeManualEditMarkers.filter((m) => m.employee_id === employeeId && m.client_mission_id === clientMissionId);
      const n1Markers = relevantMarkers.filter((m) => m.field === 'n1Total');
      const totalMarkers = relevantMarkers.filter((m) => m.field === 'total');
      const monthMarkers = relevantMarkers.filter((m) => /^m\d+$/.test(m.field));

      const priorN1Totals = timeActualN1Totals.filter(
        (n) => n.employee_id === employeeId && n.client_mission_id === clientMissionId && n1Markers.some((m) => m.year === n.year),
      );
      const priorForecasts = timeForecasts.filter(
        (f) => f.employee_id === employeeId && f.client_mission_id === clientMissionId && totalMarkers.some((m) => m.year === f.year),
      );
      const priorForecastMonths = timeForecastMonths.filter((fm) => {
        if (fm.employee_id !== employeeId || fm.client_mission_id !== clientMissionId) return false;
        return monthMarkers.some((m) => m.year === fm.year && Number(m.field.slice(1)) + 1 === fm.month);
      });
      const priorEditMarkers = [...n1Markers, ...totalMarkers, ...monthMarkers];

      const monthsByYear = new Map<number, number[]>();
      for (const m of monthMarkers) {
        monthsByYear.set(m.year, [...(monthsByYear.get(m.year) ?? []), Number(m.field.slice(1)) + 1]);
      }

      await Promise.all([
        timeEstimationService.deleteManualTimeActualsForPair(employeeId, clientMissionId),
        ...n1Markers.map((m) => timeEstimationService.deleteTimeActualN1Total(employeeId, clientMissionId, m.year)),
        ...totalMarkers.map((m) => timeEstimationService.deleteTimeForecast(employeeId, clientMissionId, m.year)),
        ...Array.from(monthsByYear.entries()).map(([year, months]) =>
          timeEstimationService.deleteTimeForecastMonths(employeeId, clientMissionId, year, months),
        ),
        priorEditMarkers.length > 0 ? timeEstimationService.deleteTimeManualEditMarkersByIds(priorEditMarkers.map((m) => m.id)) : null,
      ]);
      await refresh();

      return {
        actuals: priorActuals,
        forecastMonths: priorForecastMonths,
        forecasts: priorForecasts,
        n1Totals: priorN1Totals,
        editMarkers: priorEditMarkers,
      };
    },
    [refresh, timeActuals, timeForecasts, timeManualEditMarkers, timeActualN1Totals, timeForecastMonths],
  );

  // Undo body for purgeManualDataForPair — the caller (TimeEstimationGrid.
  // tsx) passes back exactly the snapshot purgeManualDataForPair returned.
  // time_actuals goes back under its original ids via restoreTimeActuals
  // (this app's identity-stable-undo convention); the other tables have no
  // external references to their own row ids, so a plain upsert/insert by
  // natural key is enough to restore their values.
  const restorePairData = useCallback(
    async (snapshot: PairDataSnapshot) => {
      await Promise.all([
        timeEstimationService.restoreTimeActuals(snapshot.actuals),
        timeEstimationService.upsertTimeForecastMonths(
          snapshot.forecastMonths.map((m) => ({
            employee_id: m.employee_id,
            client_mission_id: m.client_mission_id,
            year: m.year,
            month: m.month,
            pct: m.pct,
          })),
        ),
        ...snapshot.forecasts.map((f) => timeEstimationService.upsertTimeForecast(f.employee_id, f.client_mission_id, f.year, f.total_pct)),
        timeEstimationService.upsertTimeActualN1Totals(
          snapshot.n1Totals.map((n) => ({
            employee_id: n.employee_id,
            client_mission_id: n.client_mission_id,
            year: n.year,
            total_pct: n.total_pct,
          })),
        ),
        ...snapshot.editMarkers.map((m) => timeEstimationService.upsertTimeManualEditMarker(m.employee_id, m.client_mission_id, m.year, m.field)),
      ]);
      await refresh();
    },
    [refresh],
  );

  const resolveEmployeeAlias = useCallback(
    async (rawName: string, employeeId: string | null) => {
      await timeEstimationService.upsertTimeEmployeeAlias(rawName, employeeId);
      await refresh();
    },
    [refresh],
  );

  const resolveClientAlias = useCallback(
    async (rawName: string, clientMissionId: string | null) => {
      await timeEstimationService.upsertTimeClientAlias(rawName, clientMissionId);
      await refresh();
    },
    [refresh],
  );

  return {
    timeActuals,
    timeForecasts,
    timeForecastMonths,
    timeActualN1Totals,
    timeActualGroups,
    timeImportBatches,
    employeeAliases,
    clientAliases,
    timeManualEditMarkers,
    timeManualRows,
    timeRowComments,
    loading,
    error,
    refresh,
    actualsOf,
    forecastOf,
    n1TotalOf,
    monthOverridesOf,
    manualRowOf,
    commentOf,
    groupsByPrimary,
    groupOfMember,
    saveMonthOverrides,
    restoreMonthOverrides,
    saveManualActuals,
    restoreManualActuals,
    saveN1Total,
    deleteN1Total,
    saveEditMarker,
    clearEditMarker,
    createGroup,
    deleteGroup,
    createManualRow,
    deleteManualRow,
    restoreManualRow,
    saveComment,
    deleteComment,
    restoreComment,
    purgeManualDataForPair,
    restorePairData,
    resolveEmployeeAlias,
    resolveClientAlias,
  };
}
