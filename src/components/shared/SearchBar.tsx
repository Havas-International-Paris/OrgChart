import { useSelectionStore } from '../../stores/selectionStore';

export function SearchBar() {
  const searchQuery = useSelectionStore((s) => s.searchQuery);
  const setSearchQuery = useSelectionStore((s) => s.setSearchQuery);

  return (
    <input
      type="search"
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      placeholder="Rechercher un employé…"
      className="w-64 rounded border border-slate-300 px-3 py-1.5 text-sm"
    />
  );
}
