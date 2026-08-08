import { supabase } from '../lib/supabaseClient';
import { assertRowsAffected } from '../lib/mutationGuard';
import type { Company } from '../types/domain';

export async function fetchCompanies(): Promise<Company[]> {
  const { data, error } = await supabase.from('companies').select('*').order('created_at');
  if (error) throw error;
  return data as Company[];
}

export async function createCompany(name: string): Promise<Company> {
  const { data, error } = await supabase.from('companies').insert({ name }).select().single();
  if (error) throw error;
  return data as Company;
}

export async function updateCompany(id: string, name: string): Promise<void> {
  const { data, error } = await supabase.from('companies').update({ name }).eq('id', id).select();
  assertRowsAffected(data, error);
}

export async function updateCompanyColor(id: string, color: string | null): Promise<void> {
  const { data, error } = await supabase.from('companies').update({ color }).eq('id', id).select();
  assertRowsAffected(data, error);
}

export async function deleteCompany(id: string): Promise<void> {
  const { data, error } = await supabase.from('companies').delete().eq('id', id).select();
  assertRowsAffected(data, error);
}

// Re-inserts under the ORIGINAL id — see employeeService.restoreEmployee.
export async function restoreCompany(row: Company): Promise<Company> {
  const { data, error } = await supabase
    .from('companies')
    .insert({ id: row.id, name: row.name, color: row.color })
    .select()
    .single();
  if (error) throw error;
  return data as Company;
}
