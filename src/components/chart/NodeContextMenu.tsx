import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const entries: ContextMenuEntry[] = [
    { label: t('chart.contextMenu.newManager'), onSelect: onAddManager },
    { label: t('chart.contextMenu.linkManager'), onSelect: onLinkManager },
    { separator: true },
    { label: t('chart.contextMenu.newSubordinate'), onSelect: onAddSubordinate },
    { label: t('chart.contextMenu.linkSubordinate'), onSelect: onLinkSubordinate },
    { separator: true },
    { label: t('chart.contextMenu.deleteEmployee'), danger: true, onSelect: onDelete },
  ];

  return <ContextMenu x={x} y={y} header={employeeName} entries={entries} onClose={onClose} />;
}
