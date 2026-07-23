import { useState } from 'react';
import { employeePhotoUrl } from '../../services/employeePhotoService';
import { PhotoFrame } from './PhotoFrame';
import type { PhotoFrameValues } from '../../types/domain';

interface PhotoAvatarProps {
  employeeId: string;
  firstName: string;
  lastName: string;
  color: string;
  photoPath: string | null;
  frame: PhotoFrameValues;
  size?: number;
  onOpen: (employeeId: string) => void;
}

function initialsOf(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

// Purely presentational + one stable callback: a single click opens
// PhotoEditorModal (owned by the parent — grid or chart), which handles
// browsing, drag-and-drop, paste, reframing, and deletion all in one place.
export function PhotoAvatar({ employeeId, firstName, lastName, color, photoPath, frame, size = 36, onOpen }: PhotoAvatarProps) {
  const [hovering, setHovering] = useState(false);

  return (
    <div
      className="relative shrink-0 cursor-pointer"
      style={{ width: size, height: size }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(employeeId);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title="Modifier la photo"
    >
      {photoPath ? (
        <PhotoFrame
          src={employeePhotoUrl(photoPath)}
          zoom={frame.zoom}
          panX={frame.panX}
          panY={frame.panY}
          size={size}
        />
      ) : (
        <div
          className="flex items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ width: size, height: size, backgroundColor: color }}
        >
          {initialsOf(firstName, lastName)}
        </div>
      )}

      {hovering && (
        <div
          data-export-hide
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-[7px] font-semibold leading-tight text-white"
        >
          Modifier
        </div>
      )}
    </div>
  );
}
