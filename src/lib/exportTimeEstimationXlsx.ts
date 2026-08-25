import * as XLSX from 'xlsx';
import i18n from '../i18n/config';
import type {
  ClientMission,
  Employee,
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

// Full raw-data export of the "Estimation des temps" module — every table
// useTimeEstimation() loads, one sheet each, id fields left in place AND
// joined to a readable name (per CLAUDE.md, none of these tables store a
// denormalized name, only ids) so the workbook is useful both as a human
// report and as a raw dump for reconciliation. Deliberately NOT the grid's
// own derived/effective view (override ?? actual, group aggregation, etc.)
// — this is the underlying database, not what's currently on screen.
export interface TimeEstimationExportData {
  timeActuals: TimeActual[];
  timeForecasts: TimeForecast[];
  timeForecastMonths: TimeForecastMonth[];
  timeActualN1Totals: TimeActualN1Total[];
  timeActualGroups: TimeActualGroup[];
  timeImportBatches: TimeImportBatch[];
  employeeAliases: TimeEmployeeAlias[];
  clientAliases: TimeClientAlias[];
  timeManualEditMarkers: TimeManualEditMarker[];
  timeManualRows: TimeManualRow[];
  timeRowComments: TimeRowComment[];
  employeeById: Map<string, Employee>;
  clientMissionById: Map<string, ClientMission>;
}

function employeeName(employeeById: Map<string, Employee>, id: string | null): string {
  if (!id) return '';
  const e = employeeById.get(id);
  return e ? `${e.first_name} ${e.last_name}` : '';
}

function clientMissionName(clientMissionById: Map<string, ClientMission>, id: string | null): string {
  if (!id) return '';
  return clientMissionById.get(id)?.name ?? '';
}

function toSheet(rows: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

// Sheet names go through i18n like every other piece of UI chrome (per
// CLAUDE.md's "data values are never translated, only UI chrome" rule —
// these are labels, not data), so keep every one under Excel's 31-char
// sheet-name limit in both languages.
export function buildTimeEstimationWorkbook(data: TimeEstimationExportData): XLSX.WorkBook {
  const t = i18n.t;
  const h = (key: string) => t(`timeEstimation.export.headers.${key}`);
  const { employeeById, clientMissionById } = data;
  const wb = XLSX.utils.book_new();

  const actualsHeader = [
    h('id'),
    h('batchId'),
    h('year'),
    h('month'),
    h('rawEmployeeName'),
    h('rawClientName'),
    h('rawSousDossier'),
    h('rawGroupAnnonceur'),
    h('rawPayrollName'),
    h('rawBuName'),
    h('etpPct'),
    h('resolvedEmployeeId'),
    h('resolvedEmployeeName'),
    h('resolvedClientMissionId'),
    h('resolvedClientMissionName'),
    h('createdAt'),
    h('updatedAt'),
  ];
  const actualsRows = data.timeActuals.map((a) => [
    a.id,
    a.batch_id ?? '',
    a.year,
    a.month,
    a.raw_employee_name,
    a.raw_client_name,
    a.raw_sous_dossier ?? '',
    a.raw_group_annonceur ?? '',
    a.raw_payroll_name ?? '',
    a.raw_bu_name ?? '',
    a.etp_pct,
    a.resolved_employee_id ?? '',
    employeeName(employeeById, a.resolved_employee_id),
    a.resolved_client_mission_id ?? '',
    clientMissionName(clientMissionById, a.resolved_client_mission_id),
    a.created_at,
    a.updated_at,
  ]);
  XLSX.utils.book_append_sheet(wb, toSheet([actualsHeader, ...actualsRows]), t('timeEstimation.export.sheets.actuals'));

  const forecastsHeader = [h('id'), h('employeeId'), h('employeeName'), h('clientMissionId'), h('clientMissionName'), h('year'), h('totalPct'), h('createdAt'), h('updatedAt')];
  const forecastsRows = data.timeForecasts.map((f) => [
    f.id,
    f.employee_id,
    employeeName(employeeById, f.employee_id),
    f.client_mission_id,
    clientMissionName(clientMissionById, f.client_mission_id),
    f.year,
    f.total_pct ?? '',
    f.created_at,
    f.updated_at,
  ]);
  XLSX.utils.book_append_sheet(wb, toSheet([forecastsHeader, ...forecastsRows]), t('timeEstimation.export.sheets.forecasts'));

  const forecastMonthsHeader = [h('id'), h('employeeId'), h('employeeName'), h('clientMissionId'), h('clientMissionName'), h('year'), h('month'), h('pct'), h('createdAt'), h('updatedAt')];
  const forecastMonthsRows = data.timeForecastMonths.map((m) => [
    m.id,
    m.employee_id,
    employeeName(employeeById, m.employee_id),
    m.client_mission_id,
    clientMissionName(clientMissionById, m.client_mission_id),
    m.year,
    m.month,
    m.pct,
    m.created_at,
    m.updated_at,
  ]);
  XLSX.utils.book_append_sheet(wb, toSheet([forecastMonthsHeader, ...forecastMonthsRows]), t('timeEstimation.export.sheets.forecastMonths'));

  const n1Header = [h('id'), h('employeeId'), h('employeeName'), h('clientMissionId'), h('clientMissionName'), h('year'), h('totalPct'), h('createdAt'), h('updatedAt')];
  const n1Rows = data.timeActualN1Totals.map((n) => [
    n.id,
    n.employee_id,
    employeeName(employeeById, n.employee_id),
    n.client_mission_id,
    clientMissionName(clientMissionById, n.client_mission_id),
    n.year,
    n.total_pct,
    n.created_at,
    n.updated_at,
  ]);
  XLSX.utils.book_append_sheet(wb, toSheet([n1Header, ...n1Rows]), t('timeEstimation.export.sheets.n1Totals'));

  const groupsHeader = [h('id'), h('clientMissionId'), h('clientMissionName'), h('primaryEmployeeId'), h('primaryEmployeeName'), h('memberEmployeeId'), h('memberEmployeeName'), h('createdAt')];
  const groupsRows = data.timeActualGroups.map((g) => [
    g.id,
    g.client_mission_id,
    clientMissionName(clientMissionById, g.client_mission_id),
    g.primary_employee_id,
    employeeName(employeeById, g.primary_employee_id),
    g.member_employee_id,
    employeeName(employeeById, g.member_employee_id),
    g.created_at,
  ]);
  XLSX.utils.book_append_sheet(wb, toSheet([groupsHeader, ...groupsRows]), t('timeEstimation.export.sheets.groups'));

  const batchesHeader = [h('id'), h('year'), h('filename'), h('rowCount'), h('importedAt'), h('importedBy')];
  const batchesRows = data.timeImportBatches.map((b) => [b.id, b.year, b.filename, b.row_count, b.imported_at, b.imported_by ?? '']);
  XLSX.utils.book_append_sheet(wb, toSheet([batchesHeader, ...batchesRows]), t('timeEstimation.export.sheets.importBatches'));

  const empAliasHeader = [h('id'), h('rawName'), h('employeeId'), h('employeeName'), h('createdAt')];
  const empAliasRows = data.employeeAliases.map((a) => [a.id, a.raw_name, a.employee_id ?? '', employeeName(employeeById, a.employee_id), a.created_at]);
  XLSX.utils.book_append_sheet(wb, toSheet([empAliasHeader, ...empAliasRows]), t('timeEstimation.export.sheets.employeeAliases'));

  const cliAliasHeader = [h('id'), h('rawName'), h('clientMissionId'), h('clientMissionName'), h('createdAt')];
  const cliAliasRows = data.clientAliases.map((a) => [a.id, a.raw_name, a.client_mission_id ?? '', clientMissionName(clientMissionById, a.client_mission_id), a.created_at]);
  XLSX.utils.book_append_sheet(wb, toSheet([cliAliasHeader, ...cliAliasRows]), t('timeEstimation.export.sheets.clientAliases'));

  const markersHeader = [h('id'), h('employeeId'), h('employeeName'), h('clientMissionId'), h('clientMissionName'), h('year'), h('field'), h('editedAt')];
  const markersRows = data.timeManualEditMarkers.map((m) => [
    m.id,
    m.employee_id,
    employeeName(employeeById, m.employee_id),
    m.client_mission_id,
    clientMissionName(clientMissionById, m.client_mission_id),
    m.year,
    m.field,
    m.edited_at,
  ]);
  XLSX.utils.book_append_sheet(wb, toSheet([markersHeader, ...markersRows]), t('timeEstimation.export.sheets.manualEditMarkers'));

  const manualRowsHeader = [h('id'), h('employeeId'), h('employeeName'), h('clientMissionId'), h('clientMissionName'), h('createdAt'), h('createdBy')];
  const manualRowsRows = data.timeManualRows.map((r) => [
    r.id,
    r.employee_id,
    employeeName(employeeById, r.employee_id),
    r.client_mission_id,
    clientMissionName(clientMissionById, r.client_mission_id),
    r.created_at,
    r.created_by ?? '',
  ]);
  XLSX.utils.book_append_sheet(wb, toSheet([manualRowsHeader, ...manualRowsRows]), t('timeEstimation.export.sheets.manualRows'));

  const commentsHeader = [h('id'), h('employeeId'), h('employeeName'), h('clientMissionId'), h('clientMissionName'), h('commentText'), h('createdAt'), h('updatedAt'), h('createdBy')];
  const commentsRows = data.timeRowComments.map((c) => [
    c.id,
    c.employee_id,
    employeeName(employeeById, c.employee_id),
    c.client_mission_id,
    clientMissionName(clientMissionById, c.client_mission_id),
    c.comment_text,
    c.created_at,
    c.updated_at,
    c.created_by ?? '',
  ]);
  XLSX.utils.book_append_sheet(wb, toSheet([commentsHeader, ...commentsRows]), t('timeEstimation.export.sheets.rowComments'));

  return wb;
}

export function downloadTimeEstimationWorkbook(wb: XLSX.WorkBook, filename: string): void {
  XLSX.writeFile(wb, filename);
}
