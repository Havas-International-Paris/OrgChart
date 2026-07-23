import { useCallback, useMemo } from 'react';
import { deleteEmployeePhoto, uploadEmployeePhoto } from '../services/employeePhotoService';
import type { Employee, PhotoFrameValues } from '../types/domain';

// Shared by both EmployeeGrid and OrgChartView so the "delete the old storage
// object after a replace" logic (and the eventual crop reset) only lives in
// one place — see updateEmployeePhoto in employeeService.ts for why a new
// upload always resets the frame.
export function usePhotoActions(
  employees: Employee[],
  updateEmployeePhoto: (id: string, photoPath: string | null) => Promise<Employee>,
  updateEmployeePhotoFrame: (id: string, frame: PhotoFrameValues) => Promise<Employee>,
) {
  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const replacePhoto = useCallback(
    async (employeeId: string, file: File) => {
      const oldPath = employeeById.get(employeeId)?.photo_path ?? null;
      const newPath = await uploadEmployeePhoto(employeeId, file);
      await updateEmployeePhoto(employeeId, newPath);
      if (oldPath) {
        deleteEmployeePhoto(oldPath).catch(() => {});
      }
    },
    [employeeById, updateEmployeePhoto],
  );

  const saveFrame = useCallback(
    async (employeeId: string, frame: PhotoFrameValues) => {
      await updateEmployeePhotoFrame(employeeId, frame);
    },
    [updateEmployeePhotoFrame],
  );

  const deletePhoto = useCallback(
    async (employeeId: string) => {
      const oldPath = employeeById.get(employeeId)?.photo_path ?? null;
      // updateEmployeePhoto(id, null) also resets zoom/pan to their defaults
      // (see employeeService.ts) — a deleted photo shouldn't leave a stale crop.
      await updateEmployeePhoto(employeeId, null);
      if (oldPath) {
        deleteEmployeePhoto(oldPath).catch(() => {});
      }
    },
    [employeeById, updateEmployeePhoto],
  );

  return { replacePhoto, saveFrame, deletePhoto };
}
