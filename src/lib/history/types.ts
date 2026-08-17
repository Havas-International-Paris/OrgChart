// A Command's undo/redo bodies must call existing hook-returned mutator
// functions (never raw services/*.ts calls directly), so replaying one
// naturally re-triggers the same Realtime-driven refresh() every live edit
// does — see createHistoryStore.ts's isReplaying guard for how this avoids
// re-recording itself onto the stack.
export interface HistoryCommand {
  /** Shown in the undo/redo toast. */
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

// The org-chart/grid screen's own command shape — adds `orgChartId` purely
// as a self-documenting invariant (the store is cleared wholesale on chart
// switch, so a command never actually outlives its chart in practice). The
// Time Estimation screen has its own separate history store and uses the
// base HistoryCommand directly, since none of its tables are org-chart-
// scoped — see stores/timeEstimationHistoryStore.ts.
export interface Command extends HistoryCommand {
  orgChartId: string;
}
