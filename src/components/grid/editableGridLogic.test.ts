import { describe, expect, it } from 'vitest';
import {
  compareValues,
  effectiveForSort,
  hasContentIn,
  mergeDraftField,
  nextField,
} from './editableGridLogic';
import { emp } from '../../test/fixtures';

const EMPLOYEE_FIELDS = ['first_name', 'last_name', 'job_title', 'role_desc', 'department'] as const;

describe('nextField', () => {
  it('walks the fields in the declared fill order', () => {
    expect(nextField(EMPLOYEE_FIELDS, 'first_name')).toBe('last_name');
    expect(nextField(EMPLOYEE_FIELDS, 'last_name')).toBe('job_title');
    expect(nextField(EMPLOYEE_FIELDS, 'job_title')).toBe('role_desc');
    expect(nextField(EMPLOYEE_FIELDS, 'role_desc')).toBe('department');
  });

  // The explicit 2026-07-27 decision: Tab stops at the end of the row rather
  // than wrapping to the next row's first field — no spreadsheet-style nav.
  it('stops at the last field instead of wrapping to the next row', () => {
    expect(nextField(EMPLOYEE_FIELDS, 'department')).toBeNull();
  });

  it('covers every declared field exactly once', () => {
    const visited: string[] = ['first_name'];
    let current = 'first_name' as (typeof EMPLOYEE_FIELDS)[number];
    while (true) {
      const next = nextField(EMPLOYEE_FIELDS, current);
      if (!next) break;
      visited.push(next);
      current = next;
    }
    expect(visited).toEqual([...EMPLOYEE_FIELDS]);
  });

  // A single-field grid (Postes, Business Units) — the whole reason this is
  // generic over the field list instead of hardcoded to the employee shape.
  it('stops immediately for a single-field grid', () => {
    expect(nextField(['name'] as const, 'name')).toBeNull();
  });
});

describe('compareValues', () => {
  it('sorts null before any real value, on either side', () => {
    expect(compareValues(null, 'a')).toBeLessThan(0);
    expect(compareValues('a', null)).toBeGreaterThan(0);
  });

  it('treats two nulls as equal', () => {
    expect(compareValues(null, null)).toBe(0);
  });

  it('orders real strings lexicographically', () => {
    expect(compareValues('a', 'b')).toBeLessThan(0);
    expect(compareValues('b', 'a')).toBeGreaterThan(0);
    expect(compareValues('a', 'a')).toBe(0);
  });
});

describe('effectiveForSort', () => {
  const live = emp('e1', { first_name: 'Live', last_name: 'Value' });

  it('returns the live row when nothing is frozen', () => {
    expect(effectiveForSort(live, null)).toBe(live);
  });

  it('returns the live row when a DIFFERENT row is frozen', () => {
    const frozen = { id: 'someone-else', snapshot: emp('someone-else', { first_name: 'Other' }) };
    expect(effectiveForSort(live, frozen)).toBe(live);
  });

  // This is the whole fix for symptom (a): while employee `e1` is being edited,
  // every OTHER row still sorts on live data, but `e1` itself sorts on its
  // pre-edit snapshot — so it cannot jump position until editing truly ends.
  it('returns the frozen snapshot when this row is the one being edited', () => {
    const snapshot = emp('e1', { first_name: 'Pre-edit snapshot' });
    const frozen = { id: 'e1', snapshot };
    expect(effectiveForSort(live, frozen)).toBe(snapshot);
  });
});

describe('hasContentIn', () => {
  it('is false for a brand new, untouched draft', () => {
    expect(hasContentIn({ first_name: '', last_name: '' }, ['first_name', 'last_name'])).toBe(false);
  });

  it('is false for whitespace-only input — spaces alone must not promote a draft', () => {
    expect(hasContentIn({ first_name: '   ', last_name: '\t' }, ['first_name', 'last_name'])).toBe(false);
  });

  it('is true as soon as any required field has real content', () => {
    expect(hasContentIn({ first_name: 'Camille', last_name: '' }, ['first_name', 'last_name'])).toBe(true);
    expect(hasContentIn({ first_name: '', last_name: 'Dupont' }, ['first_name', 'last_name'])).toBe(true);
  });

  // The catalog grids (Postes, Business Units, Clients/Missions) only require
  // a single field ('name') — the generic function must not assume two.
  it('supports a single required field', () => {
    expect(hasContentIn({ name: '' }, ['name'])).toBe(false);
    expect(hasContentIn({ name: 'Nouveau poste' }, ['name'])).toBe(true);
  });
});

describe('mergeDraftField', () => {
  it('overwrites only the given field, leaving the rest untouched', () => {
    const draft = emp('draft-1', { first_name: '', last_name: '', job_title: null });
    const merged = mergeDraftField(draft, 'first_name', 'Camille');
    expect(merged.first_name).toBe('Camille');
    expect(merged.last_name).toBe('');
    expect(merged.id).toBe('draft-1');
  });

  it('does not mutate the original draft object', () => {
    const draft = emp('draft-1', { first_name: '' });
    mergeDraftField(draft, 'first_name', 'Camille');
    expect(draft.first_name).toBe('');
  });
});
