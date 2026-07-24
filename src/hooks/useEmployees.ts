import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as employeeService from '../services/employeeService';
import type { Employee, EmployeeInput, PhotoFrameValues } from '../types/domain';
import { useHistoryStore } from '../stores/historyStore';
import { boxFor } from '../stores/idRegistryStore';

export function useEmployees(orgChartId: string | null) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orgChartId) return;
    try {
      setEmployees(await employeeService.fetchEmployees(orgChartId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
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

  const createEmployee = async (input: EmployeeInput): Promise<Employee> => {
    if (!orgChartId) throw new Error('No active org chart');
    const created = await employeeService.createEmployee(orgChartId, input);
    await refresh();
    const box = boxFor(created.id);
    useHistoryStore.getState().push({
      label: `Créer ${created.first_name} ${created.last_name}`,
      orgChartId,
      undo: () => deleteEmployee(box.id),
      redo: async () => {
        const recreated = await employeeService.createEmployee(orgChartId, input);
        box.id = recreated.id;
        await refresh();
      },
    });
    return created;
  };

  const updateEmployee = async (
    id: string,
    changes: Partial<EmployeeInput>,
    // AG Grid mutates its row data object in place (the same object sitting
    // in `employees`) BEFORE firing onCellValueChanged, so by the time this
    // runs, employees.find(id) can no longer be trusted for the pre-edit
    // value of an AG-Grid-edited field — the grid callers pass the real old
    // values here (from the event's own oldValue) instead. Non-grid callers
    // (EmployeeNode's inline editor) omit this and fall back to the array
    // lookup, which is accurate for them since nothing mutates it early.
    oldValuesHint?: Partial<EmployeeInput>,
  ): Promise<Employee> => {
    const before = employees.find((e) => e.id === id);
    const updated = await employeeService.updateEmployee(id, changes);
    await refresh();
    if (before && orgChartId) {
      const box = boxFor(id);
      const oldChanges: Partial<EmployeeInput> = {};
      for (const key of Object.keys(changes) as (keyof EmployeeInput)[]) {
        (oldChanges as Record<string, unknown>)[key] =
          oldValuesHint && key in oldValuesHint ? oldValuesHint[key] : before[key];
      }
      useHistoryStore.getState().push({
        label: `Modifier ${before.first_name} ${before.last_name}`,
        orgChartId,
        undo: async () => { await updateEmployee(box.id, oldChanges); },
        redo: async () => { await updateEmployee(box.id, changes); },
      });
    }
    return updated;
  };

  // Deliberately NOT auto-recorded: deleting an employee cascades (FK) and
  // silently removes every ReportingRelationship/Assignment row referencing
  // it too, which a plain "recreate the employee" undo can't see from here.
  // Callers that need undo (OrgChartView, EmployeeGrid) build a compound
  // command via useEmployeeDeletion.ts instead, which has all three data
  // hooks in scope to capture and restore.
  const deleteEmployee = async (id: string) => {
    await employeeService.deleteEmployee(id);
    await refresh();
  };

  // Deliberately NOT auto-recorded: usePhotoActions.ts's replacePhoto/
  // deletePhoto delete the old Storage object with a fire-and-forget
  // best-effort call — once that runs, the old image bytes are gone, so an
  // undo could never losslessly restore them. Excluded from this system
  // entirely, unlike updateEmployeePhotoFrame below (a pure DB field swap,
  // no storage mutation).
  const updateEmployeePhoto = async (id: string, photoPath: string | null): Promise<Employee> => {
    const updated = await employeeService.updateEmployeePhoto(id, photoPath);
    await refresh();
    return updated;
  };

  const updateEmployeePhotoFrame = async (id: string, frame: PhotoFrameValues): Promise<Employee> => {
    const before = employees.find((e) => e.id === id);
    const updated = await employeeService.updateEmployeePhotoFrame(id, frame);
    await refresh();
    if (before && orgChartId) {
      const box = boxFor(id);
      const oldFrame: PhotoFrameValues = {
        zoom: before.photo_zoom,
        panX: before.photo_pan_x,
        panY: before.photo_pan_y,
      };
      useHistoryStore.getState().push({
        label: `Recadrer la photo de ${before.first_name} ${before.last_name}`,
        orgChartId,
        undo: async () => { await updateEmployeePhotoFrame(box.id, oldFrame); },
        redo: async () => { await updateEmployeePhotoFrame(box.id, frame); },
      });
    }
    return updated;
  };

  return {
    employees,
    loading,
    error,
    createEmployee,
    updateEmployee,
    deleteEmployee,
    updateEmployeePhoto,
    updateEmployeePhotoFrame,
  };
}
