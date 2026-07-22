import { getNodesBounds, type Node } from 'reactflow';
import { toPng } from 'html-to-image';

// Padding (px) around the exported nodes so borders/shadows aren't clipped.
const EXPORT_PADDING = 40;

// SVG presentation properties html-to-image needs inlined as attributes on
// edge paths — it doesn't reliably carry over stroke/fill from CSS classes
// for SVG elements, so a class-styled path silently renders as a black
// filled blob (SVG's default fill) instead of a thin stroked line.
const EDGE_PATH_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray'] as const;

// Exports at 1:1 scale (not fit into a fixed canvas) so large org charts stay
// legible — the output image grows with the content instead of shrinking it.
export async function exportChartAsPng(nodes: Node[], filename: string): Promise<void> {
  const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewportEl || nodes.length === 0) return;

  const bounds = getNodesBounds(nodes);
  const width = Math.ceil(bounds.width) + EXPORT_PADDING * 2;
  const height = Math.ceil(bounds.height) + EXPORT_PADDING * 2;
  const x = -bounds.x + EXPORT_PADDING;
  const y = -bounds.y + EXPORT_PADDING;

  // Hide the "+" add manager/subordinate buttons for the capture — they're
  // editing UI, not org-chart content — then restore them afterwards.
  const hiddenEls = Array.from(document.querySelectorAll<HTMLElement>('[data-export-hide]'));
  const previousDisplay = hiddenEls.map((el) => el.style.display);
  hiddenEls.forEach((el) => {
    el.style.display = 'none';
  });

  const edgePaths = Array.from(viewportEl.querySelectorAll<SVGPathElement>('.react-flow__edge-path'));
  const previousPathAttrs = edgePaths.map((path) => {
    const computed = getComputedStyle(path);
    const previous = EDGE_PATH_PROPS.map((prop) => path.getAttribute(prop));
    EDGE_PATH_PROPS.forEach((prop) => path.setAttribute(prop, computed.getPropertyValue(prop)));
    return previous;
  });

  try {
    const dataUrl = await toPng(viewportEl, {
      backgroundColor: '#ffffff',
      width,
      height,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${x}px, ${y}px) scale(1)`,
      },
    });

    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    hiddenEls.forEach((el, i) => {
      el.style.display = previousDisplay[i];
    });
    edgePaths.forEach((path, i) => {
      EDGE_PATH_PROPS.forEach((prop, j) => {
        const previous = previousPathAttrs[i][j];
        if (previous === null) path.removeAttribute(prop);
        else path.setAttribute(prop, previous);
      });
    });
  }
}
