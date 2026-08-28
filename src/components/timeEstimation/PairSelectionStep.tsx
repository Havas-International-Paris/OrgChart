import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { computeAllResolvablePairsSelection, isNewPairKey, rawPairKey, type RawPair } from '../../lib/timeImportDiff';

// Screen 3 of ImportTimeActualsWizard's flow — "which (employee, client)
// pairs from the file actually get written this run." Extracted into its
// own component (2026-08-28, per user request) the same way OrgChartView.tsx
// was once split into hooks: this is the single biggest, most novel piece of
// the wizard redesign, and keeping it out of the already-1000+-line wizard
// file keeps both files reviewable.
//
// Deliberately NO multi-level propagation: checking a client's own bulk
// checkbox selects only ITS OWN direct pairs (one hop), checking an
// individual pair never cascades to anything else. The client-group header
// is a display/bulk-action convenience over the same flat per-pair
// selection, not a second, independent selection level — per the user's
// explicit correction earlier in this feature's design conversation.
export interface PairSelectionStepProps {
  rawPairs: RawPair[];
  existingPairKeys: Set<string>;
  // Preview-resolved ids (previewResolvedIds, timeImportDiff.ts) — a pair
  // whose employee or client side isn't in these maps yet (still needs
  // resolving) renders as a disabled, unselectable row instead of a
  // checkbox; that's exactly what Screen 5 (resolveStragglers) picks up.
  employeeIds: Map<string, string | null>;
  clientIds: Map<string, string | null>;
  selectedPairKeys: Set<string>;
  onChangeSelectedPairKeys: (next: Set<string>) => void;
  // Fires whenever the user interacts with ANY pair under this client/
  // employee (bulk or individual, check or uncheck) — a monotonically
  // growing "this name is relevant to what I'm doing" signal Screen 5 uses
  // to decide which still-unresolved names to surface. Deliberately never
  // un-marks on the wizard side: touching a client once is enough reason to
  // keep offering its stragglers even if a later click unchecks one pair.
  onTouchClient: (clientName: string) => void;
  onTouchEmployee: (employeeName: string) => void;
  onlyNewPairsSelection: Set<string>;
  defaultSelection: Set<string>;
}

