import { describe, expect, it } from 'vitest';
import {
  detectCutoffMonth,
  forwardFillHierarchy,
  isSubtotalRow,
  splitPersonName,
  toTitleCase,
  type InputN1Row,
  type InputNRow,
} from './timeImportParsing';

describe('toTitleCase', () => {
  it('capitalizes each word of an all-caps client name', () => {
    expect(toTitleCase('AMUNDI ASSET MANAGEMENT')).toBe('Amundi Asset Management');
  });

  it('keeps French particles lowercase unless they are the first word', () => {
    expect(toTitleCase('ALICE AUBERT DE VINCELLES')).toBe('Alice Aubert de Vincelles');
    expect(toTitleCase('DE VINCELLES')).toBe('De Vincelles');
  });

  it('capitalizes both sides of a hyphen', () => {
    expect(toTitleCase('JEAN-PIERRE DURAND')).toBe('Jean-Pierre Durand');
  });

  it('is idempotent on already-mixed-case input', () => {
    expect(toTitleCase('Cléa Boulland')).toBe('Cléa Boulland');
  });
});

describe('splitPersonName', () => {
  it('splits on the first word', () => {
    expect(splitPersonName('FABIEN ANDREU')).toEqual({ firstName: 'FABIEN', lastName: 'ANDREU' });
  });

  it('keeps a multi-word last name together', () => {
    expect(splitPersonName('ALICE AUBERT DE VINCELLES')).toEqual({ firstName: 'ALICE', lastName: 'AUBERT DE VINCELLES' });
  });
});

describe('forwardFillHierarchy', () => {
  it('fills METIERS and Annonceur down from the last non-blank value above', () => {
    const rows = [
      { metiers: 'ADOPS', annonceur: 'Total', employeeName: null },
      { metiers: null, annonceur: 'AMUNDI ASSET MANAGEMENT', employeeName: 'Total' },
      { metiers: null, annonceur: null, employeeName: 'FABIEN ANDREU' },
      { metiers: null, annonceur: null, employeeName: 'IMANE BOUZIZA' },
      { metiers: 'CONSEIL', annonceur: 'Total', employeeName: null },
      { metiers: null, annonceur: null, employeeName: 'SOMEONE ELSE' },
    ];
    const filled = forwardFillHierarchy(rows);
    expect(filled.map((r) => [r.metiers, r.annonceur])).toEqual([
      ['ADOPS', 'Total'],
      ['ADOPS', 'AMUNDI ASSET MANAGEMENT'],
      ['ADOPS', 'AMUNDI ASSET MANAGEMENT'],
      ['ADOPS', 'AMUNDI ASSET MANAGEMENT'],
      ['CONSEIL', 'Total'],
      ['CONSEIL', 'Total'],
    ]);
  });

  it('does not mutate the input rows', () => {
    const rows = [{ metiers: 'ADOPS', annonceur: 'Total', employeeName: null }];
    forwardFillHierarchy(rows);
    expect(rows[0].annonceur).toBe('Total');
  });
});

describe('isSubtotalRow', () => {
  it('flags a blank employee name as a METIERS-level subtotal row', () => {
    expect(isSubtotalRow(null)).toBe(true);
    expect(isSubtotalRow('')).toBe(true);
    expect(isSubtotalRow('   ')).toBe(true);
  });

  it('flags "Total" as an Annonceur-level subtotal row, case-insensitively', () => {
    expect(isSubtotalRow('Total')).toBe(true);
    expect(isSubtotalRow('TOTAL')).toBe(true);
    expect(isSubtotalRow(' total ')).toBe(true);
  });

  it('does not flag a real employee name', () => {
    expect(isSubtotalRow('FABIEN ANDREU')).toBe(false);
  });
});

