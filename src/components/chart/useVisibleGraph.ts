import { useMemo } from 'react';
import type { Employee, ReportingRelationship } from '../../types/domain';

export interface VisibleGraphResult {
  visibleEmployees: Employee[];
  childrenOf: Map<string, string[]>;
  roots: Employee[];
}

export function useVisibleGraph(
  employees: Employee[],
  primaryEdges: ReportingRelationship[],
  expandedNodeIds: Set<string>,
): VisibleGraphResult {
  return useMemo(() => {
    const childrenOf = new Map<string, string[]>();
    const hasPrimaryManager = new Set<string>();

    for (const edge of primaryEdges) {
      hasPrimaryManager.add(edge.employee_id);
      const siblings = childrenOf.get(edge.manager_id) ?? [];
      siblings.push(edge.employee_id);
      childrenOf.set(edge.manager_id, siblings);
    }

    const roots = employees.filter((e) => !hasPrimaryManager.has(e.id));
    const employeeById = new Map(employees.map((e) => [e.id, e]));

    const visible = new Map<string, Employee>();
    const queue = [...roots];
    for (const root of roots) visible.set(root.id, root);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (!expandedNodeIds.has(current.id)) continue;
      const childIds = childrenOf.get(current.id) ?? [];
      for (const childId of childIds) {
        if (visible.has(childId)) continue;
        const child = employeeById.get(childId);
        if (!child) continue;
        visible.set(childId, child);
        queue.push(child);
      }
    }

    return { visibleEmployees: [...visible.values()], childrenOf, roots };
  }, [employees, primaryEdges, expandedNodeIds]);
}
