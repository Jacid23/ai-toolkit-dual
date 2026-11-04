'use client';

import { Search, X } from 'lucide-react';
import { TopBar } from '@/components/layout';
import LibraryManager, { useLibraryEditor } from '@/components/prompts/LibraryManager';

// DUAL BUILD: Prompt Library page. The editor itself lives in LibraryManager, shared with the
// library popup on New Job / Compare.
export default function PromptsPage() {
  const lib = useLibraryEditor();
  const { search, setSearch, total, namedGroups } = lib;

  return (
    <>
      <TopBar>
        <div className="flex items-center gap-3 w-full pr-2">
          <h1 className="text-base sm:text-lg whitespace-nowrap">Prompt Library</h1>
          <span className="hidden sm:inline text-xs text-gray-500 whitespace-nowrap">
            {total} prompt{total === 1 ? '' : 's'} · {namedGroups.length} group{namedGroups.length === 1 ? '' : 's'}
          </span>
          <div className="relative ml-auto">
            <Search className="w-4 h-4 absolute left-2.5 top-2 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search all prompts…"
              className="w-44 sm:w-64 pl-8 pr-7 py-1.5 text-sm bg-gray-800 rounded-md border border-gray-700 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-slate-500"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="absolute right-1.5 top-1.5 text-gray-500 hover:text-gray-200">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </TopBar>

      <LibraryManager lib={lib} className="absolute inset-0 pt-14 px-2 sm:px-4 pb-4" />
    </>
  );
}
