import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmployeeGrid } from '../grid/EmployeeGrid';
import { ClientsMissionsGrid } from '../grid/ClientsMissionsGrid';
import { JobTitlesGrid } from '../grid/JobTitlesGrid';
import { DepartmentsGrid } from '../grid/DepartmentsGrid';
import { AllocationsView } from '../grid/AllocationsView';
import { useUiPreferencesStore, type GridDensity } from '../../stores/uiPreferencesStore';

type Tab = 'employees' | 'clientsMissions' | 'allocations' | 'jobTitles' | 'departments';

const TAB_IDS: Tab[] = ['employees', 'clientsMissions', 'allocations', 'jobTitles', 'departments'];
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

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200">
        <div className="flex gap-1">
          {TAB_IDS.map((id) => (
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
      </div>
    </div>
  );
}
