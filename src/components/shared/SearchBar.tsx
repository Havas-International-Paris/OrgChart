import { useTranslation } from 'react-i18next';
import { useSelectionStore } from '../../stores/selectionStore';

export function SearchBar() {
  const { t } = useTranslation();
  const searchQuery = useSelectionStore((s) => s.searchQuery);
  const setSearchQuery = useSelectionStore((s) => s.setSearchQuery);

  return (
    <input
      type="search"
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      placeholder={t('searchBar.placeholder')}
      className="w-64 rounded border border-slate-300 px-3 py-1.5 text-sm"
    />
  );
}
