import dagre from 'dagre';
import type { Node, Edge } from 'reactflow';

export const NODE_WIDTH = 220;
// Approximate spacing hint for dagre only — actual card height is
// content-driven (avatar row, dept pill, two ETP bars, advertisers,
// badge) and auto-measured by React Flow once mounted, same as NODE_WIDTH.
export const NODE_HEIGHT = 190;

export function layoutWithDagre<T extends Node>(nodes: T[], edges: Edge[]): T[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 32, ranksep: 64 });

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });
}
