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
import { CompaniesGrid } from '../grid/CompaniesGrid';
import { AllocationsView } from '../grid/AllocationsView';
import { PromotionCandidatesTab } from '../grid/PromotionCandidatesTab';
import { GridOptionsMenu } from './GridOptionsMenu';

type ViewMode = 'main' | 'config';
type MainTab = 'employees' | 'allocations' | 'promotionCandidates';
type ConfigTab = 'clientsMissions' | 'jobTitles' | 'departments' | 'companies';
type Tab = MainTab | ConfigTab;

const MAIN_TAB_IDS: MainTab[] = ['employees', 'allocations'];
const CONFIG_TAB_IDS: ConfigTab[] = ['clientsMissions', 'jobTitles', 'departments', 'companies'];

export function LeftPanel() {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>('main');
  const [activeTab, setActiveTab] = useState<Tab>('employees');
  const currentOrgChartId = useSelectionStore((s) => s.currentOrgChartId);
  const { registryOrgChart } = useRegistryOrgChart();
  const { session } = useAuth();
  const { role } = useCurrentUserRole(session?.user.id);

  // Backlog item 58 Phase B — "Salariés à promouvoir" only makes sense
  // while looking at the registry chart itself, and only for admins (same
  // gate as the registry's own AccountMenu.tsx entry and EmployeeGrid.tsx's
  // import picker). It's a workflow tab, not a configuration catalog, so it
  // stays in the main view rather than moving to the configuration view.
  const showPromotionTab = registryOrgChart !== null && currentOrgChartId === registryOrgChart.id && role === 'admin';
  const tabIds: Tab[] =
    viewMode === 'main'
      ? showPromotionTab
        ? [...MAIN_TAB_IDS, 'promotionCandidates']
        : MAIN_TAB_IDS
      : CONFIG_TAB_IDS;

  // Switching view mode (or losing access to promotionCandidates) while the
  // active tab isn't in the new list would otherwise leave activeTab pointed
  // at a tab no longer rendered — no button highlighted, no content shown.
  // Falls back to each view's own first tab.
  useEffect(() => {
    if (!tabIds.includes(activeTab)) setActiveTab(tabIds[0]);
  }, [tabIds, activeTab]);

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
        <GridOptionsMenu
          viewMode={viewMode}
          onToggleViewMode={() => setViewMode((v) => (v === 'main' ? 'config' : 'main'))}
        />
      </div>
      <div className="min-h-0 flex-1">
        {viewMode === 'main' && (
          <>
            {activeTab === 'employees' && <EmployeeGrid />}
            {activeTab === 'allocations' && <AllocationsView />}
            {activeTab === 'promotionCandidates' && showPromotionTab && (
              <PromotionCandidatesTab registryChartId={registryOrgChart.id} />
            )}
          </>
        )}
        {viewMode === 'config' && (
          <>
            {activeTab === 'clientsMissions' && <ClientsMissionsGrid />}
            {activeTab === 'jobTitles' && <JobTitlesGrid />}
            {activeTab === 'departments' && <DepartmentsGrid />}
            {activeTab === 'companies' && <CompaniesGrid />}
          </>
        )}
      </div>
    </div>
  );
}
