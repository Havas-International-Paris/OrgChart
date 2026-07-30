import { ContextMenu, type ContextMenuEntry } from './ContextMenu';

interface NodeContextMenuProps {
  x: number;
  y: number;
  employeeName: string;
  onAddManager: () => void;
  onLinkManager: () => void;
  onAddSubordinate: () => void;
  onLinkSubordinate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

// Right-click menu on an employee card (backlog item 34) — absorbs what
// used to be the ✕ delete button and the two "+" add-manager/
// add-subordinate popovers (commits from the matrix-org-chart redesign).
// Deliberately does NOT absorb the collapse/focus badges or the photo
// control — see useChartActions.ts's contextMenu comment for why.
export function NodeContextMenu({
  x,
  y,
  employeeName,
  onAddManager,
  onLinkManager,
  onAddSubordinate,
  onLinkSubordinate,
  onDelete,
  onClose,
}: NodeContextMenuProps) {
  const entries: ContextMenuEntry[] = [
    { label: 'Nouveau manager', onSelect: onAddManager },
    { label: 'Rattacher un manager existant…', onSelect: onLinkManager },
    { separator: true },
    { label: 'Nouveau subordonné', onSelect: onAddSubordinate },
    { label: 'Rattacher un subordonné existant…', onSelect: onLinkSubordinate },
    { separator: true },
    { label: 'Supprimer cet employé', danger: true, onSelect: onDelete },
  ];

  return <ContextMenu x={x} y={y} header={employeeName} entries={entries} onClose={onClose} />;
}
