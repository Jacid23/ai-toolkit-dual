'use client';
import classNames from 'classnames';
import { ChevronLeft, ChevronRight, Loader2, Star, X } from 'lucide-react';
import { CompareData, CompareSettings } from '@/utils/compare';
import { openPromptLibrary, usePromptLibrary } from '@/components/PromptLibraryModal';

export interface ComfyInfo {
  ok: boolean;
  url: string;
  error?: string;
  workflows?: string[];
  workflowError?: string;
  detected?: Record<string, string | null>;
  values?: Record<string, any>;
  options?: Record<string, string[]>;
}

const inputCls =
  'w-full min-w-0 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-sm focus:ring-2 focus:ring-gray-600 focus:border-transparent';
const labelCls = 'block text-xs text-gray-400 mb-1';
const sectionCls = 'px-4 py-3.5 border-b border-gray-800';
const headCls = 'flex items-center justify-between gap-2 mb-2.5 text-[11px] uppercase tracking-wider text-gray-400 font-semibold';
const Pill = ({ children, blue }: { children: React.ReactNode; blue?: boolean }) => (
  <span
    className={classNames(
      'text-[10px] normal-case tracking-normal font-normal px-1.5 py-px rounded-full border whitespace-nowrap',
      blue ? 'text-blue-300 bg-blue-500/10 border-blue-500/30' : 'text-green-400 bg-green-500/10 border-green-500/30',
    )}
  >
    {children}
  </span>
);

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

