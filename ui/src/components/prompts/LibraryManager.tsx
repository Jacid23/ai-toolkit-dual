'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Plus,
  Trash2,
  X,
  Search,
  Pencil,
  Check,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Database,
  ImageOff,
  ImagePlus,
  Loader2,
  Layers,
  FolderPlus,
  FolderInput,
} from 'lucide-react';
import { apiClient } from '@/utils/api';
import { openConfirm } from '@/components/ConfirmModal';
import { encodeFilePathForUrl } from '@/utils/basic';
import PromptText from '@/components/PromptText';
import {
  PromptSample,
  PromptOverview as Overview,
  UNGROUPED,
  groupLabel,
  normalizePrompt,
  sortGroupNames,
  loadSelectedGroup as loadSelected,
  storeSelectedGroup as storeSelected,
} from '@/utils/prompts';

// DUAL BUILD: Prompt Library editor, shared by the /prompts page and the library popup (so the
// library can be edited from New Job without leaving it). Groups are a character's sample set (a
// dataset links to one group and New Job loads its prompts, in order, as the job's sample slots),
// so it's built around the group: the rail lists groups, the main panel shows the selected group's
// prompts as slot cards with the latest training sample each one produced.

type SavedPrompt = { id: string; name: string; text: string; group?: string; sort_order?: number };

const ALL = '\u0000all';

// in the popup, dataset / sample links open a new tab so the page underneath (New Job) stays put
const LinkTarget = createContext<string | undefined>(undefined);

// prompt id -> uploaded image, and the upload / remove actions, for the thumbnails
const PromptImages = createContext<{
  images: Record<string, string>;
  upload: (id: string, file: File) => Promise<void>;
  clear: (id: string) => Promise<void>;
} | null>(null);

const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-md bg-slate-600 hover:bg-slate-500 text-gray-100 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none';
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 text-sm transition-colors';
const iconBtn = 'p-1.5 rounded-md text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-30';
const inputCls =
  'w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-slate-500';

