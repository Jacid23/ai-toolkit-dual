'use client';

// DUAL BUILD: the Jobs explorer: the trainings as a details view. Left, the group tree (the folders
// they save in); top, a search over every config value; right, sortable columns (click a header to
// sort, again to reverse, shift-click for a second key) the viewer picks, any config field included.
// Tags are labels on top of the folders. Columns resize (drag a header's edge) and reorder (drag
// a header); sort, columns, order, widths and the open group are kept per browser. The page itself
// never scrolls: the list scrolls in its card under a header that stays put.
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Job } from '@prisma/client';
import classNames from 'classnames';
import { ChevronDown, ChevronRight, Columns3, Folder, Search, Tag, X } from 'lucide-react';
import { CgSpinner } from 'react-icons/cg';
import JobActionBar from '@/components/JobActionBar';
import SampleImageViewer from '@/components/SampleImageViewer';
import { openConfirm } from '@/components/ConfirmModal';
import { apiClient } from '@/utils/api';
import { getTotalSteps } from '@/utils/jobs';
import SamplePreview from './SamplePreview';
import {
  GroupNode,
  JobFileInfo,
  Row,
  buildTree,
  createdOf,
  datasetOf,
  diffGuidanceOf,
  emaOf,
  factorOf,
  finishedOf,
  fullRankOf,
  fmtDate,
  fmtSize,
  inGroup,
  alphaOf,
  linearOf,
  lrNumOf,
  matchRow,
  maxLrOf,
  plain,
  stepTargetOf,
  modelOf,
  netTypeOf,
  numOrNull,
  parseSearch,
  toRow,
  valueAt,
} from './explore';

type Col = {
  key: string;
  title: string;
  get: (r: Row) => string | number | null;
  render?: (r: Row) => ReactNode;
  width?: number; // default width, px
  empty?: string; // shown when the job has no value (never a blank cell); default 'none'
};

const STATUS_CLASS: Record<string, string> = {
  completed: 'text-green-400',
  error: 'text-red-400',
  failed: 'text-red-400',
  running: 'text-blue-400',
};

const BUILT_IN: Col[] = [
  { key: 'group', title: 'Group', get: r => r.info?.group ?? '', empty: '(Training Folder)' },
  {
    key: 'status',
    title: 'Status',
    get: r => r.job.status,
    render: r => <span className={STATUS_CLASS[r.job.status] ?? 'text-gray-400'}>{r.job.status}</span>,
  },
  {
    key: 'steps',
    title: 'Steps',
    get: r => r.job.step,
    render: r => {
      const total = getTotalSteps(r.job);
      return (
        <span className="text-gray-400">
          {r.job.step.toLocaleString()}
          {total ? ` / ${total.toLocaleString()}` : ''}
        </span>
      );
    },
  },
  { key: 'model', title: 'Model', get: modelOf, width: 150 },
  { key: 'type', title: 'Type', get: netTypeOf, width: 70 },
  { key: 'linear', title: 'Linear', get: linearOf, width: 70 },
  { key: 'alpha', title: 'Alpha', get: alphaOf, width: 70 },
  { key: 'rank', title: 'Full rank', get: fullRankOf, width: 80 },
  { key: 'factor', title: 'Factor', get: factorOf, width: 70 },
  { key: 'optimizer', title: 'Optimizer', get: r => r.proc.train?.optimizer ?? '', width: 110 },
  { key: 'lr', title: 'LR', get: lrNumOf, render: r => plain(lrNumOf(r)), width: 80 },
  { key: 'maxlr', title: 'Max LR', get: maxLrOf, render: r => plain(maxLrOf(r)), width: 80 },
  { key: 'steptarget', title: 'Step target', get: stepTargetOf, width: 90 },
  { key: 'diff', title: 'Diff guidance', get: diffGuidanceOf, width: 100 },
  { key: 'ema', title: 'EMA', get: emaOf, width: 70 },
  { key: 'dtype', title: 'Dtype', get: r => r.proc.train?.dtype ?? '', width: 70 },
  { key: 'saveDtype', title: 'Save dtype', get: r => r.proc.save?.dtype ?? '', width: 90 },
  { key: 'dataset', title: 'Dataset', get: datasetOf, width: 140 },
  { key: 'trigger', title: 'Trigger', get: r => r.proc.trigger_word ?? '', width: 90 },
  { key: 'created', title: 'Created', get: createdOf, render: r => fmtDate(createdOf(r)), width: 135 },
  {
    key: 'trained',
    title: 'Last trained',
    get: r => r.info?.lastLora ?? null,
    render: r => fmtDate(r.info?.lastLora),
    width: 135,
    empty: 'never',
  },
  {
    key: 'finished',
    title: 'Finished',
    get: finishedOf,
    render: r => fmtDate(finishedOf(r)),
    width: 135,
    empty: 'not finished',
  },
  { key: 'loras', title: 'LoRAs', get: r => r.info?.loras ?? 0, width: 65 },
  {
    key: 'ckpt',
    title: 'Per LoRA',
    get: r => r.info?.ckptSize ?? 0,
    render: r => fmtSize(r.info?.ckptSize ?? 0),
    width: 80,
    empty: '0',
  },
  {
    key: 'size',
    title: 'Size',
    get: r => r.info?.size ?? 0,
    render: r => fmtSize(r.info?.size ?? 0),
    width: 80,
    empty: '0',
  },
  { key: 'tags', title: 'Tags', get: r => r.tags.join(', '), width: 120 },
];
const DEFAULT_COLS = [
  'group',
  'status',
  'steps',
  'model',
  'type',
  'linear',
  'alpha',
  'factor',
  'optimizer',
  'created',
  'trained',
  'ckpt',
  'tags',
];
const NAME_WIDTH = 280;
const SELECT_WIDTH = 32;
const ACTIONS_WIDTH = 240;
const COL_WIDTH = 100;
const MIN_WIDTH = 50;

