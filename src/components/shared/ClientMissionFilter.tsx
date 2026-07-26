import { useEffect, useRef, useState } from 'react';
import { useAssignments } from '../../hooks/useAssignments';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useSelectionStore } from '../../stores/selectionStore';

interface ClientMissionFilterProps {
  orgChartId: string | null;
}

export function ClientMissionFilter({ orgChartId }: ClientMissionFilterProps) {
  const { clientsMissions } = useClientsMissions();
  const { assignmentsOfClientMission } = useAssignments(orgChartId);
  const clientMissionFilterIds = useSelectionStore((s) => s.clientMissionFilterIds);
  const toggleClientMissionFilter = useSelectionStore((s) => s.toggleClientMissionFilter);
  const clearClientMissionFilter = useSelectionStore((s) => s.clearClientMissionFilter);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  if (clientsMissions.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
      >
        Client / Mission
        {clientMissionFilterIds.size > 0 && (
          <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {clientMissionFilterIds.size}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-80 w-64 overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-slate-500">Filtrer l'équipe</span>
            {clientMissionFilterIds.size > 0 && (
              <button
                type="button"
                onClick={clearClientMissionFilter}
                className="text-xs text-slate-500 hover:text-slate-900 hover:underline"
              >
                Réinitialiser
              </button>
            )}
          </div>
          {clientsMissions.map((cm) => {
            const checked = clientMissionFilterIds.has(cm.id);
            const count = assignmentsOfClientMission(cm.id).length;
            return (
              <label
                key={cm.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleClientMissionFilter(cm.id)}
                  className="shrink-0"
                />
                <span className="flex-1 truncate">{cm.name}</span>
                <span className="shrink-0 text-[11px] text-slate-400">
                  {cm.type === 'client' ? 'Client' : 'Mission'} · {count}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