export function useLibraryEditor() {
  const [prompts, setPrompts] = useState<SavedPrompt[] | null>(null);
  const [overview, setOverview] = useState<Overview>({ links: [], samples: {} });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [extraGroups, setExtraGroups] = useState<string[]>([]); // new, still-empty groups
  const [addingGroup, setAddingGroup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    apiClient
      .get('/api/prompts')
      .then(r => setPrompts(r.data?.prompts ?? []))
      .catch(() => setPrompts(p => p ?? []));
  const loadOverview = () =>
    apiClient
      .get('/api/prompts/overview')
      .then(r => setOverview({ links: r.data?.links ?? [], samples: r.data?.samples ?? {}, images: r.data?.images ?? {} }))
      .catch(() => {});
  useEffect(() => {
    load();
    loadOverview();
  }, []);

  const byGroup = useMemo(() => {
    const m = new Map<string, SavedPrompt[]>();
    for (const p of prompts ?? []) {
      const g = (p.group || '').trim();
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(p);
    }
    for (const g of extraGroups) if (!m.has(g)) m.set(g, []);
    return m;
  }, [prompts, extraGroups]);

  const groupNames = useMemo(() => sortGroupNames(Array.from(byGroup.keys())), [byGroup]);
  const namedGroups = groupNames.filter(g => g !== UNGROUPED);

  const linksOf = (g: string) => overview.links.filter(l => l.group === g).map(l => l.dataset);

  // pick the remembered group (or the first one) once prompts are in
  useEffect(() => {
    if (prompts === null || (selected !== null && (selected === ALL || byGroup.has(selected)))) return;
    const saved = loadSelected();
    setSelected(saved !== null && (saved === ALL || byGroup.has(saved)) ? saved : (groupNames[0] ?? ALL));
  }, [prompts, byGroup, groupNames, selected]);

  const select = (g: string) => {
    setSelected(g);
    setSearch('');
    storeSelected(g);
  };

  const q = search.trim().toLowerCase();
  const searching = q.length > 0 || selected === ALL;
  const matches = useMemo(
    () =>
      (prompts ?? []).filter(
        p =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.text.toLowerCase().includes(q) ||
          (p.group || '').toLowerCase().includes(q),
      ),
    [prompts, q],
  );

  const run = async (fn: () => Promise<any>, msg: string) => {
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.response?.data?.error || msg);
      throw e;
    } finally {
      await load();
    }
  };

  const savePrompt = (p: SavedPrompt) =>
    run(
      () =>
        p.id
          ? apiClient.patch('/api/prompts', { id: p.id, name: p.name, text: p.text })
          : apiClient.post('/api/prompts', { name: p.name, text: p.text, group: p.group ?? '' }),
      'Failed to save prompt',
    ).then(() => {
      setExtraGroups(gs => gs.filter(g => g !== (p.group ?? '')));
      loadOverview();
    });

  const movePrompt = (p: SavedPrompt, group: string) =>
    run(() => apiClient.patch('/api/prompts', { id: p.id, group }), 'Failed to move prompt').catch(() => {});

  const deletePrompt = (p: SavedPrompt) =>
    openConfirm({
      title: 'Delete prompt',
      message: `Delete "${p.name}"?`,
      type: 'danger',
      confirmText: 'Delete',
      onConfirm: () => run(() => apiClient.delete('/api/prompts', { params: { id: p.id } }), 'Failed to delete').catch(() => {}),
    });

  const reorder = (ids: string[]) => {
    const pos = new Map(ids.map((id, i) => [id, i]));
    setPrompts(ps => (ps ?? []).map(p => (pos.has(p.id) ? { ...p, sort_order: pos.get(p.id)! } : p)).sort(sortPrompts));
    apiClient.patch('/api/prompts', { order: ids }).catch(() => {
      setError('Failed to save the new order');
      load();
    });
  };

  const renameGroup = async (from: string, to: string) => {
    to = to.trim();
    if (!to || to === from) return;
    if (!byGroup.get(from)?.length) {
      setExtraGroups(gs => gs.map(g => (g === from ? to : g)));
      select(to);
      return;
    }
    await run(() => apiClient.patch('/api/prompts', { renameGroup: { from, to } }), 'Failed to rename group').catch(() => {});
    select(to);
    loadOverview();
  };

  const deleteGroup = (g: string) => {
    const count = byGroup.get(g)?.length ?? 0;
    const linked = linksOf(g);
    if (!count) {
      setExtraGroups(gs => gs.filter(x => x !== g));
      setSelected(null);
      return;
    }
    openConfirm({
      title: 'Delete group',
      message:
        `Delete "${g}" and its ${count} prompt${count === 1 ? '' : 's'}?` +
        (linked.length ? ` ${linked.join(', ')} will no longer have sample prompts.` : ''),
      type: 'danger',
      confirmText: 'Delete group',
      onConfirm: async () => {
        await run(() => apiClient.delete('/api/prompts', { params: { group: g } }), 'Failed to delete group').catch(() => {});
        setSelected(null);
        loadOverview();
      },
    });
  };

  const uploadImage = async (id: string, file: File) => {
    setError(null);
    const form = new FormData();
    form.append('id', id);
    form.append('file', file);
    try {
      await apiClient.post('/api/prompts/image', form);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to upload the image');
    }
    await loadOverview();
  };
  const clearImage = async (id: string) => {
    setError(null);
    await apiClient.delete('/api/prompts/image', { params: { id } }).catch(() => setError('Failed to remove the image'));
    await loadOverview();
  };

  const addGroup = (name: string) => {
    name = name.trim();
    setAddingGroup(false);
    if (!name) return;
    if (!byGroup.has(name)) setExtraGroups(gs => [...gs, name]);
    select(name);
  };

  return {
    prompts,
    overview,
    search,
    setSearch,
    selected,
    select,
    addingGroup,
    setAddingGroup,
    error,
    setError,
    byGroup,
    groupNames,
    namedGroups,
    linksOf,
    q,
    searching,
    matches,
    total: prompts?.length ?? 0,
    savePrompt,
    movePrompt,
    deletePrompt,
    reorder,
    renameGroup,
    deleteGroup,
    addGroup,
    uploadImage,
    clearImage,
  };
}

export type LibraryEditor = ReturnType<typeof useLibraryEditor>;