type Sort = { key: string; dir: 1 | -1 };
type Prefs = {
  cols: string[];
  custom: string[];
  sorts: Sort[];
  group: string | null;
  collapsed: string[];
  order: string[]; // column order (keys); unlisted ones follow in their default place
  widths: Record<string, number>; // column widths the viewer dragged, px ('name' included)
};
const PREFS_KEY = 'aitk.jobsExplorer.v1';
const DEFAULT_PREFS: Prefs = {
  cols: DEFAULT_COLS,
  custom: [],
  sorts: [{ key: 'trained', dir: -1 }],
  group: null,
  collapsed: [],
  order: [],
  widths: {},
};

const loadPrefs = (): Prefs => {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    return p ? { ...DEFAULT_PREFS, ...p } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
};

const compare = (a: any, b: any) => {
  const na = a === null || a === undefined || a === '';
  const nb = b === null || b === undefined || b === '';
  if (na || nb) return na && nb ? 0 : na ? 1 : -1; // blanks last either way
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

export const setJobTags = (body: { ids: string[]; set?: string[]; add?: string[]; remove?: string[] }) =>
  apiClient.post('/api/jobs/tags', body);

const splitTags = (v?: string) =>
  (v ?? '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

export default function JobsExplorer({
  jobs,
  selectedIds,
  toggleRow,
  setSelectedIds,
  disabled,
  onRefresh,
}: {
  jobs: Job[];
  selectedIds: Set<string>;
  toggleRow: (id: string) => void;
  setSelectedIds: (ids: Set<string>) => void;
  disabled?: boolean;
  onRefresh: () => void;
}) {
  const [infos, setInfos] = useState<Record<string, JobFileInfo>>({});
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [query, setQuery] = useState('');
  const [showCols, setShowCols] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [viewer, setViewer] = useState<{ path: string; set: string[]; job: Job } | null>(null);

  useEffect(() => setPrefsState(loadPrefs()), []);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const setPrefs = (p: Partial<Prefs>) =>
    setPrefsState(prev => {
      const next = { ...prev, ...p };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  const loadInfos = () =>
    apiClient
      .get('/api/jobs/explore')
      .then(r => setInfos(r.data?.jobs ?? {}))
      .catch(() => {});
  useEffect(() => {
    loadInfos();
    const t = setInterval(loadInfos, 30000);
    return () => clearInterval(t);
  }, []);

  const rows = useMemo(() => jobs.map(j => toRow(j, infos[j.id])), [jobs, infos]);
  const tree = useMemo(() => buildTree(rows), [rows]);
  const tokens = useMemo(() => parseSearch(query), [query]);

  const columns: Col[] = useMemo(() => {
    // a config field that's a number wherever it's set is 0 where a job doesn't have it
    const custom: Col[] = prefs.custom.map(path => {
      const values = rows.map(r => valueAt(r, path)).filter(v => v !== '');
      const numeric = values.length > 0 && values.every(v => numOrNull(v) !== null);
      return {
        key: `cfg:${path}`,
        title: path.split('.').pop() || path,
        get: (r: Row) => {
          const v = valueAt(r, path);
          return numeric ? (numOrNull(v) ?? 0) : v;
        },
      };
    });
    const visible = [...BUILT_IN, ...custom].filter(c => prefs.cols.includes(c.key) || c.key.startsWith('cfg:'));
    const at = (k: string) => {
      const i = prefs.order.indexOf(k);
      return i < 0 ? Infinity : i;
    };
    // the viewer's order first, the rest keep their default places after it
    return visible
      .map((c, i) => ({ c, i }))
      .sort((a, b) => at(a.c.key) - at(b.c.key) || a.i - b.i)
      .map(x => x.c);
  }, [prefs.cols, prefs.custom, prefs.order, rows]);

  // --- resize (drag a header's right edge) and reorder (drag a header onto another) --------
  const resizing = useRef<{ key: string; x: number; w: number } | null>(null);
  const justResized = useRef(false);
  const [liveWidth, setLiveWidth] = useState<{ key: string; w: number } | null>(null);
  const widthOf = (key: string, col?: Col) =>
    liveWidth?.key === key
      ? liveWidth.w
      : (prefs.widths[key] ?? (key === 'name' ? NAME_WIDTH : (col?.width ?? COL_WIDTH)));
  const startResize = (e: React.MouseEvent, key: string, w: number) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { key, x: e.clientX, w };
    const widthAt = (x: number) =>
      resizing.current ? Math.max(MIN_WIDTH, Math.round(resizing.current.w + x - resizing.current.x)) : w;
    const move = (ev: MouseEvent) => setLiveWidth({ key, w: widthAt(ev.clientX) });
    const up = (ev: MouseEvent) => {
      const final = widthAt(ev.clientX);
      resizing.current = null;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      setLiveWidth(null);
      justResized.current = true; // the click that ends a resize doesn't also sort
      setTimeout(() => (justResized.current = false), 0);
      setPrefs({ widths: { ...prefsRef.current.widths, [key]: final } });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const dropOn = (target: string) => {
    if (!dragKey || dragKey === target) return;
    const keys = columns.map(c => c.key).filter(k => k !== dragKey);
    keys.splice(keys.indexOf(target), 0, dragKey);
    setPrefs({ order: keys });
  };

  const shown = useMemo(() => {
    const out: { row: Row; why: string }[] = [];
    for (const row of rows) {
      if (!inGroup(row, prefs.group)) continue;
      const why = tokens.length ? matchRow(row, tokens) : '';
      if (why === false) continue;
      out.push({ row, why });
    }
    const byKey = new Map([...BUILT_IN, ...columns].map(c => [c.key, c]));
    byKey.set('name', { key: 'name', title: 'Name', get: r => r.job.name });
    out.sort((a, b) => {
      for (const s of prefs.sorts) {
        const col = byKey.get(s.key);
        if (!col) continue;
        const c = compare(col.get(a.row), col.get(b.row));
        if (c) return c * s.dir;
      }
      return 0;
    });
    return out;
  }, [rows, tokens, prefs.group, prefs.sorts, columns]);

  const onSort = (key: string, shift: boolean) => {
    if (justResized.current) return;
    const at = prefs.sorts.findIndex(s => s.key === key);
    if (shift) {
      const sorts = [...prefs.sorts];
      if (at >= 0) sorts[at] = { key, dir: sorts[at].dir === 1 ? -1 : 1 };
      else sorts.push({ key, dir: 1 });
      setPrefs({ sorts });
    } else {
      setPrefs({ sorts: [{ key, dir: at === 0 && prefs.sorts[0].dir === 1 ? -1 : 1 }] });
    }
  };
  const sortMark = (key: string) => {
    const i = prefs.sorts.findIndex(s => s.key === key);
    if (i < 0) return null;
    return (
      <span className="text-blue-400 ml-1">
        {prefs.sorts[i].dir === 1 ? '▲' : '▼'}
        {prefs.sorts.length > 1 ? <sup>{i + 1}</sup> : null}
      </span>
    );
  };

  const editTags = (job: Job, tags: string[]) =>
    openConfirm({
      title: 'Tags',
      message: `Tags for ${job.name}, comma separated.`,
      type: 'info',
      confirmText: 'Save',
      inputTitle: 'best, lokr test, keep',
      inputValue: tags.join(', '),
      onConfirm: async v => {
        await setJobTags({ ids: [job.id], set: splitTags(v) });
        onRefresh();
      },
    });

  // config fields of the shown jobs, for "add a column"
  const fieldPaths = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) for (const [k] of r.flat) if (!/\[\d+\]/.test(k) || /^datasets\[0\]/.test(k)) s.add(k);
    return Array.from(s).sort();
  }, [rows]);

  const shownIds = shown.map(s => s.row.job.id);
  const allShownSelected = shownIds.length > 0 && shownIds.every(id => selectedIds.has(id));

  const groupTree = (nodes: GroupNode[], depth: number): ReactNode =>
    nodes.map(n => {
      const collapsed = prefs.collapsed.includes(n.path);
      return (
        <div key={n.path}>
          <div
            className={classNames(
              'flex items-center gap-1 rounded px-1 py-0.5 cursor-pointer text-sm',
              prefs.group === n.path ? 'bg-blue-900/50 text-white' : 'text-gray-300 hover:bg-gray-800',
            )}
            style={{ paddingLeft: depth * 12 + 4 }}
            onClick={() => setPrefs({ group: n.path })}
          >
            {n.children.length ? (
              <button
                type="button"
                className="text-gray-500 hover:text-gray-200"
                onClick={e => {
                  e.stopPropagation();
                  setPrefs({
                    collapsed: collapsed ? prefs.collapsed.filter(p => p !== n.path) : [...prefs.collapsed, n.path],
                  });
                }}
              >
                {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            ) : (
              <span className="w-3.5" />
            )}
            <Folder className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <span className="truncate">{n.label}</span>
            <span className="ml-auto text-xs text-gray-500">{n.count}</span>
          </div>
          {!collapsed && n.children.length > 0 && groupTree(n.children, depth + 1)}
        </div>
      );
    });

  const flatGroups = (nodes: GroupNode[], out: GroupNode[] = []) => {
    for (const n of nodes) {
      out.push(n);
      flatGroups(n.children, out);
    }
    return out;
  };

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* group tree (a select on small screens) */}
      <aside className="hidden md:block w-56 shrink-0 overflow-y-auto">
        <div
          className={classNames(
            'flex items-center gap-1 rounded px-1 py-0.5 cursor-pointer text-sm mb-1',
            prefs.group === null ? 'bg-blue-900/50 text-white' : 'text-gray-300 hover:bg-gray-800',
          )}
          onClick={() => setPrefs({ group: null })}
        >
          <span className="w-3.5" />
          <Folder className="w-3.5 h-3.5 text-gray-500" />
          All jobs
          <span className="ml-auto text-xs text-gray-500">{rows.length}</span>
        </div>
        {groupTree(tree, 0)}
      </aside>

      <div className="min-w-0 flex-1 flex flex-col min-h-0">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <select
            value={prefs.group ?? ''}
            onChange={e => setPrefs({ group: e.target.value || null })}
            className="md:hidden bg-gray-800 border border-gray-700 rounded-md text-sm px-2 py-1 max-w-full"
          >
            <option value="">All jobs ({rows.length})</option>
            {flatGroups(tree).map(n => (
              <option key={n.path} value={n.path}>
                {n.path} ({n.count})
              </option>
            ))}
          </select>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search everything: lexi lokr automagic4 · optimizer:automagic4 rank:32 tag:best after:2026-10-20"
              className="w-full bg-gray-800 border border-gray-700 rounded-md text-sm pl-8 pr-7 py-1.5"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <span className="text-xs text-gray-500">
            {shown.length} of {rows.length}
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowCols(v => !v)}
              className="flex items-center gap-1 text-sm bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md px-2 py-1"
            >
              <Columns3 className="w-4 h-4" /> Columns
            </button>
            {showCols && (
              <div className="absolute right-0 z-40 mt-1 w-72 rounded-md border border-gray-700 bg-gray-900 p-2 shadow-xl">
                <div className="grid grid-cols-2 gap-x-2">
                  {BUILT_IN.map(c => (
                    <label key={c.key} className="flex items-center gap-1.5 text-sm text-gray-300 py-0.5">
                      <input
                        type="checkbox"
                        checked={prefs.cols.includes(c.key)}
                        onChange={() =>
                          setPrefs({
                            cols: prefs.cols.includes(c.key)
                              ? prefs.cols.filter(k => k !== c.key)
                              : [...prefs.cols, c.key],
                          })
                        }
                        className="accent-blue-500"
                      />
                      {c.title}
                    </label>
                  ))}
                </div>
                <div className="mt-2 border-t border-gray-700 pt-2">
                  <div className="text-xs text-gray-500 mb-1">Any config field as a column</div>
                  {prefs.custom.map(p => (
                    <div key={p} className="flex items-center gap-1 text-xs text-gray-300 py-0.5">
                      <span className="truncate flex-1">{p}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setPrefs({
                            custom: prefs.custom.filter(x => x !== p),
                            sorts: prefs.sorts.filter(s => s.key !== `cfg:${p}`),
                          })
                        }
                        className="text-gray-500 hover:text-red-400"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <form
                    className="flex gap-1 mt-1"
                    onSubmit={e => {
                      e.preventDefault();
                      const p = customPath.trim();
                      if (p && !prefs.custom.includes(p)) setPrefs({ custom: [...prefs.custom, p] });
                      setCustomPath('');
                    }}
                  >
                    <input
                      list="aitk-config-fields"
                      value={customPath}
                      onChange={e => setCustomPath(e.target.value)}
                      placeholder="train.timestep_type"
                      className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded text-xs px-1.5 py-1"
                    />
                    <button type="submit" className="text-xs bg-gray-700 hover:bg-gray-600 rounded px-2">
                      Add
                    </button>
                    <datalist id="aitk-config-fields">
                      {fieldPaths.map(p => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-gray-800">
          <table
            className="table-fixed text-sm"
            style={{
              width:
                SELECT_WIDTH + widthOf('name') + columns.reduce((t, c) => t + widthOf(c.key, c), 0) + ACTIONS_WIDTH,
            }}
          >
            <colgroup>
              <col style={{ width: SELECT_WIDTH }} />
              <col style={{ width: widthOf('name') }} />
              {columns.map(c => (
                <col key={c.key} style={{ width: widthOf(c.key, c) }} />
              ))}
              <col style={{ width: ACTIONS_WIDTH }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-gray-900 text-gray-400 text-xs select-none shadow-[0_1px_0_0_rgb(31,41,55)]">
              <tr>
                <th className="px-2 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    disabled={disabled}
                    onChange={() => {
                      const next = new Set(selectedIds);
                      shownIds.forEach(id => (allShownSelected ? next.delete(id) : next.add(id)));
                      setSelectedIds(next);
                    }}
                    className="cursor-pointer accent-blue-500"
                  />
                </th>
                <th
                  className="relative px-2 py-2 text-left cursor-pointer whitespace-nowrap overflow-hidden"
                  onClick={e => onSort('name', e.shiftKey)}
                >
                  Name{sortMark('name')}
                  <span
                    onMouseDown={e => startResize(e, 'name', widthOf('name'))}
                    onClick={e => e.stopPropagation()}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-500/60"
                  />
                </th>
                {columns.map(c => (
                  <th
                    key={c.key}
                    draggable
                    onDragStart={e => {
                      if (resizing.current) return e.preventDefault();
                      setDragKey(c.key);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={e => {
                      if (!dragKey) return;
                      e.preventDefault();
                      setDropKey(c.key);
                    }}
                    onDragLeave={() => setDropKey(k => (k === c.key ? null : k))}
                    onDrop={e => {
                      e.preventDefault();
                      dropOn(c.key);
                      setDragKey(null);
                      setDropKey(null);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setDropKey(null);
                    }}
                    className={classNames(
                      'relative px-2 py-2 text-left cursor-pointer whitespace-nowrap overflow-hidden text-ellipsis',
                      dragKey === c.key && 'opacity-40',
                      dropKey === c.key && dragKey !== c.key && 'shadow-[inset_2px_0_0_0_rgb(59,130,246)]',
                    )}
                    onClick={e => onSort(c.key, e.shiftKey)}
                    title={`${c.key.startsWith('cfg:') ? c.key.slice(4) : c.title} · click to sort, shift-click for a second sort, drag to move, drag the edge to resize`}
                  >
                    {c.title}
                    {sortMark(c.key)}
                    <span
                      draggable={false}
                      onDragStart={e => e.preventDefault()}
                      onMouseDown={e => startResize(e, c.key, widthOf(c.key, c))}
                      onClick={e => e.stopPropagation()}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-500/60"
                    />
                  </th>
                ))}
                <th className="px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ row, why }) => {
                const job = row.job;
                return (
                  <tr key={job.id} className="border-t border-gray-800 hover:bg-gray-900/60 align-top">
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(job.id)}
                        onChange={() => toggleRow(job.id)}
                        disabled={disabled}
                        className="cursor-pointer accent-blue-500"
                      />
                    </td>
                    <td className="px-2 py-1.5 overflow-hidden">
                      <div className="flex items-center gap-1.5">
                        {row.info?.hasSamples && (
                          <SamplePreview
                            jobId={job.id}
                            running={job.status === 'running'}
                            onOpenImage={(path, set) => setViewer({ path, set, job })}
                          />
                        )}
                        <Link
                          href={`/jobs/${job.id}`}
                          title={job.name}
                          className="font-medium truncate hover:text-blue-300"
                        >
                          {['running', 'stopping'].includes(job.status) && (
                            <CgSpinner className="inline animate-spin mr-1 text-blue-400" />
                          )}
                          {job.name}
                        </Link>
                        <button
                          type="button"
                          title="Edit tags"
                          onClick={() => editTags(job, row.tags)}
                          className="text-gray-600 hover:text-gray-300"
                        >
                          <Tag className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {row.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {row.tags.map(t => (
                            <button
                              key={t}
                              type="button"
                              onClick={() =>
                                setQuery(q =>
                                  q.includes(`tag:${t}`) ? q : `${q} tag:${t.includes(' ') ? `"${t}"` : t}`.trim(),
                                )
                              }
                              className="rounded-full bg-gray-800 px-2 py-0.5 text-[11px] text-gray-300 hover:bg-gray-700"
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      )}
                      {why && (
                        <div className="text-[11px] text-amber-300/80 mt-0.5 truncate" title={why}>
                          {why}
                        </div>
                      )}
                      {row.info && !row.info.folderExists && (
                        <div className="text-[11px] text-red-400 mt-0.5">folder not found</div>
                      )}
                    </td>
                    {columns.map(c => (
                      <td
                        key={c.key}
                        className="px-2 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis text-gray-300"
                        title={String(c.get(row) ?? '')}
                      >
                        {(() => {
                          // no value says so ("none", "never", 0), never a blank
                          const v = c.render ? c.render(row) : c.get(row);
                          return v === '' || v === null || v === undefined ? (
                            <span className="text-gray-600">{c.empty ?? 'none'}</span>
                          ) : (
                            v
                          );
                        })()}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right">
                      <JobActionBar job={job} onRefresh={onRefresh} autoStartQueue={false} />
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 3} className="px-2 py-6 text-center text-gray-500">
                    {rows.length ? 'No jobs match' : 'No jobs'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {viewer && (
        <SampleImageViewer
          imgPath={viewer.path}
          numSamples={viewer.set.length}
          sampleImages={viewer.set}
          sampleConfig={(toRow(viewer.job, undefined).proc.sample ?? null) as any}
          onChange={p => setViewer(v => (p && v ? { ...v, path: p } : null))}
          jobId={viewer.job.id}
        />
      )}
    </div>
  );
}
