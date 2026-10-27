'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { Ellipsis, GripVertical, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
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
  classNames('px-2.5 py-1 text-xs', on ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200');

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
  const loadComfy = useCallback(
    async (workflow: string, apply: boolean) => {
      try {
        const res = await apiClient.get('/api/compare/comfy', { params: { workflow } });
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
  const shownPrompts = activePrompt === -1 ? prompts.map((_, i) => i) : [Math.min(activePrompt, Math.max(0, prompts.length - 1))];
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
  const minW = sub > 1 ? Math.max(90, Math.round(data.minSize * 0.7)) : data.minSize;
  const aspect = `${data.settings.width || 1} / ${data.settings.height || 1}`;

  return (
    <>
      <TopBar>
        <h1 className="text-base sm:text-lg mr-3">Compare</h1>
        <select
          value={current.id}
          onChange={async e => {
            if (e.target.value === '__new') await createComparison(`Comparison ${list.length + 1}`);
            else await openComparison(e.target.value);
          }}
          className="bg-gray-800 border border-gray-700 rounded-md text-sm px-2 py-1 mr-2 max-w-[220px]"
        >
          {list.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__new">+ New comparison…</option>
        </select>
        <input
          value={current.name}
          onChange={e => {
            const name = e.target.value;
            setCurrent({ ...current, name });
            setList(l => l.map(c => (c.id === current.id ? { ...c, name } : c)));
          }}
          onBlur={() => apiClient.put(`/api/compare/${current.id}`, { name: current.name })}
          title="Rename this comparison"
          className="bg-transparent border border-transparent hover:border-gray-700 focus:border-gray-600 rounded px-1.5 py-0.5 text-sm w-48"
        />
        <button onClick={deleteComparison} title="Delete this comparison" className="p-1 ml-1 rounded text-gray-500 hover:text-red-400 hover:bg-gray-800">
          <Trash2 className="w-4 h-4" />
        </button>
        <span className="ml-3 text-xs text-gray-500 hidden lg:inline">
          {runs.length} trainings · {allFiles.length} checkpoints × {realPrompts.length} prompts = {totalCount} images
        </span>
        <div className="flex-1" />
      </TopBar>

      <div className="absolute top-12 left-0 right-0 bottom-0 flex">
        <div className="flex-1 min-w-0 overflow-auto px-4 pb-6">
          {/* prompt tabs */}
          <div className="flex gap-0.5 border-b border-gray-800 mb-2.5 overflow-x-auto pt-2">
            {prompts.map((p, i) => {
              const done = allFiles.filter(f => cellOf(f, p)?.status === 'done').length;
              return (
                <button
                  key={i}
                  onClick={() => setActivePrompt(i)}
                  title={p}
                  className={classNames(
                    'flex flex-col items-start gap-0.5 min-w-[120px] max-w-[240px] px-3.5 pt-2 pb-1.5 border-b-2 text-left',
                    activePrompt === i ? 'border-blue-500 bg-gray-900 text-white' : 'border-transparent text-gray-400 hover:bg-gray-900',
                  )}
                >
                  <span className="flex w-full items-center gap-2 text-[13px] font-semibold">
                    Prompt {i + 1}
                    <span className={classNames('ml-auto text-[11px] font-normal', done < allFiles.length ? 'text-amber-400' : 'text-gray-500')}>
                      {done}/{allFiles.length}
                    </span>
                  </span>
                  <span className="w-full truncate text-[11px] text-gray-500">{p || '(empty)'}</span>
                </button>
              );
            })}
            <button
              onClick={() => setActivePrompt(-1)}
              className={classNames(
                'flex flex-col justify-center px-3.5 pt-2 pb-1.5 border-b-2 text-left',
                activePrompt === -1 ? 'border-blue-500 bg-gray-900 text-white' : 'border-transparent text-gray-400 hover:bg-gray-900',
              )}
            >
              <span className="text-[13px] font-semibold">All prompts</span>
              <span className="text-[11px] text-gray-500">side by side</span>
            </button>
            <button
              onClick={() => update(d => ({ ...d, prompts: [...d.prompts, ''] }))}
              title="Add prompt"
              className="px-3 text-gray-400 hover:text-white hover:bg-gray-900"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
            <button onClick={() => setAddOpen(true)} className="px-2.5 py-1 rounded-md bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-200">
              + Add training
            </button>
            <button
              onClick={() => scan(data.runs)}
              title="Re-read the training folders"
              className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-800"
            >
              <RefreshCw className={classNames('w-3.5 h-3.5', scanning && 'animate-spin')} />
            </button>
            <span className="text-gray-400 ml-2">Order</span>
            <div className="inline-flex border border-gray-700 rounded-md overflow-hidden">
              <button className={segBtn(order === 'asc')} onClick={() => update(d => ({ ...d, order: 'asc' }))}>
                First → last
              </button>
              <button className={segBtn(order === 'desc')} onClick={() => update(d => ({ ...d, order: 'desc' }))}>
                Newest first
              </button>
            </div>
            <span className="text-gray-400 ml-2" title={Object.keys(CFG_LABELS).filter(k => !diffKeys.includes(k)).map(k => CFG_LABELS[k]).join(', ')}>
              {diffKeys.length} differing settings shown · {Object.keys(CFG_LABELS).length - diffKeys.length} identical hidden
            </span>
            {data.excluded.length > 0 && (
              <span className="text-gray-400">
                · {data.excluded.length} checkpoint{data.excluded.length === 1 ? '' : 's'} removed{' '}
                <button className="text-blue-400 hover:underline" onClick={() => update(d => ({ ...d, excluded: [] }))}>
                  Restore
                </button>
              </span>
            )}
            <div className="flex-1" />
            <span className="text-gray-400">Info</span>
            <div className="inline-flex border border-gray-700 rounded-md overflow-hidden">
              {(
                [
                  ['head', 'Column header'],
                  ['cell', 'Under each image'],
                  ['off', 'Hidden'],
                ] as const
              ).map(([m, label]) => (
                <button key={m} className={segBtn(data.infoMode === m)} onClick={() => update(d => ({ ...d, infoMode: m }))}>
                  {label}
                </button>
              ))}
            </div>
            <span className="text-gray-400 ml-2">Min size</span>
            <input
              type="range"
              min={100}
              max={420}
              value={data.minSize}
              onChange={e => update(d => ({ ...d, minSize: Number(e.target.value) }))}
              className="w-28"
            />
          </div>

          {notice && (
            <div
              className={classNames(
                'mb-2 px-3 py-2 rounded-md text-sm flex items-start gap-2',
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
            <div className="mt-10 mx-auto max-w-md text-center py-14 px-8 rounded-xl border-2 border-dashed border-gray-700 text-gray-400">
              <div className="text-lg text-gray-200 mb-2">No trainings yet</div>
              Use <b>+ Add training</b> to pick AITK trainings or any folder of LoRAs. Every LoRA in the folder becomes a row.
            </div>
          ) : (
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `36px repeat(${runs.length * sub}, minmax(${minW}px, 1fr))` }}
            >
              <div className="sticky left-0 top-0 z-[4] bg-gray-950 text-[11px] text-gray-500 flex items-end justify-center pb-1.5">
                #
              </div>
              {runs.map((run, i) => (
                <div
                  key={runKey(data.runs[i])}
                  className="sticky top-0 z-[3] bg-gray-950 pb-1"
                  style={{ gridColumn: `span ${sub}` }}
                  draggable
                  onDragStart={() => (dragFrom.current = i)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => {
                    if (dragFrom.current !== null && dragFrom.current !== i) moveRun(dragFrom.current, i);
                    dragFrom.current = null;
                  }}
                >
                  <div className="h-full bg-gray-950 border border-gray-800 border-t-[3px] rounded-md px-2.5 py-2 text-xs" style={{ borderTopColor: runColor(i) }}>
                    <div className={classNames('flex items-center gap-1.5', data.infoMode === 'head' && 'mb-1.5')}>
                      <GripVertical className="w-3.5 h-3.5 text-gray-600 cursor-grab shrink-0" />
                      <span className="grid place-items-center w-[18px] h-[18px] rounded text-[11px] font-bold text-white shrink-0" style={{ background: runColor(i) }}>
                        {i + 1}
                      </span>
                      <span className="font-bold text-[13px] text-white truncate min-w-0" title={run.folder || run.name}>
                        {run.name}
                      </span>
                      <span className="ml-auto text-gray-400 whitespace-nowrap">
                        {scanMap[runKey(data.runs[i])] ? `${run.files.length} ckpts` : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      </span>
                      <button onClick={() => removeRun(i)} title="Remove training" className="p-0.5 rounded text-gray-500 hover:text-red-400 hover:bg-gray-800 shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {run.error && <div className="text-red-400 mb-1">{run.error}</div>}
                    {data.infoMode === 'head' && (
                      <>
                        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
                          {diffKeys.map(k => (
                            <div key={k} className="contents">
                              <span className="text-gray-400 whitespace-nowrap">{CFG_LABELS[k]}</span>
                              <span className="text-gray-100 truncate">{fmtCfg(run.cfg?.[k])}</span>
                            </div>
                          ))}
                          {diffKeys.length === 0 && <span className="text-gray-500 col-span-2">No differences</span>}
                        </div>
                        <div className="mt-1.5 text-[11px] text-gray-500">
                          {Object.keys(CFG_LABELS).length - diffKeys.length} identical settings hidden
                          {run.cfgSource === 'none' && scanMap[runKey(data.runs[i])] ? ' · settings unknown for this folder' : ''}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {sub > 1 && (
                <>
                  <div />
                  {runs.map((_, ri) =>
                    shownPrompts.map(pi => (
                      <div key={`${ri}-${pi}`} className="text-[11px] text-gray-500 px-1 truncate" title={prompts[pi]}>
                        P{pi + 1} · {prompts[pi]}
                      </div>
                    )),
                  )}
                </>
              )}

              {rows.map((row, r) => (
                <RowLine
                  key={r}
                  label={rowNum(r)}
                  onOpen={() => setRowCard({ row: r, prompt: shownPrompts[0] })}
                  onClear={() => clearRow(r)}
                  onRemove={() => removeRow(r)}
                >
                  {runs.map((run, ri) =>
                    shownPrompts.map(pi => {
                      const f = row.cells[ri];
                      if (!f) {
                        return (
                          <div key={`${ri}-${pi}`} className="rounded border border-dashed border-gray-800 grid place-items-center text-gray-600 text-xs" style={{ aspectRatio: aspect }}>
                            —
                          </div>
                        );
                      }
                      const c = prompts[pi]?.trim() ? cellOf(f, prompts[pi]) : undefined;
                      return (
                        <div key={`${ri}-${pi}`} className="flex flex-col gap-1">
                          <div
                            className={classNames(
                              'relative rounded overflow-hidden bg-gray-800',
                              c?.image_path ? 'cursor-pointer hover:outline hover:outline-2 hover:outline-gray-500 -outline-offset-2' : '',
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
                            {!c && <div className="absolute inset-0 grid place-items-center text-gray-500 text-xs">Not generated</div>}
                            <span className="absolute left-1 bottom-1 text-[10px] px-1.5 py-px rounded bg-gray-950/75 text-gray-300">
                              #{ri + 1} · {fmtCfg(f.step?.toLocaleString())} steps
                            </span>
                          </div>
                          {data.infoMode === 'cell' && (
                            <div className="border border-gray-800 border-t-[3px] rounded-md px-2 py-1.5 text-xs" style={{ borderTopColor: runColor(ri) }}>
                              <div className="flex gap-1.5 mb-1">
                                <span className="font-bold text-white truncate">{run.name}</span>
                                <span className="ml-auto text-gray-400 whitespace-nowrap">{fmtCfg(f.step?.toLocaleString())} steps</span>
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
      <CompareImageViewer ctx={ctx} pos={viewer} onChange={setViewer} onClose={() => setViewer(null)} />
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

// the row-number cell plus the row's images; ⋯ opens the row actions
function RowLine({
  label,
  onOpen,
  onClear,
  onRemove,
  children,
}: {
  label: number;
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
        className="group sticky left-0 z-[2] flex flex-col items-center justify-center gap-1 bg-gray-900 border border-gray-800 hover:border-blue-500 rounded-md cursor-pointer"
      >
        <b className="text-[13px] text-gray-300">{label}</b>
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
