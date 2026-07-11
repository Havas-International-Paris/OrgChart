import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { Employee } from '../../types/domain';

export interface EmployeeNodeActions {
  quickAddManager: (employeeId: string) => void;
  quickAddSubordinate: (employeeId: string) => void;
  openLinkManager: (employeeId: string) => void;
  openLinkSubordinate: (employeeId: string) => void;
  openAssignments: (employeeId: string) => void;
}

export interface EmployeeNodeData {
  employee: Employee;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isMatch: boolean;
  assignmentsCount: number;
  assignmentsTotalEtp: number;
  onToggleExpand: (employeeId: string) => void;
  actions: EmployeeNodeActions;
}

function AddButton({
  label,
  position,
  onCreateNew,
  onLinkExisting,
}: {
  label: string;
  position: 'top' | 'bottom';
  onCreateNew: () => void;
  onLinkExisting: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`absolute left-1/2 -translate-x-1/2 ${position === 'top' ? '-top-3' : '-bottom-3'}`}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title={label}
        className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-xs text-slate-500 shadow-sm hover:bg-slate-50"
      >
        +
      </button>
      {open && (
        <div
          className={`absolute left-1/2 z-10 w-48 -translate-x-1/2 rounded-md border border-slate-200 bg-white py-1 shadow-lg ${
            position === 'top' ? 'bottom-7' : 'top-7'
          }`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onCreateNew();
            }}
            className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
          >
            + Nouvel employé
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onLinkExisting();
            }}
            className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
          >
            Rattacher un existant…
          </button>
        </div>
      )}
    </div>
  );
}

function EmployeeNodeImpl({ data }: NodeProps<EmployeeNodeData>) {
  const {
    employee,
    hasChildren,
    isExpanded,
    isSelected,
    isMatch,
    assignmentsCount,
    assignmentsTotalEtp,
    onToggleExpand,
    actions,
  } = data;

  const borderClass = isSelected
    ? 'border-slate-900 ring-2 ring-slate-900'
    : isMatch
      ? 'border-amber-400 ring-2 ring-amber-300'
      : 'border-slate-300';

  return (
    <div className={`relative w-[220px] rounded-lg border bg-white px-3 py-2 shadow-sm ${borderClass}`}>
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />

      <AddButton
        label="Ajouter un manager"
        position="top"
        onCreateNew={() => actions.quickAddManager(employee.id)}
        onLinkExisting={() => actions.openLinkManager(employee.id)}
      />

      <div className="truncate text-sm font-semibold text-slate-900">
        {employee.first_name} {employee.last_name}
      </div>
      {employee.job_title && (
        <div className="truncate text-xs text-slate-500">{employee.job_title}</div>
      )}
      {assignmentsCount > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            actions.openAssignments(employee.id);
          }}
          className={`mt-1 block rounded px-1.5 py-0.5 text-xs ${
            assignmentsTotalEtp === 100
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-amber-50 text-amber-700'
          }`}
        >
          {assignmentsCount} · {assignmentsTotalEtp}% ETP
        </button>
      )}
      {hasChildren && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(employee.id);
          }}
          className="mt-1 text-xs text-slate-400 hover:text-slate-700"
        >
          {isExpanded ? '▾ Réduire' : '▸ Déplier'}
        </button>
      )}

      <AddButton
        label="Ajouter un subordonné"
        position="bottom"
        onCreateNew={() => actions.quickAddSubordinate(employee.id)}
        onLinkExisting={() => actions.openLinkSubordinate(employee.id)}
      />

      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  );
}

export const EmployeeNode = memo(EmployeeNodeImpl);
