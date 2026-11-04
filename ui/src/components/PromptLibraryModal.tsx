'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createGlobalState } from 'react-global-hooks';
import { Check, Database, ExternalLink, ImageOff, Layers, Pencil, Search, Star } from 'lucide-react';
import { Modal } from './Modal';
import PromptText from './PromptText';
import LibraryManager, { useLibraryEditor } from './prompts/LibraryManager';
import { apiClient } from '@/utils/api';
import { encodeFilePathForUrl } from '@/utils/basic';
import {
  PromptOverview,
  PromptSample,
  UNGROUPED,
  groupLabel,
  loadSelectedGroup,
  normalizePrompt,
  sortGroupNames,
  storeSelectedGroup,
} from '@/utils/prompts';

export interface SavedPrompt {
  id: string;
  name: string;
  text: string;
  group?: string;
  sort_order?: number;
}

interface PromptLibraryModalState {
  onAdd: (texts: string[]) => void;
  current?: string[]; // prompts already in use: shown as added, and "Save current prompts" saves them
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
  const save = async (text: string, name?: string, group?: string) => {
    await apiClient.post('/api/prompts', { text, name, group });
    await refresh();
  };
  const remove = async (id: string) => {
    await apiClient.delete('/api/prompts', { params: { id } });
    await refresh();
  };
  return { library: library ?? [], refresh, save, remove };
}

const ALL = '\u0000all';
const NEW_GROUP = '\u0000new';

const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-md bg-slate-600 hover:bg-slate-500 text-gray-100 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none';
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 text-sm transition-colors';
const fieldCls =
  'bg-gray-800 border border-gray-700 rounded-md px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-slate-500';