// the group rail + the selected group's (or the search's) prompts
export default function LibraryManager({
  lib,
  className = '',
  searchBox,
  linksInNewTab,
}: {
  lib: LibraryEditor;
  className?: string;
  searchBox?: boolean; // its own search field (the /prompts page has one in its top bar)
  linksInNewTab?: boolean;
}) {
  const { selected, q, byGroup } = lib;
  return (
    <LinkTarget.Provider value={linksInNewTab ? '_blank' : undefined}>
    <PromptImages.Provider value={{ images: lib.overview.images ?? {}, upload: lib.uploadImage, clear: lib.clearImage }}>
    <div className={`flex flex-col md:flex-row gap-4 ${className}`}>
      {/* group rail */}
      <aside className="md:w-64 flex-shrink-0 max-h-56 md:max-h-none overflow-y-auto bg-gray-900 rounded-lg p-2 flex flex-col">
        <RailItem active={selected === ALL && !q} onClick={() => lib.select(ALL)} icon={<Layers className="w-4 h-4" />} label="All prompts" count={lib.total} />
        <div className="flex items-center justify-between px-2 pt-4 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Groups</span>
          <button type="button" title="New group" onClick={() => lib.setAddingGroup(true)} className={iconBtn}>
            <FolderPlus className="w-4 h-4" />
          </button>
        </div>
        {lib.addingGroup && <InlineName placeholder="Group name, eg. g3mma" onDone={lib.addGroup} />}
        {lib.prompts !== null && lib.groupNames.length === 0 && !lib.addingGroup && (
          <p className="px-2 py-2 text-xs text-gray-500">No groups yet.</p>
        )}
        <div className="space-y-0.5">
          {lib.groupNames.map(g => (
            <RailItem
              key={g || '\u0000ungrouped'}
              active={selected === g && !q}
              onClick={() => lib.select(g)}
              label={groupLabel(g)}
              muted={g === UNGROUPED}
              count={byGroup.get(g)?.length ?? 0}
              sub={lib.linksOf(g)}
            />
          ))}
        </div>
      </aside>

      {/* main panel */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {searchBox && (
          <div className="relative mb-3">
            <Search className="w-4 h-4 absolute left-2.5 top-2 text-gray-500" />
            <input
              value={lib.search}
              onChange={e => lib.setSearch(e.target.value)}
              placeholder="Search all prompts…"
              className="w-full pl-8 pr-7 py-1.5 text-sm bg-gray-800 rounded-md border border-gray-700 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-slate-500"
            />
            {lib.search && (
              <button type="button" onClick={() => lib.setSearch('')} className="absolute right-1.5 top-1.5 text-gray-500 hover:text-gray-200">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
        {lib.error && (
          <div className="mb-3 flex items-center justify-between rounded-md bg-red-950/60 border border-red-900 px-3 py-2 text-sm text-red-300">
            {lib.error}
            <button type="button" onClick={() => lib.setError(null)} className="text-red-400 hover:text-red-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {lib.prompts === null ? (
          <div className="text-sm text-gray-500 p-6">Loading…</div>
        ) : lib.searching ? (
          <SearchResults
            query={q}
            prompts={lib.matches}
            groups={lib.namedGroups}
            samples={lib.overview.samples}
            onOpenGroup={lib.select}
            onSave={lib.savePrompt}
            onMove={lib.movePrompt}
            onDelete={lib.deletePrompt}
          />
        ) : selected !== null && byGroup.has(selected) ? (
          <GroupPanel
            key={selected}
            group={selected}
            prompts={byGroup.get(selected) ?? []}
            groups={lib.namedGroups}
            linked={lib.linksOf(selected)}
            samples={lib.overview.samples}
            onRename={to => lib.renameGroup(selected, to)}
            onDeleteGroup={() => lib.deleteGroup(selected)}
            onSave={lib.savePrompt}
            onMove={lib.movePrompt}
            onDelete={lib.deletePrompt}
            onReorder={lib.reorder}
          />
        ) : (
          <EmptyState
            title="No prompts yet"
            body="A group is one character's sample set: link it to a dataset and New Job loads its prompts as the job's sample prompts."
            action={
              <button type="button" onClick={() => lib.setAddingGroup(true)} className={btnPrimary}>
                <FolderPlus className="w-4 h-4" /> New group
              </button>
            }
          />
        )}
      </main>
    </div>
    </PromptImages.Provider>
    </LinkTarget.Provider>
  );
}

const sortPrompts = (a: SavedPrompt, b: SavedPrompt) => (a.sort_order ?? 0) - (b.sort_order ?? 0);

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
        <div className={`flex items-center gap-1 mt-0.5 text-[11px] truncate ${active ? 'text-slate-300' : 'text-gray-500'}`}>
          <Database className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{sub.join(', ')}</span>
        </div>
      )}
    </button>
  );
}

function InlineName({
  initial = '',
  placeholder,
  onDone,
  className = '',
}: {
  initial?: string;
  placeholder?: string;
  onDone: (v: string) => void;
  className?: string;
}) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const finish = (val: string) => {
    if (done.current) return;
    done.current = true;
    onDone(val);
  };
  return (
    <input
      autoFocus
      value={v}
      placeholder={placeholder}
      onChange={e => setV(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') finish(v);
        if (e.key === 'Escape') {
          e.preventDefault(); // cancels this field, not the popup around it
          finish(initial);
        }
      }}
      onBlur={() => finish(v)}
      className={`${inputCls} py-1.5 ${className}`}
    />
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-lg border border-dashed border-gray-700 px-6 py-12 text-center">
      <div className="text-gray-200 font-medium">{title}</div>
      <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

function GroupPanel({
  group,
  prompts,
  groups,
  linked,
  samples,
  onRename,
  onDeleteGroup,
  onSave,
  onMove,
  onDelete,
  onReorder,
}: {
  group: string;
  prompts: SavedPrompt[];
  groups: string[];
  linked: string[];
  samples: Record<string, PromptSample>;
  onRename: (to: string) => void;
  onDeleteGroup: () => void;
  onSave: (p: SavedPrompt) => Promise<void>;
  onMove: (p: SavedPrompt, group: string) => void;
  onDelete: (p: SavedPrompt) => void;
  onReorder: (ids: string[]) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(prompts.length === 0);
  const [order, setOrder] = useState<string[]>(prompts.map(p => p.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const linkTarget = useContext(LinkTarget);

  useEffect(() => {
    if (!dragId) setOrder(prompts.map(p => p.id));
  }, [prompts, dragId]);

  const byId = new Map(prompts.map(p => [p.id, p]));
  const ordered = order.map(id => byId.get(id)).filter(Boolean) as SavedPrompt[];

  const move = (id: string, delta: number) => {
    const i = order.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    onReorder(next);
  };

  const dragOver = (overId: string) => {
    if (!dragId || dragId === overId) return;
    setOrder(o => {
      const next = o.filter(id => id !== dragId);
      next.splice(next.indexOf(overId) + (o.indexOf(dragId) < o.indexOf(overId) ? 1 : 0), 0, dragId);
      return next;
    });
  };
  const dragEnd = () => {
    if (dragId && order.join() !== prompts.map(p => p.id).join()) onReorder(order);
    setDragId(null);
  };

  const isUngrouped = group === UNGROUPED;

  return (
    <div className="space-y-3">
      <header className="bg-gray-900 rounded-lg px-4 sm:px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {renaming ? (
              <InlineName
                initial={group}
                onDone={v => {
                  setRenaming(false);
                  onRename(v);
                }}
                className="max-w-sm text-lg font-semibold"
              />
            ) : (
              <div className="flex items-center gap-2 group/title">
                <h2 className={`text-xl font-semibold truncate ${isUngrouped ? 'text-gray-400 italic' : 'text-gray-100'}`}>
                  {groupLabel(group)}
                </h2>
                {!isUngrouped && (
                  <button
                    type="button"
                    title="Rename group (renaming onto an existing group merges them)"
                    onClick={() => setRenaming(true)}
                    className={`${iconBtn} opacity-0 group-hover/title:opacity-100 focus:opacity-100`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              <span>
                {prompts.length} prompt{prompts.length === 1 ? '' : 's'}
                {!isUngrouped && prompts.length > 1 && ' · order = sample slot order'}
              </span>
              {isUngrouped ? (
                <span>Prompts saved with ★ on Compare land here. Move them into a group to use them as sample prompts.</span>
              ) : linked.length ? (
                <span className="flex flex-wrap items-center gap-1">
                  Sample prompts for
                  {linked.map(d => (
                    <Link
                      key={d}
                      target={linkTarget}
                      href={`/datasets/${encodeURIComponent(d)}`}
                      className="inline-flex items-center gap-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 px-1.5 py-0.5"
                    >
                      <Database className="w-3 h-3" />
                      {d}
                    </Link>
                  ))}
                </span>
              ) : (
                <span>Not linked to a dataset yet: pick this group under “Sample prompts” on a dataset’s page.</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button type="button" onClick={() => setAdding(true)} className={btnPrimary}>
              <Plus className="w-4 h-4" /> Add prompt
            </button>
            {!isUngrouped && (
              <button type="button" title="Delete group" onClick={onDeleteGroup} className={`${iconBtn} hover:text-red-400`}>
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {ordered.map((p, i) => (
        <div
          key={p.id}
          onDragOver={e => {
            if (!dragId) return;
            e.preventDefault();
            dragOver(p.id);
          }}
          onDrop={e => e.preventDefault()}
          className={dragId === p.id ? 'opacity-40' : ''}
        >
          <PromptCard
            prompt={p}
            slot={isUngrouped ? undefined : i + 1}
            groups={groups}
            sample={samples[normalizePrompt(p.text)]}
            onSave={onSave}
            onMove={g => onMove(p, g)}
            onDelete={() => onDelete(p)}
            reorder={{
              up: i > 0 ? () => move(p.id, -1) : undefined,
              down: i < ordered.length - 1 ? () => move(p.id, 1) : undefined,
              onDragStart: () => setDragId(p.id),
              onDragEnd: dragEnd,
            }}
          />
        </div>
      ))}

      {adding ? (
        <PromptCard
          prompt={{ id: '', name: '', text: '', group }}
          slot={isUngrouped ? undefined : ordered.length + 1}
          groups={groups}
          startEditing
          onSave={async p => {
            await onSave(p);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        prompts.length === 0 && (
          <EmptyState
            title="This group is empty"
            body="Add the prompts this character should be sampled with. They load into New Job in the order shown here."
            action={
              <button type="button" onClick={() => setAdding(true)} className={btnPrimary}>
                <Plus className="w-4 h-4" /> Add prompt
              </button>
            }
          />
        )
      )}
    </div>
  );
}

function SearchResults({
  query,
  prompts,
  groups,
  samples,
  onOpenGroup,
  onSave,
  onMove,
  onDelete,
}: {
  query: string;
  prompts: SavedPrompt[];
  groups: string[];
  samples: Record<string, PromptSample>;
  onOpenGroup: (g: string) => void;
  onSave: (p: SavedPrompt) => Promise<void>;
  onMove: (p: SavedPrompt, group: string) => void;
  onDelete: (p: SavedPrompt) => void;
}) {
  if (!prompts.length)
    return <EmptyState title={query ? 'No matches' : 'No prompts yet'} body={query ? `Nothing matches “${query}”.` : 'Create a group to get started.'} />;
  return (
    <div className="space-y-3">
      <div className="px-1 text-xs text-gray-500">
        {query ? `${prompts.length} match${prompts.length === 1 ? '' : 'es'} for “${query}”` : `All ${prompts.length} prompts`}
      </div>
      {prompts.map(p => (
        <PromptCard
          key={p.id}
          prompt={p}
          groups={groups}
          sample={samples[normalizePrompt(p.text)]}
          groupTag={{ name: (p.group || '').trim(), open: () => onOpenGroup((p.group || '').trim()) }}
          highlight={query}
          onSave={onSave}
          onMove={g => onMove(p, g)}
          onDelete={() => onDelete(p)}
        />
      ))}
    </div>
  );
}

function PromptCard({
  prompt,
  slot,
  groups,
  sample,
  groupTag,
  highlight,
  startEditing,
  reorder,
  onSave,
  onCancel,
  onMove,
  onDelete,
}: {
  prompt: SavedPrompt;
  slot?: number;
  groups: string[];
  sample?: PromptSample;
  groupTag?: { name: string; open: () => void };
  highlight?: string;
  startEditing?: boolean;
  reorder?: { up?: () => void; down?: () => void; onDragStart: () => void; onDragEnd: () => void };
  onSave: (p: SavedPrompt) => Promise<void>;
  onCancel?: () => void;
  onMove?: (group: string) => void;
  onDelete?: () => void;
}) {
  const [editing, setEditing] = useState(!!startEditing);
  const [name, setName] = useState(prompt.name);
  const [text, setText] = useState(prompt.text);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) {
      setName(prompt.name);
      setText(prompt.text);
    }
  }, [prompt.name, prompt.text, editing]);

  const cancel = () => {
    setEditing(false);
    setName(prompt.name);
    setText(prompt.text);
    onCancel?.();
  };
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await onSave({ ...prompt, name, text });
      setEditing(false);
    } catch {
      // error is shown by the page
    } finally {
      setBusy(false);
    }
  };

  const current = (prompt.group || '').trim();
  const moveTargets = [...groups.filter(g => g !== current), ...(current ? [UNGROUPED] : [])];

  return (
    <div className="group/card bg-gray-900 rounded-lg flex overflow-hidden border border-transparent hover:border-gray-800 transition-colors">
      {/* slot gutter */}
      {(slot !== undefined || reorder) && (
        <div className="w-12 flex-shrink-0 flex flex-col items-center gap-1 py-3 bg-gray-950/40 border-r border-gray-800">
          {slot !== undefined && (
            <div className="text-center leading-none">
              <div className="text-[9px] uppercase tracking-wider text-gray-500">Slot</div>
              <div className="text-lg font-semibold text-gray-300 tabular-nums">{slot}</div>
            </div>
          )}
          {reorder && !editing && (
            <div className="flex flex-col items-center mt-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
              <button type="button" title="Move up" disabled={!reorder.up} onClick={reorder.up} className={iconBtn}>
                <ChevronUp className="w-4 h-4" />
              </button>
              <span
                draggable
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'move';
                  reorder.onDragStart();
                }}
                onDragEnd={reorder.onDragEnd}
                title="Drag to reorder"
                className="p-1 text-gray-500 hover:text-gray-200 cursor-grab active:cursor-grabbing"
              >
                <GripVertical className="w-4 h-4" />
              </span>
              <button type="button" title="Move down" disabled={!reorder.down} onClick={reorder.down} className={iconBtn}>
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* body */}
      <div className="flex-1 min-w-0 px-4 py-3">
        {editing ? (
          <div
            className="space-y-2"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
              if (e.key === 'Escape') {
                e.preventDefault(); // cancels the edit, not the popup around it
                cancel();
              }
            }}
          >
            <input
              autoFocus={!prompt.id}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Title, eg. Beach portrait (blank = start of the prompt)"
              className={inputCls}
            />
            <textarea
              autoFocus={!!prompt.id}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="jac1d, …"
              rows={Math.min(12, Math.max(4, Math.ceil(text.length / 90) + 1))}
              className={`${inputCls} leading-relaxed resize-y`}
            />
            <div className="flex items-center gap-2">
              <button type="button" disabled={busy || !text.trim()} onClick={save} className={btnPrimary}>
                <Check className="w-4 h-4" /> {prompt.id ? 'Save' : 'Add'}
              </button>
              <button type="button" onClick={cancel} className={btnGhost}>
                Cancel
              </button>
              <span className="ml-auto text-xs text-gray-500 tabular-nums">
                {text.length} chars · Ctrl+Enter to save
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <h3 className="text-sm font-medium text-gray-100 truncate">{prompt.name}</h3>
                {groupTag && (
                  <button
                    type="button"
                    onClick={groupTag.open}
                    className={`text-[11px] rounded px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 ${groupTag.name ? 'text-gray-300' : 'text-gray-500 italic'}`}
                  >
                    {groupLabel(groupTag.name)}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 focus-within:opacity-100 transition-opacity">
                <button type="button" title="Edit" onClick={() => setEditing(true)} className={iconBtn}>
                  <Pencil className="w-4 h-4" />
                </button>
                {onMove && moveTargets.length > 0 && (
                  <label title="Move to group" className={`${iconBtn} relative cursor-pointer`}>
                    <FolderInput className="w-4 h-4" />
                    <select
                      value=""
                      onChange={e => e.target.value !== '' && onMove(e.target.value === '\u0000' ? UNGROUPED : e.target.value)}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    >
                      <option value="">Move to…</option>
                      {moveTargets.map(g => (
                        <option key={g || '\u0000'} value={g || '\u0000'}>
                          {groupLabel(g)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {onDelete && (
                  <button type="button" title="Delete" onClick={onDelete} className={`${iconBtn} hover:text-red-400`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <p
              onDoubleClick={() => setEditing(true)}
              title="Double-click to edit"
              className="mt-1.5 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap break-words"
            >
              <PromptText text={prompt.text} highlight={highlight} />
            </p>
            <div className="mt-2 text-[11px] text-gray-500 tabular-nums">
              {prompt.text.length} chars
              {sample && ` · sampled in ${sample.jobs} job${sample.jobs === 1 ? '' : 's'}`}
            </div>
          </>
        )}
      </div>

      {/* latest sample */}
      {!editing && <SampleThumb sample={sample} promptId={prompt.id || undefined} />}
    </div>
  );
}

// the prompt's picture: an image the user uploaded for it, else its latest training sample. Hover
// (or drop an image on it) to upload / replace; an uploaded one can be removed again.
function SampleThumb({ sample, promptId }: { sample?: PromptSample; promptId?: string }) {
  const [broken, setBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState(false);
  const linkTarget = useContext(LinkTarget);
  const imgs = useContext(PromptImages);
  const input = useRef<HTMLInputElement>(null);
  const own = promptId ? imgs?.images[promptId] : undefined;
  const canUpload = !!promptId && !!imgs;

  useEffect(() => setBroken(false), [own, sample?.path]);

  const upload = async (file?: File | null) => {
    if (!file || !promptId || !imgs || !file.type.startsWith('image/')) return;
    setBusy(true);
    try {
      await imgs.upload(promptId, file);
    } finally {
      setBusy(false);
    }
  };
  const pick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    input.current?.click();
  };
  const dropProps = canUpload
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.stopPropagation();
          setDropping(true);
        },
        onDragLeave: () => setDropping(false),
        onDrop: (e: React.DragEvent) => {
          if (!e.dataTransfer.files?.length) return;
          e.preventDefault();
          e.stopPropagation();
          setDropping(false);
          upload(e.dataTransfer.files[0]);
        },
      }
    : {};
  const fileInput = canUpload && (
    <input
      ref={input}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={e => {
        upload(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );
  const box = `hidden sm:block relative w-32 h-32 flex-shrink-0 m-3 ml-0 rounded-md overflow-hidden bg-gray-950 ring-1 transition group/thumb ${
    dropping ? 'ring-slate-400' : 'ring-gray-800 hover:ring-slate-500'
  }`;
  const hoverBtn =
    'rounded bg-black/70 hover:bg-black/90 text-gray-200 p-1 opacity-0 group-hover/thumb:opacity-100 focus:opacity-100 transition-opacity';
  const src = own ?? sample?.path;

  if (!src || broken)
    return (
      <div {...dropProps} className={box.replace('ring-1', 'border border-dashed border-gray-800 ring-0')}>
        {fileInput}
        <button
          type="button"
          disabled={!canUpload || busy}
          onClick={pick}
          title={canUpload ? 'Upload an image for this prompt (or drop one here)' : undefined}
          className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-600 enabled:hover:text-gray-300"
        >
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : canUpload ? <ImagePlus className="w-5 h-5" /> : <ImageOff className="w-5 h-5" />}
          <span className="text-[10px]">{canUpload ? 'Upload image' : 'No samples yet'}</span>
        </button>
      </div>
    );

  const picture = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/img/${encodeFilePathForUrl(src)}?thumb=1`}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="w-full h-full object-cover"
      />
      {!own && sample && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pt-4 pb-1">
          <div className="text-[10px] text-gray-200 truncate">{sample.jobName}</div>
          <div className="text-[10px] text-gray-400 tabular-nums">step {sample.step.toLocaleString()}</div>
        </div>
      )}
      {canUpload && (
        <div className="absolute top-1 right-1 flex gap-1">
          <button type="button" title={own ? 'Replace image' : 'Use your own image'} onClick={pick} className={hoverBtn}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
          </button>
          {own && (
            <button
              type="button"
              title={sample ? 'Remove (back to the latest sample)' : 'Remove image'}
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                imgs!.clear(promptId!);
              }}
              className={`${hoverBtn} hover:text-red-400`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </>
  );

  if (own)
    return (
      <div {...dropProps} className={box}>
        {fileInput}
        {picture}
      </div>
    );
  // the file input sits outside the link: its click would bubble up and follow it
  return (
    <>
      {fileInput}
      <Link
        {...dropProps}
        target={linkTarget}
        href={`/jobs/${sample!.jobId}?tab=samples`}
        title={`Latest sample: ${sample!.jobName}, step ${sample!.step.toLocaleString()}`}
        className={box}
      >
        {picture}
      </Link>
    </>
  );
}
