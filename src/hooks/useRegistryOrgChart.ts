import { useEffect, useState } from 'react';
import * as orgChartService from '../services/orgChartService';
import type { OrgChart } from '../types/domain';

// One-shot fetch of the registry chart (backlog item 58) — no realtime
// subscription needed, unlike every other data hook in this app: the
// registry chart's own ROW (name/short_label) essentially never changes
// after being seeded by the migration, and a partial unique index guarantees
// there's ever at most one. Consumers that need live registry EMPLOYEE data
// (the import picker) fetch that separately, scoped to this chart's id.
export function useRegistryOrgChart() {
  const [registryOrgChart, setRegistryOrgChart] = useState<OrgChart | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    orgChartService
      .fetchRegistryOrgChart()
      .then((chart) => {
        if (!cancelled) setRegistryOrgChart(chart);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { registryOrgChart, loading };
}
