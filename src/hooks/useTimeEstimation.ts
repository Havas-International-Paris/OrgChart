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
} from '../types/domain';

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
      const [actuals, forecasts, forecastMonths, n1Totals, groups, batches, empAliases, cliAliases, editMarkers, manualRows] = await Promise.all([
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
    loading,
    error,
    refresh,
    actualsOf,
    forecastOf,
    n1TotalOf,
    monthOverridesOf,
    manualRowOf,
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
    resolveEmployeeAlias,
    resolveClientAlias,
  };
}
