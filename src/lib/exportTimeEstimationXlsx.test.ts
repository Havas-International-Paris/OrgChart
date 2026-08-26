import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildTimeEstimationWorkbook, type TimeEstimationExportData } from './exportTimeEstimationXlsx';
import type { ClientMission, Employee } from '../types/domain';

function makeEmployee(id: string, first_name: string, last_name: string): Employee {
  return {
    id,
    first_name,
    last_name,
    job_title: null,
    role_desc: null,
    department: null,
    company: null,
    photo_path: null,
    photo_zoom: 1,
    photo_pan_x: 0,
    photo_pan_y: 0,
    sibling_order: null,
    org_chart_id: 'org-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    created_by: null,
    updated_by: null,
    hidden_from_registry_candidates: false,
    has_left_company: false,
  };
}

function makeClientMission(id: string, name: string): ClientMission {
  return { id, name, type: 'client', created_at: '2026-01-01T00:00:00Z' };
}

const employeeById = new Map([['emp-1', makeEmployee('emp-1', 'Jean', 'Dupont')]]);
const clientMissionById = new Map([['cli-1', makeClientMission('cli-1', 'Client Exemple')]]);

function emptyData(): TimeEstimationExportData {
  return {
    timeActuals: [],
    timeForecasts: [],
    timeForecastMonths: [],
    timeActualN1Totals: [],
    timeActualGroups: [],
    timeImportBatches: [],
    employeeAliases: [],
    clientAliases: [],
    timeManualEditMarkers: [],
    timeManualRows: [],
    timeRowComments: [],
    employeeById,
    clientMissionById,
  };
}

describe('buildTimeEstimationWorkbook', () => {
  it('creates one sheet per table', () => {
    const wb = buildTimeEstimationWorkbook(emptyData());
    expect(wb.SheetNames).toHaveLength(11);
  });

  it('resolves employee/client ids to display names in the actuals sheet', () => {
    const data = emptyData();
    data.timeActuals = [
      {
        id: 'a1',
        batch_id: 'b1',
        year: 2026,
        month: 3,
        raw_employee_name: 'Jean D.',
        raw_client_name: 'Client Ex',
        raw_sous_dossier: null,
        raw_group_annonceur: null,
        raw_payroll_name: null,
        raw_bu_name: null,
        etp_pct: 20,
        resolved_employee_id: 'emp-1',
        resolved_client_mission_id: 'cli-1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];
    const wb = buildTimeEstimationWorkbook(data);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    const values = Object.values(row);
    expect(values).toContain('Jean Dupont');
    expect(values).toContain('Client Exemple');
  });

  it('leaves the name blank when an id has no match (e.g. a deleted employee)', () => {
    const data = emptyData();
    data.timeForecasts = [
      {
        id: 'f1',
        employee_id: 'missing-emp',
        client_mission_id: 'cli-1',
        year: 2026,
        total_pct: 42,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];
    const wb = buildTimeEstimationWorkbook(data);
    const forecastsSheetName = wb.SheetNames[1];
    const sheet = wb.Sheets[forecastsSheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    expect(rows).toHaveLength(1);
    // The employee id column keeps the raw id even though no name resolved.
    expect(Object.values(rows[0])).toContain('missing-emp');
  });
});
