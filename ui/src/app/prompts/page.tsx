'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  Layers,
  FolderPlus,
  FolderInput,
} from 'lucide-react';
import { TopBar } from '@/components/layout';
import { apiClient } from '@/utils/api';
import { openConfirm } from '@/components/ConfirmModal';
import { encodeFilePathForUrl } from '@/utils/basic';

// DUAL BUILD: Prompt Library. Groups are a character's sample set (a dataset links to one
// group and New Job loads its prompts, in order, as the job's sample slots), so the page is
// built around the group: the rail lists groups, the main panel shows the selected group's
// prompts as slot cards with the latest training sample each one produced.

type SavedPrompt = { id: string; name: string; text: string; group?: string; sort_order?: number };
type PromptSample = { path: string; jobId: string; jobName: string; step: number; jobs: number };
type Overview = { links: { dataset: string; group: string }[]; samples: Record<string, PromptSample> };

const ALL = '\u0000all';
const UNGROUPED = '';
const groupLabel = (g: string) => (g === UNGROUPED ? 'Ungrouped' : g);
const normalizePrompt = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();

const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-md bg-slate-600 hover:bg-slate-500 text-gray-100 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none';
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 text-sm transition-colors';
const iconBtn = 'p-1.5 rounded-md text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-30';
const inputCls =
  'w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-slate-500';

const loadSelected = () => {
  try {
    return localStorage.getItem('prompts.group');
  } catch {
    return null;
  }
};
const storeSelected = (g: string) => {
  try {
    localStorage.setItem('prompts.group', g);
  } catch {}
};

export default function PromptsPage() {
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
      .then(r => setOverview({ links: r.data?.links ?? [], samples: r.data?.samples ?? {} }))
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

  const groupNames = useMemo(
    () =>
      Array.from(byGroup.keys()).sort((a, b) =>
        a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b, undefined, { sensitivity: 'base' }),
      ),
    [byGroup],
  );
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

  const addGroup = (name: string) => {
    name = name.trim();
    setAddingGroup(false);
    if (!name) return;
    if (!byGroup.has(name)) setExtraGroups(gs => [...gs, name]);
    select(name);
  };

  const total = prompts?.length ?? 0;

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

      <div className="absolute inset-0 pt-14 px-2 sm:px-4 pb-4 flex flex-col md:flex-row gap-4">
        {/* group rail */}
        <aside className="md:w-64 flex-shrink-0 max-h-56 md:max-h-none overflow-y-auto bg-gray-900 rounded-lg p-2 flex flex-col">
          <RailItem active={selected === ALL && !q} onClick={() => select(ALL)} icon={<Layers className="w-4 h-4" />} label="All prompts" count={total} />
          <div className="flex items-center justify-between px-2 pt-4 pb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Groups</span>
            <button type="button" title="New group" onClick={() => setAddingGroup(true)} className={iconBtn}>
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>
          {addingGroup && <InlineName placeholder="Group name, eg. g3mma" onDone={addGroup} />}
          {prompts !== null && groupNames.length === 0 && !addingGroup && (
            <p className="px-2 py-2 text-xs text-gray-500">No groups yet.</p>
          )}
          <div className="space-y-0.5">
            {groupNames.map(g => (
              <RailItem
                key={g || '\u0000ungrouped'}
                active={selected === g && !q}
                onClick={() => select(g)}
                label={groupLabel(g)}
                muted={g === UNGROUPED}
                count={byGroup.get(g)?.length ?? 0}
                sub={linksOf(g)}
              />
            ))}
          </div>
        </aside>

        {/* main panel */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {error && (
            <div className="mb-3 flex items-center justify-between rounded-md bg-red-950/60 border border-red-900 px-3 py-2 text-sm text-red-300">
              {error}
              <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-200">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {prompts === null ? (
            <div className="text-sm text-gray-500 p-6">Loading…</div>
          ) : searching ? (
            <SearchResults
              query={q}
              prompts={matches}
              groups={namedGroups}
              samples={overview.samples}
              onOpenGroup={select}
              onSave={savePrompt}
              onMove={movePrompt}
              onDelete={deletePrompt}
            />
          ) : selected !== null && byGroup.has(selected) ? (
            <GroupPanel
              key={selected}
              group={selected}
              prompts={byGroup.get(selected) ?? []}
              groups={namedGroups}
              linked={linksOf(selected)}
              samples={overview.samples}
              onRename={to => renameGroup(selected, to)}
              onDeleteGroup={() => deleteGroup(selected)}
              onSave={savePrompt}
              onMove={movePrompt}
              onDelete={deletePrompt}
              onReorder={reorder}
            />
          ) : (
            <EmptyState
              title="No prompts yet"
              body="A group is one character's sample set: link it to a dataset and New Job loads its prompts as the job's sample prompts."
              action={
                <button type="button" onClick={() => setAddingGroup(true)} className={btnPrimary}>
                  <FolderPlus className="w-4 h-4" /> New group
                </button>
              }
            />
          )}
        </main>
      </div>
    </>
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
        if (e.key === 'Escape') finish(initial);
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

// the trigger word is the prompt's leading single-word token ("jac1d, 6' tall…")
const triggerOf = (text: string) => {
  const m = text.match(/^\s*([^\s,.;:]{2,24})\s*[,.;:]/);
  return m ? m[1] : '';
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function PromptText({ text, highlight }: { text: string; highlight?: string }) {
  const trigger = triggerOf(text);
  const terms = [trigger, highlight].filter(Boolean) as string[];
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) =>
        trigger && part.toLowerCase() === trigger.toLowerCase() ? (
          <span key={i} className="rounded bg-slate-700/70 text-slate-100 px-1 font-medium">
            {part}
          </span>
        ) : highlight && part.toLowerCase() === highlight.toLowerCase() ? (
          <mark key={i} className="bg-amber-500/30 text-amber-100 rounded px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
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
              if (e.key === 'Escape') cancel();
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
      {!editing && <SampleThumb sample={sample} />}
    </div>
  );
}

function SampleThumb({ sample }: { sample?: PromptSample }) {
  const [broken, setBroken] = useState(false);
  if (!sample || broken)
    return (
      <div className="hidden sm:flex w-32 flex-shrink-0 m-3 ml-0 rounded-md border border-dashed border-gray-800 flex-col items-center justify-center gap-1 text-gray-600">
        <ImageOff className="w-5 h-5" />
        <span className="text-[10px]">No samples yet</span>
      </div>
    );
  return (
    <Link
      href={`/jobs/${sample.jobId}?tab=samples`}
      title={`Latest sample: ${sample.jobName}, step ${sample.step.toLocaleString()}`}
      className="hidden sm:block relative w-32 h-32 flex-shrink-0 m-3 ml-0 rounded-md overflow-hidden bg-gray-950 ring-1 ring-gray-800 hover:ring-slate-500 transition"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/img/${encodeFilePathForUrl(sample.path)}?thumb=1`}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="w-full h-full object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pt-4 pb-1">
        <div className="text-[10px] text-gray-200 truncate">{sample.jobName}</div>
        <div className="text-[10px] text-gray-400 tabular-nums">step {sample.step.toLocaleString()}</div>
      </div>
    </Link>
  );
}
