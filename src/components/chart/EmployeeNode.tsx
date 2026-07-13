import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { etpStatus } from '../../lib/etpStatus';
import type { Employee } from '../../types/domain';

export interface EmployeeNodeActions {
  quickAddManager: (employeeId: string) => void;
  quickAddSubordinate: (employeeId: string) => void;
  openLinkManager: (employeeId: string) => void;
  openLinkSubordinate: (employeeId: string) => void;
  openAssignments: (employeeId: string) => void;
  updateEmployee: (
    id: string,
    changes: Partial<Pick<Employee, 'first_name' | 'last_name' | 'job_title' | 'department'>>,
  ) => Promise<Employee>;
}

export interface EmployeeNodeData {
  employee: Employee;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isMatch: boolean;
  assignmentsCount: number;
  assignmentsTotalEtp: number;
  jobTitles: string[];
  departmentNames: string[];
  departmentColor: string | null;
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

type EditableField = 'first_name' | 'last_name' | 'job_title' | 'department';

function EmployeeNodeImpl({ data }: NodeProps<EmployeeNodeData>) {
  const {
    employee,
    hasChildren,
    isExpanded,
    isSelected,
    isMatch,
    assignmentsCount,
    assignmentsTotalEtp,
    jobTitles,
    departmentNames,
    departmentColor,
    onToggleExpand,
    actions,
  } = data;

  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState('');

  function startEdit(field: EditableField, currentValue: string) {
    setDraft(currentValue);
    setEditingField(field);
  }

  function cancelEdit() {
    setEditingField(null);
  }

  async function commitEdit() {
    const field = editingField;
    if (!field) return;
    try {
      await actions.updateEmployee(employee.id, { [field]: draft });
    } catch (err) {
      console.error(err);
    } finally {
      setEditingField(null);
    }
  }

  const borderClass = isSelected
    ? 'border-slate-900 ring-2 ring-slate-900'
    : isMatch
      ? 'border-amber-400 ring-2 ring-amber-300'
      : 'border-slate-300';

  const textInputClass =
    'min-w-0 flex-1 rounded border border-slate-300 px-1 py-0.5 text-sm font-semibold text-slate-900';

  return (
    <div
      className={`relative w-[220px] rounded-lg border bg-white px-3 py-2 shadow-sm ${borderClass}`}
      style={departmentColor ? { borderLeftColor: departmentColor, borderLeftWidth: 4 } : undefined}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />

      <AddButton
        label="Ajouter un manager"
        position="top"
        onCreateNew={() => actions.quickAddManager(employee.id)}
        onLinkExisting={() => actions.openLinkManager(employee.id)}
      />

      <div className="flex items-center gap-1 text-sm font-semibold text-slate-900">
        {editingField === 'first_name' ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              else if (e.key === 'Escape') cancelEdit();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={textInputClass}
          />
        ) : (
          <span
            className="truncate"
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEdit('first_name', employee.first_name);
            }}
          >
            {employee.first_name}
          </span>
        )}
        {editingField === 'last_name' ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              else if (e.key === 'Escape') cancelEdit();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={textInputClass}
          />
        ) : (
          <span
            className="truncate"
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEdit('last_name', employee.last_name);
            }}
          >
            {employee.last_name}
          </span>
        )}
      </div>

      {editingField === 'job_title' ? (
        <select
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancelEdit();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="mt-0.5 w-full rounded border border-slate-300 px-1 py-0.5 text-xs text-slate-700"
        >
          <option value="" disabled>
            Choisir un poste…
          </option>
          {jobTitles.map((title) => (
            <option key={title} value={title}>
              {title}
            </option>
          ))}
        </select>
      ) : employee.job_title ? (
        <div
          className="truncate text-xs text-slate-500"
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEdit('job_title', employee.job_title ?? '');
          }}
        >
          {employee.job_title}
        </div>
      ) : (
        <div
          className="truncate text-xs text-slate-300"
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEdit('job_title', '');
          }}
        >
          + poste
        </div>
      )}

      {editingField === 'department' ? (
        <select
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancelEdit();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="mt-0.5 w-full rounded border border-slate-300 px-1 py-0.5 text-xs text-slate-700"
        >
          <option value="" disabled>
            Choisir une business unit…
          </option>
          {departmentNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ) : employee.department ? (
        <div
          className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEdit('department', employee.department ?? '');
          }}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: departmentColor ?? undefined }}
          />
          <span className="truncate">{employee.department}</span>
        </div>
      ) : (
        <div
          className="mt-0.5 truncate text-xs text-slate-300"
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEdit('department', '');
          }}
        >
          + business unit
        </div>
      )}

      {assignmentsCount > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            actions.openAssignments(employee.id);
          }}
          className={`mt-1 block rounded px-1.5 py-0.5 text-xs ${
            etpStatus(assignmentsTotalEtp) === 'green'
              ? 'bg-emerald-50 text-emerald-700'
              : etpStatus(assignmentsTotalEtp) === 'amber'
                ? 'bg-amber-50 text-amber-700'
                : 'bg-red-50 text-red-700'
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