export function PairSelectionStep({
  rawPairs,
  existingPairKeys,
  employeeIds,
  clientIds,
  selectedPairKeys,
  onChangeSelectedPairKeys,
  onTouchClient,
  onTouchEmployee,
  onlyNewPairsSelection,
  defaultSelection,
}: PairSelectionStepProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const pairsByClient = useMemo(() => {
    const map = new Map<string, RawPair[]>();
    for (const pair of rawPairs) {
      if (!map.has(pair.clientName)) map.set(pair.clientName, []);
      map.get(pair.clientName)!.push(pair);
    }
    return map;
  }, [rawPairs]);

  const sortedClientNames = useMemo(() => [...pairsByClient.keys()].sort((a, b) => a.localeCompare(b, 'fr')), [pairsByClient]);

  // "Select all" needs nothing the wizard doesn't already pass down for the
  // resolvability check every row already does — computed locally rather
  // than threaded in as yet another prop like onlyNewPairsSelection/
  // defaultSelection, which the wizard also needs for its own "seed the
  // selection on screen transition" logic and so already computes itself.
  const allResolvableSelection = useMemo(() => computeAllResolvablePairsSelection(rawPairs, employeeIds, clientIds), [rawPairs, employeeIds, clientIds]);

  const q = query.trim().toLowerCase();
  // A client group stays visible if its own name matches, or ANY of its
  // employees do — searching "McCain" shows every McCain pair, searching
  // "Dupont" shows only Dupont's rows (under whichever clients he's on).
  const visibleClientNames = q
    ? sortedClientNames.filter(
        (clientName) => clientName.toLowerCase().includes(q) || (pairsByClient.get(clientName) ?? []).some((p) => p.employeeName.toLowerCase().includes(q)),
      )
    : sortedClientNames;

  function isPairResolvable(pair: RawPair): boolean {
    return Boolean(employeeIds.get(pair.employeeName) && clientIds.get(pair.clientName));
  }

  function togglePair(pair: RawPair) {
    const key = rawPairKey(pair.employeeName, pair.clientName);
    const next = new Set(selectedPairKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChangeSelectedPairKeys(next);
    onTouchClient(pair.clientName);
    onTouchEmployee(pair.employeeName);
  }

  function toggleClientGroup(clientName: string, resolvablePairs: RawPair[]) {
    const keys = resolvablePairs.map((p) => rawPairKey(p.employeeName, p.clientName));
    const allChecked = keys.length > 0 && keys.every((k) => selectedPairKeys.has(k));
    const next = new Set(selectedPairKeys);
    if (allChecked) keys.forEach((k) => next.delete(k));
    else keys.forEach((k) => next.add(k));
    onChangeSelectedPairKeys(next);
    onTouchClient(clientName);
    resolvablePairs.forEach((p) => onTouchEmployee(p.employeeName));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('timeEstimation.wizard.searchPairsPlaceholder')}
          className="min-w-[200px] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={() => onChangeSelectedPairKeys(allResolvableSelection)}
          className="rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {t('timeEstimation.wizard.selectAllPairsButton')}
        </button>
        <button
          type="button"
          onClick={() => onChangeSelectedPairKeys(onlyNewPairsSelection)}
          className="rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {t('timeEstimation.wizard.onlyNewPairsButton')}
        </button>
        <button
          type="button"
          onClick={() => onChangeSelectedPairKeys(defaultSelection)}
          className="rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {t('timeEstimation.wizard.resetToDefaultSelection')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {visibleClientNames.length === 0 && <p className="text-sm text-slate-500">{t('timeEstimation.wizard.noMatchesForSearch')}</p>}
        {visibleClientNames.map((clientName) => {
          const pairs = pairsByClient.get(clientName) ?? [];
          const visiblePairs = q ? pairs.filter((p) => clientName.toLowerCase().includes(q) || p.employeeName.toLowerCase().includes(q)) : pairs;
          const resolvablePairs = pairs.filter(isPairResolvable);
          const resolvableKeys = resolvablePairs.map((p) => rawPairKey(p.employeeName, p.clientName));
          const allChecked = resolvableKeys.length > 0 && resolvableKeys.every((k) => selectedPairKeys.has(k));
          const someChecked = !allChecked && resolvableKeys.some((k) => selectedPairKeys.has(k));
          const unresolvedCount = pairs.length - resolvablePairs.length;

          return (
            <div key={clientName} className="mb-3 rounded border border-slate-200">
              <div className="flex items-center justify-between gap-2 rounded-t bg-slate-50 px-2 py-1.5">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = someChecked;
                    }}
                    onChange={() => toggleClientGroup(clientName, resolvablePairs)}
                  />
                  {clientName}
                </label>
                {unresolvedCount > 0 && (
                  <span className="text-[10px] font-medium text-amber-600">
                    {t('timeEstimation.wizard.pairsUnresolvedCount', { count: unresolvedCount })}
                  </span>
                )}
              </div>
              <div>
                {visiblePairs.map((pair) => {
                  const key = rawPairKey(pair.employeeName, pair.clientName);
                  if (!isPairResolvable(pair)) {
                    return (
                      <div key={key} className="flex items-center gap-2 border-t border-slate-100 px-2 py-1 text-xs text-slate-400">
                        <input type="checkbox" disabled className="opacity-30" />
                        <span className="flex-1">{pair.employeeName}</span>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          {t('timeEstimation.wizard.pairUnresolvedBadge')}
                        </span>
                      </div>
                    );
                  }
                  const employeeId = employeeIds.get(pair.employeeName)!;
                  const clientMissionId = clientIds.get(pair.clientName)!;
                  const isNew = isNewPairKey(employeeId, clientMissionId, existingPairKeys);
                  return (
                    <label key={key} className="flex items-center gap-2 border-t border-slate-100 px-2 py-1 text-xs hover:bg-slate-50">
                      <input type="checkbox" checked={selectedPairKeys.has(key)} onChange={() => togglePair(pair)} />
                      <span className="flex-1">{pair.employeeName}</span>
                      {isNew && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                          {t('timeEstimation.wizard.pairNewBadge')}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
