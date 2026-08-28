import { describe, expect, it } from 'vitest';
import {
  buildImportRowPlan,
  computeAllResolvablePairsSelection,
  computeDefaultPairSelection,
  computeDistinctRawPairs,
  computeImportDiffSummary,
  computeOnlyNewPairsSelection,
  computeRelevantUnresolvedNames,
  isNewPairKey,
  previewResolvedIds,
  rawPairKey,
  seedNeedsReviewEmployeeResolution,
  type ClientResolution,
  type EmployeeResolution,
  type ImportFieldSelection,
} from './timeImportDiff';
import type { InputN1Row, InputNRow } from './timeImportParsing';

const ALL_FIELDS: ImportFieldSelection = { n1: true, actuals: true, forecast: true };

function n1Row(overrides: Partial<InputN1Row> = {}): InputN1Row {
  return { metiers: 'ADOPS', annonceur: 'Client A', employeeName: 'Jean Dupont', n1TotalFraction: 0.1, n2026CrossCheckFraction: null, ...overrides };
}

function nRow(overrides: Partial<InputNRow> = {}): InputNRow {
  return {
    metiers: 'ADOPS',
    annonceur: 'Client A',
    employeeName: 'Jean Dupont',
    monthlyFractions: Array(12).fill(0.2),
    ...overrides,
  };
}

describe('isNewPairKey', () => {
  it('is true when the pair key is absent from existingPairKeys', () => {
    expect(isNewPairKey('emp1', 'client1', new Set(['emp2::client2']))).toBe(true);
  });

  it('is false when the pair key is present', () => {
    expect(isNewPairKey('emp1', 'client1', new Set(['emp1::client1']))).toBe(false);
  });
});

describe('seedNeedsReviewEmployeeResolution', () => {
  const registry = [
    { id: 'e1', first_name: 'Jean', last_name: 'Dupont' },
    { id: 'e2', first_name: 'Marie', last_name: 'Durand' },
  ];

  it('defaults to create, pre-filled from the raw name, when nothing is close', () => {
    const res = seedNeedsReviewEmployeeResolution('Alice Nouvelle', registry);
    expect(res.decision).toBe('create');
    expect(res.employeeId).toBeNull();
    expect(res.createFirstName).toBe('Alice');
    expect(res.createLastName).toBe('Nouvelle');
  });

  it('defaults to matching the closest employee on a near-exact spelling variant', () => {
    const res = seedNeedsReviewEmployeeResolution('Jean Dupond', registry);
    expect(res.decision).toBe('match');
    expect(res.employeeId).toBe('e1');
  });

  it('does not default to a match for two different people with similar-length names', () => {
    const res = seedNeedsReviewEmployeeResolution('Marie Dupont', registry);
    expect(res.decision).toBe('create');
    expect(res.employeeId).toBeNull();
  });

  it('defaults to create against an empty registry', () => {
    const res = seedNeedsReviewEmployeeResolution('Alice Nouvelle', []);
    expect(res.decision).toBe('create');
  });
});

