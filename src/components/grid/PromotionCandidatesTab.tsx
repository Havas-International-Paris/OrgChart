import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePromotionCandidates, type PromotionCandidate } from '../../hooks/usePromotionCandidates';

// Purely presentational — all state (the per-row dedup "confirm anyway?"
// gate) lives in the parent below, so there's exactly one place deciding
// whether a click promotes immediately or needs confirmation first.
function CandidateRow({
  candidate,
  confirming,
  onPromoteClick,
  onConfirmPromote,
  onCancelConfirm,
  onHide,
}: {
  candidate: PromotionCandidate;
  confirming: boolean;
  onPromoteClick: () => void;
  onConfirmPromote: () => void;
  onCancelConfirm: () => void;
  onHide: () => void;
}) {
  const { t } = useTranslation();

  return (
    <tr className="border-b border-slate-100">
      <td className="px-3 py-2 text-sm text-slate-700">
        {candidate.first_name} {candidate.last_name}
      </td>
      <td className="px-3 py-2 text-sm text-slate-500">{candidate.job_title ?? '—'}</td>
      <td className="px-3 py-2 text-sm text-slate-500">{candidate.orgChartName}</td>
      <td className="px-3 py-2 text-right">
        {confirming ? (
          <span className="inline-flex items-center gap-2">
            <span className="text-xs text-amber-600">{t('promotionCandidates.duplicateWarning')}</span>
            <button
              type="button"
              onClick={onConfirmPromote}
              className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
            >
              {t('promotionCandidates.promoteAnyway')}
            </button>
            <button
              type="button"
              onClick={onCancelConfirm}
              className="rounded px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100"
            >
              {t('promotionCandidates.cancel')}
            </button>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            {!candidate.hidden_from_registry_candidates && (
              <button
                type="button"
                onClick={onHide}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {t('promotionCandidates.hide')}
              </button>
            )}
            <button
              type="button"
              onClick={onPromoteClick}
              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {t('promotionCandidates.promote')}
            </button>
          </span>
        )}
      </td>
    </tr>
  );
}

// Backlog item 58 Phase B, flux 2 — always driven from inside the registry's
// own screen, never a per-chart context menu action (deliberate, per the
// spec: this is a curation decision, not a quick shortcut like flux 1).
export function PromotionCandidatesTab({ registryChartId }: { registryChartId: string }) {
  const { t } = useTranslation();
  const { candidates, includeHidden, setIncludeHidden, loading, findRegistryNameMatch, promote, hide } =
    usePromotionCandidates(registryChartId);
  // Which candidate row (if any) is showing the dedup "confirm anyway?"
  // gate — only ever one at a time, matching the app's general convention
  // of not needing more than one confirmation open simultaneously.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function handlePromoteClick(candidate: PromotionCandidate) {
    if (findRegistryNameMatch(candidate)) {
      setConfirmingId(candidate.id);
      return;
    }
    promote(candidate);
  }

  function handleConfirmPromote(candidate: PromotionCandidate) {
    setConfirmingId(null);
    promote(candidate);
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{t('promotionCandidates.title')}</h2>
        <button
          type="button"
          onClick={() => setIncludeHidden((v) => !v)}
          className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {includeHidden ? t('promotionCandidates.hideHidden') : t('promotionCandidates.showHidden')}
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-slate-400">{t('promotionCandidates.loading')}</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-slate-400">{t('promotionCandidates.empty')}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500">
                <th className="px-3 py-2">{t('promotionCandidates.columns.name')}</th>
                <th className="px-3 py-2">{t('promotionCandidates.columns.jobTitle')}</th>
                <th className="px-3 py-2">{t('promotionCandidates.columns.originChart')}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <CandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  confirming={confirmingId === candidate.id}
                  onPromoteClick={() => handlePromoteClick(candidate)}
                  onConfirmPromote={() => handleConfirmPromote(candidate)}
                  onCancelConfirm={() => setConfirmingId(null)}
                  onHide={() => hide(candidate.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
