import { supabase } from '../lib/supabaseClient';
import { assertRowsAffected } from '../lib/mutationGuard';
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
} from '../types/domain';

// PostgREST caps an unbounded `select('*')` at this project's configured
// max-rows (1000 by default) and truncates silently — no error, just fewer
// rows than actually exist, typically missing whichever rows happen to sort
// last. Hit for real once time_actuals crossed 1000 rows: newly-imported
// data for the current year disappeared from the grid (which reads this
// hook's full in-memory array) while older rows kept displaying fine, with
// nothing in the UI or console hinting at why. Every table here grows with
// every import — some (time_actuals) already crossed that line, the rest
// will eventually — so every "fetch the whole table" call pages through
// `.range()` instead of trusting a single request to return everything.
async function fetchAllRows<T>(table: string): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select('*').range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

export async function fetchTimeImportBatches(): Promise<TimeImportBatch[]> {
  const { data, error } = await supabase.from('time_import_batches').select('*').order('imported_at', { ascending: false });
  if (error) throw error;
  return data as TimeImportBatch[];
}

export async function createTimeImportBatch(
  year: number,
  filename: string,
  rowCount: number,
  importedBy: string | null,
): Promise<TimeImportBatch> {
  const { data, error } = await supabase
    .from('time_import_batches')
    .insert({ year, filename, row_count: rowCount, imported_by: importedBy })
    .select()
    .single();
  if (error) throw error;
  return data as TimeImportBatch;
}

export async function fetchTimeActuals(): Promise<TimeActual[]> {
  return fetchAllRows<TimeActual>('time_actuals');
}

// Keyed on (raw_employee_name, raw_client_name, year, month) — a re-import
// (monthly update of the current year, or a correction) overwrites the
// matching row's etp_pct/resolution/batch_id rather than duplicating it.
export interface TimeActualUpsertRow {
  batch_id: string;
  year: number;
  month: number;
  raw_employee_name: string;
  raw_client_name: string;
  raw_sous_dossier: string | null;
  raw_group_annonceur: string | null;
  raw_payroll_name: string | null;
  raw_bu_name: string | null;
  etp_pct: number;
  resolved_employee_id: string | null;
  resolved_client_mission_id: string | null;
}

export async function upsertTimeActuals(rows: TimeActualUpsertRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('time_actuals')
    .upsert(rows, { onConflict: 'raw_employee_name,raw_client_name,year,month' });
  if (error) throw error;
}

// Every row (however many raw-name variants resolved to this pair) for one
// (employee, client, year, month) — used both to build a manual edit's undo
// snapshot and, immediately after, deleted wholesale so the manual value
// replaces rather than adds to whatever was already there (time_actuals
// sums every matching row by design, see upsertTimeActuals's own comment,
// which is exactly wrong for a "set this month to X" manual edit).
export async function fetchTimeActualsForMonths(
  employeeId: string,
  clientMissionId: string,
  year: number,
  months: number[],
): Promise<TimeActual[]> {
  if (months.length === 0) return [];
  const { data, error } = await supabase
    .from('time_actuals')
    .select('*')
    .eq('resolved_employee_id', employeeId)
    .eq('resolved_client_mission_id', clientMissionId)
    .eq('year', year)
    .in('month', months);
  if (error) throw error;
  return data as TimeActual[];
}

// Manual-edit / import counterpart of deleteTimeForecastMonths — "nothing
// to delete" is the common case (a month with no prior actuals at all), so
// this deliberately does not assertRowsAffected.
export async function deleteTimeActualsForMonths(
  employeeId: string,
  clientMissionId: string,
  year: number,
  months: number[],
): Promise<void> {
  if (months.length === 0) return;
  const { error } = await supabase
    .from('time_actuals')
    .delete()
    .eq('resolved_employee_id', employeeId)
    .eq('resolved_client_mission_id', clientMissionId)
    .eq('year', year)
    .in('month', months);
  if (error) throw error;
}

export interface ManualTimeActualRow {
  employee_id: string;
  client_mission_id: string;
  year: number;
  month: number;
  pct: number;
  employee_name: string;
  client_name: string;
}

// A hand-typed past-month value in the grid — not tied to any import batch
// (batch_id null, already `on delete set null`), raw_employee_name/
// raw_client_name set to the real display names (not a placeholder) purely
// so the row stays legible if ever inspected directly.
export async function insertManualTimeActuals(rows: ManualTimeActualRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from('time_actuals').insert(
    rows.map((r) => ({
      batch_id: null,
      year: r.year,
      month: r.month,
      raw_employee_name: r.employee_name,
      raw_client_name: r.client_name,
      raw_sous_dossier: null,
      raw_group_annonceur: null,
      raw_payroll_name: null,
      raw_bu_name: null,
      etp_pct: r.pct,
      resolved_employee_id: r.employee_id,
      resolved_client_mission_id: r.client_mission_id,
    })),
  );
  if (error) throw error;
}

