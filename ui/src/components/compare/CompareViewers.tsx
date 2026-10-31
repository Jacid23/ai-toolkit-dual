'use client';
import { useEffect, useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react';
import { RefreshCw, X } from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { encodeFilePathForUrl } from '@/utils/basic';
import { AlignedRow, CFG_LABELS, CompareCellRow, ScannedFile, ScannedRun } from '@/utils/compare';

export const RUN_COLORS = ['#3b82f6', '#f59e0b', '#22c55e', '#ec4899', '#a855f7', '#14b8a6', '#ef4444', '#eab308'];
export const runColor = (i: number) => RUN_COLORS[i % RUN_COLORS.length];
export const fmtCfg = (v: any) => (v === null || v === undefined || v === '' ? '—' : String(v));
export const imgUrl = (p: string) => `/api/img/${encodeFilePathForUrl(p)}`;

export interface GridCtx {
  runs: ScannedRun[];
  rows: AlignedRow[]; // in display order
  prompts: string[];
  diffKeys: string[];
  cellOf: (f: ScannedFile, prompt: string) => CompareCellRow | undefined;
  rowNum: (row: number) => number;
}

const RunBadge = ({ i }: { i: number }) => (
  <span
    className="inline-grid place-items-center w-[18px] h-[18px] rounded text-[11px] font-bold text-white mr-1.5 shrink-0"
    style={{ background: runColor(i) }}
  >
    {i + 1}
  </span>
);

const DiffList = ({ run, keys, cols = 1 }: { run: ScannedRun; keys: string[]; cols?: number }) => (
  <div
    className="grid gap-x-2 gap-y-0.5 text-xs"
    style={{ gridTemplateColumns: `repeat(${cols}, auto minmax(0, 1fr))` }}
  >
    {keys.map(k => (
      <div key={k} className="contents">
        <span className="text-gray-400 whitespace-nowrap">{CFG_LABELS[k]}</span>
        <span className="text-gray-100 truncate">{fmtCfg(run.cfg?.[k])}</span>
      </div>
    ))}
  </div>
);

const useKeys = (open: boolean, handlers: Record<string, () => void>) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const h = handlers[e.key];
      if (h) {
        e.preventDefault();
        h();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handlers]);
};

export interface ImagePos {
  run: number;
  row: number;
  prompt: number;
}

