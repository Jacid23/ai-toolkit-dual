'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { Menu, MenuButton, MenuItem, MenuItems, Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { Ellipsis, FolderX, GripVertical, ImageOff, Loader2, Pencil, Plus, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { TopBar } from '@/components/layout';
import { apiClient } from '@/utils/api';
import { openConfirm } from '@/components/ConfirmModal';
import ComparePanel, { ComfyInfo } from '@/components/compare/ComparePanel';
import AddTrainingModal from '@/components/compare/AddTrainingModal';
import {
  CompareImageViewer,
  CompareRowCard,
  fmtCfg,
  GridCtx,
  ImagePos,
  imgUrl,
  runColor,
} from '@/components/compare/CompareViewers';
import {
  alignRows,
  CFG_LABELS,
  cellKey,
  CompareCellRow,
  CompareData,
  CompareRun,
  CompareSettings,
  DEFAULT_COMPARE_SETTINGS,
  newCompareData,
  runKey,
  ScannedFile,
  ScannedRun,
} from '@/utils/compare';

const errText = (e: any) => e?.response?.data?.error ?? e?.message ?? String(e);
const segBtn = (on: boolean) =>
  classNames('flex-1 px-3 py-1.5 text-sm', on ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200');
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const iconBtn = 'p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors';
const menuItem = 'block w-full text-left px-3 py-2 rounded-md text-sm hover:bg-gray-800';
const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-md bg-slate-600 hover:bg-slate-500 text-gray-100 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50';
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 text-sm transition-colors disabled:opacity-50';

// a training folder that can't be read, said plainly (the raw error stays in the tooltip)
const runErrorText = (err: string) =>
  /ENOENT|no such file|scandir/i.test(err)
    ? "Can't find this training's folder. Is its drive connected, or was it moved?"
    : /EACCES|EPERM/i.test(err)
      ? "Can't read this training's folder (no permission)."
      : err;

export default function ComparePage() {
  const [list, setList] = useState<{ id: string; name: string }[]>([]);
  const [current, setCurrent] = useState<{ id: string; name: string } | null>(null);
  const [data, setData] = useState<CompareData | null>(null);
  const [defaults, setDefaults] = useState<Partial<CompareSettings> | null>(null);
  const [scanMap, setScanMap] = useState<Record<string, ScannedRun>>({});
  const [scanning, setScanning] = useState(false);
  const [cells, setCells] = useState<Map<string, CompareCellRow>>(new Map());
  const [queue, setQueue] = useState({ running: 0, waiting: 0 });
  const [comfy, setComfy] = useState<ComfyInfo | null>(null);
  const [activePrompt, setActivePrompt] = useState(0);
  const [folded, setFoldedState] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [batchTotal, setBatchTotal] = useState(0);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [persistMsg, setPersistMsg] = useState('✓ Saved with this comparison');
  const [addOpen, setAddOpen] = useState(false);
  const [viewer, setViewer] = useState<ImagePos | null>(null);
  const [rowCard, setRowCard] = useState<{ row: number; prompt: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const dirty = useRef(false);
  const dragFrom = useRef<number | null>(null);
  const syncing = useRef(false);

  // ---------- comparisons: load / create / save ----------
  const openComparison = useCallback(async (id: string) => {
    const res = await apiClient.get(`/api/compare/${id}`);
    dirty.current = false;
    const d = res.data.data ?? {};
    setCurrent({ id: res.data.id, name: res.data.name });
    setData({ ...newCompareData(), ...d, settings: { ...DEFAULT_COMPARE_SETTINGS, ...(d.settings ?? {}) } });
    setActivePrompt(0);
    setCells(new Map());
    setBatchTotal(0);
    setNotice(null);
  }, []);

  const createComparison = useCallback(
    async (name: string) => {
      const res = await apiClient.post('/api/compare', { name });
      setList(l => [{ id: res.data.id, name: res.data.name }, ...l]);
      await openComparison(res.data.id);
    },
    [openComparison],
  );

  useEffect(() => {
    apiClient
      .get('/api/compare')
      .then(async res => {
        setList(res.data.comparisons);
        setDefaults(res.data.defaults);
        const ids: string[] = res.data.comparisons.map((c: any) => c.id);
        const id = ids.includes(res.data.lastId) ? res.data.lastId : ids[0];
        if (id) await openComparison(id);
        else await createComparison('Comparison 1');
      })
      .catch(e => setNotice({ kind: 'error', text: `Could not load comparisons: ${errText(e)}` }));
  }, [openComparison, createComparison]);

  // per-viewer convenience: remember whether the settings panel is folded
  useEffect(() => {
    try {
      setFoldedState(localStorage.getItem('compare.folded') === '1');
    } catch {}
  }, []);
  const setFolded = (f: boolean) => {
    setFoldedState(f);
    try {
      localStorage.setItem('compare.folded', f ? '1' : '0');
    } catch {}
  };

  const update = useCallback((fn: (d: CompareData) => CompareData) => {
    dirty.current = true;
    setData(d => (d ? fn(d) : d));
  }, []);
  const setSettings = useCallback(
    (patch: Partial<CompareSettings>) => update(d => ({ ...d, settings: { ...d.settings, ...patch } })),
    [update],
  );

  useEffect(() => {
    if (!data || !current || !dirty.current) return;
    const t = setTimeout(() => {
      apiClient
        .put(`/api/compare/${current.id}`, { data })
        .then(() => setPersistMsg('✓ Saved with this comparison'))
        .catch(e => setNotice({ kind: 'error', text: `Could not save: ${errText(e)}` }));
    }, 500);
    return () => clearTimeout(t);
  }, [data, current]);

  const flushSave = async () => {
    if (current && data) await apiClient.put(`/api/compare/${current.id}`, { data });
    dirty.current = false;
  };

  // ---------- trainings: scan folders ----------
  const runsSig = data ? JSON.stringify(data.runs) : '[]';
  const scan = useCallback(async (runs: CompareRun[]) => {
    if (!runs.length) return;
    setScanning(true);
    try {
      const res = await apiClient.post('/api/compare/scan', { runs });
      setScanMap(m => {
        const next = { ...m };
        runs.forEach((r, i) => (next[runKey(r)] = res.data.runs[i]));
        return next;
      });
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not read training folders: ${errText(e)}` });
    } finally {
      setScanning(false);
    }
  }, []);
  useEffect(() => {
    const runs: CompareRun[] = JSON.parse(runsSig);
    scan(runs.filter(r => !scanMap[runKey(r)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runsSig, scan]);
  // a training that's still running keeps saving checkpoints: pick them up
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') scan(JSON.parse(runsSig));
    }, 60000);
    return () => clearInterval(t);
  }, [runsSig, scan]);

  // ---------- ComfyUI ----------
  // the comparison's server pick, read when talking to ComfyUI (main or Later Samples)
  const serverRef = useRef<'main' | 'later'>('main');
  serverRef.current = data?.settings.server === 'later' ? 'later' : 'main';
  const loadComfy = useCallback(
    async (workflow: string, apply: boolean) => {
      try {
        const res = await apiClient.get('/api/compare/comfy', { params: { workflow, server: serverRef.current } });
        setComfy(res.data);
        const v = res.data.values;
        if (apply && v) {
          const n = (x: any) => (typeof x === 'number' ? x : undefined);
          const str = (x: any) => (typeof x === 'string' ? x : undefined);
          update(d => {
            const patch: Partial<CompareSettings> = {};
            for (const k of ['seed', 'steps', 'cfg', 'width', 'height'] as const) if (n(v[k]) !== undefined) patch[k] = n(v[k]);
            for (const k of ['sampler', 'scheduler', 'neg'] as const) if (str(v[k]) !== undefined) patch[k] = str(v[k]);
            const prompts =
              d.prompts.every(p => !p.trim()) && str(v.prompt)?.trim() ? [v.prompt as string] : d.prompts;
            return { ...d, prompts, settings: { ...d.settings, ...patch, model: '', te: '', vae: '' } };
          });
        }
      } catch (e) {
        setComfy({ ok: false, url: '', error: errText(e) });
      }
    },
    [update],
  );
  const onWorkflowChange = useCallback(
    (name: string) => {
      setSettings({ workflow: name });
      loadComfy(name, true);
    },
    [setSettings, loadComfy],
  );
  // each ComfyUI has its own workflow (Settings): switching server switches to it
  const onServerChange = useCallback(
    async (server: 'main' | 'later') => {
      serverRef.current = server;
      setComfy(null);
      const res = await apiClient.get('/api/compare/comfy', { params: { server } }).catch(() => null);
      const tied: string | null = res?.data?.tiedWorkflow ?? null;
      if (tied && tied !== data?.settings.workflow) {
        setSettings({ server, workflow: tied });
        loadComfy(tied, true);
      } else {
        setSettings({ server });
        loadComfy(data?.settings.workflow ?? '', false);
      }
    },
    [setSettings, loadComfy, data?.settings.workflow],
  );
  useEffect(() => {
    if (current) loadComfy(data?.settings.workflow ?? '', false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);
  // first use: pick the first API-format workflow automatically
  useEffect(() => {
    if (comfy?.ok && data && !data.settings.workflow) {
      const w = comfy.workflows?.find(x => /\bapi\b/i.test(x));
      if (w) onWorkflowChange(w);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comfy?.ok, current?.id]);
  // keep retrying while Comfy is down
  useEffect(() => {
    if (!comfy || comfy.ok) return;
    const t = setInterval(() => loadComfy(data?.settings.workflow ?? '', false), 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comfy?.ok]);

  // ---------- generated images ----------
  const sync = useCallback(async () => {
    if (!current || syncing.current) return;
    syncing.current = true;
    try {
      const res = await apiClient.post(`/api/compare/${current.id}/sync`);
      const m = new Map<string, CompareCellRow>();
      for (const c of res.data.cells) m.set(cellKey(c.lora_path, c.prompt), c);
      setCells(m);
      setQueue(res.data.queue);
      if (res.data.comfyError) setNotice({ kind: 'error', text: res.data.comfyError });
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not check ComfyUI: ${errText(e)}` });
    } finally {
      syncing.current = false;
    }
  }, [current]);
  useEffect(() => {
    sync();
  }, [sync]);
  const pendingCount = useMemo(() => Array.from(cells.values()).filter(c => c.status === 'pending').length, [cells]);
  useEffect(() => {
    if (!pendingCount) return;
    const t = setInterval(sync, 2500);
    return () => clearInterval(t);
  }, [pendingCount > 0, sync]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- grid ----------
  const runs: ScannedRun[] = useMemo(
    () =>
      (data?.runs ?? []).map(
        r => scanMap[runKey(r)] ?? { name: r.name, folder: '', files: [], cfg: null, cfgSource: 'none' as const },
      ),
    [data?.runs, scanMap],
  );
  const excludedSig = (data?.excluded ?? []).join('\u0000');
  const rowsAsc = useMemo(() => {
    const excluded = new Set(excludedSig ? excludedSig.split('\u0000') : []);
    return alignRows(runs.map(r => r.files.filter(f => !excluded.has(f.path))));
  }, [runs, excludedSig]);
  const order = data?.order ?? 'asc';
  const rows = useMemo(() => (order === 'desc' ? [...rowsAsc].reverse() : rowsAsc), [rowsAsc, order]);
  const rowNum = useCallback((row: number) => (order === 'desc' ? rows.length - row : row + 1), [order, rows.length]);
  const prompts = data?.prompts ?? [];
  const realPrompts = prompts.filter(p => p.trim() !== '');
  // one training reads like its Samples tab: a row per checkpoint, a column per prompt
  const single = runs.length === 1;
  const shownPrompts =
    single || activePrompt === -1 ? prompts.map((_, i) => i) : [Math.min(activePrompt, Math.max(0, prompts.length - 1))];
  const diffKeys = useMemo(
    () => Object.keys(CFG_LABELS).filter(k => new Set(runs.map(r => fmtCfg(r.cfg?.[k]))).size > 1),
    [runs],
  );
  const cellOf = useCallback((f: ScannedFile, prompt: string) => cells.get(cellKey(f.path, prompt)), [cells]);
  const allFiles = rowsAsc.flatMap(r => r.cells.filter((f): f is ScannedFile => !!f));
  const totalCount = allFiles.length * realPrompts.length;
  const missingCount = allFiles.reduce(
    (t, f) => t + realPrompts.filter(p => !['done', 'pending'].includes(cellOf(f, p)?.status ?? '')).length,
    0,
  );
  const ctx: GridCtx = { runs, rows, prompts, diffKeys, cellOf, rowNum };

  // ---------- actions ----------
  const generate = async () => {
    if (!current || !data) return;
    setGenerating(true);
    setNotice(null);
    try {
      await flushSave();
      const res = await apiClient.post(`/api/compare/${current.id}/generate`, { mode: data.settings.regen });
      if (!res.data.queued) setNotice({ kind: 'info', text: 'Nothing to generate: every image already exists.' });
      else setBatchTotal(res.data.queued);
      if (res.data.failed) setNotice({ kind: 'error', text: `${res.data.failed} image(s) could not be queued: ${res.data.firstError}` });
      await sync();
    } catch (e) {
      setNotice({ kind: 'error', text: errText(e) });
    } finally {
      setGenerating(false);
    }
  };
  // one image again, with the comparison's current settings; the old one stays until it's done
  const regenerateCell = async (f: ScannedFile, prompt: string): Promise<string | null> => {
    if (!current) return null;
    try {
      await flushSave();
      const res = await apiClient.post(`/api/compare/${current.id}/generate`, { only: [{ loraPath: f.path, prompt }] });
      await sync();
      return res.data.failed ? res.data.firstError : null;
    } catch (e) {
      return errText(e);
    }
  };

  // render the AITK trainings' missing training samples (checkpoints with none, plus the
  // step-0 baseline) straight into each job's samples/ folder, on ComfyUI
  const [filling, setFilling] = useState(false);
  const fillTrainingSamples = async () => {
    if (!data) return;
    const jobs = data.runs.filter((r): r is Extract<CompareRun, { kind: 'job' }> => r.kind === 'job');
    if (!jobs.length) {
      setNotice({ kind: 'info', text: 'Only AITK trainings have training samples to fill in; folders of LoRAs do not.' });
      return;
    }
    setFilling(true);
    setNotice(null);
    const parts: string[] = [];
    const errors: string[] = [];
    for (const run of jobs) {
      try {
        const res = await apiClient.post(`/api/jobs/${run.jobId}/comfy_backfill`, {
          workflow: data.settings.workflow || null,
          server: data.settings.server === 'later' ? 'later' : 'main',
        });
        if (res.data.queued) parts.push(`${run.name}: ${res.data.queued} step${res.data.queued === 1 ? '' : 's'}`);
        else if (res.data.running) parts.push(`${run.name}: already filling`);
      } catch (e) {
        errors.push(`${run.name}: ${errText(e)}`);
      }
    }
    setFilling(false);
    if (errors.length) setNotice({ kind: 'error', text: errors.join(' · ') });
    else if (parts.length)
      setNotice({ kind: 'info', text: `Rendering missing training samples on ComfyUI — ${parts.join(' · ')}. They appear on each training's Samples tab as they finish.` });
    else setNotice({ kind: 'info', text: 'Every checkpoint already has training samples.' });
  };
  const cancel = async () => {
    if (!current) return;
    await apiClient.post(`/api/compare/${current.id}/cancel`).catch(e => setNotice({ kind: 'error', text: errText(e) }));
    setBatchTotal(0);
    await sync();
  };
  const rowFiles = (row: number) => (rows[row]?.cells ?? []).filter((f): f is ScannedFile => !!f).map(f => f.path);
  const clearRow = async (row: number) => {
    if (!current) return;
    await apiClient.post(`/api/compare/${current.id}/clear`, { lora_paths: rowFiles(row) });
    await sync();
  };
  const removeRow = (row: number) => {
    const paths = rowFiles(row);
    update(d => ({ ...d, excluded: Array.from(new Set([...d.excluded, ...paths])) }));
    setRowCard(null);
  };
  const removeRun = (i: number) => update(d => ({ ...d, runs: d.runs.filter((_, j) => j !== i) }));
  const moveRun = (from: number, to: number) =>
    update(d => {
      const next = [...d.runs];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return { ...d, runs: next };
    });
  const renameComparison = (name: string) => {
    setRenaming(false);
    name = name.trim();
    if (!current || !name || name === current.name) return;
    setCurrent({ ...current, name });
    setList(l => l.map(c => (c.id === current.id ? { ...c, name } : c)));
    apiClient.put(`/api/compare/${current.id}`, { name }).catch(e => setNotice({ kind: 'error', text: errText(e) }));
  };
  const deleteComparison = () => {
    if (!current) return;
    openConfirm({
      title: 'Delete comparison',
      message: `Delete "${current.name}" and the images generated for it? Your LoRA files are not touched.`,
      type: 'warning',
      confirmText: 'Delete',
      onConfirm: async () => {
        await apiClient.delete(`/api/compare/${current.id}`);
        const rest = list.filter(c => c.id !== current.id);
        setList(rest);
        if (rest.length) await openComparison(rest[0].id);
        else await createComparison('Comparison 1');
      },
    });
  };

  const done = Math.max(0, batchTotal - pendingCount);
  const progressPct = batchTotal ? (done / batchTotal) * 100 : 0;
  const progressText = pendingCount
    ? `Generating in ComfyUI: ${done} / ${batchTotal || pendingCount} done${queue.running ? ' · running now' : ''}`
    : batchTotal
      ? `Done — ${batchTotal} image${batchTotal === 1 ? '' : 's'}`
      : comfy?.ok
        ? 'Ready'
        : 'Waiting for ComfyUI';

  if (!data || !current) {
    return (
      <>
        <TopBar>
          <h1 className="text-base sm:text-lg">Compare</h1>
        </TopBar>
        <div className="absolute top-12 left-0 right-0 p-6 text-gray-400">
          {notice ? <span className="text-red-400">{notice.text}</span> : 'Loading…'}
        </div>
      </>
    );
  }

  const sub = shownPrompts.length;
  const minW = sub > 1 && !single ? Math.max(90, Math.round(data.minSize * 0.7)) : data.minSize;
  const aspect = `${data.settings.width || 1} / ${data.settings.height || 1}`;

  return (
    <>
      <TopBar className="gap-3 pr-4">
        <h1 className="text-base sm:text-lg pl-2">Compare</h1>
        {renaming ? (
          <input
            autoFocus
            defaultValue={current.name}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={e => renameComparison(e.target.value)}
            className="bg-gray-800 border border-gray-600 rounded-md px-2.5 py-1 text-sm w-56 focus:outline-none"
          />
        ) : (
          <div className="flex items-center gap-1">
            <select
              value={current.id}
              onChange={async e => {
                if (e.target.value === '__new') await createComparison(`Comparison ${list.length + 1}`);
                else await openComparison(e.target.value);
              }}
              title="Switch comparison"
              className="bg-gray-800 border border-gray-700 rounded-md text-sm pl-2.5 pr-8 py-1 max-w-[240px]"
            >
              {list.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="__new">+ New comparison…</option>
            </select>
            <button onClick={() => setRenaming(true)} title="Rename this comparison" className={iconBtn}>
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        )}
        <span className="hidden lg:inline-flex items-center rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300">
          {plural(runs.length, 'training')} · {plural(allFiles.length, 'checkpoint')} · {plural(realPrompts.length, 'prompt')} ·{' '}
          {plural(totalCount, 'image')}
        </span>
        <div className="flex-1" />
        <Menu>
          <MenuButton title="More" className={iconBtn}>
            <Ellipsis className="w-5 h-5" />
          </MenuButton>
          <MenuItems anchor="bottom end" className="z-50 mt-1 w-56 bg-gray-900 border border-gray-700 rounded-lg p-1 shadow-lg">
            <MenuItem>
              <button className={menuItem} onClick={() => createComparison(`Comparison ${list.length + 1}`)}>
                New comparison
              </button>
            </MenuItem>
            <MenuItem>
              <button className={menuItem} onClick={() => setRenaming(true)}>
                Rename
              </button>
            </MenuItem>
            <MenuItem>
              <button className={classNames(menuItem, 'text-red-400')} onClick={deleteComparison}>
                Delete comparison
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>
      </TopBar>

      <div className="absolute top-12 left-0 right-0 bottom-0 flex">
        <div className="flex-1 min-w-0 overflow-auto p-4 pb-8">
          {/* toolbar: actions left, view options right */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button onClick={() => setAddOpen(true)} className={btnPrimary}>
              <Plus className="w-4 h-4" /> Add training
            </button>
            <button
              onClick={fillTrainingSamples}
              disabled={filling}
              title="Render the missing training samples (checkpoints with none, plus the step-0 baseline) on ComfyUI into each training's Samples tab"
              className={btnGhost}
            >
              {filling && <Loader2 className="w-4 h-4 animate-spin" />}
              Fill training samples
            </button>
            <button onClick={() => scan(data.runs)} title="Re-read the training folders" className={iconBtn}>
              <RefreshCw className={classNames('w-4 h-4', scanning && 'animate-spin')} />
            </button>
            {(runs.length > 1 || data.excluded.length > 0) && (
              <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-gray-900 border border-gray-800 px-3 py-1 text-xs text-gray-400">
                {runs.length > 1 && (
                  <span title={`Identical: ${Object.keys(CFG_LABELS).filter(k => !diffKeys.includes(k)).map(k => CFG_LABELS[k]).join(', ')}`}>
                    {plural(diffKeys.length, 'differing setting')} · {Object.keys(CFG_LABELS).length - diffKeys.length} identical hidden
                  </span>
                )}
                {runs.length > 1 && data.excluded.length > 0 && <span>·</span>}
                {data.excluded.length > 0 && (
                  <span>
                    {plural(data.excluded.length, 'checkpoint')} removed{' '}
                    <button className="text-blue-400 hover:underline" onClick={() => update(d => ({ ...d, excluded: [] }))}>
                      Restore
                    </button>
                  </span>
                )}
              </span>
            )}
            <div className="flex-1" />
            <Popover className="relative">
              <PopoverButton className={btnGhost}>
                <SlidersHorizontal className="w-4 h-4" /> View
              </PopoverButton>
              <PopoverPanel anchor="bottom end" className="z-50 mt-2 w-72 rounded-lg border border-gray-700 bg-gray-900 p-4 shadow-xl space-y-4">
                <div>
                  <div className="text-xs text-gray-400 mb-1.5">Order</div>
                  <div className="flex border border-gray-700 rounded-md overflow-hidden">
                    <button className={segBtn(order === 'asc')} onClick={() => update(d => ({ ...d, order: 'asc' }))}>
                      First → last
                    </button>
                    <button className={segBtn(order === 'desc')} onClick={() => update(d => ({ ...d, order: 'desc' }))}>
                      Newest first
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1.5">Training settings</div>
                  <div className="flex border border-gray-700 rounded-md overflow-hidden">
                    {(
                      [
                        ['head', 'In header'],
                        ['cell', 'Per image'],
                        ['off', 'Hidden'],
                      ] as const
                    ).map(([m, label]) => (
                      <button key={m} className={segBtn(data.infoMode === m)} onClick={() => update(d => ({ ...d, infoMode: m }))}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                    <span>Image size</span>
                    <span className="tabular-nums">{data.minSize}px</span>
                  </div>
                  <input
                    type="range"
                    min={100}
                    max={640}
                    value={data.minSize}
                    onChange={e => update(d => ({ ...d, minSize: Number(e.target.value) }))}
                    className="w-full"
                  />
                </div>
              </PopoverPanel>
            </Popover>
          </div>

          {/* prompt tabs (one training shows every prompt as a column instead) */}
          {!single && runs.length > 0 && (
            <div className="flex gap-1 mb-4 overflow-x-auto border-b border-gray-800">
              {prompts.map((p, i) => {
                const done = allFiles.filter(f => cellOf(f, p)?.status === 'done').length;
                return (
                  <button
                    key={i}
                    onClick={() => setActivePrompt(i)}
                    title={p}
                    className={classNames(
                      'flex flex-col items-start gap-0.5 min-w-[140px] max-w-[260px] px-4 py-2 border-b-2 -mb-px text-left rounded-t-md transition-colors',
                      activePrompt === i ? 'border-blue-500 bg-gray-900 text-white' : 'border-transparent text-gray-400 hover:bg-gray-900/60',
                    )}
                  >
                    <span className="flex w-full items-center gap-2 text-sm font-medium">
                      Prompt {i + 1}
                      <span className={classNames('ml-auto text-xs font-normal tabular-nums', done < allFiles.length ? 'text-amber-400' : 'text-gray-500')}>
                        {done}/{allFiles.length}
                      </span>
                    </span>
                    <span className="w-full truncate text-xs text-gray-500">{p || '(empty)'}</span>
                  </button>
                );
              })}
              <button
                onClick={() => setActivePrompt(-1)}
                className={classNames(
                  'flex flex-col justify-center px-4 py-2 border-b-2 -mb-px text-left rounded-t-md transition-colors',
                  activePrompt === -1 ? 'border-blue-500 bg-gray-900 text-white' : 'border-transparent text-gray-400 hover:bg-gray-900/60',
                )}
              >
                <span className="text-sm font-medium">All prompts</span>
                <span className="text-xs text-gray-500">side by side</span>
              </button>
              <button
                onClick={() => update(d => ({ ...d, prompts: [...d.prompts, ''] }))}
                title="Add prompt"
                className="px-3 text-gray-400 hover:text-white"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          )}

          {notice && (
            <div
              className={classNames(
                'mb-4 px-4 py-2.5 rounded-lg text-sm flex items-start gap-2',
                notice.kind === 'error' ? 'bg-red-950/40 border border-red-900 text-red-300' : 'bg-gray-900 border border-gray-800 text-gray-300',
              )}
            >
              <span className="flex-1 break-words">{notice.text}</span>
              <button onClick={() => setNotice(null)} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {runs.length === 0 ? (
            <EmptyState
              icon={<Plus className="w-6 h-6" />}
              title="No trainings yet"
              body="Add AITK trainings or any folder of LoRAs. Every LoRA in a folder becomes a row, lined up by step."
              action={
                <button onClick={() => setAddOpen(true)} className={btnPrimary}>
                  <Plus className="w-4 h-4" /> Add training
                </button>
              }
            />
          ) : (
            <>
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `${single ? 72 : 44}px repeat(${runs.length * sub}, ${minW}px)` }}
            >
              <div className="sticky left-0 top-0 z-[4] bg-gray-950 text-xs text-gray-500 flex items-end justify-center pb-2">
                {single ? 'Step' : '#'}
              </div>
              {runs.map((run, i) => {
                const scanned = !!scanMap[runKey(data.runs[i])];
                const showCfg = data.infoMode === 'head' && runs.length > 1;
                return (
                  <div
                    key={runKey(data.runs[i])}
                    className="sticky top-0 z-[3] bg-gray-950 pb-1"
                    style={{ gridColumn: `span ${sub}` }}
                    draggable={runs.length > 1}
                    onDragStart={() => (dragFrom.current = i)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => {
                      if (dragFrom.current !== null && dragFrom.current !== i) moveRun(dragFrom.current, i);
                      dragFrom.current = null;
                    }}
                  >
                    <div className="group/run h-full bg-gray-900 border border-gray-800 border-t-[3px] rounded-lg px-3 py-2.5" style={{ borderTopColor: runColor(i) }}>
                      <div className="flex items-center gap-2">
                        {runs.length > 1 && <GripVertical className="w-4 h-4 text-gray-600 cursor-grab shrink-0" />}
                        <span className="grid place-items-center w-5 h-5 rounded text-xs font-bold text-white shrink-0" style={{ background: runColor(i) }}>
                          {i + 1}
                        </span>
                        <span className="font-semibold text-sm text-gray-100 truncate min-w-0" title={run.folder || run.name}>
                          {run.name}
                        </span>
                        <span className="ml-auto shrink-0 rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400 tabular-nums">
                          {scanned ? plural(run.files.length, 'checkpoint') : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        </span>
                        <button
                          onClick={() => removeRun(i)}
                          title="Remove training from this comparison"
                          className="p-1 rounded-md text-gray-500 hover:text-red-400 hover:bg-gray-800 shrink-0 opacity-0 group-hover/run:opacity-100 focus:opacity-100 transition-opacity"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {run.error && (
                        <div className="mt-2 flex items-start gap-1.5 text-sm text-red-300" title={run.error}>
                          <FolderX className="w-4 h-4 mt-0.5 shrink-0" />
                          {runErrorText(run.error)}
                        </div>
                      )}
                      {showCfg && (
                        <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                          {diffKeys.map(k => (
                            <div key={k} className="contents">
                              <span className="text-gray-500 whitespace-nowrap">{CFG_LABELS[k]}</span>
                              <span className="text-gray-200 truncate">{fmtCfg(run.cfg?.[k])}</span>
                            </div>
                          ))}
                          {diffKeys.length === 0 && <span className="text-gray-500 col-span-2">Same settings as the others</span>}
                          {run.cfgSource === 'none' && scanned && (
                            <span className="text-gray-500 col-span-2">Settings unknown for this folder</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {single ? (
                <>
                  <div />
                  {shownPrompts.map(pi => {
                    const done = allFiles.filter(f => cellOf(f, prompts[pi])?.status === 'done').length;
                    return (
                      <div key={pi} className="px-1 pt-1 pb-1 min-w-0" title={prompts[pi]}>
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                          Prompt {pi + 1}
                          {allFiles.length > 0 && (
                            <span className={classNames('ml-auto text-xs font-normal tabular-nums', done < allFiles.length ? 'text-amber-400' : 'text-gray-500')}>
                              {done}/{allFiles.length}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500 line-clamp-2 break-words">{prompts[pi] || '(empty)'}</div>
                      </div>
                    );
                  })}
                </>
              ) : (
                sub > 1 && (
                  <>
                    <div />
                    {runs.map((_, ri) =>
                      shownPrompts.map(pi => (
                        <div key={`${ri}-${pi}`} className="text-xs text-gray-500 px-1 truncate" title={prompts[pi]}>
                          <span className="text-gray-300 font-medium">P{pi + 1}</span> · {prompts[pi]}
                        </div>
                      )),
                    )}
                  </>
                )
              )}

              {rows.map((row, r) => (
                <RowLine
                  key={r}
                  label={single ? fmtCfg(row.cells[0]?.step?.toLocaleString()) : rowNum(r)}
                  onOpen={() => setRowCard({ row: r, prompt: shownPrompts[0] })}
                  onClear={() => clearRow(r)}
                  onRemove={() => removeRow(r)}
                >
                  {runs.map((run, ri) =>
                    shownPrompts.map(pi => {
                      const f = row.cells[ri];
                      if (!f) {
                        return (
                          <div key={`${ri}-${pi}`} className="rounded-md border border-dashed border-gray-800 grid place-items-center text-gray-600 text-xs" style={{ aspectRatio: aspect }}>
                            —
                          </div>
                        );
                      }
                      const c = prompts[pi]?.trim() ? cellOf(f, prompts[pi]) : undefined;
                      return (
                        <div key={`${ri}-${pi}`} className="flex flex-col gap-1.5">
                          <div
                            className={classNames(
                              'relative rounded-md overflow-hidden bg-gray-900 ring-1 ring-gray-800',
                              c?.image_path ? 'cursor-pointer hover:ring-2 hover:ring-slate-500' : '',
                            )}
                            style={{ aspectRatio: aspect }}
                            onClick={() => c?.image_path && setViewer({ run: ri, row: r, prompt: pi })}
                          >
                            {c?.image_path && (
                              <img src={imgUrl(c.image_path)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-contain" />
                            )}
                            {c?.status === 'pending' && (
                              <div className="absolute inset-0 grid place-items-center bg-gray-900/80 text-gray-400 text-xs">
                                <div className="flex flex-col items-center gap-1.5">
                                  <Loader2 className="w-5 h-5 animate-spin" />
                                  Queued
                                </div>
                              </div>
                            )}
                            {c?.status === 'error' && (
                              <div className="absolute inset-0 grid place-items-center bg-red-950/60 text-red-300 text-xs p-2 text-center" title={c.error ?? ''}>
                                Failed — hover for why
                              </div>
                            )}
                            {!c && <div className="absolute inset-0 grid place-items-center text-gray-600 text-xs">Not generated</div>}
                            {!single && (
                              <span className="absolute left-1.5 bottom-1.5 text-[11px] px-1.5 py-0.5 rounded bg-gray-950/80 text-gray-300 tabular-nums">
                                #{ri + 1} · {fmtCfg(f.step?.toLocaleString())} steps
                              </span>
                            )}
                          </div>
                          {data.infoMode === 'cell' && (
                            <div className="bg-gray-900 border border-gray-800 border-t-[3px] rounded-md px-2.5 py-2 text-xs" style={{ borderTopColor: runColor(ri) }}>
                              <div className="flex gap-1.5 mb-1">
                                <span className="font-semibold text-gray-100 truncate">{run.name}</span>
                                <span className="ml-auto text-gray-400 whitespace-nowrap tabular-nums">{fmtCfg(f.step?.toLocaleString())} steps</span>
                              </div>
                              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
                                {diffKeys.map(k => (
                                  <div key={k} className="contents">
                                    <span className="text-gray-400">{CFG_LABELS[k]}</span>
                                    <span className="text-gray-100 truncate">{fmtCfg(run.cfg?.[k])}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }),
                  )}
                </RowLine>
              ))}
            </div>
            {rows.length === 0 &&
              data.runs.every(r => !!scanMap[runKey(r)]) &&
              (runs.every(r => r.error) ? (
                <EmptyState
                  icon={<FolderX className="w-6 h-6" />}
                  title={runs.length === 1 ? "This training's folder can't be read" : "These trainings' folders can't be read"}
                  body="Check that the drive is connected and the folder is still there, then refresh."
                  action={
                    <button onClick={() => scan(data.runs)} className={btnGhost}>
                      <RefreshCw className={classNames('w-4 h-4', scanning && 'animate-spin')} /> Refresh
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<ImageOff className="w-6 h-6" />}
                  title="No checkpoints yet"
                  body="Rows appear as the trainings save LoRA files (.safetensors). A running training is picked up every minute."
                />
              ))}
            </>
          )}
        </div>

        <ComparePanel
          data={data}
          folded={folded}
          setFolded={setFolded}
          setSettings={setSettings}
          setPrompts={prompts => {
            update(d => ({ ...d, prompts: prompts.length ? prompts : [''] }));
            if (activePrompt >= prompts.length) setActivePrompt(Math.max(0, prompts.length - 1));
          }}
          comfy={comfy}
          onWorkflowChange={onWorkflowChange}
          onServerChange={onServerChange}
          onSaveDefault={async () => {
            await apiClient.post('/api/compare/defaults', { settings: data.settings });
            setDefaults(data.settings);
            setPersistMsg('✓ Saved as default');
          }}
          onResetDefault={() => {
            setSettings({ ...DEFAULT_COMPARE_SETTINGS, ...(defaults ?? {}), workflow: defaults?.workflow || data.settings.workflow });
            setPersistMsg('✓ Reset to default');
          }}
          persistMsg={persistMsg}
          generating={generating}
          pendingCount={pendingCount}
          missingCount={missingCount}
          totalCount={totalCount}
          progressText={progressText}
          progressPct={progressPct}
          onGenerate={generate}
          onCancel={cancel}
        />
      </div>

      <AddTrainingModal
        open={addOpen}
        existing={data.runs}
        onClose={() => setAddOpen(false)}
        onAdd={newRuns => update(d => ({ ...d, runs: [...d.runs, ...newRuns] }))}
      />
      <CompareImageViewer
        ctx={ctx}
        pos={viewer}
        onChange={setViewer}
        onClose={() => setViewer(null)}
        onRegenerate={regenerateCell}
      />
      <CompareRowCard
        ctx={ctx}
        pos={rowCard}
        onChange={setRowCard}
        onClose={() => setRowCard(null)}
        onOpenImage={p => {
          setRowCard(null);
          setViewer(p);
        }}
        onClearRow={clearRow}
        onRemoveRow={removeRow}
      />
    </>
  );
}

function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="mt-6 mx-auto max-w-md text-center px-8 py-12 rounded-xl border border-dashed border-gray-700 bg-gray-900/40">
      <div className="mx-auto mb-3 grid place-items-center w-12 h-12 rounded-full bg-gray-800 text-gray-400">{icon}</div>
      <div className="text-base font-medium text-gray-100">{title}</div>
      <p className="mt-1 text-sm text-gray-400">{body}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

// the row-number cell plus the row's images; ⋯ opens the row actions
function RowLine({
  label,
  onOpen,
  onClear,
  onRemove,
  children,
}: {
  label: React.ReactNode;
  onOpen: () => void;
  onClear: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const item = 'block w-full text-left px-3 py-1.5 rounded text-sm hover:bg-gray-800';
  return (
    <>
      <div
        onClick={onOpen}
        title="Open this row as a card"
        className="group sticky left-0 z-[2] flex flex-col items-center justify-center gap-1 bg-gray-900 border border-gray-800 hover:border-slate-500 rounded-md cursor-pointer"
      >
        <b className="text-sm font-semibold text-gray-300 tabular-nums">{label}</b>
        <Menu>
          <MenuButton
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            title="Row actions"
            className="invisible group-hover:visible data-[open]:visible p-0.5 rounded text-gray-400 hover:text-white hover:bg-gray-700"
          >
            <Ellipsis className="w-4 h-4" />
          </MenuButton>
          <MenuItems anchor="right start" className="z-50 ml-1 w-52 bg-gray-900 border border-gray-700 rounded-md p-1 shadow-lg">
            <div className="px-3 py-1 text-[11px] text-gray-500">Row #{label}</div>
            <MenuItem>
              <button className={item} onClick={e => (e.stopPropagation(), onOpen())}>
                Open row card
              </button>
            </MenuItem>
            <MenuItem>
              <button className={item} onClick={e => (e.stopPropagation(), onClear())}>
                Clear images (regenerate)
              </button>
            </MenuItem>
            <MenuItem>
              <button className={classNames(item, 'text-red-400')} onClick={e => (e.stopPropagation(), onRemove())}>
                Remove row
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>
      </div>
      {children}
    </>
  );
}