describe('previewResolvedIds', () => {
  it('resolves a matched raw name to its real id', () => {
    const employeeResolutions: Record<string, EmployeeResolution> = {
      'Jean Dupont': { status: 'auto', employeeId: 'real-emp-id', decision: 'match' },
    };
    const { employeeIds } = previewResolvedIds(employeeResolutions, {});
    expect(employeeIds.get('Jean Dupont')).toBe('real-emp-id');
  });

  it('resolves a to-be-created raw name to a unique placeholder that never matches a real id', () => {
    const employeeResolutions: Record<string, EmployeeResolution> = {
      'Jean Dupont': { status: 'needs-review', employeeId: null, decision: 'create', createFirstName: 'Jean', createLastName: 'Dupont' },
    };
    const { employeeIds } = previewResolvedIds(employeeResolutions, {});
    const placeholder = employeeIds.get('Jean Dupont');
    expect(placeholder).toBeTruthy();
    expect(placeholder).not.toBe('real-emp-id');
    // Two different raw names never collide.
    const employeeResolutions2: Record<string, EmployeeResolution> = {
      'Jean Dupont': { status: 'needs-review', employeeId: null, decision: 'create' },
      'Alice Martin': { status: 'needs-review', employeeId: null, decision: 'create' },
    };
    const { employeeIds: ids2 } = previewResolvedIds(employeeResolutions2, {});
    expect(ids2.get('Jean Dupont')).not.toBe(ids2.get('Alice Martin'));
  });

  it('resolves ignore/undecided to null', () => {
    const employeeResolutions: Record<string, EmployeeResolution> = {
      Ignored: { status: 'needs-review', employeeId: null, decision: 'ignore' },
      Undecided: { status: 'needs-review', employeeId: null, decision: null },
    };
    const { employeeIds } = previewResolvedIds(employeeResolutions, {});
    expect(employeeIds.get('Ignored')).toBeNull();
    expect(employeeIds.get('Undecided')).toBeNull();
  });

  it('resolves client resolutions the same way (match/create/null)', () => {
    const clientResolutions: Record<string, ClientResolution> = {
      'Client A': { status: 'auto', clientMissionId: 'real-client-id', decision: 'match' },
      'Client B': { status: 'needs-review', clientMissionId: null, decision: 'create', createName: 'Client B' },
      'Client C': { status: 'needs-review', clientMissionId: null, decision: null },
    };
    const { clientIds } = previewResolvedIds({}, clientResolutions);
    expect(clientIds.get('Client A')).toBe('real-client-id');
    expect(clientIds.get('Client B')).toBeTruthy();
    expect(clientIds.get('Client B')).not.toBe('real-client-id');
    expect(clientIds.get('Client C')).toBeNull();
  });
});

describe('computeDistinctRawPairs', () => {
  it('unions pairs from both sheets, deduplicated', () => {
    const pairs = computeDistinctRawPairs(
      [n1Row({ employeeName: 'A', annonceur: 'X' })],
      [nRow({ employeeName: 'A', annonceur: 'X' }), nRow({ employeeName: 'B', annonceur: 'Y' })],
    );
    expect(pairs).toEqual([
      { employeeName: 'A', clientName: 'X' },
      { employeeName: 'B', clientName: 'Y' },
    ]);
  });

  it('skips a row missing either name', () => {
    const pairs = computeDistinctRawPairs([n1Row({ employeeName: null })], [nRow({ annonceur: null })]);
    expect(pairs).toEqual([]);
  });
});

describe('computeDefaultPairSelection', () => {
  const rawPairs = [
    { employeeName: 'Known Emp', clientName: 'Known Client' },
    { employeeName: 'New Emp', clientName: 'New Client' },
    { employeeName: 'Unresolved Emp', clientName: 'Known Client' },
  ];
  const employeeIds = new Map([
    ['Known Emp', 'emp1'],
    ['New Emp', 'emp2'],
  ]);
  const clientIds = new Map([
    ['Known Client', 'client1'],
    ['New Client', 'client2'],
  ]);
  const existingPairKeys = new Set(['emp1::client1']);

  it('selects only pairs that resolve to real ids AND are already known', () => {
    const selection = computeDefaultPairSelection(rawPairs, employeeIds, clientIds, existingPairKeys);
    expect(selection).toEqual(new Set([rawPairKey('Known Emp', 'Known Client')]));
  });

  it('never selects a pair with an unresolved side', () => {
    const selection = computeDefaultPairSelection(rawPairs, employeeIds, clientIds, existingPairKeys);
    expect(selection.has(rawPairKey('Unresolved Emp', 'Known Client'))).toBe(false);
  });
});

