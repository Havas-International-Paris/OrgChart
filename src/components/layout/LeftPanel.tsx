import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { useCurrentUserRole } from '../../hooks/useCurrentUserRole';
import { useRegistryOrgChart } from '../../hooks/useRegistryOrgChart';
import { useSelectionStore } from '../../stores/selectionStore';
import { EmployeeGrid } from '../grid/EmployeeGrid';
import { ClientsMissionsGrid } from '../grid/ClientsMissionsGrid';
import { JobTitlesGrid } from '../grid/JobTitlesGrid';
import { DepartmentsGrid } from '../grid/DepartmentsGrid';
import { AllocationsView } from '../grid/AllocationsView';
import { PromotionCandidatesTab } from '../grid/PromotionCandidatesTab';
import { useUiPreferencesStore, type GridDensity } from '../../stores/uiPreferencesStore';

type Tab = 'employees' | 'clientsMissions' | 'allocations' | 'jobTitles' | 'departments' | 'promotionCandidates';

const BASE_TAB_IDS: Tab[] = ['employees', 'clientsMissions', 'allocations', 'jobTitles', 'departments'];
const DENSITY_IDS: GridDensity[] = ['comfortable', 'compact'];

function DensityToggle() {
  const { t } = useTranslation();
  const gridDensity = useUiPreferencesStore((s) => s.gridDensity);
  const setGridDensity = useUiPreferencesStore((s) => s.setGridDensity);

  return (
    <div className="flex items-center gap-1">
      {DENSITY_IDS.map((id) => (
        <button
          key={id}
          onClick={() => setGridDensity(id)}
          className={`rounded px-2 py-1 text-xs font-medium ${
            gridDensity === id
              ? 'bg-slate-900 text-white'
              : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
          }`}
        >
          {t(`leftPanel.density.${id}`)}
        </button>
      ))}
    </div>
  );
}

export function LeftPanel() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('employees');
  const currentOrgChartId = useSelectionStore((s) => s.currentOrgChartId);
  const { registryOrgChart } = useRegistryOrgChart();
  const { session } = useAuth();
  const { role } = useCurrentUserRole(session?.user.id);

  // Backlog item 58 Phase B — "Salariés à promouvoir" only makes sense
  // while looking at the registry chart itself, and only for admins (same
  // gate as the registry's own AccountMenu.tsx entry and EmployeeGrid.tsx's
  // import picker).
  const showPromotionTab = registryOrgChart !== null && currentOrgChartId === registryOrgChart.id && role === 'admin';
  const tabIds: Tab[] = showPromotionTab ? [...BASE_TAB_IDS, 'promotionCandidates'] : BASE_TAB_IDS;

  // Switching away from the registry (or losing admin) while this tab was
  // active would otherwise leave activeTab pointed at a tab no longer in
  // the list — no button highlighted, no content rendered. Falls back to
  // the always-available default.
  useEffect(() => {
    if (activeTab === 'promotionCandidates' && !showPromotionTab) setActiveTab('employees');
  }, [activeTab, showPromotionTab]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200">
        <div className="flex gap-1">
          {tabIds.map((id) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`px-3 py-1.5 text-sm font-medium ${
                activeTab === id
                  ? 'border-b-2 border-slate-900 text-slate-900'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {t(`leftPanel.tabs.${id}`)}
            </button>
          ))}
        </div>
        <DensityToggle />
      </div>
      <div className="min-h-0 flex-1">
        {activeTab === 'employees' && <EmployeeGrid />}
        {activeTab === 'clientsMissions' && <ClientsMissionsGrid />}
        {activeTab === 'allocations' && <AllocationsView />}
        {activeTab === 'jobTitles' && <JobTitlesGrid />}
        {activeTab === 'departments' && <DepartmentsGrid />}
        {activeTab === 'promotionCandidates' && showPromotionTab && (
          <PromotionCandidatesTab registryChartId={registryOrgChart.id} />
        )}
      </div>
    </div>
  );
}
