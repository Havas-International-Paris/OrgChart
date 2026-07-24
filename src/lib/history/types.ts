// A Command's undo/redo bodies must call existing hook-returned mutator
// functions (never raw services/*.ts calls directly), so replaying one
// naturally re-triggers the same Realtime-driven refresh() every live edit
// does — see historyStore.ts's isReplaying guard for how this avoids
// re-recording itself onto the stack.
export interface Command {
  /** Shown in the undo/redo toast. */
  label: string;
  /**
   * Which org chart this command belongs to. The store is cleared wholesale
   * on chart switch, so a command never actually outlives its chart in
   * practice — this field just makes that invariant checkable/self-documenting.
   */
  orgChartId: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}
