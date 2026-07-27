import { describe, expect, it } from 'vitest';
import {
  EDITABLE_FIELDS,
  compareValues,
  draftHasContent,
  effectiveForSort,
  mergeDraftField,
  nextEditableField,
} from './editableGridLogic';
import { emp } from '../../test/fixtures';

describe('nextEditableField', () => {
  it('walks the fields in the declared fill order', () => {
    expect(nextEditableField('first_name')).toBe('last_name');
    expect(nextEditableField('last_name')).toBe('job_title');
    expect(nextEditableField('job_title')).toBe('role_desc');
    expect(nextEditableField('role_desc')).toBe('department');
  });

  // The explicit 2026-07-27 decision: Tab stops at the end of the row rather
  // than wrapping to the next row's first field — no spreadsheet-style nav.
  it('stops at the last field instead of wrapping to the next row', () => {
    expect(nextEditableField('department')).toBeNull();
  });

  it('covers every declared editable field exactly once', () => {
    const visited: string[] = ['first_name'];
    let current = 'first_name' as (typeof EDITABLE_FIELDS)[number];
    while (true) {
      const next = nextEditableField(current);
      if (!next) break;
      visited.push(next);
      current = next;
    }
    expect(visited).toEqual([...EDITABLE_FIELDS]);
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

describe('draftHasContent', () => {
  it('is false for a brand new, untouched draft', () => {
    expect(draftHasContent({ first_name: '', last_name: '' })).toBe(false);
  });

  it('is false for whitespace-only input — spaces alone must not promote a draft', () => {
    expect(draftHasContent({ first_name: '   ', last_name: '\t' })).toBe(false);
  });

  it('is true as soon as either name field has real content', () => {
    expect(draftHasContent({ first_name: 'Camille', last_name: '' })).toBe(true);
    expect(draftHasContent({ first_name: '', last_name: 'Dupont' })).toBe(true);
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
