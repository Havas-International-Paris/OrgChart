import { averageOverRange } from './timeEstimationMath';

// Pure helpers for the combined N-1 + N import (revision 2) — the raw Havas
// exports ("Input N-1" shaped like the real "Evol Etps" export, "Input N"
// shaped like the real "ETPs Landing" export) use a COMPRESSED hierarchy:
// METIERS/Annonceur are only filled in on their own group-header row and
// blank on every row below, and each group has its own aggregate "Total"
// row that must never be imported as if it were a real employee. Kept
// framework/Supabase/xlsx-free so this is testable without a DB or a
// spreadsheet library — the wizard does the actual sheet reading and hands
// plain row objects in here.

export interface HierarchicalRow {
  metiers: string | null;
  annonceur: string | null;
  employeeName: string | null;
}

// Fills METIERS/Annonceur down from the last non-blank value above —
// mirrors how the raw export only writes each group label once, on its own
// header row. Must run BEFORE isSubtotalRow filtering, since the blank rows
// being filled are exactly the ones isSubtotalRow would otherwise treat as
// ungrouped orphans.
export function forwardFillHierarchy<T extends HierarchicalRow>(rows: T[]): T[] {
  let lastMetiers: string | null = null;
  let lastAnnonceur: string | null = null;
  return rows.map((row) => {
    const metiers = row.metiers ?? lastMetiers;
    const annonceur = row.annonceur ?? lastAnnonceur;
    lastMetiers = metiers;
    lastAnnonceur = annonceur;
    return { ...row, metiers, annonceur };
  });
}

// A group's aggregate row: either the METIERS-level total (Annonceur ===
// "Total", Employee blank) or the Annonceur-level total (Employee ===
// "Total") — both patterns confirmed in the real export. Neither is a real
// employee and must be excluded before any resolution/import step.
export function isSubtotalRow(employeeName: string | null): boolean {
  const trimmed = (employeeName ?? '').trim().toLowerCase();
  return trimmed === '' || trimmed === 'total';
}

export interface InputN1Row extends HierarchicalRow {
  // Input N-1's "ETPs 2025" — the only column actually imported from this
  // tab (raw fraction, e.g. 0.0665911867220903 = 6.66%).
  n1TotalFraction: number | null;
  // Input N-1's "ETPs 2026" — used only for cutoff-month detection below,
  // never imported/stored.
  n2026CrossCheckFraction: number | null;
}

export interface InputNRow extends HierarchicalRow {
  // Input N's 12 "ETP staffing" MTD columns, raw fractions, index 0 = month 1.
  monthlyFractions: (number | null)[];
}

export interface CutoffCandidate {
  month: number;
  matchingRows: number;
}

export interface CutoffDetectionResult {
  // A single month whose past-months average matches EVERY sampled row's
  // Input N-1 cross-check value — null if no month fits all of them
  // (ambiguous), in which case `candidates` (sorted best-first) drives the
  // wizard's manual fallback selector.
  cutoffMonth: number | null;
  candidates: CutoffCandidate[];
  sampleSize: number;
}

// French particles that stay lowercase in a title-cased name/client, unless
// they're the very first word (a client or name is never proposed starting
// with a lowercase letter).
const LOWERCASE_PARTICLES = new Set(['de', 'du', 'des', 'la', 'le']);

function capitalizeWord(word: string): string {
  // Capitalizes after internal hyphens too ("jean-pierre" -> "Jean-Pierre").
  return word
    .split('-')
    .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('-');
}

// Proposes a default for a raw ALL-CAPS import name/client ("AMUNDI ASSET
// MANAGEMENT" -> "Amundi Asset Management", "ALICE AUBERT DE VINCELLES" ->
// "Alice Aubert de Vincelles") — a starting point the admin can edit in the
// resolution screen, never applied silently. Deliberately not "smart" about
// anything beyond casing (no attempt to detect company suffixes, etc.).
export function toTitleCase(raw: string): string {
  const words = raw.trim().toLowerCase().split(/\s+/);
  return words.map((word, index) => (index > 0 && LOWERCASE_PARTICLES.has(word) ? word : capitalizeWord(word))).join(' ');
}

// Naive first/last name split for a raw "Firstname Lastname" import string —
// first word is the first name, everything else is the last name. Used only
// to seed the resolution screen's two editable fields; the admin can always
// correct a multi-word first name (e.g. "Maria Carla") by hand.
export function splitPersonName(raw: string): { firstName: string; lastName: string } {
  const parts = raw.trim().split(/\s+/);
  return { firstName: parts[0] ?? raw, lastName: parts.slice(1).join(' ') || raw };
}

const CUTOFF_TOLERANCE = 0.0005; // fraction-scale (≈0.05 percentage points)

function rowKey(annonceur: string | null, employeeName: string | null): string {
  return `${(annonceur ?? '').trim().toUpperCase()}::${(employeeName ?? '').trim().toUpperCase()}`;
}

// Joins Input N-1 and Input N rows on (Annonceur, Employee) and keeps only
// pairs usable as a cutoff-detection sample: a row with no ETPs 2026 cross-
// check value (e.g. someone with zero real months, like a brand-new joiner)
// can't help pin down the cutoff, so it's excluded rather than treated as a
// zero.
export function detectCutoffMonth(inputN1Rows: InputN1Row[], inputNRows: InputNRow[]): CutoffDetectionResult {
  const nByKey = new Map(inputNRows.map((r) => [rowKey(r.annonceur, r.employeeName), r]));
  const samples: { crossCheck: number; monthly: (number | null)[] }[] = [];
  for (const r1 of inputN1Rows) {
    if (r1.n2026CrossCheckFraction == null) continue;
    const match = nByKey.get(rowKey(r1.annonceur, r1.employeeName));
    if (!match) continue;
    samples.push({ crossCheck: r1.n2026CrossCheckFraction, monthly: match.monthlyFractions });
  }

  const candidates: CutoffCandidate[] = [];
  for (let month = 1; month <= 12; month += 1) {
    let matchingRows = 0;
    for (const sample of samples) {
      const avg = averageOverRange(sample.monthly.slice(0, month));
      if (Math.abs(avg - sample.crossCheck) < CUTOFF_TOLERANCE) matchingRows += 1;
    }
    candidates.push({ month, matchingRows });
  }
  candidates.sort((a, b) => b.matchingRows - a.matchingRows || a.month - b.month);

  const best = candidates[0];
  const cutoffMonth = samples.length > 0 && best && best.matchingRows === samples.length ? best.month : null;

  return { cutoffMonth, candidates, sampleSize: samples.length };
}
