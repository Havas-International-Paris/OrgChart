import type { Assignment, ClientMission, Employee, ReportingRelationship } from '../types/domain';

const HEADERS = [
  'Prénom',
  'Nom',
  'Poste',
  'Rôle',
  'Manager principal',
  'Managers secondaires',
  'Client / Mission',
  'Type',
  'Modèle',
  '% ETP vendu',
  '% ETP réel',
  'Total % ETP vendu (employé)',
  'Total % ETP réel (employé)',
];

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function formatName(employee: Employee | undefined): string {
  return employee ? `${employee.first_name} ${employee.last_name}` : '';
}

function formatNumber(value: number | null): string {
  return value === null ? '' : String(value);
}

export function buildEmployeesCsv(
  employees: Employee[],
  employeeById: Map<string, Employee>,
  managersOf: (employeeId: string) => ReportingRelationship[],
  assignmentsOf: (employeeId: string) => Assignment[],
  clientMissionById: Map<string, ClientMission>,
): string {
  const rows: string[][] = [];

  for (const employee of employees) {
    const managers = managersOf(employee.id);
    const primaryName = formatName(
      employeeById.get(managers.find((m) => m.is_primary)?.manager_id ?? ''),
    );
    const secondaryNames = managers
      .filter((m) => !m.is_primary)
      .map((m) => formatName(employeeById.get(m.manager_id)))
      .filter(Boolean)
      .join(', ');

    const assignments = assignmentsOf(employee.id);
    const vendus = assignments.filter((a) => a.etp_vendu !== null);
    const reels = assignments.filter((a) => a.etp_reel !== null);
    const totalVendu = vendus.length > 0 ? String(vendus.reduce((s, a) => s + (a.etp_vendu ?? 0), 0)) : '';
    const totalReel = reels.length > 0 ? String(reels.reduce((s, a) => s + (a.etp_reel ?? 0), 0)) : '';

    const baseRow = [
      employee.first_name,
      employee.last_name,
      employee.job_title ?? '',
      employee.role_desc ?? '',
      primaryName,
      secondaryNames,
    ];

    if (assignments.length === 0) {
      rows.push([...baseRow, '', '', '', '', '', totalVendu, totalReel]);
      continue;
    }

    for (const a of assignments) {
      const cm = clientMissionById.get(a.client_mission_id);
      rows.push([
        ...baseRow,
        cm?.name ?? '',
        cm ? (cm.type === 'mission' ? 'Mission' : 'Client') : '',
        a.remuneration_model === 'commission'
          ? 'Commission'
          : a.remuneration_model === 'retainer'
            ? 'Retainer'
            : '',
        formatNumber(a.etp_vendu),
        formatNumber(a.etp_reel),
        totalVendu,
        totalReel,
      ]);
    }
  }

  const lines = [HEADERS, ...rows].map((row) => row.map(csvEscape).join(','));
  // Leading BOM so Excel on Windows detects UTF-8 and renders accents correctly.
  return '﻿' + lines.join('\r\n');
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
