import { useCallback, useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient';
import * as employeeService from '../services/employeeService';
import type { Employee, EmployeeInput, PhotoFrameValues } from '../types/domain';
import { useHistoryStore, withSuppressedRecording } from '../stores/historyStore';
import { hasConcurrentUpdate } from '../lib/conflictCheck';

export function useEmployees(orgChartId: string | null) {
  const { t } = useTranslation();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Guards against a stale response overwriting a newer one. The realtime
  // subscription below is deliberately unfiltered, so ANY change to this table —
  // in any org chart — fires refresh() in every mounted consumer. Switch charts
  // while one of those fetches is in flight and it resolves afterwards, writing
  // the PREVIOUS chart's rows over the new chart's. Hit for real: switching
  // charts left the chart pane showing the old org's cards for as long as it was
  // watched, while the grid (a separate hook instance that happened not to race)
  // correctly showed the new, empty one. Same guard in useReportingGraph.ts and
  // useAssignments.ts — keep all three in step.
  const latestRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!orgChartId) return;
    const requestId = ++latestRequestRef.current;
    try {
      const rows = await employeeService.fetchEmployees(orgChartId);
      if (requestId !== latestRequestRef.current) return;
      setEmployees(rows);
      setError(null);
    } catch (err) {
      if (requestId !== latestRequestRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestId === latestRequestRef.current) setLoading(false);
    }
  }, [orgChartId]);

  useEffect(() => {
    if (!orgChartId) return;
    // Reset to a clean loading state before fetching the new chart's data,
    // so consumers see a real loading:true→false transition on every switch
    // instead of briefly showing the previous chart's stale employees.
    setEmployees([]);
    setLoading(true);
    refresh();

    // Unique per mount: this hook can have multiple simultaneous consumers
    // (grid + chart), and React StrictMode double-mounts in dev — a shared
    // fixed channel name would collide with `.on()` after `.subscribe()`.
    // Deliberately unfiltered (not `filter: org_chart_id=eq.${orgChartId}`):
    // Postgres only ships primary-key columns in a DELETE's WAL entry under
    // the default replica identity, so Realtime can't evaluate a filter on
    // a non-PK column like org_chart_id for DELETE events and silently
    // drops them for filtered subscribers — INSERT/UPDATE were never
    // affected since the full new row is always available. Subscribing
    // unfiltered and re-scoping via the (already org_chart_id-filtered)
    // refresh() query sidesteps that Realtime limitation entirely, at the
    // cost of an occasional harmless refetch triggered by another chart's
    // change — fine at this app's scale (a few hundred rows).
    const channel = supabase
      .channel(`employees-changes-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'employees' },
        () => {
          refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgChartId, refresh]);

  // Deliberately NOT auto-recorded: deleting an employee cascades (FK) and
  // silently removes every ReportingRelationship/Assignment row referencing
  // it too, which a plain "recreate the employee" undo can't see from here.
  // Callers that need undo (OrgChartView, EmployeeGrid) build a compound
  // command via useEmployeeDeletion.ts instead, which has all three data
  // hooks in scope to capture and restore.
  //
  // Wrapped in useCallback (like every mutator below) so this hook's return
  // value stays reference-stable across renders when nothing it depends on
  // actually changed — components consuming these (OrgChartView.tsx in
  // particular) build their own memoized values on top, and a fresh
  // function reference every render defeats that memoization all the way
  // up. This was a latent, harmless inefficiency until the chart's own
  // drag-to-reorder feature started relying on its node array staying
  // stable during a drag — an unstable `nodes` prop breaks React Flow's
  // internal drag-position tracking (and, worse, can thrash it into a
  // crash) — so treat this as a correctness fix, not just cleanup.
  const deleteEmployee = useCallback(
    async (id: string) => {
      await employeeService.deleteEmployee(id);
      await refresh();
    },
    [refresh],
  );

  const createEmployee = useCallback(
    async (input: EmployeeInput): Promise<Employee> => {
      if (!orgChartId) throw new Error('No active org chart');
      const created = await employeeService.createEmployee(orgChartId, input);
      await refresh();
      // The id is stable across the whole undo/redo cycle because redo RESTORES
      // the original row rather than creating a new one — so a plain string id is
      // safe to close over here, and in every other command below.
      useHistoryStore.getState().push({
        label: t('history.createEmployee', { name: `${created.first_name} ${created.last_name}` }),
        orgChartId,
        undo: () => deleteEmployee(created.id),
        redo: async () => {
          await employeeService.restoreEmployee(created);
          await refresh();
        },
      });
      return created;
    },
    [orgChartId, refresh, deleteEmployee, t],
  );

  // Undo-only helper: re-inserts a deleted row under its ORIGINAL id, whole row
  // included (photo, crop, sibling_order). Deliberately NOT recorded — it only
  // ever runs inside another command's undo/redo, which owns the recording.
  const restoreEmployee = useCallback(
    async (row: Employee): Promise<Employee> => {
      const restored = await employeeService.restoreEmployee(row);
      await refresh();
      return restored;
    },
    [refresh],
  );

  const updateEmployee = useCallback(
    async (
      id: string,
      changes: Partial<EmployeeInput>,
      // AG Grid mutates its row data object in place (the same object
      // sitting in `employees`) BEFORE firing onCellValueChanged, so by the
      // time this runs, employees.find(id) can no longer be trusted for
      // the pre-edit value of an AG-Grid-edited field — the grid callers
      // pass the real old values here (from the event's own oldValue)
      // instead. Non-grid callers (EmployeeNode's inline editor) omit this
      // and fall back to the array lookup, which is accurate for them
      // since nothing mutates it early.
      oldValuesHint?: Partial<EmployeeInput>,
    ): Promise<Employee> => {
      const before = employees.find((e) => e.id === id);
      // Must run BEFORE the update, not in parallel with it: our own write
      // is likely to commit before a concurrent SELECT runs, which would
      // make it see our OWN new updated_at and false-positive a conflict on
      // every single edit. Sequential ordering is what makes this correct
      // — the small added latency (one extra round trip) is the price.
      const hadConflict = before ? await hasConcurrentUpdate('employees', id, before.updated_at) : false;
      const updated = await employeeService.updateEmployee(id, changes);
      await refresh();
      if (before && orgChartId) {
        const oldChanges: Partial<EmployeeInput> = {};
        for (const key of Object.keys(changes) as (keyof EmployeeInput)[]) {
          (oldChanges as Record<string, unknown>)[key] =
            oldValuesHint && key in oldValuesHint ? oldValuesHint[key] : before[key];
        }
        const name = `${before.first_name} ${before.last_name}`;
        useHistoryStore.getState().push({
          // Folded into the SAME toast as the undo confirmation rather than
          // a separate one — the toast store only ever shows one toast at a
          // time, and a standalone warning would just get immediately
          // clobbered by this push's own toast a moment later.
          label: hadConflict ? t('history.updateEmployeeConflict', { name }) : t('history.updateEmployee', { name }),
          orgChartId,
          undo: async () => { await updateEmployee(id, oldChanges); },
          redo: async () => { await updateEmployee(id, changes); },
        });
      }
      return updated;
    },
    [employees, orgChartId, refresh, t],
  );

  // Deliberately NOT auto-recorded: usePhotoActions.ts's replacePhoto/
  // deletePhoto delete the old Storage object with a fire-and-forget
  // best-effort call — once that runs, the old image bytes are gone, so an
  // undo could never losslessly restore them. Excluded from this system
  // entirely, unlike updateEmployeePhotoFrame below (a pure DB field swap,
  // no storage mutation).
  const updateEmployeePhoto = useCallback(
    async (id: string, photoPath: string | null): Promise<Employee> => {
      const updated = await employeeService.updateEmployeePhoto(id, photoPath);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const updateEmployeePhotoFrame = useCallback(
    async (id: string, frame: PhotoFrameValues): Promise<Employee> => {
      const before = employees.find((e) => e.id === id);
      const updated = await employeeService.updateEmployeePhotoFrame(id, frame);
      await refresh();
      if (before && orgChartId) {
        const oldFrame: PhotoFrameValues = {
          zoom: before.photo_zoom,
          panX: before.photo_pan_x,
          panY: before.photo_pan_y,
        };
        useHistoryStore.getState().push({
          label: t('history.reframePhoto', { name: `${before.first_name} ${before.last_name}` }),
          orgChartId,
          undo: async () => { await updateEmployeePhotoFrame(id, oldFrame); },
          redo: async () => { await updateEmployeePhotoFrame(id, frame); },
        });
      }
      return updated;
    },
    [employees, orgChartId, refresh, t],
  );

  // Toggling the "has left the company" flag — same undo/redo shape as
  // updateEmployeePhotoFrame above: capture before, write, refresh, then push
  // a Command whose undo/redo both just call this same mutator again with
  // the old/new value (symmetric, so no separate revert function is needed).
  const updateHasLeftCompany = useCallback(
    async (id: string, value: boolean): Promise<void> => {
      const before = employees.find((e) => e.id === id);
      await employeeService.setHasLeftCompany(id, value);
      await refresh();
      if (before && orgChartId) {
        const name = `${before.first_name} ${before.last_name}`;
        useHistoryStore.getState().push({
          label: value ? t('history.markEmployeeLeft', { name }) : t('history.markEmployeeActive', { name }),
          orgChartId,
          undo: async () => { await updateHasLeftCompany(id, before.has_left_company); },
          redo: async () => { await updateHasLeftCompany(id, value); },
        });
      }
    },
    [employees, orgChartId, refresh, t],
  );

  // Drag-to-reorder support (siblingOrder.ts). `updates` may cover more than
  // just the dragged employee — the first manual reorder in a sibling group
  // backfills real values for every member in the same write (see
  // useChartNodes.ts's handleNodeDragStop) — but it's still one user
  // gesture, so it must record as a single undo/redo command regardless of
  // how many rows it touches.
  const updateSiblingOrders = useCallback(
    async (updates: { id: string; siblingOrder: number | null }[], label: string): Promise<void> => {
      if (!orgChartId) throw new Error('No active org chart');
      const before = updates.map((u) => ({
        id: u.id,
        oldSiblingOrder: employees.find((e) => e.id === u.id)?.sibling_order ?? null,
      }));
      await employeeService.updateSiblingOrders(updates);
      await refresh();

      useHistoryStore.getState().push({
        label,
        orgChartId,
        undo: () =>
          withSuppressedRecording(async () => {
            await employeeService.updateSiblingOrders(
              before.map((b) => ({ id: b.id, siblingOrder: b.oldSiblingOrder })),
            );
            await refresh();
          }),
        redo: () =>
          withSuppressedRecording(async () => {
            await employeeService.updateSiblingOrders(
              updates.map((u) => ({ id: u.id, siblingOrder: u.siblingOrder })),
            );
            await refresh();
          }),
      });
    },
    [employees, orgChartId, refresh],
  );

  return {
    employees,
    loading,
    error,
    createEmployee,
    restoreEmployee,
    updateEmployee,
    deleteEmployee,
    updateEmployeePhoto,
    updateEmployeePhotoFrame,
    updateHasLeftCompany,
    updateSiblingOrders,
  };
}
