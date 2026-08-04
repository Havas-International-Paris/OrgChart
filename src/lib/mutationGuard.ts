// Postgres RLS denies an UPDATE/DELETE by matching zero rows, not by
// throwing — supabase-js reports that as a normal success with an empty
// array, not an error. Every UPDATE/DELETE call chains .select() and passes
// its result through this so a denial is DETECTABLE instead of silent (a
// button that visibly does nothing, no error anywhere — hit for real with
// org-chart deletion, see orgChartService.deleteOrgChart's original fix).
export class PermissionDeniedError extends Error {
  constructor(message = 'Permission denied') {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

export function assertRowsAffected<T>(
  data: T[] | null,
  error: { message: string } | null,
): asserts data is T[] {
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new PermissionDeniedError();
  }
}