describe('computeOnlyNewPairsSelection', () => {
  it('selects exactly the inverse of computeDefaultPairSelection for resolved pairs', () => {
    const rawPairs = [
      { employeeName: 'Known Emp', clientName: 'Known Client' },
      { employeeName: 'New Emp', clientName: 'New Client' },
    ];
    const employeeIds = new Map([
      ['Known Emp', 'emp1'],
      ['New Emp', 'emp2'],
    ]);
    const clientIds = new Map([
      ['Known Client', 'client1'],
      ['New Client', 'client2'],
    ]);
    const existingPairKeys = new Set(['emp1::client1']);
    const selection = computeOnlyNewPairsSelection(rawPairs, employeeIds, clientIds, existingPairKeys);
    expect(selection).toEqual(new Set([rawPairKey('New Emp', 'New Client')]));
  });
});

describe('computeAllResolvablePairsSelection', () => {
  it('selects every pair whose employee and client both resolve, regardless of new/existing', () => {
    const rawPairs = [
      { employeeName: 'Known Emp', clientName: 'Known Client' },
      { employeeName: 'New Emp', clientName: 'New Client' },
      { employeeName: 'Unresolved Emp', clientName: 'Known Client' },
    ];
    const employeeIds = new Map([
      ['Known Emp', 'emp1'],
      ['New Emp', 'emp2'],
    ]);
    const clientIds = new Map([
      ['Known Client', 'client1'],
      ['New Client', 'client2'],
    ]);
    const selection = computeAllResolvablePairsSelection(rawPairs, employeeIds, clientIds);
    expect(selection).toEqual(new Set([rawPairKey('Known Emp', 'Known Client'), rawPairKey('New Emp', 'New Client')]));
  });
});

