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
} from '../types/domain';

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
  const { data, error } = await supabase.from('time_actuals').select('*');
  if (error) throw error;
  return data as TimeActual[];
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
  const { data, error } = await supabase.from('time_forecast_months').select('*');
  if (error) throw error;
  return data as TimeForecastMonth[];
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

// Import-only variant of the above — deliberately does NOT assertRowsAffected,
// since "zero rows deleted" is the expected, common case here (most
// employee/client/month combinations in a real import were never manually
// overridden). Used by ImportTimeActualsWizard to clear any stale manual
// override on exactly the past months it's (re)importing, so a fresh
// import of "Temps réel" always wins visually instead of being shadowed
// forever by an old override (effectiveByMonth = override ?? actual, see
// TimeEstimationGrid.tsx) that a re-import of time_actuals alone can never
// touch, since it lives in this separate table.
export async function clearTimeForecastMonthOverridesIfAny(
  employeeId: string,
  clientMissionId: string,
  year: number,
  months: number[],
): Promise<void> {
  if (months.length === 0) return;
  const { error } = await supabase
    .from('time_forecast_months')
    .delete()
    .eq('employee_id', employeeId)
    .eq('client_mission_id', clientMissionId)
    .eq('year', year)
    .in('month', months);
  if (error) throw error;
}

export async function fetchTimeActualN1Totals(): Promise<TimeActualN1Total[]> {
  const { data, error } = await supabase.from('time_actual_n1_totals').select('*');
  if (error) throw error;
  return data as TimeActualN1Total[];
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
