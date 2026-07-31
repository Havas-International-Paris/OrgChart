import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, useConnection, type Node, type NodeProps } from '@xyflow/react';
import { NEUTRAL_DEPARTMENT_COLOR, withAlpha } from '../../lib/departmentColor';
import { PhotoAvatar } from '../shared/PhotoAvatar';
import type { Employee } from '../../types/domain';

// Adding a manager/subordinate and deleting the employee moved out of this
// bag entirely (2026-07-30, backlog item 34) — they're now the right-click
// context menu's job (OrgChartView.tsx's NodeContextMenu), wired directly
// off useChartActions.ts's own return rather than through this per-node
// prop, since the card itself no longer renders any control for them.
export interface EmployeeNodeActions {
  openAssignments: (employeeId: string) => void;
  updateEmployee: (
    id: string,
    changes: Partial<Pick<Employee, 'first_name' | 'last_name' | 'job_title' | 'department'>>,
  ) => Promise<Employee>;
  openPhotoEditor: (employeeId: string) => void;
}

// Extends Record<string, unknown> because @xyflow/react v12's Node<T> now
// requires its data generic to satisfy that shape.
export interface EmployeeNodeData extends Record<string, unknown> {
  employee: Employee;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isMatch: boolean;
  isDimmed: boolean;
  isChainHighlighted: boolean;
  // Live, drag-only feedback (siblingOrder.ts's drag-to-reorder): while
  // dragging a card near this one's sibling cluster, this person (and their
  // descendants) is who's nearest to being displaced/swapped if dropped
  // here — a distinct amber treatment from the department-colored chain
  // highlight above, since it means something different ("this is about to
  // move" vs. "this is in the hovered/selected reporting chain").
  isDisplacementTarget: boolean;
  // This card is one of the two endpoints (manager or employee) of the
  // currently-HOVERED link — see useChartNodes.ts's hoveredEdgeId. WHICH
  // cards get this flag is narrower than isChainHighlighted on purpose (the
  // two specific endpoints, not the whole ancestor/descendant chain — see
  // useChartNodes.ts), but the visual treatment is deliberately identical
  // to isChainHighlighted (below), not a distinct color.
  isHoverEdgeEndpoint: boolean;
  // Ordered relationship ids, one Handle rendered per entry — see
  // useChartNodes.ts for how the order (by each neighbor's laid-out x) and
  // the fallback synthetic id for a childless node are derived.
  incomingHandleIds: string[];
  outgoingHandleIds: string[];
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
      className={`nodrag absolute left-1/2 z-[6] flex h-[22px] w-[22px] -translate-x-1/2 items-center justify-center rounded-full border bg-white font-bold leading-none shadow-sm hover:bg-slate-50 ${
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
          className="nodrag shrink-0 rounded-full bg-slate-100 px-1.5 text-[9px] font-bold leading-4 text-slate-500 hover:bg-slate-200"
        >
          {expanded ? '−' : `+${names.length - 2}`}
        </button>
      )}
    </div>
  );
}

type EditableField = 'first_name' | 'last_name' | 'job_title' | 'department';

function EmployeeNodeImpl({ data }: NodeProps<Node<EmployeeNodeData>>) {
  const { t } = useTranslation();
  const {
    employee,
    hasChildren,
    isExpanded,
    isSelected,
    isMatch,
    isDimmed,
    isChainHighlighted,
    isDisplacementTarget,
    isHoverEdgeEndpoint,
    incomingHandleIds,
    outgoingHandleIds,
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

  // Only a card that was ALREADY selected before this gesture can open an
  // inline editor — otherwise the first click of a double-click (which also
  // bubbles up and selects the card, via React Flow's own onNodeClick) reads
  // as "select", and only a second, separate double-click on an
  // already-selected card opens the field. Without this guard, simply
  // double-clicking a not-yet-selected card to select it could accidentally
  // pop open a name/poste/department editor the user never meant to touch.
  function startEdit(field: EditableField, currentValue: string) {
    if (!isSelected) return;
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

  const swatch = departmentColor ?? NEUTRAL_DEPARTMENT_COLOR;
  const trackColor = withAlpha(swatch, 0.15);
  // Deliberately its own, lighter alpha rather than reusing trackColor — a
  // full-card background needs to read as more subtle than a small pill or
  // gauge track filled with the same color would.
  const selectedBackgroundColor = withAlpha(swatch, 0.1);

  // Live drop-candidate feedback for a native edge-reconnect drag (dragging
  // a relationship's manager end onto this card): replaces the old
  // ReportingEdge.tsx grip's manual `style.outline` DOM mutation with normal
  // render state, via React Flow's own connection store. `isValid` reflects
  // whatever <ReactFlow>'s isValidConnection prop returned for the current
  // candidate (OrgChartView.tsx wires it to computeDropValidity).
  const reconnectTarget = useConnection((c) =>
    c.inProgress && c.toNode?.id === employee.id ? { active: true, isValid: c.isValid } : { active: false, isValid: null },
  );

  // Reconnect-target feedback (green/red, only while a drag is actually
  // hovering this specific card) takes precedence over everything else — it
  // only ever applies mid-gesture, same reasoning as displacement-target
  // below. Displacement-target (drag-to-reorder, amber) is next — it only
  // ever applies while a drag is in progress, at which point hover-driven
  // chain highlighting is deliberately suppressed (see useChartNodes.ts's
  // isDraggingRef), so there's no real competing signal to lose.
  // isHoverEdgeEndpoint (this card is one of the two ends of a
  // currently-hovered LINK) deliberately renders with the EXACT SAME
  // treatment as isChainHighlighted below — colored border + glow, in the
  // card's OWN department color — rather than its own distinct color, so
  // hovering a link reads as "the same kind of highlight" a user already
  // knows from hovering/selecting a card, not a fourth unrelated color to
  // learn. Chain-highlight otherwise takes precedence over the older
  // isSelected/isMatch styling — activeEmployeeId already falls back to
  // selectedEmployeeId and relatedIds always includes the active id itself,
  // so the pinned card always satisfies isChainHighlighted whenever a chain
  // is active; this cleanly replaces its old black ring too, matching the
  // reference.
  const borderClass = reconnectTarget.active
    ? reconnectTarget.isValid
      ? 'border-2 border-emerald-500'
      : 'border-2 border-red-500'
    : isDisplacementTarget
      ? 'border-2 border-amber-500'
      : isChainHighlighted || isHoverEdgeEndpoint
        ? 'border'
        : isSelected
          ? 'border-slate-900 ring-2 ring-slate-900'
          : isMatch
            ? 'border-amber-400 ring-2 ring-amber-300'
            : 'border-slate-300';

  const textInputClass =
    'nodrag min-w-0 flex-1 rounded border border-slate-300 px-1 py-0.5 text-sm font-semibold text-slate-900';
  const showBadge = directReportsCount > 0 || functionalManagerCount > 0;
  const badgeText =
    directReportsCount > 0
      ? t('chart.node.totalAndDirect', { total: totalDescendantCount, count: directReportsCount })
      : t('chart.node.functionalCount', { count: functionalManagerCount });

  return (
    <div
      className={`relative w-[220px] rounded-lg border bg-white px-3 pb-6 pt-3 shadow-sm ${borderClass}`}
      style={{
        opacity: isDimmed ? 0.3 : 1,
        // "Editable mode" is exactly isSelected, not the broader
        // isChainHighlighted a hover/pin can also put an ancestor or
        // descendant into — double-click-to-edit, the photo control, and
        // the assignment gauges all specifically gate on isSelected (see
        // startEdit above), so only the actual selected card should read
        // as "you can edit this one," not everyone lit up by the chain
        // highlight around it. A dedicated, lighter alpha of this card's own
        // department color (selectedBackgroundColor, 10% — deliberately not
        // trackColor's 15%, which is calibrated for a small pill/gauge track
        // rather than a full card background), so "editable" reads as this
        // card's own team color, softly, instead of introducing a new color.
        ...(isSelected ? { backgroundColor: selectedBackgroundColor } : {}),
        ...(reconnectTarget.active
          ? reconnectTarget.isValid
            ? { boxShadow: '0 0 0 1px #10b981, 0 0 16px rgba(16, 185, 129, 0.5)' }
            : { boxShadow: '0 0 0 1px #ef4444, 0 0 16px rgba(239, 68, 68, 0.5)' }
          : isDisplacementTarget
            ? { boxShadow: '0 0 0 1px #f59e0b, 0 0 16px rgba(245, 158, 11, 0.5)' }
            : isChainHighlighted || isHoverEdgeEndpoint
              ? { borderColor: swatch, boxShadow: `0 0 0 1px ${swatch}, 0 0 16px ${withAlpha(swatch, 0.5)}` }
              : {}),
      }}
    >
      {/* One Handle per incoming relationship, spread evenly along the top
          edge in the order useChartNodes.ts derived from each manager's own
          laid-out x — lets a native reconnect (or a brand-new connect) drag
          land on one specific relationship instead of every incoming edge
          sharing a single point. Always at least one, even with zero
          managers today: dragging a fresh link onto this card (a new
          connection, not a reconnect — see OrgChartView.tsx's onConnect)
          needs a real target handle to drop on. */}
      {incomingHandleIds.map((id, i) => (
        <Handle
          key={id}
          id={id}
          type="target"
          position={Position.Top}
          style={{ left: `${((i + 1) / (incomingHandleIds.length + 1)) * 100}%` }}
          className="!bg-slate-400"
        />
      ))}


      {hasManager && (
        <CollapseBadge
          position="top"
          label={isFocused ? `+${focusHiddenCount}` : '−'}
          swatch={swatch}
          trackColor={trackColor}
          onToggle={() => onToggleFocus(employee.id)}
          title={isFocused ? t('chart.node.showEveryone') : t('chart.node.isolateTeam')}
        />
      )}
      {hasChildren && (
        <CollapseBadge
          position="bottom"
          label={isExpanded ? '−' : `+${totalDescendantCount}`}
          swatch={swatch}
          trackColor={trackColor}
          onToggle={() => onToggleExpand(employee.id)}
          title={isExpanded ? t('chart.node.collapseTeam') : t('chart.node.expandTeam')}
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
          // Same "must already be selected" guard as the inline field editors
          // and the assignment gauges — a click on an unselected card should
          // just select it, not also pop the photo editor in the same
          // gesture. The grid's own PhotoAvatar usage never passes this, so
          // it keeps opening on a single click there, unaffected.
          canOpen={isSelected}
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
              className="nodrag mt-0.5 w-full rounded border border-slate-300 px-1 py-0.5 text-xs text-slate-700"
            >
              <option value="" disabled>
                {t('chart.node.chooseJobTitle')}
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
              {t('chart.node.addJobTitle')}
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
          className="nodrag mt-2 w-full rounded border border-slate-300 px-1 py-0.5 text-xs text-slate-700"
        >
          <option value="" disabled>
            {t('chart.node.chooseBusinessUnit')}
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
          {t('chart.node.addBusinessUnit')}
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          // Same "must already be selected" guard as startEdit above, and for
          // the same reason: a plain click here used to stopPropagation and
          // open the assignments modal unconditionally, even on a card that
          // had never been selected — so a single click meant for
          // "select this card" could open a modal instead. Not stopping
          // propagation here lets the click bubble up to React Flow's
          // onNodeClick and select the card normally.
          if (!isSelected) return;
          e.stopPropagation();
          actions.openAssignments(employee.id);
        }}
        title={t('chart.node.editAssignments')}
        className="nodrag mt-2 block w-full text-left"
      >
        <MetricRow
          label={t('chart.node.sold')}
          pct={assignmentsTotalEtpVendu}
          trackColor={trackColor}
          fillColor={withAlpha(swatch, 0.55)}
        />
        <MetricRow label={t('chart.node.actual')} pct={assignmentsTotalEtpReel} trackColor={trackColor} fillColor={swatch} />
      </button>

      {advertiserNames.length > 0 && <AdvertisersRow names={advertiserNames} />}

      {showBadge && (
        <div className="absolute bottom-1.5 right-2.5 text-[9px] font-medium text-slate-400">{badgeText}</div>
      )}

      {/* One Handle per outgoing relationship (primary or secondary — this
          person as anyone's manager), spread along the bottom edge in the
          order useChartNodes.ts derived from each report's own laid-out x.
          Always at least one: a manager currently has to have SOME existing
          bottom handle to be a valid drop target the first time someone is
          reassigned to report to them, so useChartNodes.ts falls back to a
          single synthetic id when directReportsOf is empty. */}
      {outgoingHandleIds.map((id, i) => (
        <Handle
          key={id}
          id={id}
          type="source"
          position={Position.Bottom}
          style={{ left: `${((i + 1) / (outgoingHandleIds.length + 1)) * 100}%` }}
          className="!bg-slate-400"
        />
      ))}
    </div>
  );
}

export const EmployeeNode = memo(EmployeeNodeImpl);