describe('buildImportRowPlan', () => {
  const employeeIds = new Map([['Jean Dupont', 'emp1']]);
  const clientIds = new Map([['Client A', 'client1']]);
  const selectAll = new Set([rawPairKey('Jean Dupont', 'Client A')]);

  it('writes nothing for a category the user unchecked', () => {
    const plan = buildImportRowPlan({
      n1Rows: [n1Row()],
      nRows: [nRow()],
      employeeIds,
      clientIds,
      existingPairKeys: new Set(),
      importFields: { n1: false, actuals: false, forecast: false },
      selectedPairKeys: selectAll,
      year: 2026,
      cutoffMonth: 6,
    });
    expect(plan.n1UpsertRows).toEqual([]);
    expect(plan.actualUpsertRows).toEqual([]);
    expect(plan.forecastUpsertRows).toEqual([]);
  });

  it('splits monthly fractions into actuals (<=cutoffMonth) and forecast (>cutoffMonth)', () => {
    const plan = buildImportRowPlan({
      n1Rows: [],
      nRows: [nRow()],
      employeeIds,
      clientIds,
      existingPairKeys: new Set(),
      importFields: ALL_FIELDS,
      selectedPairKeys: selectAll,
      year: 2026,
      cutoffMonth: 6,
    });
    expect(plan.actualUpsertRows).toHaveLength(6);
    expect(plan.forecastUpsertRows).toHaveLength(6);
    expect(plan.actualUpsertRows.every((r) => r.month <= 6)).toBe(true);
    expect(plan.forecastUpsertRows.every((r) => r.month > 6)).toBe(true);
  });

  it('writes a null monthly cell as an explicit 0, never skips it', () => {
    const plan = buildImportRowPlan({
      n1Rows: [],
      nRows: [nRow({ monthlyFractions: [null, ...Array(11).fill(0.2)] })],
      employeeIds,
      clientIds,
      existingPairKeys: new Set(),
      importFields: ALL_FIELDS,
      selectedPairKeys: selectAll,
      year: 2026,
      cutoffMonth: 6,
    });
    const januaryRow = plan.actualUpsertRows.find((r) => r.month === 1);
    expect(januaryRow?.etp_pct).toBe(0);
  });

  it('a pair not in selectedPairKeys is written nowhere, on every category', () => {
    const plan = buildImportRowPlan({
      n1Rows: [n1Row()],
      nRows: [nRow()],
      employeeIds,
      clientIds,
      existingPairKeys: new Set(['emp1::client1']),
      importFields: ALL_FIELDS,
      selectedPairKeys: new Set(), // nothing selected
      year: 2026,
      cutoffMonth: 6,
    });
    expect(plan.n1UpsertRows).toEqual([]);
    expect(plan.actualUpsertRows).toEqual([]);
    expect(plan.forecastUpsertRows).toEqual([]);
    expect(plan.affectedPairKeys.size).toBe(0);
  });

  it('a pair present only in Input N-1 is zero-filled into every actual/forecast month, if selected', () => {
    const plan = buildImportRowPlan({
      n1Rows: [n1Row()],
      nRows: [],
      employeeIds,
      clientIds,
      existingPairKeys: new Set(),
      importFields: ALL_FIELDS,
      selectedPairKeys: selectAll,
      year: 2026,
      cutoffMonth: 6,
    });
    expect(plan.actualUpsertRows).toHaveLength(6);
    expect(plan.actualUpsertRows.every((r) => r.etp_pct === 0)).toBe(true);
    expect(plan.forecastUpsertRows).toHaveLength(6);
    expect(plan.forecastUpsertRows.every((r) => r.pct === 0)).toBe(true);
  });

  it('a pair present only in Input N is zero-filled into the N-1 total, if selected', () => {
    const plan = buildImportRowPlan({
      n1Rows: [],
      nRows: [nRow()],
      employeeIds,
      clientIds,
      existingPairKeys: new Set(),
      importFields: ALL_FIELDS,
      selectedPairKeys: selectAll,
      year: 2026,
      cutoffMonth: 6,
    });
    expect(plan.n1UpsertRows).toHaveLength(1);
    expect(plan.n1UpsertRows[0].total_pct).toBe(0);
  });

  it('classifies a pair as new when either side resolves to a create placeholder', () => {
    const previewIds = previewResolvedIds(
      { 'Jean Dupont': { status: 'needs-review', employeeId: null, decision: 'create' } },
      { 'Client A': { status: 'auto', clientMissionId: 'client1', decision: 'match' } },
    );
    const plan = buildImportRowPlan({
      n1Rows: [],
      nRows: [nRow()],
      employeeIds: previewIds.employeeIds,
      clientIds: previewIds.clientIds,
      // Real pair already known under a DIFFERENT (real) employee id — must
      // not accidentally match the placeholder.
      existingPairKeys: new Set(['some-other-real-emp::client1']),
      importFields: ALL_FIELDS,
      selectedPairKeys: selectAll,
      year: 2026,
      cutoffMonth: 6,
    });
    expect(plan.newPairKeys.size).toBe(1);
  });

  it('excludes a pair whose employee or client side is unresolved, even if raw-selected', () => {
    const plan = buildImportRowPlan({
      n1Rows: [n1Row()],
      nRows: [nRow()],
      employeeIds: new Map(), // 'Jean Dupont' resolves to undefined -> falsy
      clientIds,
      existingPairKeys: new Set(),
      importFields: ALL_FIELDS,
      selectedPairKeys: selectAll,
      year: 2026,
      cutoffMonth: 6,
    });
    expect(plan.n1UpsertRows).toEqual([]);
    expect(plan.actualUpsertRows).toEqual([]);
    expect(plan.forecastUpsertRows).toEqual([]);
    expect(plan.affectedPairKeys.size).toBe(0);
  });

  it('sums n1/forecast into one row, not two, when two raw names resolve to the same employee', () => {
    // "Jean Dupont" and "J. Dupont" — two raw spellings both resolved to the
    // same real employee id. n1_totals/forecast_months have no raw-name
    // column to disambiguate by (unlike time_actuals), so two rows sharing
    // the same (employee_id, client_mission_id, year[, month]) would collide
    // in a single upsert() call and Postgres would reject the whole batch.
    const sharedEmployeeIds = new Map([
      ['Jean Dupont', 'emp1'],
      ['J. Dupont', 'emp1'],
    ]);
    const bothSelected = new Set([rawPairKey('Jean Dupont', 'Client A'), rawPairKey('J. Dupont', 'Client A')]);
    const plan = buildImportRowPlan({
      n1Rows: [n1Row({ n1TotalFraction: 0.1 }), n1Row({ employeeName: 'J. Dupont', n1TotalFraction: 0.05 })],
      nRows: [nRow({ monthlyFractions: Array(12).fill(0.1) }), nRow({ employeeName: 'J. Dupont', monthlyFractions: Array(12).fill(0.2) })],
      employeeIds: sharedEmployeeIds,
      clientIds,
      existingPairKeys: new Set(),
      importFields: ALL_FIELDS,
      selectedPairKeys: bothSelected,
      year: 2026,
      cutoffMonth: 6,
    });
    expect(plan.n1UpsertRows).toHaveLength(1);
    expect(plan.n1UpsertRows[0].total_pct).toBeCloseTo(15); // 10% + 5%
    expect(plan.forecastUpsertRows).toHaveLength(6); // one per remaining month, not twelve
    expect(plan.forecastUpsertRows.every((r) => r.pct === 30)).toBe(true); // 10% + 20% each month
  });
});

