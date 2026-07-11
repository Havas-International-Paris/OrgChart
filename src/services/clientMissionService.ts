import { supabase } from '../lib/supabaseClient';
import type { ClientMission, ClientMissionType } from '../types/domain';

export async function fetchClientsMissions(): Promise<ClientMission[]> {
  const { data, error } = await supabase.from('clients_missions').select('*').order('name');
  if (error) throw error;
  return data as ClientMission[];
}

export async function createClientMission(
  name: string,
  type: ClientMissionType,
): Promise<ClientMission> {
  const { data, error } = await supabase
    .from('clients_missions')
    .insert({ name, type })
    .select()
    .single();
  if (error) throw error;
  return data as ClientMission;
}

export async function updateClientMission(
  id: string,
  changes: Partial<Pick<ClientMission, 'name' | 'type'>>,
): Promise<void> {
  const { error } = await supabase.from('clients_missions').update(changes).eq('id', id);
  if (error) throw error;
}

export async function deleteClientMission(id: string): Promise<void> {
  const { error } = await supabase.from('clients_missions').delete().eq('id', id);
  if (error) throw error;
}
