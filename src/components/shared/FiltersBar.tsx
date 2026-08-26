import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDepartments } from '../../hooks/useDepartments';
import { useCompanies } from '../../hooks/useCompanies';
import { useJobTitles } from '../../hooks/useJobTitles';
import { useClientsMissions } from '../../hooks/useClientsMissions';
import { useEmployees } from '../../hooks/useEmployees';
import { useAssignments } from '../../hooks/useAssignments';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import { useActiveFilterCount } from '../../hooks/useActiveFilterCount';
import { departmentColorMap } from '../../lib/departmentColor';
import { companyColorMap } from '../../lib/companyColor';
import { FilterDropdown, type FilterDropdownOption } from './FilterDropdown';
import { RangeSlider } from './RangeSlider';

interface FiltersBarProps {
  orgChartId: string | null;
}

const ETP_BOUNDS = { min: 0, max: 150 };

// The expandable header row toggled by FiltersToggle.tsx — a classic filter
// bar: several collapsed dropdown filters side by side (Business Unit,
// Poste, Client/Mission — each a FilterDropdown, "repliés" until clicked),
// plus the two ETP range sliders shown directly, since a slider has no
// natural "collapsed" state the way a checkbox list does. Renders as a
// full-width sibling of AppShell's <header>, not a floating popover — this
// is what makes the header's own bottom edge move down when opened, per the
// user's request, rather than a panel dropping over the canvas below it.
export function FiltersBar({ orgChartId }: FiltersBarProps) {
  const { t } = useTranslation();
  const { departments } = useDepartments();
  const { companies } = useCompanies();
  const { jobTitles } = useJobTitles();
  const { clientsMissions } = useClientsMissions();
  const { employees } = useEmployees(orgChartId);
  const { assignmentsOfClientMission } = useAssignments(orgChartId);

  const clientMissionFilterIds = useSelectionStore((s) => s.clientMissionFilterIds);
  const toggleClientMissionFilter = useSelectionStore((s) => s.toggleClientMissionFilter);
  const deptFilterNames = useSelectionStore((s) => s.deptFilterNames);
  const toggleDeptFilter = useSelectionStore((s) => s.toggleDeptFilter);
  const companyFilterNames = useSelectionStore((s) => s.companyFilterNames);
  const toggleCompanyFilter = useSelectionStore((s) => s.toggleCompanyFilter);
  const jobTitleFilterNames = useSelectionStore((s) => s.jobTitleFilterNames);
  const toggleJobTitleFilter = useSelectionStore((s) => s.toggleJobTitleFilter);
  const etpVenduRange = useSelectionStore((s) => s.etpVenduRange);
  const setEtpVenduRange = useSelectionStore((s) => s.setEtpVenduRange);
  const etpReelRange = useSelectionStore((s) => s.etpReelRange);
  const setEtpReelRange = useSelectionStore((s) => s.setEtpReelRange);
  const resetAllFilters = useSelectionStore((s) => s.resetAllFilters);
  const hideDepartedEmployees = useUiPreferencesStore((s) => s.hideDepartedEmployees);
  const setHideDepartedEmployees = useUiPreferencesStore((s) => s.setHideDepartedEmployees);

  const departmentColorByName = useMemo(() => departmentColorMap(departments), [departments]);
  const companyColorByName = useMemo(() => companyColorMap(companies), [companies]);

  const employeeCountByDept = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of employees) {
      if (!e.department) continue;
      counts.set(e.department, (counts.get(e.department) ?? 0) + 1);
    }
    return counts;
  }, [employees]);

  const employeeCountByCompany = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of employees) {
      if (!e.company) continue;
      counts.set(e.company, (counts.get(e.company) ?? 0) + 1);
    }
    return counts;
  }, [employees]);

  const employeeCountByJobTitle = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of employees) {
      if (!e.job_title) continue;
      counts.set(e.job_title, (counts.get(e.job_title) ?? 0) + 1);
    }
    return counts;
  }, [employees]);

  const deptOptions: FilterDropdownOption[] = useMemo(
    () =>
      departments.map((d) => ({
        key: d.name,
        label: d.name,
        badge: String(employeeCountByDept.get(d.name) ?? 0),
        swatch: departmentColorByName.get(d.name),
      })),
    [departments, employeeCountByDept, departmentColorByName],
  );

  const companyOptions: FilterDropdownOption[] = useMemo(
    () =>
      companies.map((c) => ({
        key: c.name,
        label: c.name,
        badge: String(employeeCountByCompany.get(c.name) ?? 0),
        swatch: companyColorByName.get(c.name),
      })),
    [companies, employeeCountByCompany, companyColorByName],
  );

  const jobTitleOptions: FilterDropdownOption[] = useMemo(
    () =>
      jobTitles.map((jt) => ({
        key: jt.name,
        label: jt.name,
        badge: String(employeeCountByJobTitle.get(jt.name) ?? 0),
      })),
    [jobTitles, employeeCountByJobTitle],
  );

  const clientMissionOptions: FilterDropdownOption[] = useMemo(
    () =>
      clientsMissions.map((cm) => ({
        key: cm.id,
        label: cm.name,
        badge: `${assignmentsOfClientMission(cm.id).length}`,
      })),
    [clientsMissions, assignmentsOfClientMission],
  );

  const activeFilterCount = useActiveFilterCount();

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
      <FilterDropdown
        title={t('filters.businessUnit')}
        hint={t('filters.businessUnitHint')}
        options={deptOptions}
        selected={deptFilterNames}
        onToggle={toggleDeptFilter}
      />
      <FilterDropdown
        title={t('filters.company')}
        hint={t('filters.companyHint')}
        options={companyOptions}
        selected={companyFilterNames}
        onToggle={toggleCompanyFilter}
      />
      <FilterDropdown
        title={t('filters.jobTitle')}
        options={jobTitleOptions}
        selected={jobTitleFilterNames}
        onToggle={toggleJobTitleFilter}
      />
      <FilterDropdown
        title={t('filters.clientMission')}
        options={clientMissionOptions}
        selected={clientMissionFilterIds}
        onToggle={toggleClientMissionFilter}
      />
      <div className="min-w-[180px] flex-1">
        <RangeSlider
          label={t('filters.timeSold')}
          min={ETP_BOUNDS.min}
          max={ETP_BOUNDS.max}
          value={etpVenduRange}
          onChange={setEtpVenduRange}
        />
      </div>
      <div className="min-w-[180px] flex-1">
        <RangeSlider
          label={t('filters.timeActual')}
          min={ETP_BOUNDS.min}
          max={ETP_BOUNDS.max}
          value={etpReelRange}
          onChange={setEtpReelRange}
        />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={hideDepartedEmployees}
          onChange={(e) => setHideDepartedEmployees(e.target.checked)}
        />
        {t('filters.hideDepartedEmployees')}
      </label>
      {activeFilterCount > 0 && (
        <button
          type="button"
          onClick={resetAllFilters}
          className="text-xs text-slate-500 hover:text-slate-900 hover:underline"
        >
          {t('filters.reset')}
        </button>
      )}
    </div>
  );
}
