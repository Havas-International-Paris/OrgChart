// Opt-in test mode, switched on by `?e2e=1` in the URL and nothing else.
//
// Deliberately a query parameter rather than a build-time env var: the dev server
// is shared with manual use in this project, so a `VITE_E2E` flag would change
// what the developer sees in their own browser. A query parameter is scoped to
// the page Playwright opens and leaves every other tab alone.
//
// It exists because the React Flow canvas is otherwise not reliably clickable
// under automation, for two reasons found by probing:
//   * the decorative overlays (department legend, minimap, controls, export
//     panel) are absolutely positioned over the canvas and intercept pointer
//     events on any card beneath them — Playwright names the legend outright;
//   * the viewport keeps moving (auto-fit, and setCenter's 400ms animation when
//     the selection changes), so a click can be attempted against a target that
//     is still travelling.
//
// Test mode removes the overlays and makes viewport moves instant. It does NOT
// change any data path, mutation or undo behaviour — the point is to make the
// real behaviour observable, not to substitute different behaviour for it.
let cached: boolean | null = null;

export function isE2EMode(): boolean {
  if (cached !== null) return cached;
  if (typeof window === 'undefined') return false;
  cached = new URLSearchParams(window.location.search).get('e2e') === '1';
  return cached;
}
