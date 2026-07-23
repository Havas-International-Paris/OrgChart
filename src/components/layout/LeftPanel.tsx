import { useState } from 'react';
import { EmployeeGrid } from '../grid/EmployeeGrid';
import { ClientsMissionsGrid } from '../grid/ClientsMissionsGrid';
import { JobTitlesGrid } from '../grid/JobTitlesGrid';
import { DepartmentsGrid } from '../grid/DepartmentsGrid';
import { AllocationsView } from '../grid/AllocationsView';
import { useUiPreferencesStore, type GridDensity } from '../../stores/uiPreferencesStore';

type Tab = 'employees' | 'clientsMissions' | 'allocations' | 'jobTitles' | 'departments';

const TABS: { id: Tab; label: string }[] = [
  { id: 'employees', label: 'Employés' },
  { id: 'clientsMissions', label: 'Clients / Missions' },
  { id: 'allocations', label: 'Allocations' },
  { id: 'jobTitles', label: 'Postes' },
  { id: 'departments', label: 'Business Units' },
];

const DENSITY_OPTIONS: { id: GridDensity; label: string }[] = [
  { id: 'comfortable', label: 'Confortable' },
  { id: 'compact', label: 'Compact' },
];

function DensityToggle() {
  const gridDensity = useUiPreferencesStore((s) => s.gridDensity);
  const setGridDensity = useUiPreferencesStore((s) => s.setGridDensity);

  return (
    <div className="flex items-center gap-1">
      {DENSITY_OPTIONS.map((option) => (
        <button
          key={option.id}
          onClick={() => setGridDensity(option.id)}
          className={`rounded px-2 py-1 text-xs font-medium ${
            gridDensity === option.id
              ? 'bg-slate-900 text-white'
              : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function LeftPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('employees');

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-sm font-medium ${
                activeTab === tab.id
                  ? 'border-b-2 border-slate-900 text-slate-900'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {tab.label}
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
