'use client';
import { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { ChevronLeft, ChevronRight, Ellipsis, Loader2, Plus, Star, X } from 'lucide-react';
import { CompareData, CompareSettings } from '@/utils/compare';
import { openPromptLibrary, usePromptLibrary } from '@/components/PromptLibraryModal';
import ComfyWorkflowImport from '@/components/ComfyWorkflowImport';

export interface ComfyInfo {
  ok: boolean;
  url: string;
  error?: string;
  workflows?: string[];
  workflowError?: string;
  detected?: Record<string, string | null>;
  values?: Record<string, any>;
  options?: Record<string, string[]>;
  servers?: { main: string; later: string | null; labels?: { main: string; later: string | null } };
}

const inputCls =
  'w-full min-w-0 px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-sm text-gray-100 focus:outline-none focus:border-slate-500';
const labelCls = 'block text-xs text-gray-400 mb-1.5';
const sectionCls = 'px-5 py-5 border-b border-gray-800';
const headCls = 'text-xs uppercase tracking-wider text-gray-400 font-semibold';
const helpCls = 'mt-1 mb-3 text-xs text-gray-500';
const iconBtn = 'p-1 rounded-md text-gray-500 hover:text-gray-100 hover:bg-gray-800 transition-colors';
const linkBtn = 'inline-flex items-center gap-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200 px-2.5 py-1 text-xs transition-colors';

// a Comfy dropdown; keeps a saved value visible even if Comfy no longer lists it
const ComboSelect = ({
  value,
  options,
  onChange,
  emptyLabel,
}: {
  value: string;
  options?: string[];
  onChange: (v: string) => void;
  emptyLabel: string;
}) => {
  const opts = options ?? [];
  const list = value && !opts.includes(value) ? [value, ...opts] : opts;
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
      <option value="">{emptyLabel}</option>
      {list.map(o => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
};

interface Props {
  data: CompareData;
  folded: boolean;
  setFolded: (f: boolean) => void;
  setSettings: (patch: Partial<CompareSettings>) => void;
  setPrompts: (prompts: string[]) => void;
  comfy: ComfyInfo | null;
  onWorkflowChange: (name: string) => void;
  onServerChange: (server: 'main' | 'later') => void;
  onSaveDefault: () => void;
  onResetDefault: () => void;
  persistMsg: string;
  generating: boolean;
  pendingCount: number;
  missingCount: number;
  totalCount: number;
  progressText: string;
  progressPct: number;
  onGenerate: () => void;
  onCancel: () => void;
}

const PANEL_WIDTH_KEY = 'compare.panelWidth';
const PANEL_MIN = 260;
const PANEL_MAX = 800;

export default function ComparePanel(p: Props) {
  const { data, setSettings } = p;
  const s = data.settings;
  const { library, save, remove } = usePromptLibrary();
  const libId = (t: string) => library.find(l => l.text === t)?.id;
  const num = (v: string) => (v === '' ? 0 : Number(v));

  // drag the panel's left edge to resize it; the width is remembered in this browser
  const [width, setWidth] = useState(380);
  const [editing, setEditing] = useState<number | null>(null); // the prompt open for editing
  const drag = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem(PANEL_WIDTH_KEY));
      if (w >= PANEL_MIN && w <= PANEL_MAX) setWidth(w);
    } catch {}
  }, []);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = { x: e.clientX, w: width };
    let last = width;
    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      last = Math.min(PANEL_MAX, Math.max(PANEL_MIN, drag.current.w + drag.current.x - ev.clientX));
      setWidth(last);
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem(PANEL_WIDTH_KEY, String(last));
      } catch {}
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (p.folded) {
    return (
      <aside className="w-10 shrink-0 border-l border-gray-800 bg-gray-900 flex flex-col items-center gap-4 pt-3">
        <button onClick={() => p.setFolded(false)} title="Show sample settings" className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={() => p.setFolded(false)}
          className="text-xs text-gray-400 tracking-wider [writing-mode:vertical-rl] rotate-180 hover:text-white"
        >
          Sample settings
        </button>
      </aside>
    );
  }

  return (
    // the handle sits outside the scrolling aside so it stays put while the panel scrolls
    <div style={{ width }} className="relative shrink-0 flex">
      <div
        onPointerDown={startResize}
        onDoubleClick={() => {
          setWidth(380);
          try {
            localStorage.removeItem(PANEL_WIDTH_KEY);
          } catch {}
        }}
        title="Drag to resize · double-click to reset"
        className="absolute left-0 top-0 bottom-0 w-1.5 -ml-px z-20 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/60"
      />
      <aside className="flex-1 min-w-0 border-l border-gray-800 bg-gray-900 overflow-y-auto flex flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 pl-5 pr-3 py-3 bg-gray-900 border-b border-gray-800">
        <b className="text-sm font-semibold text-gray-100">Sample settings</b>
        <span className="text-xs text-gray-500 truncate">{p.persistMsg.replace(/^✓\s*/, '')}</span>
        <div className="flex-1" />
        <Menu>
          <MenuButton title="Defaults" className={iconBtn}>
            <Ellipsis className="w-4 h-4" />
          </MenuButton>
          <MenuItems anchor="bottom end" className="z-50 mt-1 w-64 bg-gray-900 border border-gray-700 rounded-lg p-1 shadow-lg">
            <MenuItem>
              <button onClick={p.onSaveDefault} className="block w-full text-left px-3 py-2 rounded-md text-sm hover:bg-gray-800">
                Save as default
                <span className="block text-xs text-gray-500">New comparisons start with these settings</span>
              </button>
            </MenuItem>
            <MenuItem>
              <button onClick={p.onResetDefault} className="block w-full text-left px-3 py-2 rounded-md text-sm hover:bg-gray-800">
                Reset to default
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>
        <button onClick={() => p.setFolded(true)} title="Fold to the right" className={iconBtn}>
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <section className={sectionCls}>
        <div className={headCls}>Prompts</div>
        <p className={helpCls}>Every training is sampled with each of these.</p>
        <div className="space-y-2">
          {data.prompts.map((prompt, i) => {
            const id = libId(prompt);
            const open = editing === i || !prompt.trim();
            return (
              <div key={i} className="group/prompt flex gap-2 items-start rounded-lg bg-gray-950/60 border border-gray-800 px-2.5 py-2">
                <span className="mt-0.5 grid place-items-center w-5 h-5 shrink-0 rounded bg-gray-800 text-[11px] font-semibold text-gray-400 tabular-nums">
                  {i + 1}
                </span>
                {open ? (
                  <textarea
                    autoFocus={editing === i}
                    value={prompt}
                    onChange={e => p.setPrompts(data.prompts.map((x, j) => (j === i ? e.target.value : x)))}
                    onBlur={() => setEditing(null)}
                    onKeyDown={e => e.key === 'Escape' && (e.currentTarget as HTMLTextAreaElement).blur()}
                    rows={Math.min(10, Math.max(3, Math.ceil(prompt.length / 48)))}
                    className={classNames(inputCls, 'resize-y leading-relaxed')}
                    placeholder="Enter prompt"
                  />
                ) : (
                  <p
                    onClick={() => setEditing(i)}
                    title="Click to edit"
                    className="flex-1 min-w-0 cursor-text text-sm text-gray-300 leading-relaxed line-clamp-3 break-words"
                  >
                    {prompt}
                  </p>
                )}
                <div className={classNames('flex flex-col', !id && 'opacity-0 group-hover/prompt:opacity-100 focus-within:opacity-100 transition-opacity')}>
                  <button
                    title={id ? 'Saved in the prompt library (click to remove)' : 'Save to the prompt library'}
                    onClick={() => (id ? remove(id) : prompt.trim() && save(prompt))}
                    className={classNames('p-1 rounded-md hover:bg-gray-800', id ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400')}
                  >
                    <Star className="w-4 h-4" fill={id ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    title="Remove from this comparison"
                    onClick={() => p.setPrompts(data.prompts.filter((_, j) => j !== i))}
                    className="p-1 rounded-md text-gray-500 hover:text-red-400 hover:bg-gray-800 opacity-0 group-hover/prompt:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => {
              p.setPrompts([...data.prompts, '']);
              setEditing(data.prompts.length);
            }}
            className={linkBtn}
          >
            <Plus className="w-3.5 h-3.5" /> Add prompt
          </button>
          <button
            onClick={() =>
              openPromptLibrary(
                texts => p.setPrompts([...data.prompts.filter(x => x.trim() !== ''), ...texts.filter(t => !data.prompts.includes(t))]),
                data.prompts,
              )
            }
            className={linkBtn}
          >
            <Star className="w-3.5 h-3.5" /> From library
          </button>
        </div>
      </section>

      <section className={sectionCls}>
        <div className={headCls}>ComfyUI</div>
        <div className="flex items-center gap-2 text-sm mt-2 mb-4">
          <span
            className={classNames(
              'w-2 h-2 shrink-0 rounded-full',
              p.comfy === null ? 'bg-gray-500' : p.comfy.ok ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,.6)]' : 'bg-red-500',
            )}
          />
          <span className={classNames('min-w-0 break-words', p.comfy?.ok || p.comfy === null ? 'text-gray-300' : 'text-red-400')}>
            {p.comfy === null ? 'Checking…' : p.comfy.ok ? `Connected · ${p.comfy.url.replace(/^https?:\/\//, '')}` : p.comfy.error}
          </span>
        </div>
        <div className="space-y-3">
          {p.comfy?.servers?.later && (
            <div>
              <label className={labelCls}>Server</label>
              <select
                value={s.server === 'later' ? 'later' : 'main'}
                onChange={e => p.onServerChange(e.target.value === 'later' ? 'later' : 'main')}
                className={inputCls}
              >
                <option value="main">
                  {p.comfy.servers.labels?.main ?? 'Main'} · {p.comfy.servers.main.replace(/^https?:\/\//, '')}
                </option>
                <option value="later">
                  {p.comfy.servers.labels?.later ?? 'Later'} · {p.comfy.servers.later.replace(/^https?:\/\//, '')}
                </option>
              </select>
            </div>
          )}
          <div>
            <label className={labelCls}>Workflow</label>
            <select value={s.workflow} onChange={e => p.onWorkflowChange(e.target.value)} className={inputCls}>
              <option value="">Pick a workflow…</option>
              {(s.workflow && !(p.comfy?.workflows ?? []).includes(s.workflow) ? [s.workflow] : [])
                .concat(p.comfy?.workflows ?? [])
                .map(w => (
                  <option key={w} value={w}>
                    {w.replace(/\.json$/i, '')}
                  </option>
                ))}
            </select>
            {p.comfy?.workflowError && <div className="text-xs text-red-400 mt-1.5">{p.comfy.workflowError}</div>}
            <ComfyWorkflowImport className="mt-2" onImported={p.onWorkflowChange} />
          </div>
          {p.comfy?.options && (
            <details className="group/ov rounded-lg border border-gray-800" open={(['model', 'te', 'vae'] as const).filter(f => s[f]).length > 0 || undefined}>
              <summary className="flex items-center gap-2 cursor-pointer select-none list-none px-3 py-2 text-sm text-gray-300 hover:text-gray-100 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="w-4 h-4 text-gray-500 transition-transform group-open/ov:rotate-90" />
                Model overrides
                <span className="ml-auto text-xs text-gray-500">{(['model', 'te', 'vae'] as const).filter(f => s[f]).length ? `${(['model', 'te', 'vae'] as const).filter(f => s[f]).length} set` : "workflow's own"}</span>
              </summary>
              <div className="px-3 pb-3 space-y-3">
                {(['model', 'te', 'vae'] as const).map(field =>
                  p.comfy?.options?.[field] ? (
                    <div key={field}>
                      <label className={labelCls}>{{ model: 'Diffusion model', te: 'Text encoder', vae: 'VAE' }[field]}</label>
                      <ComboSelect
                        value={s[field]}
                        options={p.comfy.options[field]}
                        onChange={v => setSettings({ [field]: v })}
                        emptyLabel={`Workflow's own (${p.comfy?.values?.[field] ?? '?'})`}
                      />
                    </div>
                  ) : null,
                )}
                <p className="text-xs text-gray-500 leading-relaxed">
                  GPU split stays as the workflow sets it.
                  {p.comfy.detected && (
                    <>
                      {' '}
                      LoRA → {p.comfy.detected.lora}; prompt → {p.comfy.detected.positive ?? 'not found'}; sampler → {p.comfy.detected.sampler};
                      size → {p.comfy.detected.latent ?? 'not found'}.
                    </>
                  )}
                </p>
              </div>
            </details>
          )}
        </div>
      </section>

      <section className={sectionCls}>
        <div className={headCls}>Generation</div>
        <p className={helpCls}>The same for every image, so only the LoRA differs.</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <div>
            <label className={labelCls}>Seed</label>
            <input type="number" value={s.seed} onChange={e => setSettings({ seed: num(e.target.value) })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Steps</label>
            <input type="number" value={s.steps} onChange={e => setSettings({ steps: num(e.target.value) })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>CFG</label>
            <input type="number" step="0.1" value={s.cfg} onChange={e => setSettings({ cfg: num(e.target.value) })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>LoRA strength</label>
            <input
              type="number"
              step="0.05"
              value={s.strength}
              onChange={e => setSettings({ strength: num(e.target.value) })}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Sampler</label>
            <ComboSelect value={s.sampler} options={p.comfy?.options?.sampler} onChange={v => setSettings({ sampler: v })} emptyLabel="Workflow's own" />
          </div>
          <div>
            <label className={labelCls}>Scheduler</label>
            <ComboSelect
              value={s.scheduler}
              options={p.comfy?.options?.scheduler}
              onChange={v => setSettings({ scheduler: v })}
              emptyLabel="Workflow's own"
            />
          </div>
          <div>
            <label className={labelCls}>Width</label>
            <input type="number" step="16" value={s.width} onChange={e => setSettings({ width: num(e.target.value) })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Height</label>
            <input type="number" step="16" value={s.height} onChange={e => setSettings({ height: num(e.target.value) })} className={inputCls} />
          </div>
        </div>
        <div className="mt-3">
          <label className={labelCls}>Negative prompt</label>
          <textarea value={s.neg} onChange={e => setSettings({ neg: e.target.value })} rows={2} placeholder="(none)" className={classNames(inputCls, 'resize-y')} />
        </div>
      </section>

      <details className="group/how px-5 py-4 border-b border-gray-800 text-xs text-gray-400 leading-relaxed">
        <summary className="flex items-center gap-2 cursor-pointer select-none list-none text-sm text-gray-400 hover:text-gray-200 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="w-4 h-4 text-gray-500 transition-transform group-open/how:rotate-90" />
          How Compare works
        </summary>
        <div className="mt-3 space-y-2">
          <p>
            Columns are trainings; adding one loads <b className="text-amber-400 font-medium">every LoRA in its folder</b>. Drag a column
            header to reorder, ✕ removes it.
          </p>
          <p>
            Rows line up by step: each checkpoint goes into the closest row its training hasn't filled, so gaps stay empty. Click a row # for
            the row card; hover it and use ⋯ to <b className="text-amber-400 font-medium">clear</b> or{' '}
            <b className="text-amber-400 font-medium">remove</b> the row.
          </p>
          <p>
            Every image comes from ComfyUI using the picked workflow, with the settings above patched in. Settings are saved with the
            comparison; Save as default (⋯ at the top) sets what new comparisons start with. ★ saves a prompt to the library, which New Job
            can use too.
          </p>
        </div>
      </details>

      <div className="sticky bottom-0 mt-auto bg-gray-900 px-5 py-4 border-t border-gray-800 space-y-3">
        <div className="flex border border-gray-700 rounded-md overflow-hidden">
          {(
            [
              ['missing', 'Missing only'],
              ['all', 'Regenerate all'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setSettings({ regen: m })}
              className={classNames('flex-1 px-3 py-1.5 text-xs', s.regen === m ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200')}
            >
              {label}
            </button>
          ))}
        </div>
        {p.pendingCount > 0 ? (
          <button
            onClick={p.onCancel}
            className="w-full py-2.5 rounded-md bg-gray-700 hover:bg-gray-600 text-sm inline-flex items-center justify-center gap-2"
          >
            <Loader2 className="w-4 h-4 animate-spin" /> Cancel ({p.pendingCount} queued)
          </button>
        ) : (
          <button
            onClick={p.onGenerate}
            disabled={p.generating || !p.comfy?.ok || !s.workflow || !p.totalCount || (s.regen !== 'all' && !p.missingCount)}
            className="w-full py-2.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white text-sm font-medium transition-colors"
          >
            {p.generating
              ? 'Queuing…'
              : !p.totalCount
                ? 'Add checkpoints to generate'
                : s.regen === 'all'
                  ? `Regenerate all ${p.totalCount} image${p.totalCount === 1 ? '' : 's'}`
                  : p.missingCount
                    ? `Generate ${p.missingCount} missing image${p.missingCount === 1 ? '' : 's'}`
                    : 'All images generated'}
          </button>
        )}
        {p.progressPct > 0 && (
          <div className="h-1.5 rounded bg-gray-800 overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${p.progressPct}%` }} />
          </div>
        )}
        <div className="text-xs text-gray-500 truncate">{p.progressText}</div>
      </div>
      </aside>
    </div>
  );
}
