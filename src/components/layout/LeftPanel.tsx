import { useState } from 'react';
import { EmployeeGrid } from '../grid/EmployeeGrid';
import { ClientsMissionsGrid } from '../grid/ClientsMissionsGrid';
import { JobTitlesGrid } from '../grid/JobTitlesGrid';

type Tab = 'employees' | 'clientsMissions' | 'jobTitles';

const TABS: { id: Tab; label: string }[] = [
  { id: 'employees', label: 'Employés' },
  { id: 'clientsMissions', label: 'Clients / Missions' },
  { id: 'jobTitles', label: 'Postes' },
];

export function LeftPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('employees');

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex gap-1 border-b border-slate-200">
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
      <div className="min-h-0 flex-1">
        {activeTab === 'employees' && <EmployeeGrid />}
        {activeTab === 'clientsMissions' && <ClientsMissionsGrid />}
        {activeTab === 'jobTitles' && <JobTitlesGrid />}
      </div>
    </div>
  );
}