describe('computeRelevantUnresolvedNames', () => {
  const rawPairs = [
    { employeeName: 'Unresolved Emp', clientName: 'Selected Client' },
    { employeeName: 'Resolved Emp', clientName: 'Selected Client' },
    { employeeName: 'Unresolved Emp', clientName: 'Not Selected Client' },
    { employeeName: 'Selected Emp', clientName: 'Unresolved Client' },
  ];
  const employeeResolutions: Record<string, EmployeeResolution> = {
    'Unresolved Emp': { status: 'needs-review', employeeId: null, decision: null },
    'Resolved Emp': { status: 'auto', employeeId: 'emp1', decision: 'match' },
  };
  const clientResolutions: Record<string, ClientResolution> = {
    'Unresolved Client': { status: 'needs-review', clientMissionId: null, decision: null },
  };

  it('surfaces an unresolved employee only when their client is selected', () => {
    const { employees } = computeRelevantUnresolvedNames(
      new Set(['Selected Client']),
      new Set(),
      rawPairs,
      employeeResolutions,
      clientResolutions,
    );
    expect(employees).toEqual(['Unresolved Emp']);
  });

  it('surfaces an unresolved client only when their employee is selected', () => {
    const { clients } = computeRelevantUnresolvedNames(new Set(), new Set(['Selected Emp']), rawPairs, employeeResolutions, clientResolutions);
    expect(clients).toEqual(['Unresolved Client']);
  });

  it('never surfaces an already-resolved name', () => {
    const { employees } = computeRelevantUnresolvedNames(
      new Set(['Selected Client']),
      new Set(),
      rawPairs,
      employeeResolutions,
      clientResolutions,
    );
    expect(employees).not.toContain('Resolved Emp');
  });
});

