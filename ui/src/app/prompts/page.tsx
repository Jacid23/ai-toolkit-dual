'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Save, X, Search } from 'lucide-react';
import { TopBar } from '@/components/layout';
import { apiClient } from '@/utils/api';
import { TextInput, TextAreaInput } from '@/components/formInputs';
import { openConfirm } from '@/components/ConfirmModal';

type SavedPrompt = { id: string; name: string; text: string; group?: string; created_at?: string };

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SavedPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    apiClient
      .get('/api/prompts')
      .then(r => setPrompts(r.data?.prompts ?? []))
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prompts.filter(
      p =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.text.toLowerCase().includes(q) ||
        (p.group || '').toLowerCase().includes(q),
    );
  }, [prompts, search]);

  const groups = useMemo(() => {
    const m = new Map<string, SavedPrompt[]>();
    for (const p of filtered) {
      const g = (p.group || '').trim() || 'Ungrouped';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(p);
    }
    return Array.from(m.entries()).sort((a, b) =>
      a[0] === 'Ungrouped' ? 1 : b[0] === 'Ungrouped' ? -1 : a[0].localeCompare(b[0]),
    );
  }, [filtered]);

  const allGroups = useMemo(
    () => Array.from(new Set(prompts.map(p => (p.group || '').trim()).filter(Boolean))).sort(),
    [prompts],
  );

  const save = async (p: SavedPrompt) => {
    setBusy(true);
    setError(null);
    try {
      if (p.id) await apiClient.patch('/api/prompts', { id: p.id, name: p.name, text: p.text, group: p.group ?? '' });
      else await apiClient.post('/api/prompts', { name: p.name, text: p.text, group: p.group ?? '' });
      setEditing(null);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to save prompt');
    } finally {
      setBusy(false);
    }
  };

  const del = (p: SavedPrompt) =>
    openConfirm({
      title: 'Delete prompt',
      message: `Delete "${p.name}"?`,
      type: 'danger',
      confirmText: 'Delete',
      onConfirm: async () => {
        await apiClient.delete('/api/prompts', { params: { id: p.id } }).catch(() => {});
        await load();
      },
    });

  return (
    <>
      <TopBar>
        <div className="flex items-center gap-3 w-full">
          <h1 className="text-lg font-medium whitespace-nowrap">Prompt Library</h1>
          <div className="relative ml-auto">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="pl-7 pr-2 py-1.5 text-sm bg-gray-800 rounded border border-gray-700 focus:outline-none focus:border-gray-500"
            />
          </div>
          <button
            type="button"
            onClick={() => setEditing({ id: '', name: '', text: '', group: '' })}
            className="flex items-center gap-1 bg-green-700 hover:bg-green-600 text-white rounded px-3 py-1.5 text-sm"
          >
            <Plus className="w-4 h-4" /> New
          </button>
        </div>
      </TopBar>

      <div className="pt-24 px-6 pb-10 max-w-4xl mx-auto">
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        {editing && (
          <PromptEditor
            prompt={editing}
            groups={allGroups}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={save}
          />
        )}
        {groups.length === 0 && !editing && (
          <p className="text-gray-500 text-sm">No prompts yet. Click “New” to add one.</p>
        )}
        {groups.map(([g, items]) => (
          <div key={g} className="mb-6">
            <h2 className="text-xs uppercase tracking-wide text-gray-400 mb-2">
              {g} <span className="opacity-50">({items.length})</span>
            </h2>
            <div className="space-y-2">
              {items.map(p => (
                <div key={p.id} className="bg-gray-800/60 border border-gray-700 rounded p-3 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{p.name}</div>
                    <div
                      className="text-xs text-gray-400 mt-1 whitespace-pre-wrap overflow-hidden"
                      style={{ maxHeight: '3.5rem' }}
                    >
                      {p.text}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(p)}
                    className="text-gray-400 hover:text-white p-1"
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => del(p)}
                    className="text-gray-400 hover:text-red-400 p-1"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function PromptEditor({
  prompt,
  groups,
  busy,
  onCancel,
  onSave,
}: {
  prompt: SavedPrompt;
  groups: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (p: SavedPrompt) => void;
}) {
  const [name, setName] = useState(prompt.name);
  const [group, setGroup] = useState(prompt.group ?? '');
  const [text, setText] = useState(prompt.text);

  return (
    <div className="bg-gray-800 border border-gray-600 rounded p-4 mb-6">
      <div className="text-sm font-medium mb-2">{prompt.id ? 'Edit prompt' : 'New prompt'}</div>
      <TextInput label="Title" value={name} onChange={(v: string) => setName(v)} placeholder="eg. Beach portrait" />
      <div className="pt-2">
        <TextInput
          label="Group"
          value={group}
          onChange={(v: string) => setGroup(v)}
          placeholder="eg. Portraits (blank = Ungrouped)"
        />
        {groups.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {groups.map(g => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                className="text-xs bg-gray-700 hover:bg-gray-600 rounded px-2 py-0.5"
              >
                {g}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="pt-2">
        <TextAreaInput label="Prompt" value={text} onChange={(v: string) => setText(v)} rows={5} />
      </div>
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => onSave({ ...prompt, name, group, text })}
          className="flex items-center gap-1 bg-green-700 hover:bg-green-600 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
        >
          <Save className="w-4 h-4" /> Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 text-white rounded px-3 py-1.5 text-sm"
        >
          <X className="w-4 h-4" /> Cancel
        </button>
      </div>
    </div>
  );
}
