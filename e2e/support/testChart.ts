import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { E2E_EMAIL, E2E_PASSWORD, SUPABASE_ANON_KEY, SUPABASE_URL, TEST_CHART_FILE } from './env';

// Every destructive smoke test runs inside its own throwaway org chart rather
// than against the real one. This is the whole reason E2E was blocked: the same
// Supabase project backs local dev and production, so a test that creates and
// deletes employees would otherwise be editing live data. `org_chart_id` scoping
// already isolates charts from each other completely (uniqueness constraints and
// the cycle-check trigger are all scoped to it), and deleting the chart cascades
// to its employees, relationships and assignments — so cleanup is one delete.
export interface TestChart {
  id: string;
  name: string;
}

function client() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedInClient() {
  const supabase = client();
  const { error } = await supabase.auth.signInWithPassword({ email: E2E_EMAIL, password: E2E_PASSWORD });
  if (error) throw new Error(`E2E sign-in failed: ${error.message}`);
  return supabase;
}

export async function createTestChart(): Promise<TestChart> {
  const supabase = await signedInClient();
  // Timestamped so a crashed run that skipped teardown leaves an obviously
  // disposable row behind, rather than something indistinguishable from a real
  // chart someone made.
  const name = `E2E throwaway ${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const { data, error } = await supabase
    .from('org_charts')
    .insert({ name, short_label: 'E2E' })
    .select()
    .single();
  if (error) throw new Error(`Could not create the throwaway org chart: ${error.message}`);

  // Seed one root employee directly rather than through the UI. Creating the
  // first employee is otherwise only possible via AG Grid cell editing, which
  // cannot be driven reliably (the editor mounts asynchronously and can close
  // mid-keystroke — see the browser-testing notes) and is itself due for rework.
  // Seeding sidesteps it and lets the specs exercise the chart's own button-driven
  // actions, which is where the undo/redo behaviour worth covering lives.
  // "Exactly one, named Racine" is also a sharper isolation assertion than
  // "empty": a wrong chart would show its real headcount instead.
  const { error: employeeError } = await supabase.from('employees').insert({
    first_name: 'Racine',
    last_name: 'E2E',
    org_chart_id: data.id,
  });
  if (employeeError) {
    throw new Error(`Could not seed the throwaway chart's employee: ${employeeError.message}`);
  }

  const chart = { id: data.id, name };
  writeFileSync(TEST_CHART_FILE, JSON.stringify(chart));
  return chart;
}

export function readTestChart(): TestChart {
  return JSON.parse(readFileSync(TEST_CHART_FILE, 'utf8')) as TestChart;
}

export async function deleteTestChart(id: string): Promise<void> {
  const supabase = await signedInClient();
  const { error } = await supabase.from('org_charts').delete().eq('id', id);
  if (error) throw new Error(`Could not delete the throwaway org chart ${id}: ${error.message}`);
}

// Safety net for runs that died before teardown. Only ever touches rows whose
// name carries the E2E prefix above, so it can never remove a real chart.
export async function deleteOrphanedTestCharts(): Promise<number> {
  const supabase = await signedInClient();
  const { data, error } = await supabase
    .from('org_charts')
    .delete()
    .like('name', 'E2E throwaway %')
    .select('id');
  if (error) throw new Error(`Could not clean up orphaned test charts: ${error.message}`);
  return data?.length ?? 0;
}
