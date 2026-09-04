// Pure helpers for the "Estimation des temps" module — name/month matching
// and the numeric rules for prorated totals and group aggregation. Kept
// framework/Supabase-free so they're testable without a DB or React.

const FRENCH_MONTHS: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
};

// Lowercase, strip accents, collapse punctuation/whitespace to single
// spaces — used for both employee full-name and client-name matching so an
// all-caps unaccented import ("ANTOINE PANICUCCI") matches a DB row stored
// with accents/mixed case ("Cléa Boulland").
export function normalizeNameForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Compares an imported "Firstname Lastname" string against a DB row's
// first_name/last_name as one normalized full name — never splits the raw
// string into first/last parts, since real names in this DB have
// multi-word first or last names (e.g. "Aubert de Vincelles") that a naive
// split would get wrong.
export function matchesEmployeeName(rawFullName: string, firstName: string, lastName: string): boolean {
  return normalizeNameForMatch(rawFullName) === normalizeNameForMatch(`${firstName} ${lastName}`);
}

export function matchesClientName(rawName: string, clientMissionName: string): boolean {
  return normalizeNameForMatch(rawName) === normalizeNameForMatch(clientMissionName);
}

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prevRow = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const currRow = [i];
    for (let j = 1; j <= b.length; j += 1) {
      currRow[j] =
        a[i - 1] === b[j - 1]
          ? prevRow[j - 1]
          : 1 + Math.min(prevRow[j - 1], prevRow[j], currRow[j - 1]);
    }
    prevRow = currRow;
  }
  return prevRow[b.length];
}

// Similarity in [0,1] (1 = identical) between a raw imported name and an
// existing employee's full name — used ONLY to rank suggestions in the
// resolve step's "match an existing employee" dropdown, never to
// auto-resolve an import row. matchesEmployeeName above stays the sole
// strict-equality check that drives any automatic decision; loosening that
// one would risk silently mismatching two different people (see CLAUDE.md).
export function employeeNameSimilarity(rawFullName: string, firstName: string, lastName: string): number {
  const a = normalizeNameForMatch(rawFullName);
  const b = normalizeNameForMatch(`${firstName} ${lastName}`);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

// The import file's "Date - Mois" column is a bare French month name, no
// year, no accent-normalization guaranteed — resolved against the current
// import's own selected year (see ImportTimeActualsWizard).
export function frenchMonthNameToNumber(raw: string): number | null {
  const key = normalizeNameForMatch(raw);
  return FRENCH_MONTHS[key] ?? null;
}

// The import's "ETP Moy" column is a fraction of full-time (0.117994 =
// 11.8%); assignments.etp_vendu/etp_reel are stored as 0-150 percentages.
export function etpFractionToPct(fraction: number): number {
  return fraction * 100;
}

// Sums a fixed range of monthly values, treating an absent month as 0.
export function sumOfMonths(values: Array<number | null | undefined>): number {
  return values.reduce((sum: number, v) => sum + (v ?? 0), 0);
}

// Average over the FULL length of the range, not just the present values —
// an absent month counts as 0 in the average rather than being excluded
// from the denominator (explicit user decision: a month genuinely worked
// at 0% must pull the average down like any other value, it isn't "no
// data"). Used at all three cascade levels: past months, remaining months,
// and the full year (% total actual N = averageOverRange of all 12).
export function averageOverRange(values: Array<number | null | undefined>): number {
  return values.length === 0 ? 0 : sumOfMonths(values) / values.length;
}

// Sums a set of nullable numbers, treating null/undefined as absent rather
// than zero — null only when EVERY value is absent (so a "cumul" column
// stays blank when nobody in the group has that metric, instead of
// misleadingly showing 0).
export function sumNullable(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0);
}

// "Constaté" for the org chart's employee card gauge: the average of the
// already-elapsed months of `year`, summed across every client/mission the
// employee has actual time logged against — same lastMonth/averageOverRange
// logic as TimeEstimationGrid's own per-row avgPast, but aggregated at the
// employee level (all clients combined) since the card shows one number per
// person, not per client. Takes the pre-filtered TimeActual rows for a given
// year (any resolved_employee_id) so it can compute lastMonth itself,
// exactly like the grid does — a month with zero actuals imported anywhere
// is not "the employee did 0%", it just hasn't happened data-wise yet.
export function computeAvgPastMonths(
  actuals: Array<{ resolved_employee_id: string | null; resolved_client_mission_id: string | null; year: number; month: number; etp_pct: number }>,
  employeeId: string,
  year: number,
): number | null {
  const yearRows = actuals.filter((a) => a.year === year && a.resolved_employee_id && a.resolved_client_mission_id);
  const lastMonth = yearRows.reduce((max, a) => Math.max(max, a.month), 0);
  if (lastMonth === 0) return null;

  const employeeRows = yearRows.filter((a) => a.resolved_employee_id === employeeId);
  if (employeeRows.length === 0) return null;

  const byMonth = new Array(lastMonth).fill(null) as Array<number | null>;
  for (const row of employeeRows) {
    if (row.month > lastMonth) continue;
    const idx = row.month - 1;
    byMonth[idx] = (byMonth[idx] ?? 0) + row.etp_pct;
  }
  return averageOverRange(byMonth);
}

// Aggregates a group's rows (primary + members) into one "cumul" row by
// summing every numeric metric column-by-column — used for every numeric
// column in the grid (vendu, prevu, N-1 total, each monthly actual,
// planned, total), so the union of keys across rows must be summed
// independently per key rather than assuming every row has the same shape.
export function sumMetricRows(rows: Array<Record<string, number | null>>): Record<string, number | null> {
  const keys = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((key) => keys.add(key)));
  const result: Record<string, number | null> = {};
  keys.forEach((key) => {
    result[key] = sumNullable(rows.map((row) => row[key]));
  });
  return result;
}
