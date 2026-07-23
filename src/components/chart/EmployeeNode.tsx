import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { NEUTRAL_DEPARTMENT_COLOR, withAlpha } from '../../lib/departmentColor';
import { PhotoAvatar } from '../shared/PhotoAvatar';
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
  openPhotoEditor: (employeeId: string) => void;
  deleteEmployee: (employeeId: string) => void;
}

export interface EmployeeNodeData {
  employee: Employee;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isMatch: boolean;
  isDimmed: boolean;
  assignmentsCount: number;
  assignmentsTotalEtpVendu: number;
  assignmentsTotalEtpReel: number;
  advertiserNames: string[];
  directReportsCount: number;
  totalDescendantCount: number;
  functionalManagerCount: number;
  hasManager: boolean;
  isFocused: boolean;
  focusHiddenCount: number;
  jobTitles: string[];
  departmentNames: string[];
  departmentColor: string | null;
  onToggleExpand: (employeeId: string) => void;
  onToggleFocus: (employeeId: string) => void;
  actions: EmployeeNodeActions;
}

function AddButton({
  label,
  corner,
  onCreateNew,
  onLinkExisting,
}: {
  label: string;
  corner: 'top-right' | 'bottom-right';
  onCreateNew: () => void;
  onLinkExisting: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isTop = corner === 'top-right';

  return (
    <div data-export-hide className={`absolute right-[-9px] ${isTop ? 'top-[-9px]' : 'bottom-[-9px]'}`}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title={label}
        className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-dashed border-slate-300 bg-white text-[11px] font-bold leading-none text-slate-400 shadow-sm hover:bg-slate-50"
      >
        +
      </button>
      {open && (
        <div
          className={`absolute right-0 z-10 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg ${
            isTop ? 'top-6' : 'bottom-6'
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

function CollapseBadge({
  position,
  label,
  swatch,
  trackColor,
  onToggle,
  title,
}: {
  position: 'top' | 'bottom';
  label: string;
  swatch: string;
  trackColor: string;
  onToggle: () => void;
  title: string;
}) {
  const isCount = label.startsWith('+');
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={title}
      className={`absolute left-1/2 z-[6] flex h-[22px] w-[22px] -translate-x-1/2 items-center justify-center rounded-full border bg-white font-bold leading-none shadow-sm hover:bg-slate-50 ${
        isCount ? 'text-[8px]' : 'text-[13px]'
      } ${position === 'top' ? '-top-[11px]' : '-bottom-[11px]'}`}
      style={{ borderColor: trackColor, color: swatch }}
    >
      {label}
    </button>
  );
}

function MetricRow({
  label,
  pct,
  trackColor,
  fillColor,
}: {
  label: string;
  pct: number;
  trackColor: string;
  fillColor: string;
}) {
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <span className="w-10 shrink-0 text-[9px] font-semibold text-slate-500">{label}</span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: trackColor }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: fillColor }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-[9px] font-bold text-slate-600">{pct}%</span>
    </div>
  );
}

function AdvertisersRow({ names }: { names: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = names.length > 2;
  const text = expanded ? names.join(', ') : names.slice(0, 2).join(', ');

  return (
    <div className="mt-1.5 flex items-start gap-1">
      <span className={`min-w-0 flex-1 text-[10px] text-slate-500 ${expanded ? '' : 'truncate'}`}>{text}</span>
      {truncated && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[9px] font-bold leading-4 text-slate-500 hover:bg-slate-200"
        >
          {expanded ? '−' : `+${names.length - 2}`}
        </button>
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
    isDimmed,
    assignmentsTotalEtpVendu,
    assignmentsTotalEtpReel,
    advertiserNames,
    directReportsCount,
    totalDescendantCount,
    functionalManagerCount,
    hasManager,
    isFocused,
    focusHiddenCount,
    jobTitles,
    departmentNames,
    departmentColor,
    onToggleExpand,
    onToggleFocus,
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

  const swatch = departmentColor ?? NEUTRAL_DEPARTMENT_COLOR;
  const trackColor = withAlpha(swatch, 0.15);
  const showBadge = directReportsCount > 0 || functionalManagerCount > 0;
  const badgeText =
    directReportsCount > 0
      ? `${totalDescendantCount} au total · ${directReportsCount} direct${directReportsCount > 1 ? 's' : ''}`
      : `+${functionalManagerCount} fonc.`;

  return (
    <div
      className={`relative w-[220px] rounded-lg border bg-white px-3 pb-6 pt-3 shadow-sm ${borderClass}`}
      style={{ opacity: isDimmed ? 0.3 : 1 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />

      <button
        type="button"
        data-export-hide
        onClick={(e) => {
          e.stopPropagation();
          actions.deleteEmployee(employee.id);
        }}
        title="Supprimer cet employé"
        className="absolute left-[-9px] top-[-9px] flex h-[18px] w-[18px] items-center justify-center rounded-full border border-dashed border-slate-300 bg-white text-[11px] font-bold leading-none text-slate-400 shadow-sm hover:border-red-300 hover:bg-red-50 hover:text-red-500"
      >
        ✕
      </button>

      <AddButton
        label="Ajouter un manager"
        corner="top-right"
        onCreateNew={() => actions.quickAddManager(employee.id)}
        onLinkExisting={() => actions.openLinkManager(employee.id)}
      />
      <AddButton
        label="Ajouter un subordonné"
        corner="bottom-right"
        onCreateNew={() => actions.quickAddSubordinate(employee.id)}
        onLinkExisting={() => actions.openLinkSubordinate(employee.id)}
      />

      {hasManager && (
        <CollapseBadge
          position="top"
          label={isFocused ? `+${focusHiddenCount}` : '−'}
          swatch={swatch}
          trackColor={trackColor}
          onToggle={() => onToggleFocus(employee.id)}
          title={isFocused ? 'Afficher tout le monde' : 'Isoler cette personne et son équipe'}
        />
      )}
      {hasChildren && (
        <CollapseBadge
          position="bottom"
          label={isExpanded ? '−' : `+${totalDescendantCount}`}
          swatch={swatch}
          trackColor={trackColor}
          onToggle={() => onToggleExpand(employee.id)}
          title={isExpanded ? 'Réduire l’équipe' : 'Déplier l’équipe'}
        />
      )}

      <div className="flex items-center gap-2">
        <PhotoAvatar
          employeeId={employee.id}
          firstName={employee.first_name}
          lastName={employee.last_name}
          color={swatch}
          photoPath={employee.photo_path}
          frame={{ zoom: employee.photo_zoom, panX: employee.photo_pan_x, panY: employee.photo_pan_y }}
          size={36}
          onOpen={actions.openPhotoEditor}
        />
        <div className="min-w-0 flex-1">
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
        </div>
      </div>

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
          className="mt-2 w-full rounded border border-slate-300 px-1 py-0.5 text-xs text-slate-700"
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
        <span
          className="mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ backgroundColor: trackColor, color: swatch }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEdit('department', employee.department ?? '');
          }}
        >
          {employee.department}
        </span>
      ) : (
        <div
          className="mt-2 truncate text-xs text-slate-300"
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEdit('department', '');
          }}
        >
          + business unit
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          actions.openAssignments(employee.id);
        }}
        title="Modifier les missions"
        className="mt-2 block w-full text-left"
      >
        <MetricRow
          label="Vendu"
          pct={assignmentsTotalEtpVendu}
          trackColor={trackColor}
          fillColor={withAlpha(swatch, 0.55)}
        />
        <MetricRow label="Réel" pct={assignmentsTotalEtpReel} trackColor={trackColor} fillColor={swatch} />
      </button>

      {advertiserNames.length > 0 && <AdvertisersRow names={advertiserNames} />}

      {showBadge && (
        <div className="absolute bottom-1.5 right-2.5 text-[9px] font-medium text-slate-400">{badgeText}</div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  );
}

export const EmployeeNode = memo(EmployeeNodeImpl);
