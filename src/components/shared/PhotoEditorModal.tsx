import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { PhotoFrame } from './PhotoFrame';
import { baseSizePct } from '../../lib/photoFrameMath';
import { employeePhotoUrl } from '../../services/employeePhotoService';
import type { PhotoFrameValues } from '../../types/domain';

const PREVIEW_SIZE = 220;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

// Keeps the frame from ever showing blank space: derived from the same
// cover-fit percentages PhotoFrame itself uses (see baseSizePct) so the
// clamp always matches what's actually on screen, at any zoom level.
function maxPan(basePct: number, zoom: number) {
  return Math.max(0, 50 * (1 - 100 / (basePct * zoom)));
}

function clampPan(pan: number, basePct: number, zoom: number) {
  const max = maxPan(basePct, zoom);
  return Math.max(-max, Math.min(max, pan));
}

function extractImageFile(items: DataTransferItemList | undefined): File | null {
  if (!items) return null;
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }
  return null;
}

interface PhotoEditorModalProps {
  employeeName: string;
  photoPath: string | null;
  currentFrame: PhotoFrameValues;
  onSave: (file: File | null, frame: PhotoFrameValues) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

// One single interface for everything photo-related: browse, drag-and-drop,
// paste, reposition/zoom, and delete — replacing what used to be two
// separate hover-revealed buttons (fragile: opening the "choose an action"
// step and the action itself were two clicks, easy for a host component's
// re-render to wipe in between). Paste is listened for at the document
// level while this modal is mounted, rather than requiring a specific small
// element to hold focus — non-editable focused elements don't reliably
// receive native paste events in every browser.
export function PhotoEditorModal({ employeeName, photoPath, currentFrame, onSave, onDelete, onClose }: PhotoEditorModalProps) {
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [pickedUrl, setPickedUrl] = useState<string | null>(null);
  const [frame, setFrame] = useState<PhotoFrameValues>(currentFrame);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const src = pickedUrl ?? (photoPath ? employeePhotoUrl(photoPath) : null);
  const base = naturalSize ? baseSizePct(naturalSize.w, naturalSize.h) : { widthPct: 100, heightPct: 100 };

  useEffect(() => {
    if (!pickedFile) {
      setPickedUrl(null);
      return;
    }
    const url = URL.createObjectURL(pickedFile);
    setPickedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pickedFile]);

  function pickFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Le fichier doit être une image.');
      return;
    }
    setError(null);
    setNaturalSize(null);
    setFrame({ zoom: 1, panX: 0, panY: 0 });
    setPickedFile(file);
  }

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const file = extractImageFile(e.clipboardData?.items);
      if (file) {
        e.preventDefault();
        pickFile(file);
      }
    }
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  function updateZoom(nextZoom: number) {
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    setFrame((f) => ({
      zoom,
      panX: clampPan(f.panX, base.widthPct, zoom),
      panY: clampPan(f.panY, base.heightPct, zoom),
    }));
  }

  // Wheel needs a non-passive native listener — React's synthetic onWheel is
  // passive by default, so preventDefault() there silently fails to stop the
  // page from scrolling behind the modal.
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !src) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      updateZoom(frame.zoom - e.deltaY * 0.002);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.zoom, base.widthPct, base.heightPct, src]);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!src) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, panX: frame.panX, panY: frame.panY };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const deltaPanX = (dx * 10000) / (frame.zoom * base.widthPct * PREVIEW_SIZE);
    const deltaPanY = (dy * 10000) / (frame.zoom * base.heightPct * PREVIEW_SIZE);
    setFrame((f) => ({
      ...f,
      panX: clampPan(drag.panX + deltaPanX, base.widthPct, f.zoom),
      panY: clampPan(drag.panY + deltaPanY, base.heightPct, f.zoom),
    }));
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) pickFile(file);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(pickedFile, frame);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de l’enregistrement');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la suppression');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div data-row-stabilizer-ignore className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-xs rounded-lg bg-white p-5 shadow-lg">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Photo de {employeeName}</h2>

        <div
          ref={previewRef}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className={`mx-auto flex touch-none select-none items-center justify-center rounded-full border-2 border-dashed ${
            dragOver ? 'border-slate-900 bg-slate-50' : 'border-transparent'
          } ${src ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
          style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
          onClick={() => {
            if (!src) inputRef.current?.click();
          }}
        >
          {src ? (
            <PhotoFrame
              src={src}
              zoom={frame.zoom}
              panX={frame.panX}
              panY={frame.panY}
              size={PREVIEW_SIZE}
              onNaturalSize={(w, h) => setNaturalSize({ w, h })}
            />
          ) : (
            <div className="flex flex-col items-center gap-1 px-6 text-center text-xs text-slate-400">
              <span>Glissez une image ici, cliquez pour parcourir,</span>
              <span>ou collez avec Ctrl+V</span>
            </div>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) pickFile(file);
          }}
        />

        {src && (
          <>
            <p className="mt-2 text-center text-[11px] text-slate-400">
              Glissez pour repositionner, molette pour zoomer
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateZoom(frame.zoom - 0.2)}
                className="rounded border border-slate-300 px-2 py-1 text-sm leading-none text-slate-600 hover:bg-slate-50"
              >
                −
              </button>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={frame.zoom}
                onChange={(e) => updateZoom(Number(e.target.value))}
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => updateZoom(frame.zoom + 0.2)}
                className="rounded border border-slate-300 px-2 py-1 text-sm leading-none text-slate-600 hover:bg-slate-50"
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-2 text-xs text-slate-500 hover:underline"
            >
              Changer de photo…
            </button>
          </>
        )}

        {error && <p className="mt-2 text-center text-xs text-red-600">{error}</p>}

        <div className="mt-4 flex items-center justify-between">
          {photoPath && !pickedFile ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="text-sm text-red-600 hover:underline disabled:opacity-50"
            >
              {deleting ? 'Suppression…' : 'Supprimer la photo'}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !src}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
