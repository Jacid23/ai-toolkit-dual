'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createGlobalState } from 'react-global-hooks';
import { Star, X } from 'lucide-react';
import { Modal } from './Modal';
import { apiClient } from '@/utils/api';

export interface SavedPrompt {
  id: string;
  name: string;
  text: string;
}

interface PromptLibraryModalState {
  onAdd: (texts: string[]) => void;
  current?: string[]; // prompts already in use: shown as added, and "Save all current prompts" saves them
}

export const promptLibraryModalState = createGlobalState<PromptLibraryModalState | null>(null);

export const openPromptLibrary = (onAdd: (texts: string[]) => void, current?: string[]) => {
  promptLibraryModalState.set({ onAdd, current });
};

// shared list so a star toggled on the Compare page shows up in the modal (and the reverse)
const libraryState = createGlobalState<SavedPrompt[] | null>(null);

export function usePromptLibrary() {
  const [library, setLibrary] = libraryState.use();
  const refresh = useCallback(async () => {
    const res = await apiClient.get('/api/prompts');
    setLibrary(res.data.prompts);
  }, [setLibrary]);
  useEffect(() => {
    if (library === null) refresh().catch(() => setLibrary([]));
  }, [library, refresh, setLibrary]);
  const save = async (text: string, name?: string) => {
    await apiClient.post('/api/prompts', { text, name });
    await refresh();
  };
  const remove = async (id: string) => {
    await apiClient.delete('/api/prompts', { params: { id } });
    await refresh();
  };
  return { library: library ?? [], refresh, save, remove };
}

export default function PromptLibraryModal() {
  const [state, setState] = promptLibraryModalState.use();
  const { library, save, remove } = usePromptLibrary();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (state) {
      setSearch('');
      setSelected(new Set());
    }
  }, [state]);

  const current = useMemo(() => new Set(state?.current ?? []), [state]);
  const shown = library.filter(p => !search || (p.name + ' ' + p.text).toLowerCase().includes(search.toLowerCase()));
  const close = () => setState(null);

  const unsaved = (state?.current ?? []).filter(t => t.trim() && !library.some(l => l.text === t));

  return (
    <Modal isOpen={state !== null} onClose={close} title="Prompt library" size="lg">
      <p className="text-sm text-gray-400 mb-3">
        Saved test prompts. The same list is available on the Compare page and in New Job's sample prompts.
      </p>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search saved prompts…"
        className="w-full px-3 py-2 mb-3 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-gray-600 focus:border-transparent"
      />
      <div className="max-h-[50vh] overflow-y-auto border border-gray-700 rounded-lg divide-y divide-gray-700">
        {shown.length === 0 && <div className="p-4 text-sm text-gray-500">No saved prompts yet. Use ★ next to a prompt to save it.</div>}
        {shown.map(p => {
          const inUse = current.has(p.text);
          return (
            <label key={p.id} className="flex items-start gap-3 px-3 py-2 hover:bg-gray-800 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                disabled={inUse}
                checked={inUse || selected.has(p.id)}
                onChange={e => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(p.id);
                  else next.delete(p.id);
                  setSelected(next);
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-200">{p.name}</div>
                <div className="text-xs text-gray-400 line-clamp-2">{p.text}</div>
              </div>
              <button
                type="button"
                title="Delete from library"
                className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-gray-700"
                onClick={e => {
                  e.preventDefault();
                  remove(p.id);
                }}
              >
                <X className="w-4 h-4" />
              </button>
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-2 mt-4">
        {unsaved.length > 0 && (
          <button
            type="button"
            className="text-sm text-blue-400 hover:underline inline-flex items-center gap-1"
            onClick={async () => {
              for (const t of unsaved) await save(t);
            }}
          >
            <Star className="w-4 h-4" /> Save all current prompts ({unsaved.length})
          </button>
        )}
        <div className="flex-1" />
        <button type="button" onClick={close} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">
          Close
        </button>
        <button
          type="button"
          disabled={selected.size === 0}
          onClick={() => {
            state?.onAdd(library.filter(p => selected.has(p.id)).map(p => p.text));
            close();
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-sm text-white"
        >
          Add selected
        </button>
      </div>
    </Modal>
  );
}
