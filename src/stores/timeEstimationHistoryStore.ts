import { createHistoryStore } from './createHistoryStore';
import type { HistoryCommand } from '../lib/history/types';

// The Time Estimation screen's own undo/redo history — fully independent
// of the org-chart/grid screen's useHistoryStore (see historyStore.ts):
// neither store's Cmd+Z/buttons can act on the other's commands, and each
// is reset to empty the moment its own screen is left (AppShell.tsx's
// onOpenTimeEstimation/TimeEstimationScreen's onBack). None of this
// module's tables (time_actuals, time_forecasts, time_forecast_months,
// time_actual_n1_totals) are org-chart-scoped, so its commands use the
// plain HistoryCommand shape (no orgChartId field).
const { useStore } = createHistoryStore<HistoryCommand>();

export const useTimeEstimationHistoryStore = useStore;
