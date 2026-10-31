import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import useSampleImages from '@/hooks/useSampleImages';
import SampleImageCard from './SampleImageCard';
import { Job } from '@prisma/client';
import { JobConfig } from '@/types';
import { LuImageOff, LuLoader, LuBan } from 'react-icons/lu';
import { RefreshCw } from 'lucide-react';
import useRegenQueue, { RegenSlot, SlotState } from '@/hooks/useRegenQueue';
import { Button, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { FaDownload } from 'react-icons/fa';
import { apiClient } from '@/utils/api';
import { encodeFilePathForUrl } from '@/utils/basic';
import classNames from 'classnames';
import { FaCaretDown, FaCaretUp } from 'react-icons/fa';
import SampleImageViewer from './SampleImageViewer';
import { openConfirm } from './ConfirmModal';

interface SampleImagesMenuProps {
  job?: Job | null;
}

export const SampleImagesMenu = ({ job }: SampleImagesMenuProps) => {
  const [isZipping, setIsZipping] = useState(false);

  const downloadZip = async () => {
    if (isZipping) return;
    setIsZipping(true);

    try {
      const res = await apiClient.post('/api/zip', {
        zipTarget: 'samples',
        jobName: job?.name,
      });

      const zipPath = res.data.zipPath; // e.g. /mnt/Train2/out/ui/.../samples.zip
      if (!zipPath) throw new Error('No zipPath in response');

      const downloadPath = `/api/files/${encodeFilePathForUrl(zipPath)}`;
      const a = document.createElement('a');
      a.href = downloadPath;
      // optional: suggest filename (browser may ignore if server sets Content-Disposition)
      a.download = 'samples.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error('Error downloading zip:', err);
    } finally {
      setIsZipping(false);
    }
  };
  return (
    <Button
      onClick={downloadZip}
      className={classNames(
        `flex-1 sm:flex-initial justify-center px-2 sm:px-4 py-1 h-8 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center`,
        {
          'opacity-50 cursor-not-allowed': isZipping,
        },
      )}
    >
      {isZipping ? (
        <LuLoader className="animate-spin inline-block sm:mr-2" />
      ) : (
        <FaDownload className="inline-block sm:mr-2" />
      )}
      <span className="hidden sm:inline">{isZipping ? 'Preparing' : 'Download'}</span>
    </Button>
  );
};

interface SampleImagesProps {
  job: Job;
}

// DUAL BUILD: one grid row = one step's prompt slots. Slots with no image at a checkpoint that
// still exists show as "not sampled" tiles; every tile has a checkbox, and ticked tiles (and
// ctrl/shift-click selections) go to the job's ComfyUI regen queue with "Regenerate selected".
type Slot = { path: string | null; step: number | null; idx: number; missing: boolean };
type Row = { key: string; step: number | null; slots: Slot[] };

const slotOf = (p: string): { step: number; idx: number } | null => {
  const m = p.match(/__(\d+)_(\d+)\.[^.\\/]+$/);
  return m ? { step: parseInt(m[1], 10), idx: parseInt(m[2], 10) } : null;
};
const missingKey = (step: number, idx: number) => `missing:${step}:${idx}`;
const keyOfSlot = (s: Slot) => s.path ?? missingKey(s.step ?? -1, s.idx);
const slotOfKey = (k: string): RegenSlot | null => {
  const m = k.match(/^missing:(\d+):(\d+)$/);
  if (m) return { step: parseInt(m[1], 10), idx: parseInt(m[2], 10) };
  return slotOf(k);
};

const SHOW_MISSING_KEY = 'samples.showMissing';

export default function SampleImages({ job }: SampleImagesProps) {
  const { sampleImages, status, refreshSampleImages } = useSampleImages(job.id, 5000);
  const regen = useRegenQueue(job.id);
  const [showMissing, setShowMissing] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(SHOW_MISSING_KEY) === '0') setShowMissing(false);
    } catch {}
  }, []);
  const toggleShowMissing = useCallback(() => {
    setShowMissing(v => {
      try {
        localStorage.setItem(SHOW_MISSING_KEY, v ? '0' : '1');
      } catch {}
      return !v;
    });
  }, []);
  const [selectedSamplePath, setSelectedSamplePath] = useState<string | null>(null);
  // multi-select (checkboxes; shift-click ranges from the anchor, ctrl/cmd-click toggles): bulk
  // regenerate, and bulk delete for the images among it. Keys: image path, or missing:<step>:<idx>
  const [selectedSet, setSelectedSet] = useState<Set<string>>(() => new Set());
  const anchorIdxRef = useRef<number | null>(null);
  // selection as it was when the anchor was set; shift-click ranges are rebuilt on top of it, not accumulated
  const baseSetRef = useRef<Set<string>>(new Set());
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null);
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null);
  const scrollParentCallback = useCallback((el: HTMLDivElement | null) => setScrollParent(el), []);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const numSamples = useMemo(() => {
    if (job?.job_config) {
      const jobConfig = JSON.parse(job.job_config) as JobConfig;
      const sampleConfig = jobConfig.config.process[0].sample;
      const numPrompts = sampleConfig.prompts ? sampleConfig.prompts.length : 0;
      const numSamples = sampleConfig.samples.length;
      return Math.max(numPrompts, numSamples, 1);
    }
    return 10;
  }, [job]);

  // each saved regen image: reload the grid
  const regenVersion = regen.status?.version ?? 0;
  useEffect(() => {
    if (regenVersion) refreshSampleImages();
  }, [regenVersion]);

  const missingList = useMemo(() => regen.status?.missing ?? [], [regen.status]);
  const missingSet = useMemo(
    () => new Set(showMissing ? missingList.map(m => `${m.step}:${m.idx}`) : []),
    [missingList, showMissing],
  );

  // Rows: the files of one step laid out by prompt index (the samples API lists them step by
  // step, row by row of prompt slots), so a missing image leaves its own slot empty; steps that
  // only have missing slots get a row of "not sampled" tiles. Files with no step in the name
  // keep the old layout (chunks of numSamples).
  const rows = useMemo(() => {
    const byStep = new Map<number, string[]>();
    const loose: string[] = [];
    for (const sample of sampleImages) {
      const slot = slotOf(sample);
      if (!slot) loose.push(sample);
      else byStep.set(slot.step, [...(byStep.get(slot.step) ?? []), sample]);
    }
    for (const key of Array.from(missingSet)) {
      const step = parseInt(key.split(':')[0], 10);
      if (!byStep.has(step)) byStep.set(step, []);
    }
    const out: Row[] = [];
    for (const step of Array.from(byStep.keys()).sort((a, b) => a - b)) {
      const lists = new Map<number, string[]>();
      for (const f of byStep.get(step)!) {
        const idx = slotOf(f)!.idx;
        lists.set(idx, [...(lists.get(idx) ?? []), f]);
      }
      const width = Math.max(numSamples, ...Array.from(lists.keys()).map(i => i + 1));
      const depth = Math.max(1, ...Array.from(lists.values()).map(l => l.length));
      for (let r = 0; r < depth; r++) {
        const slots: Slot[] = [];
        for (let idx = 0; idx < width; idx++) {
          const p = lists.get(idx)?.[r] ?? null;
          slots.push({ path: p, step, idx, missing: !p && r === 0 && missingSet.has(`${step}:${idx}`) });
        }
        out.push({ key: `${step}:${r}`, step, slots });
      }
    }
    for (let i = 0; i < loose.length; i += numSamples) {
      const chunk = loose.slice(i, i + numSamples);
      out.push({ key: chunk[0], step: null, slots: chunk.map((p, idx) => ({ path: p, step: null, idx, missing: false })) });
    }
    return out;
  }, [sampleImages, numSamples, missingSet]);

  // drop selections whose image is gone (deleted / replaced) or whose slot is no longer missing
  useEffect(() => {
    setSelectedSet(prev => {
      if (!prev.size) return prev;
      const have = new Set(sampleImages);
      const next = new Set(
        Array.from(prev).filter(k => (k.startsWith('missing:') ? missingSet.has(k.slice(8)) : have.has(k))),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [sampleImages, missingSet]);

  // the viewer follows its image when a regen replaces it (same step and prompt slot)
  useEffect(() => {
    if (!selectedSamplePath || !sampleImages.length || sampleImages.includes(selectedSamplePath)) return;
    const was = slotOf(selectedSamplePath);
    if (!was) return;
    const now = sampleImages.find(p => {
      const s = slotOf(p);
      return s && s.step === was.step && s.idx === was.idx;
    });
    if (now) setSelectedSamplePath(now);
  }, [sampleImages, selectedSamplePath]);

  const toggleKeys = useCallback((keys: string[], on?: boolean) => {
    setSelectedSet(prev => {
      const next = new Set(prev);
      const add = on ?? keys.some(k => !next.has(k));
      for (const k of keys) {
        if (add) next.add(k);
        else next.delete(k);
      }
      baseSetRef.current = new Set(next);
      return next;
    });
  }, []);

  const handleCardClick = useCallback(
    (sample: string, e: React.MouseEvent) => {
      const isRange = e.shiftKey;
      const isToggle = e.ctrlKey || e.metaKey;
      if (!isRange && !isToggle) {
        setSelectedSet(new Set());
        anchorIdxRef.current = null;
        baseSetRef.current = new Set();
        setSelectedSamplePath(sample);
        return;
      }
      e.preventDefault();
      const idx = sampleImages.indexOf(sample);
      if (idx === -1) return;
      setSelectedSet(prev => {
        const anchor = anchorIdxRef.current;
        if (isRange && anchor !== null && anchor < sampleImages.length) {
          const next = new Set(baseSetRef.current);
          const [lo, hi] = anchor < idx ? [anchor, idx] : [idx, anchor];
          for (let i = lo; i <= hi; i++) next.add(sampleImages[i]);
          return next;
        }
        const next = new Set(prev);
        if (isToggle && next.has(sample)) {
          next.delete(sample);
        } else {
          next.add(sample);
        }
        anchorIdxRef.current = idx;
        baseSetRef.current = new Set(next);
        return next;
      });
    },
    [sampleImages],
  );

  const clearSelection = useCallback(() => {
    setSelectedSet(new Set());
    anchorIdxRef.current = null;
    baseSetRef.current = new Set();
  }, []);

  const selectedFiles = useMemo(() => Array.from(selectedSet).filter(k => !k.startsWith('missing:')), [selectedSet]);

  const deleteSelected = useCallback(() => {
    const paths = selectedFiles;
    if (paths.length === 0) return;
    openConfirm({
      title: 'Delete Samples',
      message: `Are you sure you want to delete ${paths.length} sample${paths.length === 1 ? '' : 's'}? This action cannot be undone.`,
      type: 'warning',
      confirmText: 'Delete',
      onConfirm: async () => {
        setDeleteProgress({ done: 0, total: paths.length });
        // bounded concurrency so the progress counter advances and the server isn't flooded
        const CONCURRENCY = 4;
        let cursor = 0;
        let done = 0;
        const worker = async () => {
          while (cursor < paths.length) {
            const imgPath = paths[cursor++];
            try {
              await apiClient.post('/api/img/delete', { imgPath });
            } catch (error) {
              console.error('Error deleting sample:', imgPath, error);
            }
            done++;
            setDeleteProgress({ done, total: paths.length });
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));
        setDeleteProgress(null);
        clearSelection();
        refreshSampleImages();
      },
    });
  }, [selectedFiles, refreshSampleImages, clearSelection]);

  const { enqueue } = regen;
  const regenerateSelected = useCallback(() => {
    const items = Array.from(selectedSet)
      .map(slotOfKey)
      .filter((s): s is RegenSlot => !!s);
    if (!items.length) return;
    enqueue({ items });
    clearSelection();
  }, [selectedSet, enqueue, clearSelection]);

  const selectMissing = useCallback(() => {
    if (!showMissing) toggleShowMissing();
    toggleKeys(
      missingList.map(m => missingKey(m.step, m.idx)),
      true,
    );
  }, [missingList, showMissing, toggleShowMissing, toggleKeys]);

  // Delete/Backspace deletes the selection, Escape clears it; ignored while the viewer is open or typing in a field
  useEffect(() => {
    if (selectedSet.size === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (selectedSamplePath) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Escape') {
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedSet.size, selectedSamplePath, deleteSelected, clearSelection]);

  const scrollToBottom = () => {
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end' });
  };

  const scrollToTop = () => {
    virtuosoRef.current?.scrollToIndex({ index: 0, align: 'start' });
  };

  const PageInfoContent = useMemo(() => {
    let icon = null;
    let text = '';
    let subtitle = '';
    let showIt = false;
    let bgColor = '';
    let textColor = '';
    let iconColor = '';

    if (rows.length > 0) return null;

    if (status == 'loading') {
      icon = <LuLoader className="animate-spin w-8 h-8" />;
      text = 'Loading Samples';
      subtitle = 'Please wait while we fetch your samples...';
      showIt = true;
      bgColor = 'bg-gray-50 dark:bg-gray-800/50';
      textColor = 'text-gray-900 dark:text-gray-100';
      iconColor = 'text-gray-500 dark:text-gray-400';
    }
    if (status == 'error') {
      icon = <LuBan className="w-8 h-8" />;
      text = 'Error Loading Samples';
      subtitle = 'There was a problem fetching the samples.';
      showIt = true;
      bgColor = 'bg-red-50 dark:bg-red-950/20';
      textColor = 'text-red-900 dark:text-red-100';
      iconColor = 'text-red-600 dark:text-red-400';
    }
    if (status == 'success' && sampleImages.length === 0) {
      icon = <LuImageOff className="w-8 h-8" />;
      text = 'No Samples Found';
      subtitle = 'No samples have been generated yet';
      showIt = true;
      bgColor = 'bg-gray-50 dark:bg-gray-800/50';
      textColor = 'text-gray-900 dark:text-gray-100';
      iconColor = 'text-gray-500 dark:text-gray-400';
    }

    if (!showIt) return null;

    return (
      <div
        className={`mt-10 flex flex-col items-center justify-center py-16 px-8 rounded-xl border-2 border-gray-700 border-dashed ${bgColor} ${textColor} mx-auto max-w-md text-center`}
      >
        <div className={`${iconColor} mb-4`}>{icon}</div>
        <h3 className="text-lg font-semibold mb-2">{text}</h3>
        <p className="text-sm opacity-75 leading-relaxed">{subtitle}</p>
      </div>
    );
  }, [status, sampleImages.length, rows.length]);

  // Inline style instead of Tailwind grid-cols-N classes — Tailwind only ships grid-cols-1..12,
  // so class-based columns silently break for larger sample counts.
  const gridCols = Math.max(numSamples, 3);

  const sampleConfig = useMemo(() => {
    if (job?.job_config) {
      const jobConfig = JSON.parse(job.job_config) as JobConfig;
      return jobConfig.config.process[0].sample;
    }
    return null;
  }, [job]);

  const qs = regen.status;
  const current = qs?.current ?? null;
  const lastError = regen.error ?? (qs?.errors?.length ? qs.errors[qs.errors.length - 1] : null);
  const showBar = selectedSet.size > 0 || missingList.length > 0 || regen.active || !!lastError;
  const viewerSlot = selectedSamplePath ? slotOf(selectedSamplePath) : null;

  const slotBadge = (state: SlotState) =>
    state === 'rendering' ? (
      <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center rounded-t-lg bg-black/50">
        <span className="flex items-center gap-1.5 rounded bg-gray-900/90 px-2 py-1 text-[11px] text-blue-300">
          <RefreshCw className="w-3 h-3 animate-spin" /> Rendering
        </span>
      </div>
    ) : state === 'queued' ? (
      <span className="pointer-events-none absolute right-1.5 top-1.5 z-[2] rounded bg-gray-900/90 px-1.5 py-0.5 text-[10px] text-amber-300">
        Queued
      </span>
    ) : null;

  const tickBox = (key: string, checked: boolean) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={() => toggleKeys([key])}
      onClick={e => e.stopPropagation()}
      title="Select for Regenerate / Delete"
      className={classNames(
        'absolute left-1.5 top-1.5 z-[3] h-4 w-4 cursor-pointer accent-blue-500 transition-opacity',
        checked || selectedSet.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
      )}
    />
  );

  return (
    <div ref={scrollParentCallback} className="absolute top-[80px] left-0 right-0 bottom-0 overflow-y-auto">
      {showBar && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-800 bg-gray-950/95 px-2 py-1.5 text-xs text-gray-300">
          {selectedSet.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-gray-200">{selectedSet.size} selected</span>
              <button
                type="button"
                onClick={regenerateSelected}
                className="flex items-center gap-1 rounded bg-blue-700 px-2 py-0.5 text-white hover:bg-blue-600"
                title="Re-render the selected samples on ComfyUI with the job's current prompts and settings"
              >
                <RefreshCw className="w-3 h-3" /> Regenerate selected
              </button>
              {selectedFiles.length > 0 && (
                <button type="button" onClick={deleteSelected} className="rounded bg-gray-800 px-2 py-0.5 hover:bg-red-800">
                  Delete {selectedFiles.length}
                </button>
              )}
              <button type="button" onClick={clearSelection} className="rounded bg-gray-800 px-2 py-0.5 hover:bg-gray-700">
                Clear
              </button>
            </div>
          )}
          {missingList.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-amber-400">
                {missingList.length} sample{missingList.length === 1 ? '' : 's'} missing
              </span>
              <button type="button" onClick={selectMissing} className="rounded bg-gray-800 px-2 py-0.5 hover:bg-gray-700">
                Select missing
              </button>
              <button type="button" onClick={toggleShowMissing} className="text-gray-500 hover:text-gray-300">
                {showMissing ? 'Hide' : 'Show'}
              </button>
            </div>
          )}
          {regen.active && (
            <div className="flex items-center gap-2 text-blue-300">
              <RefreshCw className="w-3 h-3 animate-spin" />
              {current
                ? `Rendering step ${current.step.toLocaleString()} (${current.done.length}/${current.indices.length})`
                : 'Starting'}
              {qs && qs.pending.length > 0 && <span className="text-gray-400">· {qs.pending.length} queued</span>}
              {qs && qs.pending.length > 0 && (
                <button type="button" onClick={regen.clear} className="text-gray-500 hover:text-gray-300">
                  Clear queue
                </button>
              )}
            </div>
          )}
          {lastError && (
            <span className="max-w-[480px] truncate text-red-400" title={(qs?.errors ?? []).join('\n') || lastError}>
              {lastError}
            </span>
          )}
        </div>
      )}
      <div className="pb-4">
        {PageInfoContent}
        {rows.length > 0 && scrollParent && (
          <Virtuoso
            ref={virtuosoRef}
            customScrollParent={scrollParent}
            totalCount={rows.length}
            initialTopMostItemIndex={rows.length - 1}
            followOutput="auto"
            increaseViewportBy={400}
            computeItemKey={index => rows[index]?.key ?? index}
            itemContent={index => {
              const row = rows[index];
              if (!row) return null;

              // Only pad the final row when numSamples < MIN_COLS and the row is short.
              const MIN_COLS = 3;
              const shouldPad = numSamples < MIN_COLS && row.slots.length < MIN_COLS;
              const padsNeeded = shouldPad ? MIN_COLS - row.slots.length : 0;
              const rowKeys = row.slots.filter(s => s.path || s.missing).map(keyOfSlot);
              const rowChecked = rowKeys.length > 0 && rowKeys.every(k => selectedSet.has(k));

              return (
                // pb-1 recreates the vertical gap between rows that the original single CSS grid provided via `gap-1`.
                <div className="flex gap-1 pb-1">
                  <label
                    className="flex w-12 shrink-0 cursor-pointer flex-col items-center gap-1 pt-1 text-[10px] text-gray-500 hover:text-gray-300"
                    title={row.step !== null ? `Select every sample of step ${row.step.toLocaleString()}` : 'Select row'}
                  >
                    <input
                      type="checkbox"
                      checked={rowChecked}
                      onChange={() => toggleKeys(rowKeys, !rowChecked)}
                      className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
                    />
                    {row.step !== null && <span>{row.step.toLocaleString()}</span>}
                  </label>
                  <div
                    className="grid flex-1 gap-1"
                    style={{ gridTemplateColumns: `repeat(${Math.max(gridCols, row.slots.length)}, minmax(0, 1fr))` }}
                  >
                    {row.slots.map(slot => {
                      const key = keyOfSlot(slot);
                      const checked = selectedSet.has(key);
                      const state = slot.step !== null ? regen.slotState(slot.step, slot.idx) : null;
                      if (slot.path) {
                        const sample = slot.path;
                        return (
                          <div key={sample} className="group relative">
                            <SampleImageCard
                              imageUrl={sample}
                              numSamples={numSamples}
                              sampleImages={sampleImages}
                              alt="Sample Image"
                              onClick={e => handleCardClick(sample, e)}
                              selected={checked || selectedSamplePath === sample}
                              observerRoot={scrollParent}
                            />
                            {slot.step !== null && tickBox(key, checked)}
                            {slotBadge(state)}
                          </div>
                        );
                      }
                      if (slot.missing) {
                        return (
                          <div key={key} className="group relative">
                            <div
                              className="relative w-full cursor-pointer select-none"
                              style={{ paddingBottom: '100%' }}
                              onClick={() => toggleKeys([key])}
                              title={`Step ${(slot.step ?? 0).toLocaleString()}, prompt ${slot.idx + 1}: not sampled. Tick it and Regenerate selected.`}
                            >
                              <div
                                className={classNames(
                                  'absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-t-lg border-2 border-dashed text-[11px]',
                                  checked
                                    ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                                    : 'border-gray-700 text-gray-500 hover:border-gray-500',
                                )}
                              >
                                <LuImageOff className="w-5 h-5" />
                                Not sampled
                              </div>
                            </div>
                            {tickBox(key, checked)}
                            {slotBadge(state)}
                          </div>
                        );
                      }
                      return <div key={`empty-${row.key}-${slot.idx}`} className="invisible" />;
                    })}
                    {Array.from({ length: padsNeeded }).map((_, i) => (
                      <div key={`pad-${index}-${i}`} className="invisible" />
                    ))}
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>
      <Dialog open={deleteProgress !== null} onClose={() => {}} className="relative z-20">
        <DialogBackdrop className="fixed inset-0 bg-gray-900/75" />
        <div className="fixed inset-0 z-10 flex items-center justify-center p-4">
          <DialogPanel className="w-full max-w-sm rounded-lg bg-gray-800 p-6 shadow-xl text-gray-200">
            <DialogTitle as="h3" className="text-base font-semibold flex items-center gap-2">
              <LuLoader className="animate-spin" />
              Deleting Samples
            </DialogTitle>
            <p className="mt-2 text-sm text-gray-400">
              {deleteProgress?.done ?? 0} / {deleteProgress?.total ?? 0}
            </p>
            <div className="mt-3 h-2 w-full rounded bg-gray-700 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-150"
                style={{
                  width: `${deleteProgress && deleteProgress.total > 0 ? (deleteProgress.done / deleteProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </DialogPanel>
        </div>
      </Dialog>
      <SampleImageViewer
        imgPath={selectedSamplePath}
        numSamples={numSamples}
        sampleImages={sampleImages}
        onChange={setPath => setSelectedSamplePath(setPath)}
        sampleConfig={sampleConfig}
        refreshSampleImages={refreshSampleImages}
        jobId={job.id}
        regenState={viewerSlot ? regen.slotState(viewerSlot.step, viewerSlot.idx) : null}
        regenError={regen.error}
        onRegenerate={regen.enqueue}
      />
      <div
        className="hidden md:flex fixed top-20 mt-4 right-6 w-10 h-10 rounded-full bg-gray-900 shadow-lg items-center justify-center text-white opacity-80 hover:opacity-100 cursor-pointer"
        onClick={scrollToTop}
        title="Scroll to Top"
      >
        <FaCaretUp className="text-gray-500 dark:text-gray-400" />
      </div>
      <div
        className="hidden md:flex fixed bottom-5 right-6 w-10 h-10 rounded-full bg-gray-900 shadow-lg items-center justify-center text-white opacity-80 hover:opacity-100 cursor-pointer"
        onClick={scrollToBottom}
        title="Scroll to Bottom"
      >
        <FaCaretDown className="text-gray-500 dark:text-gray-400" />
      </div>
    </div>
  );
}
