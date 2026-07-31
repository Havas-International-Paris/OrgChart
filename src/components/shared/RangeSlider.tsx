import { useState } from 'react';
import { clampRangeEdge, type Range } from '../../lib/rangeSliderMath';

interface RangeSliderProps {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: Range;
  onChange: (value: Range) => void;
}

// Dual-handle range slider (item 44's ETP vendu/réel filters) — no such
// component existed anywhere in the app before this (PhotoEditorModal.tsx
// has the only prior <input type="range">, single-handle). Built from two
// overlapping native range inputs sharing one track rather than a
// mousedown/pointermove drag implementation, so keyboard/accessibility
// behavior (arrow keys, focus ring) comes for free from the native element.
//
// Both inputs sit stacked via `absolute inset-0` in one `relative` track;
// each only reacts to pointer events on its own thumb (`pointer-events-none`
// on the input, re-enabled on just the thumb via the ::-webkit-slider-thumb/
// -moz-range-thumb pseudo-elements below), so clicking the empty track never
// accidentally grabs the wrong handle. `activeThumb` raises whichever thumb
// was most recently interacted with to the top z-index — without it, once
// both handles land on the same value, the one rendered underneath becomes
// permanently ungrabbable (the input on top always wins hit-testing there).
export function RangeSlider({ label, min, max, step = 1, value, onChange }: RangeSliderProps) {
  const [activeThumb, setActiveThumb] = useState<'min' | 'max'>('min');

  const handleMinChange = (raw: number) => {
    setActiveThumb('min');
    onChange(clampRangeEdge('min', raw, value, { min, max }));
  };
  const handleMaxChange = (raw: number) => {
    setActiveThumb('max');
    onChange(clampRangeEdge('max', raw, value, { min, max }));
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span className="font-semibold">{label}</span>
        <span>
          {value.min}% – {value.max}%
        </span>
      </div>
      <div className="relative h-5">
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-200" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-900"
          style={{
            left: `${((value.min - min) / (max - min)) * 100}%`,
            right: `${100 - ((value.max - min) / (max - min)) * 100}%`,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value.min}
          onChange={(e) => handleMinChange(Number(e.target.value))}
          className="range-slider-thumb pointer-events-none absolute inset-0 w-full appearance-none bg-transparent"
          style={{ zIndex: activeThumb === 'min' ? 2 : 1 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value.max}
          onChange={(e) => handleMaxChange(Number(e.target.value))}
          className="range-slider-thumb pointer-events-none absolute inset-0 w-full appearance-none bg-transparent"
          style={{ zIndex: activeThumb === 'max' ? 2 : 1 }}
        />
      </div>
    </div>
  );
}
