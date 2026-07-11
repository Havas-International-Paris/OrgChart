import type { ColDef } from 'ag-grid-community';
import type { Employee } from '../../types/domain';

// job_title ("Poste") is built dynamically in EmployeeGrid — it needs the
// live job_titles catalog for its select editor's list of values — so it
// sits between nameColumnDefs and roleDescColumnDef rather than in one array.
export const nameColumnDefs: ColDef<Employee>[] = [
  { field: 'first_name', headerName: 'Prénom', editable: true, minWidth: 120 },
  { field: 'last_name', headerName: 'Nom', editable: true, minWidth: 120 },
];

export const roleDescColumnDef: ColDef<Employee> = {
  field: 'role_desc',
  headerName: 'Rôle',
  editable: true,
  flex: 1,
  minWidth: 160,
};
