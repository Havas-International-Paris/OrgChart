// Cover-fit sizing for a photo inside a *square* frame, expressed as
// percentages of the frame's own size. Because it only depends on the
// source image's aspect ratio (not the frame's absolute pixel size), the
// same numbers apply unchanged whether the frame is a 28px grid avatar, a
// 36px chart card avatar, or a 220px reframe-modal preview — which is what
// lets one (zoom, panX, panY) triple stay correct everywhere. Split out of
// PhotoFrame.tsx (shared with PhotoReframeModal.tsx) so that component file
// only exports the component itself, for React Fast Refresh.
export function baseSizePct(naturalWidth: number, naturalHeight: number) {
  const ar = naturalWidth / naturalHeight;
  return ar >= 1 ? { widthPct: 100 * ar, heightPct: 100 } : { widthPct: 100, heightPct: 100 / ar };
}