// one image, like the Samples viewer: ←/→ training, ↑/↓ row, [ / ] prompt
export function CompareImageViewer({
  ctx,
  pos,
  onChange,
  onClose,
  onRegenerate,
}: {
  ctx: GridCtx;
  pos: ImagePos | null;
  onChange: (p: ImagePos) => void;
  onClose: () => void;
  onRegenerate?: (file: ScannedFile, prompt: string) => Promise<string | null>; // error text or null
}) {
  const file = pos ? ctx.rows[pos.row]?.cells[pos.run] : null;
  const prompt = pos ? ctx.prompts[pos.prompt] : '';
  const cell = file && pos ? ctx.cellOf(file, prompt) : undefined;
  const run = pos ? ctx.runs[pos.run] : null;
  const [sending, setSending] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  useEffect(() => setRegenError(null), [file?.path, prompt]);
  const regenerating = sending || cell?.status === 'pending';
  let snap: any = {};
  try {
    snap = JSON.parse(cell?.settings || '{}');
  } catch {}

  // move to the next spot that has an image, skipping empty cells
  const step = (dRun: number, dRow: number, dPrompt: number) => {
    if (!pos) return;
    let p = { ...pos };
    for (let i = 0; i < 200; i++) {
      p = { run: p.run + dRun, row: p.row + dRow, prompt: p.prompt + dPrompt };
      if (p.run < 0 || p.run >= ctx.runs.length || p.row < 0 || p.row >= ctx.rows.length) return;
      if (p.prompt < 0 || p.prompt >= ctx.prompts.length) return;
      const f = ctx.rows[p.row].cells[p.run];
      const c = f ? ctx.cellOf(f, ctx.prompts[p.prompt]) : undefined;
      if (c?.image_path) return onChange(p);
    }
  };
  // one training: prompts sit side by side like the Samples viewer, so ←/→ moves between them
  const single = ctx.runs.length === 1;
  useKeys(!!pos, {
    Escape: onClose,
    ArrowLeft: () => (single ? step(0, 0, -1) : step(-1, 0, 0)),
    ArrowRight: () => (single ? step(0, 0, 1) : step(1, 0, 0)),
    ArrowUp: () => step(0, -1, 0),
    ArrowDown: () => step(0, 1, 0),
    '[': () => step(0, 0, -1),
    ']': () => step(0, 0, 1),
  });

  return (
    <Dialog open={!!pos && !!cell?.image_path} onClose={onClose} className="relative z-30">
      <DialogBackdrop className="fixed inset-0 bg-gray-900/75" />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-0 sm:p-4">
        <DialogPanel className="relative rounded-none sm:rounded-lg bg-gray-800 shadow-xl overflow-hidden flex flex-col sm:max-w-[95vw] sm:max-h-[95vh]">
          {cell?.image_path && (
            // wheel / double-click zoom, drag to pan — same as the Samples viewer
            <TransformWrapper
              key={cell.image_path}
              initialScale={1}
              minScale={1}
              maxScale={6}
              doubleClick={{ mode: 'toggle', step: 2 }}
              wheel={{ step: 0.2 }}
              panning={{ disabled: false, allowRightClickPan: false }}
            >
              <TransformComponent>
                <img
                  src={imgUrl(cell.image_path)}
                  alt=""
                  draggable={false}
                  className="w-auto h-auto max-w-full sm:max-w-[95vw] max-h-[78vh] object-contain select-none"
                />
              </TransformComponent>
            </TransformWrapper>
          )}
          <div className="bg-gray-950 text-sm flex gap-4 px-4 py-2">
            {run && file && pos && (
              <div className="flex-1 min-w-0">
                <div className="flex items-center mb-1">
                  <RunBadge i={pos.run} />
                  <span className="font-bold text-white truncate">{run.name}</span>
                  <span className="text-gray-400 ml-2 whitespace-nowrap">· {fmtCfg(file.step?.toLocaleString())} steps</span>
                </div>
                <DiffList run={run} keys={ctx.diffKeys} cols={3} />
              </div>
            )}
            {onRegenerate && file && (
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <button
                  type="button"
                  disabled={regenerating}
                  onClick={async () => {
                    setSending(true);
                    setRegenError(null);
                    setRegenError(await onRegenerate(file, prompt));
                    setSending(false);
                  }}
                  title="Re-render this image on ComfyUI with the comparison's current settings (replaces it when done)"
                  className="inline-flex items-center gap-1.5 rounded-md bg-gray-700 hover:bg-gray-600 px-2.5 py-1 text-xs text-gray-100 disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                  {regenerating ? 'Regenerating…' : 'Regenerate'}
                </button>
                {(regenError || (cell?.status === 'error' && cell.error)) && (
                  <span className="text-[11px] text-red-400 max-w-[260px] text-right break-words">
                    {regenError || cell?.error}
                  </span>
                )}
              </div>
            )}
            <div className="text-xs whitespace-nowrap">
              {pos && (
                <>
                  <div>
                    <span className="text-gray-400">Row:</span> #{ctx.rowNum(pos.row)}
                  </div>
                  <div>
                    <span className="text-gray-400">Prompt #:</span> {pos.prompt + 1} of {ctx.prompts.length}
                  </div>
                </>
              )}
              <div>
                <span className="text-gray-400">Seed:</span> {fmtCfg(snap.seed)}
              </div>
              <div>
                <span className="text-gray-400">Steps / CFG:</span> {fmtCfg(snap.steps)} / {fmtCfg(snap.cfg)}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="absolute top-2 right-2 bg-gray-900 rounded-full p-1 leading-[0px] opacity-60 hover:opacity-100"
          >
            <X />
          </button>
          <span className="absolute top-2 left-2 text-[11px] bg-gray-950/70 text-gray-300 px-2 py-0.5 rounded">
            {single ? '← → prompt · ↑ ↓ step' : '← → training · ↑ ↓ row · [ ] prompt'} · wheel zoom · Esc
          </span>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

// a whole row (one checkpoint position across every training) as one big card
export function CompareRowCard({
  ctx,
  pos,
  onChange,
  onClose,
  onOpenImage,
  onClearRow,
  onRemoveRow,
}: {
  ctx: GridCtx;
  pos: { row: number; prompt: number } | null;
  onChange: (p: { row: number; prompt: number }) => void;
  onClose: () => void;
  onOpenImage: (p: ImagePos) => void;
  onClearRow: (row: number) => void;
  onRemoveRow: (row: number) => void;
}) {
  useKeys(!!pos, {
    Escape: onClose,
    ArrowUp: () => pos && pos.row > 0 && onChange({ ...pos, row: pos.row - 1 }),
    ArrowDown: () => pos && pos.row < ctx.rows.length - 1 && onChange({ ...pos, row: pos.row + 1 }),
    '[': () => pos && pos.prompt > 0 && onChange({ ...pos, prompt: pos.prompt - 1 }),
    ']': () => pos && pos.prompt < ctx.prompts.length - 1 && onChange({ ...pos, prompt: pos.prompt + 1 }),
  });
  const row = pos ? ctx.rows[pos.row] : null;
  const n = ctx.runs.length || 1;
  const colW =
    typeof window === 'undefined'
      ? 300
      : Math.max(200, Math.min(window.innerHeight * 0.94 - 240, Math.floor((window.innerWidth * 0.96 - 16) / n) - 6));

  return (
    <Dialog open={!!pos && !!row} onClose={onClose} className="relative z-30">
      <DialogBackdrop className="fixed inset-0 bg-gray-900/75" />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-2">
        <DialogPanel className="relative w-[96vw] max-h-[94vh] bg-gray-800 rounded-lg shadow-xl overflow-hidden flex flex-col">
          {pos && row && (
            <>
              <div className="flex items-center gap-3 pl-4 pr-12 py-2.5 bg-gray-900 border-b border-gray-700">
                <b className="text-white">
                  Row #{ctx.rowNum(pos.row)} of {ctx.rows.length}
                </b>
                <span className="flex-1 min-w-0 truncate text-xs text-gray-400">
                  Prompt {pos.prompt + 1}: {ctx.prompts[pos.prompt]}
                </span>
                <button
                  onClick={() => onClearRow(pos.row)}
                  className="px-2.5 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
                >
                  Clear row
                </button>
                <button
                  onClick={() => onRemoveRow(pos.row)}
                  className="px-2.5 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-red-400"
                >
                  Remove row
                </button>
                <span className="text-[11px] text-gray-500 hidden md:inline">↑ ↓ row · [ ] prompt · Esc</span>
              </div>
              <div className="grid gap-1.5 p-2 overflow-auto" style={{ gridTemplateColumns: `repeat(${n}, ${colW}px)` }}>
                {ctx.runs.map((run, ri) => {
                  const f = row.cells[ri];
                  const c = f ? ctx.cellOf(f, ctx.prompts[pos.prompt]) : undefined;
                  return (
                    <div
                      key={ri}
                      className="flex flex-col bg-gray-950 rounded-md overflow-hidden border-t-[3px]"
                      style={{ borderTopColor: runColor(ri) }}
                    >
                      <div className="aspect-square bg-gray-900 grid place-items-center">
                        {!f ? (
                          <span className="text-gray-600 text-sm">no checkpoint in this row</span>
                        ) : c?.image_path ? (
                          <img
                            src={imgUrl(c.image_path)}
                            alt=""
                            className="w-full h-full object-contain cursor-pointer"
                            onClick={() => onOpenImage({ run: ri, row: pos.row, prompt: pos.prompt })}
                          />
                        ) : (
                          <span className="text-gray-500 text-sm">
                            {c?.status === 'pending' ? 'Generating…' : c?.status === 'error' ? 'Failed' : 'Not generated'}
                          </span>
                        )}
                      </div>
                      <div className="px-2.5 py-2">
                        <div className="flex items-baseline gap-1.5 mb-1 text-xs">
                          <span className="font-bold text-white truncate">{run.name}</span>
                          <span className="text-gray-400 whitespace-nowrap">
                            {f ? `${fmtCfg(f.step?.toLocaleString())} steps` : '—'}
                          </span>
                        </div>
                        <DiffList run={run} keys={ctx.diffKeys} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <button
            onClick={onClose}
            className="absolute top-2 right-2 bg-gray-900 rounded-full p-1 leading-[0px] opacity-60 hover:opacity-100"
          >
            <X />
          </button>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