// DUAL BUILD: the library picker for New Job's sample prompts and Compare. Same layout as the
// /prompts page: groups on the left (a group = one character's sample set), the group's prompts
// in slot order on the right. Pick prompts or a whole group; "Edit library" switches the popup to
// the /prompts editor in place, so the page underneath (New Job) is never left.
export default function PromptLibraryModal() {
  const [state, setState] = promptLibraryModalState.use();
  const { library, refresh, save } = usePromptLibrary();
  const [overview, setOverview] = useState<PromptOverview>({ links: [], samples: {} });
  const [group, setGroup] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveTo, setSaveTo] = useState<string>(UNGROUPED);
  const [newGroup, setNewGroup] = useState('');
  const [saving, setSaving] = useState(false);
  const [manage, setManage] = useState(false);

  const open = state !== null;

  const reload = useCallback(() => {
    refresh().catch(() => {});
    apiClient
      .get('/api/prompts/overview')
      .then(r => setOverview({ links: r.data?.links ?? [], samples: r.data?.samples ?? {}, images: r.data?.images ?? {} }))
      .catch(() => {});
  }, [refresh]);

  // fresh list (it may have been edited on /prompts) and the sample thumbnails, every time it opens
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelected(new Set());
    setNewGroup('');
    setManage(false);
    reload();
  }, [open, reload]);

  // back from editing: pick from the edited library, on the group the editor last showed
  const doneEditing = () => {
    setManage(false);
    setSelected(new Set());
    reload();
    const saved = loadSelectedGroup();
    if (saved !== null) setGroup(saved);
  };

  const byGroup = useMemo(() => {
    const m = new Map<string, SavedPrompt[]>();
    for (const p of library) {
      const g = (p.group || '').trim();
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(p);
    }
    return m;
  }, [library]);
  const groupNames = useMemo(() => sortGroupNames(Array.from(byGroup.keys())), [byGroup]);
  const namedGroups = groupNames.filter(g => g !== UNGROUPED);

  // open on the group the library page / popup last showed
  useEffect(() => {
    if (!open) return;
    const saved = loadSelectedGroup();
    if (saved !== null && (saved === ALL || byGroup.has(saved))) setGroup(saved);
    else if (!byGroup.has(group) && group !== ALL) setGroup(groupNames[0] ?? ALL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, byGroup.size]);

  useEffect(() => {
    if (open) setSaveTo(group !== ALL && byGroup.has(group) ? group : (namedGroups[0] ?? UNGROUPED));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group]);

  const current = useMemo(() => new Set((state?.current ?? []).map(t => t.trim())), [state]);
  const inUse = (p: SavedPrompt) => current.has(p.text.trim());
  const linksOf = (g: string) => overview.links.filter(l => l.group === g).map(l => l.dataset);

  const q = search.trim().toLowerCase();
  const shown = useMemo(() => {
    if (q)
      return library.filter(
        p => (p.name + ' ' + p.text + ' ' + (p.group || '')).toLowerCase().includes(q),
      );
    if (group === ALL) return groupNames.flatMap(g => byGroup.get(g) ?? []);
    return byGroup.get(group) ?? [];
  }, [q, library, group, groupNames, byGroup]);

  const close = () => {
    if (manage) refresh().catch(() => {}); // edits show on Compare's stars too
    setState(null);
  };
  const pickGroup = (g: string) => {
    setGroup(g);
    setSearch('');
    storeSelectedGroup(g);
  };
  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // in library (slot) order, whatever order they were ticked in
  const addTexts = (prompts: SavedPrompt[]) => {
    const texts = prompts.filter(p => !inUse(p)).map(p => p.text);
    if (texts.length) state?.onAdd(texts);
    close();
  };
  const groupAddable = group !== ALL && !q ? (byGroup.get(group) ?? []).filter(p => !inUse(p)) : [];

  // the prompts in use that aren't saved yet (once each)
  const unsaved = Array.from(new Set((state?.current ?? []).map(t => t.trim()))).filter(
    t => t && !library.some(l => l.text.trim() === t),
  );
  const saveCurrent = async () => {
    const g = saveTo === NEW_GROUP ? newGroup.trim() : saveTo;
    if (saveTo === NEW_GROUP && !g) return;
    setSaving(true);
    try {
      for (const t of unsaved) await save(t, undefined, g);
      if (g !== UNGROUPED) pickGroup(g);
      setNewGroup('');
    } finally {
      setSaving(false);
    }
  };

  if (manage)
    return (
      <Modal isOpen={open} onClose={close} title="Prompt library · editing" size="xl">
        <div className="h-[min(70vh,640px)] rounded-lg bg-gray-950 p-2">
          <ManageView />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-gray-800">
          <span className="text-xs text-gray-500">Changes save as you make them.</span>
          <div className="flex-1" />
          <a
            href="/prompts"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mr-2"
          >
            Open in a new tab <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button type="button" onClick={doneEditing} className={btnPrimary}>
            Done editing
          </button>
        </div>
      </Modal>
    );

  return (
    <Modal isOpen={open} onClose={close} title="Prompt library" size="xl">
      <div className="flex flex-col sm:flex-row gap-3 h-[min(70vh,640px)]">
        {/* groups */}
        <aside className="sm:w-48 flex-shrink-0 max-h-32 sm:max-h-none overflow-y-auto rounded-lg bg-gray-950/50 p-1.5">
          <RailItem
            active={group === ALL && !q}
            onClick={() => pickGroup(ALL)}
            icon={<Layers className="w-4 h-4" />}
            label="All prompts"
            count={library.length}
          />
          <div className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Groups</div>
          {groupNames.length === 0 && <p className="px-2 py-1 text-xs text-gray-500">No groups yet.</p>}
          {groupNames.map(g => (
            <RailItem
              key={g || '\u0000ungrouped'}
              active={group === g && !q}
              onClick={() => pickGroup(g)}
              label={groupLabel(g)}
              muted={g === UNGROUPED}
              count={byGroup.get(g)?.length ?? 0}
              sub={linksOf(g)}
            />
          ))}
        </aside>

        {/* prompts */}
        <section className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-2 pb-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-2.5 top-2 text-gray-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search all prompts…"
                className={`${fieldCls} w-full pl-8`}
              />
            </div>
            {groupAddable.length > 0 && (
              <button type="button" onClick={() => addTexts(byGroup.get(group) ?? [])} className={btnPrimary}>
                Add whole group ({groupAddable.length})
              </button>
            )}
          </div>
          {group !== ALL && !q && (
            <div className="px-0.5 pb-2 text-xs text-gray-500">
              {groupLabel(group)} · in slot order
              {linksOf(group).length > 0 && <> · sample prompts for {linksOf(group).join(', ')}</>}
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {shown.length === 0 && (
              <div className="rounded-lg border border-dashed border-gray-700 px-4 py-10 text-center text-sm text-gray-500">
                {q ? `Nothing matches “${search.trim()}”.` : 'No prompts here yet.'}
              </div>
            )}
            {shown.map(p => (
              <PromptRow
                key={p.id}
                prompt={p}
                added={inUse(p)}
                checked={selected.has(p.id)}
                onToggle={() => toggle(p.id)}
                sample={overview.samples[normalizePrompt(p.text)]}
                image={overview.images?.[p.id]}
                groupTag={q || group === ALL ? (p.group || '').trim() : undefined}
                highlight={q}
              />
            ))}
          </div>
        </section>
      </div>

      {/* footer */}
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-gray-800">
        {unsaved.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-gray-400">
            <button
              type="button"
              disabled={saving || (saveTo === NEW_GROUP && !newGroup.trim())}
              onClick={saveCurrent}
              className={btnGhost}
            >
              <Star className="w-4 h-4 text-amber-400" />
              {saving ? 'Saving…' : `Save all current to library (${unsaved.length})`}
            </button>
            into
            <select value={saveTo} onChange={e => setSaveTo(e.target.value)} className={fieldCls}>
              {namedGroups.map(g => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
              <option value={UNGROUPED}>Ungrouped</option>
              <option value={NEW_GROUP}>New group…</option>
            </select>
            {saveTo === NEW_GROUP && (
              <input
                autoFocus
                value={newGroup}
                onChange={e => setNewGroup(e.target.value)}
                placeholder="Group name"
                className={`${fieldCls} w-32`}
              />
            )}
          </div>
        ) : (
          (state?.current ?? []).some(t => t.trim()) && (
            <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
              <Star className="w-3.5 h-3.5" /> All current prompts are in the library
            </span>
          )
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setManage(true)}
          className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mr-2"
        >
          <Pencil className="w-3.5 h-3.5" /> Edit library
        </button>
        <button type="button" onClick={close} className={btnGhost}>
          Cancel
        </button>
        <button
          type="button"
          disabled={selected.size === 0}
          onClick={() => addTexts(library.filter(p => selected.has(p.id)))}
          className={btnPrimary}
        >
          Add selected{selected.size ? ` (${selected.size})` : ''}
        </button>
      </div>
    </Modal>
  );
}

// the /prompts editor, inside the popup (mounted only while editing)
function ManageView() {
  const lib = useLibraryEditor();
  return <LibraryManager lib={lib} searchBox linksInNewTab className="h-full" />;
}

function RailItem({
  active,
  onClick,
  label,
  count,
  icon,
  sub,
  muted,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon?: React.ReactNode;
  sub?: string[];
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-md px-2 py-1.5 transition-colors ${
        active ? 'bg-slate-700 text-white' : 'text-gray-300 hover:bg-gray-800'
      }`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className={`flex-1 truncate text-sm ${muted && !active ? 'italic text-gray-400' : ''}`}>{label}</span>
        <span
          className={`text-[11px] tabular-nums rounded px-1.5 ${active ? 'bg-slate-600 text-gray-100' : 'bg-gray-800 text-gray-400'}`}
        >
          {count}
        </span>
      </div>
      {sub && sub.length > 0 && (
        <div className={`flex items-center gap-1 mt-0.5 text-[11px] ${active ? 'text-slate-300' : 'text-gray-500'}`}>
          <Database className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{sub.join(', ')}</span>
        </div>
      )}
    </button>
  );
}

function PromptRow({
  prompt,
  added,
  checked,
  onToggle,
  sample,
  image,
  groupTag,
  highlight,
}: {
  prompt: SavedPrompt;
  added: boolean;
  checked: boolean;
  onToggle: () => void;
  sample?: PromptSample;
  image?: string; // uploaded for this prompt; shown instead of the sample
  groupTag?: string;
  highlight?: string;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <label
      className={`flex items-start gap-3 rounded-lg px-3 py-2.5 border transition-colors ${
        added
          ? 'border-transparent bg-gray-800/30 opacity-60 cursor-default'
          : checked
            ? 'border-slate-500 bg-slate-800/40 cursor-pointer'
            : 'border-transparent bg-gray-800/50 hover:bg-gray-800 cursor-pointer'
      }`}
    >
      <input type="checkbox" className="mt-1 accent-slate-400" disabled={added} checked={added || checked} onChange={onToggle} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-100 truncate">{prompt.name}</span>
          {groupTag !== undefined && (
            <span className={`text-[11px] rounded px-1.5 bg-gray-700/70 ${groupTag ? 'text-gray-300' : 'text-gray-500 italic'}`}>
              {groupLabel(groupTag)}
            </span>
          )}
          {added && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-400">
              <Check className="w-3 h-3" /> Added
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-400 leading-relaxed line-clamp-2">
          <PromptText text={prompt.text} highlight={highlight} />
        </p>
      </div>
      <div className="hidden sm:flex w-12 h-12 flex-shrink-0 rounded overflow-hidden bg-gray-950 ring-1 ring-gray-800 items-center justify-center text-gray-700">
        {(image || sample) && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/img/${encodeFilePathForUrl(image ?? sample!.path)}?thumb=1`}
            alt=""
            loading="lazy"
            title={image ? undefined : `${sample!.jobName}, step ${sample!.step.toLocaleString()}`}
            onError={() => setBroken(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <ImageOff className="w-4 h-4" />
        )}
      </div>
    </label>
  );
}