describe('computeImportDiffSummary', () => {
  it('reconciles counts across create/match/ignore/undecided on both sides', () => {
    const employeeResolutions: Record<string, EmployeeResolution> = {
      'New Employee': { status: 'needs-review', employeeId: null, decision: 'create', createFirstName: 'New', createLastName: 'Employee' },
      'Matched Employee': { status: 'auto', employeeId: 'emp1', decision: 'match' },
      'Ignored Employee': { status: 'needs-review', employeeId: null, decision: 'ignore' },
      'Undecided Employee': { status: 'needs-review', employeeId: null, decision: null },
    };
    const clientResolutions: Record<string, ClientResolution> = {
      'New Client': { status: 'needs-review', clientMissionId: null, decision: 'create', createName: 'New Client' },
      'Matched Client': { status: 'auto', clientMissionId: 'client1', decision: 'match' },
      'Undecided Client': { status: 'needs-review', clientMissionId: null, decision: null },
    };
    const n1Rows: InputN1Row[] = [n1Row({ annonceur: 'Matched Client', employeeName: 'Matched Employee' })];
    const nRows: InputNRow[] = [nRow({ annonceur: 'Matched Client', employeeName: 'Matched Employee' })];
    const selectedPairKeys = new Set([rawPairKey('Matched Employee', 'Matched Client')]);

    const summary = computeImportDiffSummary(employeeResolutions, clientResolutions, n1Rows, nRows, new Set(), ALL_FIELDS, selectedPairKeys, 2026, 6);

    expect(summary.employeesToCreate).toEqual(['New Employee']);
    expect(summary.employeesMatchedCount).toBe(1);
    expect(summary.employeesIgnoredCount).toBe(2); // ignore + undecided
    expect(summary.clientsToCreate).toEqual(['New Client']);
    expect(summary.clientsMatchedCount).toBe(1);
    expect(summary.clientsIgnoredCount).toBe(1); // undecided only, clients have no explicit ignore
    expect(summary.newPairsSelectedCount).toBe(1); // Matched Employee x Matched Client, not in existingPairKeys, and selected
    expect(summary.existingPairsSelectedCount).toBe(0);
    expect(summary.newPairsSkippedCount).toBe(0);
    expect(summary.existingPairsSkippedCount).toBe(0);
    expect(summary.unresolvedPairsCount).toBe(0);
    expect(summary.undecidedCount).toBe(2); // one employee, one client
  });

  it('counts an already-known, selected pair as existing-selected, not new', () => {
    const employeeResolutions: Record<string, EmployeeResolution> = {
      'Jean Dupont': { status: 'auto', employeeId: 'emp1', decision: 'match' },
    };
    const clientResolutions: Record<string, ClientResolution> = {
      'Client A': { status: 'auto', clientMissionId: 'client1', decision: 'match' },
    };
    const selectedPairKeys = new Set([rawPairKey('Jean Dupont', 'Client A')]);
    const summary = computeImportDiffSummary(
      employeeResolutions,
      clientResolutions,
      [n1Row()],
      [nRow()],
      new Set(['emp1::client1']),
      ALL_FIELDS,
      selectedPairKeys,
      2026,
      6,
    );
    expect(summary.newPairsSelectedCount).toBe(0);
    expect(summary.existingPairsSelectedCount).toBe(1);
  });

  it('counts an already-known, unselected pair as existing-skipped', () => {
    const employeeResolutions: Record<string, EmployeeResolution> = {
      'Jean Dupont': { status: 'auto', employeeId: 'emp1', decision: 'match' },
    };
    const clientResolutions: Record<string, ClientResolution> = {
      'Client A': { status: 'auto', clientMissionId: 'client1', decision: 'match' },
    };
    const summary = computeImportDiffSummary(
      employeeResolutions,
      clientResolutions,
      [n1Row()],
      [nRow()],
      new Set(['emp1::client1']),
      ALL_FIELDS,
      new Set(), // nothing selected
      2026,
      6,
    );
    expect(summary.existingPairsSkippedCount).toBe(1);
    expect(summary.newPairsSelectedCount).toBe(0);
    expect(summary.existingPairsSelectedCount).toBe(0);
  });

  it('falls back to a naive name split/title-case when create-name fields are blank', () => {
    // Mirrors employeeCreateDisplayName/clientCreateDisplayName's own
    // fallback exactly: employee falls back to splitPersonName (no
    // title-casing — only the resolve-step UI's own "Créer" button seeds
    // toTitleCase into createFirstName/createLastName, this is the raw
    // fallback for when those are truly blank), client falls back to
    // toTitleCase(rawName).
    const employeeResolutions: Record<string, EmployeeResolution> = {
      'JEAN DUPONT': { status: 'needs-review', employeeId: null, decision: 'create' },
    };
    const clientResolutions: Record<string, ClientResolution> = {
      'CLIENT A': { status: 'needs-review', clientMissionId: null, decision: 'create' },
    };
    const summary = computeImportDiffSummary(employeeResolutions, clientResolutions, [], [], new Set(), ALL_FIELDS, new Set(), 2026, 6);
    expect(summary.employeesToCreate).toEqual(['JEAN DUPONT']);
    expect(summary.clientsToCreate).toEqual(['Client A']);
  });
});