// Real values from the two Havas exports analyzed this session (Evol Etps
// (2025).xlsx / ETPs Landing (2026).xlsx) — verified by hand that ETPs 2026
// equals the average of the first 7 MTD columns (juillet cutoff) for every
// one of these rows, including two aggregate "Total" rows (the math holds
// at any hierarchy level, even though only real employee rows are ever
// actually imported).
describe('detectCutoffMonth', () => {
  const adopsTotal: InputNRow = {
    metiers: 'ADOPS',
    annonceur: 'Total',
    employeeName: null,
    monthlyFractions: [
      1.0472861340394906, 0.7993894963726585, 1.0491316716543033, 0.5024282352866921, 0.6152050440121865,
      0.41335253214320367, 0.3782103181612984, 0.62, 0.62, 0.62, 0.62, 0.62,
    ],
  };
  const amundiTotal: InputNRow = {
    metiers: null,
    annonceur: 'AMUNDI ASSET MANAGEMENT',
    employeeName: 'Total',
    monthlyFractions: [
      0.3974174400318944, 0.02112676056338028, 0.29529631516386484, 0.09174311926605505, 0.2554744525547445,
      0.03374233128834356, 0.04411764705882353, 0.22, 0.22, 0.22, 0.22, 0.22,
    ],
  };
  const fabienAndreu: InputNRow = {
    metiers: null,
    annonceur: null,
    employeeName: 'FABIEN ANDREU',
    monthlyFractions: [
      0.006688963210702341, 0.02112676056338028, 0.013245033112582781, 0.09174311926605505, 0.2554744525547445,
      0.03374233128834356, 0.04411764705882353, 0.07, 0.07, 0.07, 0.07, 0.07,
    ],
  };
  const imaneBouziza: InputNRow = {
    metiers: null,
    annonceur: null,
    employeeName: 'IMANE BOUZIZA',
    monthlyFractions: [null, null, null, null, null, null, null, 0.15, 0.15, 0.15, 0.15, 0.15],
  };

  const n1Rows: InputN1Row[] = [
    { metiers: 'ADOPS', annonceur: 'Total', employeeName: null, n1TotalFraction: 0.5613341221540211, n2026CrossCheckFraction: 0.686429061667119 },
    {
      metiers: null,
      annonceur: 'AMUNDI ASSET MANAGEMENT',
      employeeName: 'Total',
      n1TotalFraction: 0.026439521954324533,
      n2026CrossCheckFraction: 0.16270258084672945,
    },
    {
      metiers: null,
      annonceur: null,
      employeeName: 'FABIEN ANDREU',
      n1TotalFraction: 0.011870757385559967,
      n2026CrossCheckFraction: 0.0665911867220903,
    },
    { metiers: null, annonceur: null, employeeName: 'IMANE BOUZIZA', n1TotalFraction: null, n2026CrossCheckFraction: null },
  ];

  it('detects July (month 7) as the global cutoff using the real exported values', () => {
    const result = detectCutoffMonth(n1Rows, [adopsTotal, amundiTotal, fabienAndreu, imaneBouziza]);
    expect(result.cutoffMonth).toBe(7);
    expect(result.sampleSize).toBe(3); // Imane Bouziza excluded: no ETPs 2026 cross-check value
  });

  it('excludes a row with zero real months (null cross-check) from the sample entirely', () => {
    const result = detectCutoffMonth(n1Rows, [adopsTotal, amundiTotal, fabienAndreu, imaneBouziza]);
    const july = result.candidates.find((c) => c.month === 7);
    expect(july?.matchingRows).toBe(3);
  });

  it('returns null (ambiguous) when no single month satisfies every sampled row', () => {
    const conflicting: InputN1Row[] = [
      { metiers: null, annonceur: null, employeeName: 'FABIEN ANDREU', n1TotalFraction: 0.01, n2026CrossCheckFraction: 0.9 },
    ];
    const result = detectCutoffMonth(conflicting, [fabienAndreu]);
    expect(result.cutoffMonth).toBeNull();
    expect(result.sampleSize).toBe(1);
  });

  it('returns null with an empty candidate match when nothing joins between the two tabs', () => {
    const result = detectCutoffMonth(
      [{ metiers: null, annonceur: 'UNKNOWN CLIENT', employeeName: 'NOBODY', n1TotalFraction: 0.1, n2026CrossCheckFraction: 0.1 }],
      [fabienAndreu],
    );
    expect(result.cutoffMonth).toBeNull();
    expect(result.sampleSize).toBe(0);
  });
});