export default function ComparePanel(p: Props) {
  const { data, setSettings } = p;
  const s = data.settings;
  const { library, save, remove } = usePromptLibrary();
  const libId = (t: string) => library.find(l => l.text === t)?.id;
  const num = (v: string) => (v === '' ? 0 : Number(v));

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
    <aside className="w-[340px] shrink-0 border-l border-gray-800 bg-gray-900 overflow-y-auto flex flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 pl-4 pr-3 py-2.5 bg-gray-900 border-b border-gray-800">
        <b className="text-sm">Sample settings</b>
        <div className="flex-1" />
        <button onClick={() => p.setFolded(true)} title="Fold to the right" className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 border-b border-gray-800 text-xs">
        <span className="text-green-400">{p.persistMsg}</span>
        <div className="flex-1" />
        <button onClick={p.onSaveDefault} className="text-blue-400 hover:underline">
          Save as default
        </button>
        <button onClick={p.onResetDefault} className="text-blue-400 hover:underline">
          Reset to default
        </button>
      </div>

      <div className={sectionCls}>
        <div className={headCls}>
          Prompts <Pill>same for every column</Pill>
        </div>
        {data.prompts.map((prompt, i) => {
          const id = libId(prompt);
          return (
            <div key={i} className="flex gap-1 items-start mb-2">
              <span className="w-4 shrink-0 pt-1.5 text-xs text-gray-500 text-right">{i + 1}</span>
              <textarea
                value={prompt}
                onChange={e => p.setPrompts(data.prompts.map((x, j) => (j === i ? e.target.value : x)))}
                rows={3}
                className={classNames(inputCls, 'resize-y text-[13px]')}
                placeholder="Enter prompt"
              />
              <div className="flex flex-col">
                <button
                  title={id ? 'Saved in the prompt library (click to remove)' : 'Save to the prompt library'}
                  onClick={() => (id ? remove(id) : prompt.trim() && save(prompt))}
                  className={classNames('p-1 rounded hover:bg-gray-800', id ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400')}
                >
                  <Star className="w-4 h-4" fill={id ? 'currentColor' : 'none'} />
                </button>
                <button
                  title="Remove from this comparison"
                  onClick={() => p.setPrompts(data.prompts.filter((_, j) => j !== i))}
                  className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-gray-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
        <div className="flex gap-3 text-xs">
          <button onClick={() => p.setPrompts([...data.prompts, ''])} className="text-blue-400 hover:underline">
            + Add prompt
          </button>
          <button
            onClick={() =>
              openPromptLibrary(
                texts => p.setPrompts([...data.prompts.filter(x => x.trim() !== ''), ...texts.filter(t => !data.prompts.includes(t))]),
                data.prompts,
              )
            }
            className="text-blue-400 hover:underline"
          >
            ★ Prompt library…
          </button>
        </div>
      </div>

      <div className={sectionCls}>
        <div className={headCls}>
          ComfyUI <Pill blue>sent with every image</Pill>
        </div>
        <div className="flex items-center gap-2 text-xs mb-2.5">
          <span
            className={classNames('w-2 h-2 rounded-full', p.comfy?.ok ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,.6)]' : 'bg-red-500')}
          />
          <span className={p.comfy?.ok ? 'text-gray-300' : 'text-red-400'}>
            {p.comfy === null ? 'Checking…' : p.comfy.ok ? `Connected · ${p.comfy.url.replace(/^https?:\/\//, '')}` : p.comfy.error}
          </span>
        </div>
        <div className="mb-2.5">
          <label className={labelCls}>Workflow (API export)</label>
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
          {p.comfy?.workflowError && <div className="text-xs text-red-400 mt-1">{p.comfy.workflowError}</div>}
        </div>
        {p.comfy?.options && (
          <>
            {(['model', 'te', 'vae'] as const).map(field =>
              p.comfy?.options?.[field] ? (
                <div key={field} className="mb-2.5">
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
            <div className="text-[11px] text-gray-500 leading-relaxed">
              GPU split stays as the workflow sets it.
              {p.comfy.detected && (
                <>
                  {' '}
                  LoRA → {p.comfy.detected.lora}; prompt → {p.comfy.detected.positive ?? 'not found'}; sampler →{' '}
                  {p.comfy.detected.sampler}; size → {p.comfy.detected.latent ?? 'not found'}.
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className={sectionCls}>
        <div className={headCls}>
          Generation <Pill>locked across columns</Pill>
        </div>
        <div className="grid grid-cols-2 gap-2">
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
        <div className="mt-2">
          <label className={labelCls}>Negative prompt</label>
          <textarea value={s.neg} onChange={e => setSettings({ neg: e.target.value })} rows={2} placeholder="(none)" className={inputCls} />
        </div>
      </div>

      <div className={sectionCls}>
        <div className={headCls}>Generate</div>
        <label className={labelCls}>When generating</label>
        <select value={s.regen} onChange={e => setSettings({ regen: e.target.value as CompareSettings['regen'] })} className={inputCls}>
          <option value="missing">Only generate missing images</option>
          <option value="all">Regenerate everything</option>
        </select>
      </div>

      <div className={classNames(sectionCls, 'text-xs text-gray-400 leading-relaxed space-y-2')}>
        <div className={headCls}>How it works</div>
        <p>
          Columns are trainings; adding one loads <b className="text-amber-400 font-medium">every LoRA in its folder</b>. Drag a column header
          to reorder, ✕ removes it.
        </p>
        <p>
          Rows line up by step: each checkpoint goes into the closest row its training hasn't filled, so gaps stay empty. Click a row # for
          the row card; hover it and use ⋯ to <b className="text-amber-400 font-medium">clear</b> or{' '}
          <b className="text-amber-400 font-medium">remove</b> the row.
        </p>
        <p>
          Every image comes from ComfyUI using the picked workflow, with the settings above patched in. Settings are saved with the
          comparison; Save as default sets what new comparisons start with. ★ saves a prompt to the library, which New Job can use too.
        </p>
      </div>

      <div className="sticky bottom-0 mt-auto bg-gray-900 px-4 py-3 border-t border-gray-800">
        {p.pendingCount > 0 ? (
          <button
            onClick={p.onCancel}
            className="w-full py-2 rounded-md bg-gray-700 hover:bg-gray-600 text-sm inline-flex items-center justify-center gap-2"
          >
            <Loader2 className="w-4 h-4 animate-spin" /> Cancel ({p.pendingCount} queued)
          </button>
        ) : (
          <button
            onClick={p.onGenerate}
            disabled={p.generating || !p.comfy?.ok || !s.workflow}
            className="w-full py-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm"
          >
            {p.generating
              ? 'Queuing…'
              : s.regen === 'all'
                ? `Regenerate all (${p.totalCount})`
                : `Generate${p.missingCount ? ` (${p.missingCount} missing)` : ' — nothing missing'}`}
          </button>
        )}
        <div className="h-1.5 rounded bg-gray-700 overflow-hidden mt-2">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${p.progressPct}%` }} />
        </div>
        <div className="text-[11px] text-gray-400 mt-1 truncate">{p.progressText}</div>
      </div>
    </aside>
  );
}
