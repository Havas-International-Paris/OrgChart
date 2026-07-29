import type { ReactNode } from 'react';
import type { EditableRows } from './useEditableRows';

interface EditableCellProps<Row extends { id: string }, Field extends Extract<keyof Row, string>> {
  editing: EditableRows<Row, Field>;
  row: Row;
  field: Field;
  // Required for a 'select' field, ignored otherwise. An empty option ("—") is
  // offered unless allowEmpty is false — a field like Clients/Missions' type,
  // which is NOT NULL in the schema, must not let the user clear it.
  options?: { value: string; label: string }[];
  allowEmpty?: boolean;
  // Closed-state rendering, when the plain value isn't enough (a colour dot, a
  // translated label…). Defaults to the raw value, or a dash when blank.
  display?: ReactNode;
  title?: string;
}

// The one cell renderer for every editable field in the left panel. Closed, it
// is a button whose click activates the cell; open, it is a plain <input> or
// <select> whose lifecycle is entirely owned by useEditableRows.
export function EditableCell<Row extends { id: string }, Field extends Extract<keyof Row, string>>({
  editing,
  row,
  field,
  options,
  allowEmpty = true,
  display,
  title,
}: EditableCellProps<Row, Field>) {
  const isActive = editing.activeCell?.rowId === row.id && editing.activeCell.field === field;
  const value = (row[field] as string | null) ?? null;

  if (isActive && editing.fieldKind[field] === 'select') {
    return (
      <select
        ref={(el) => {
          editing.inputRef.current = el;
        }}
        value={value ?? ''}
        onChange={(e) => editing.handleSelectChange(row, field, e.target.value)}
        onKeyDown={(e) => editing.handleKeyDown(e, field)}
        onBlur={() => editing.handleBlur(row, field, value)}
        className="w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-inherit outline-none"
      >
        {allowEmpty && <option value="">—</option>}
        {(options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (isActive) {
    return (
      <input
        ref={(el) => {
          editing.inputRef.current = el;
        }}
        value={editing.draftValue}
        onChange={(e) => editing.setDraftValue(e.target.value)}
        onKeyDown={(e) => editing.handleKeyDown(e, field)}
        onBlur={() => editing.handleBlur(row, field, editing.draftValue)}
        className="w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-inherit outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => editing.activateCell(row, field)}
      className="block w-full truncate text-left"
      title={title}
    >
      {display ?? (value ? <span className="truncate">{value}</span> : <span className="text-slate-300">—</span>)}
    </button>
  );
}
