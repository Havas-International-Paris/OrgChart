import { useMemo } from 'react';
import type { ReportingRelationship } from '../../types/domain';

export interface ReportingChainResult {
  // Every person to keep at full opacity: the active person, their full
  // ancestor chain (solid + dotted), their full descendant subtree, and
  // anyone whose dotted line points directly at them.
  relatedIds: Set<string>;
  // Subset of relatedIds an edge's *other* endpoint must also be in for
  // that edge to be considered part of the chain (used together with "the
  // edge touches the active person directly" — see OrgChartView). Excludes
  // incoming-dotted reporters, whose edge already highlights via touching
  // the active person directly.
  chainIds: Set<string>;
}

const EMPTY: ReportingChainResult = { relatedIds: new Set(), chainIds: new Set() };

// Mirrors the hover/pin highlight spec from the "Organigramme Matriciel"
// design handoff: hovering (or pinning) a person highlights their entire
// reporting chain — ancestors up the solid-line tree, ancestors of any
// dotted-line manager, the full descendant subtree, and anyone reporting
// dotted-line directly to them — dimming everyone else.
export function useReportingChain(
  activeId: string | null,
  relationships: ReportingRelationship[],
  childrenOf: Map<string, string[]>,
): ReportingChainResult {
  return useMemo(() => {
    if (!activeId) return EMPTY;

    const primaryManagerOf = new Map<string, string>();
    const dottedManagersOf = new Map<string, string[]>();
    const dottedReportersOf = new Map<string, string[]>();
    for (const r of relationships) {
      if (r.is_primary) {
        primaryManagerOf.set(r.employee_id, r.manager_id);
        continue;
      }
      const managers = dottedManagersOf.get(r.employee_id) ?? [];
      managers.push(r.manager_id);
      dottedManagersOf.set(r.employee_id, managers);

      const reporters = dottedReportersOf.get(r.manager_id) ?? [];
      reporters.push(r.employee_id);
      dottedReportersOf.set(r.manager_id, reporters);
    }

    const related = new Set<string>([activeId]);
    const chain = new Set<string>([activeId]);

    const walkUpPrimary = (fromId: string) => {
      let current = primaryManagerOf.get(fromId);
      while (current && !chain.has(current)) {
        related.add(current);
        chain.add(current);
        current = primaryManagerOf.get(current);
      }
    };
    walkUpPrimary(activeId);

    for (const managerId of dottedManagersOf.get(activeId) ?? []) {
      related.add(managerId);
      chain.add(managerId);
      walkUpPrimary(managerId);
    }

    // Cards for incoming dotted reporters stay highlighted, but the edge
    // itself is highlighted separately (it touches activeId directly) —
    // don't add them to `chain`, which is only for the "both ends inside
    // the ancestor/descendant chain" edge check.
    for (const reporterId of dottedReportersOf.get(activeId) ?? []) {
      related.add(reporterId);
    }

    const collectDescendants = (fromId: string) => {
      for (const childId of childrenOf.get(fromId) ?? []) {
        if (related.has(childId)) continue;
        related.add(childId);
        chain.add(childId);
        collectDescendants(childId);
      }
    };
    collectDescendants(activeId);

    return { relatedIds: related, chainIds: chain };
  }, [activeId, relationships, childrenOf]);
}