// Undo body for a manual past-month edit — re-inserts the exact rows
// fetchTimeActualsForMonths captured before the edit, under their original
// ids (this app's identity-stable-undo convention, see restoreAssignment/
// restoreEmployee). Can be zero rows (nothing existed for that month before
// the edit) or several (multiple raw-name variants had summed into it).
export async function restoreTimeActuals(rows: TimeActual[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from('time_actuals').insert(
    rows.map((r) => ({
      id: r.id,
      batch_id: r.batch_id,
      year: r.year,
      month: r.month,
      raw_employee_name: r.raw_employee_name,
      raw_client_name: r.raw_client_name,
      raw_sous_dossier: r.raw_sous_dossier,
      raw_group_annonceur: r.raw_group_annonceur,
      raw_payroll_name: r.raw_payroll_name,
      raw_bu_name: r.raw_bu_name,
      etp_pct: r.etp_pct,
      resolved_employee_id: r.resolved_employee_id,
      resolved_client_mission_id: r.resolved_client_mission_id,
    })),
  );
  if (error) throw error;
}

export async function fetchTimeEmployeeAliases(): Promise<TimeEmployeeAlias[]> {
  const { data, error } = await supabase.from('time_employee_aliases').select('*');
  if (error) throw error;
  return data as TimeEmployeeAlias[];
}

export async function upsertTimeEmployeeAlias(rawName: string, employeeId: string | null): Promise<TimeEmployeeAlias> {
  const { data, error } = await supabase
    .from('time_employee_aliases')
    .upsert({ raw_name: rawName, employee_id: employeeId }, { onConflict: 'raw_name' })
    .select()
    .single();
  if (error) throw error;
  return data as TimeEmployeeAlias;
}

export async function fetchTimeClientAliases(): Promise<TimeClientAlias[]> {
  const { data, error } = await supabase.from('time_client_aliases').select('*');
  if (error) throw error;
  return data as TimeClientAlias[];
}

export async function upsertTimeClientAlias(rawName: string, clientMissionId: string | null): Promise<TimeClientAlias> {
  const { data, error } = await supabase
    .from('time_client_aliases')
    .upsert({ raw_name: rawName, client_mission_id: clientMissionId }, { onConflict: 'raw_name' })
    .select()
    .single();
  if (error) throw error;
  return data as TimeClientAlias;
}

export async function fetchTimeForecasts(): Promise<TimeForecast[]> {
  const { data, error } = await supabase.from('time_forecasts').select('*');
  if (error) throw error;
  return data as TimeForecast[];
}

// total_pct is written on its own — every caller recomputes it itself
// (timeEstimationMath.averageOverRange over the year's 12 effective
// monthly values) before calling this, so it never drifts from the
// underlying time_forecast_months rows.
export async function upsertTimeForecast(
  employeeId: string,
  clientMissionId: string,
  year: number,
  totalPct: number | null,
): Promise<TimeForecast> {
  const { data, error } = await supabase
    .from('time_forecasts')
    .upsert(
      { employee_id: employeeId, client_mission_id: clientMissionId, year, total_pct: totalPct },
      { onConflict: 'employee_id,client_mission_id,year' },
    )
    .select()
    .single();
  if (error) throw error;
  return data as TimeForecast;
}

// Undo-only: removes the row entirely (not an upsert-to-null) for the case
// where a month-cascade edit is undone and no time_forecasts row existed
// before that edit — see useTimeEstimation.ts's restoreMonthOverrides.
export async function deleteTimeForecast(employeeId: string, clientMissionId: string, year: number): Promise<void> {
  const { data, error } = await supabase
    .from('time_forecasts')
    .delete()
    .eq('employee_id', employeeId)
    .eq('client_mission_id', clientMissionId)
    .eq('year', year)
    .select();
  assertRowsAffected(data, error);
}

export async function fetchTimeForecastMonths(): Promise<TimeForecastMonth[]> {
  return fetchAllRows<TimeForecastMonth>('time_forecast_months');
}

// Upserts one manual override per (employee, client, year, month) — used
// for a single-month edit (one row) and for the 3-level cascade fill
// (multiple rows, all the same `pct`, one call per affected month).
export async function upsertTimeForecastMonths(
  rows: Array<{ employee_id: string; client_mission_id: string; year: number; month: number; pct: number }>,
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('time_forecast_months')
    .upsert(rows, { onConflict: 'employee_id,client_mission_id,year,month' });
  if (error) throw error;
}

// Undo-only: removes specific months' override rows entirely (not an
// upsert-to-a-value) — a month that had no override before an edit must go
// back to having none, deferring to the imported actual, not a copy of
// whatever that actual happened to equal at the time of the edit.
export async function deleteTimeForecastMonths(
  employeeId: string,
  clientMissionId: string,
  year: number,
  months: number[],
): Promise<void> {
  if (months.length === 0) return;
  const { data, error } = await supabase
    .from('time_forecast_months')
    .delete()
    .eq('employee_id', employeeId)
    .eq('client_mission_id', clientMissionId)
    .eq('year', year)
    .in('month', months)
    .select();
  assertRowsAffected(data, error);
}

export async function fetchTimeActualN1Totals(): Promise<TimeActualN1Total[]> {
  return fetchAllRows<TimeActualN1Total>('time_actual_n1_totals');
}

// One row per (employee, client) from Input N-1's "ETPs 2025" column — a
// single annual figure, no monthly breakdown (see TimeActualN1Total's own
// doc comment for why this can't live in time_actuals).
export async function upsertTimeActualN1Totals(
  rows: Array<{ employee_id: string; client_mission_id: string; year: number; total_pct: number }>,
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('time_actual_n1_totals')
    .upsert(rows, { onConflict: 'employee_id,client_mission_id,year' });
  if (error) throw error;
}

// Undo-only: removes the row entirely for the case where a "Total N-1" edit
// is undone and no row existed before that edit.
export async function deleteTimeActualN1Total(employeeId: string, clientMissionId: string, year: number): Promise<void> {
  const { data, error } = await supabase
    .from('time_actual_n1_totals')
    .delete()
    .eq('employee_id', employeeId)
    .eq('client_mission_id', clientMissionId)
    .eq('year', year)
    .select();
  assertRowsAffected(data, error);
}

export async function fetchTimeActualGroups(): Promise<TimeActualGroup[]> {
  const { data, error } = await supabase.from('time_actual_groups').select('*');
  if (error) throw error;
  return data as TimeActualGroup[];
}

export async function createTimeActualGroup(
  clientMissionId: string,
  primaryEmployeeId: string,
  memberEmployeeId: string,
): Promise<TimeActualGroup> {
  const { data, error } = await supabase
    .from('time_actual_groups')
    .insert({ client_mission_id: clientMissionId, primary_employee_id: primaryEmployeeId, member_employee_id: memberEmployeeId })
    .select()
    .single();
  if (error) throw error;
  return data as TimeActualGroup;
}

export async function deleteTimeActualGroup(id: string): Promise<void> {
  const { data, error } = await supabase.from('time_actual_groups').delete().eq('id', id).select();
  assertRowsAffected(data, error);
}

export async function fetchTimeManualEditMarkers(): Promise<TimeManualEditMarker[]> {
  return fetchAllRows<TimeManualEditMarker>('time_manual_edit_markers');
}

// Records that this exact field was the one the user directly typed into —
// see the migration's comment for why only "direct" edits are persisted.
export async function upsertTimeManualEditMarker(
  employeeId: string,
  clientMissionId: string,
  year: number,
  field: string,
): Promise<void> {
  const { error } = await supabase
    .from('time_manual_edit_markers')
    .upsert({ employee_id: employeeId, client_mission_id: clientMissionId, year, field }, { onConflict: 'employee_id,client_mission_id,year,field' });
  if (error) throw error;
}

// "Nothing to delete" is a normal outcome (undoing an edit that wasn't
// itself marked direct, or clearing markers for a pair/field an import
// touches that was never manually edited) — deliberately no
// assertRowsAffected, same reasoning as the import-time clear functions
// above.
export async function deleteTimeManualEditMarker(
  employeeId: string,
  clientMissionId: string,
  year: number,
  field: string,
): Promise<void> {
  const { error } = await supabase
    .from('time_manual_edit_markers')
    .delete()
    .eq('employee_id', employeeId)
    .eq('client_mission_id', clientMissionId)
    .eq('year', year)
    .eq('field', field);
  if (error) throw error;
}

// One bulk delete by id — used both by ImportTimeActualsWizard (clearing
// every marker a re-import is about to overwrite, computed client-side
// against the already-loaded timeManualEditMarkers so this is a single
// round trip regardless of how many pairs/fields are affected) and
// available for any other bulk-clear need.
export async function deleteTimeManualEditMarkersByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('time_manual_edit_markers').delete().in('id', ids);
  if (error) throw error;
}
