import { useState } from 'react';
import { baseSizePct } from '../../lib/photoFrameMath';

interface PhotoFrameProps {
  src: string;
  zoom: number;
  panX: number;
  panY: number;
  size: number;
  className?: string;
  alt?: string;
  onNaturalSize?: (naturalWidth: number, naturalHeight: number) => void;
}

export function PhotoFrame({ src, zoom, panX, panY, size, className = '', alt = '', onNaturalSize }: PhotoFrameProps) {
  const [ratio, setRatio] = useState<{ w: number; h: number } | null>(null);
  const { widthPct, heightPct } = ratio ? baseSizePct(ratio.w, ratio.h) : { widthPct: 100, heightPct: 100 };

  return (
    <div className={`relative overflow-hidden rounded-full ${className}`} style={{ width: size, height: size }}>
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) => {
          const { naturalWidth, naturalHeight } = e.currentTarget;
          if (naturalWidth && naturalHeight) {
            setRatio({ w: naturalWidth, h: naturalHeight });
            onNaturalSize?.(naturalWidth, naturalHeight);
          }
        }}
        style={{
          position: 'absolute',
          width: `${widthPct}%`,
          height: `${heightPct}%`,
          maxWidth: 'none',
          left: `${(100 - widthPct) / 2}%`,
          top: `${(100 - heightPct) / 2}%`,
          transform: `scale(${zoom}) translate(${panX}%, ${panY}%)`,
          transformOrigin: 'center',
        }}
      />
    </div>
  );
}
