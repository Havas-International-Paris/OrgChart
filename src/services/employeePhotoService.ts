import { supabase } from '../lib/supabaseClient';

const BUCKET = 'employee-photos';
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function employeePhotoUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function uploadEmployeePhoto(employeeId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Le fichier doit être une image.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Image trop lourde (5 Mo maximum).');

  const ext = file.name.split('.').pop() || 'jpg';
  // Random suffix (not just employeeId) so replacing a photo always writes
  // a new object — overwriting the same path would keep serving the old
  // image from any cache until the URL itself changes.
  const path = `${employeeId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: '3600' });
  if (error) throw error;
  return path;
}

export async function deleteEmployeePhoto(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
