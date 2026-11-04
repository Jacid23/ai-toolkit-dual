// DUAL BUILD: the Jobs explorer's rows, columns and search, kept apart from the component.
import { Job } from '@prisma/client';

export type JobFileInfo = {
  group: string;
  folderExists: boolean;
  loras: number;
  size: number;
  firstLora: number | null;
  lastLora: number | null;
  finalAt: number | null;
  ckptSize: number | null; // one LoRA's size (the newest checkpoint)
  hasSamples: boolean;
};

export type Row = {
  job: Job;
  proc: any;
  tags: string[];
  info: JobFileInfo | undefined;
  flat: [string, string][]; // every config value as [path, value], for search and custom columns
};

const flatten = (v: any, prefix: string, out: [string, string][]) => {
  if (v === null || v === undefined) return;
  if (Array.isArray(v)) {
    v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out));
  } else if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.push([prefix, String(v)]);
  }
};

export const toRow = (job: Job, info: JobFileInfo | undefined): Row => {
  let cfg: any = {};
  try {
    cfg = JSON.parse(job.job_config);
  } catch {}
  const proc = cfg?.config?.process?.[0] ?? {};
  const flat: [string, string][] = [];
  flatten(proc, '', flat);
  const tags = Array.isArray(cfg?.aitk_tags) ? cfg.aitk_tags.map(String) : [];
  return { job, proc, tags, info, flat };
};

const baseName = (p: string) =>
  (p || '')
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || '';
const stripExt = (n: string) => n.replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
// a decimal as written (0.0001, never 1e-4)
export const plain = (n: any) => {
  const x = Number(n);
  return isFinite(x) ? x.toFixed(12).replace(/\.?0+$/, '') : '';
};

export const fmtDate = (ms: number | null | undefined) => {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fmtSize = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b ? `${Math.round(b / 1e6)} MB` : '');

export const modelOf = (r: Row) => {
  const m = r.proc.model ?? {};
  const file = stripExt(baseName(m.name_or_path ?? ''));
  return [m.arch, file && file !== m.arch ? file : ''].filter(Boolean).join(' · ');
};
export const networkOf = (r: Row) => {
  const n = r.proc.network;
  if (!n?.type) return '';
  const type = n.type === 'lokr' ? 'LoKr' : n.type === 'lora' ? 'LoRA' : n.type;
  const dims = n.linear != null ? ` ${n.linear}/${n.linear_alpha ?? n.linear}` : '';
  return `${type}${dims}${n.type === 'lokr' && n.lokr_factor ? ` f${n.lokr_factor}` : ''}${n.lokr_full_rank ? ' full' : ''}`;
};
// the network split up: type, linear, alpha, full rank (LoKr), factor
export const netTypeOf = (r: Row) => {
  const t = r.proc.network?.type;
  return t === 'lokr' ? 'LoKr' : t === 'lora' ? 'LoRA' : (t ?? '');
};
export const numOrNull = (v: any) =>
  v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v);
// a setting a job doesn't have (older jobs, a LoRA's LoKr-only fields) counts as 0 / off, so it
// sorts and searches with the rest
export const num0 = (v: any) => numOrNull(v) ?? 0;
export const fullRankOf = (r: Row) =>
  r.proc.network?.type === 'lokr' && r.proc.network?.lokr_full_rank ? 'full' : 'no';
export const factorOf = (r: Row) => (r.proc.network?.type === 'lokr' ? num0(r.proc.network?.lokr_factor) : 0);
export const linearOf = (r: Row) => num0(r.proc.network?.linear);
export const alphaOf = (r: Row) => num0(r.proc.network?.linear_alpha);
export const lrNumOf = (r: Row) => num0(r.proc.train?.lr);
export const maxLrOf = (r: Row) => num0(r.proc.train?.optimizer_params?.max_lr);
export const stepTargetOf = (r: Row) => num0(r.proc.train?.optimizer_params?.step_target);
// 0 = off, else its setting
export const diffGuidanceOf = (r: Row) =>
  r.proc.train?.do_differential_guidance ? (numOrNull(r.proc.train?.differential_guidance_scale) ?? 3) : 0;
export const emaOf = (r: Row) =>
  r.proc.train?.ema_config?.use_ema ? (numOrNull(r.proc.train?.ema_config?.ema_decay) ?? 0.999) : 0;

export const lrOf = (r: Row) => {
  const t = r.proc.train ?? {};
  const max = t.optimizer_params?.max_lr;
  return `${plain(t.lr)}${max != null ? ` (max ${plain(max)})` : ''}`;
};
export const datasetOf = (r: Row) =>
  (r.proc.datasets ?? [])
    .map((d: any) => baseName(d.folder_path ?? ''))
    .filter(Boolean)
    .join(', ');
export const finishedOf = (r: Row) =>
  r.job.status === 'completed' ? (r.info?.finalAt ?? r.info?.lastLora ?? null) : null;
const ts = (d: any) => (d ? new Date(d).getTime() : null);
export const createdOf = (r: Row) => ts(r.job.created_at);
export const valueAt = (r: Row, path: string) =>
  r.flat
    .filter(([k]) => k === path || k.startsWith(path + '[') || k.startsWith(path + '.'))
    .map(([, v]) => v)
    .join(', ');

// --- search -------------------------------------------------------------------------------
// words all must match (name, group, status, tags, any config value); key:value narrows to a field
// (optimizer:automagic4, rank:32, model:raw, tag:best, group:lexi, trained:2026-10, after:2026-10-20)
type Token = { key: string | null; value: string };

export const parseSearch = (q: string): Token[] => {
  const out: Token[] = [];
  const re = /(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    if (m[1]) out.push({ key: m[1].toLowerCase(), value: m[2].toLowerCase() });
    else if (m[3]) out.push({ key: m[3].toLowerCase(), value: m[4].toLowerCase() });
    else out.push({ key: null, value: (m[5] ?? m[6]).toLowerCase() });
  }
  return out.filter(t => t.value);
};

const FIELDS: Record<string, (r: Row) => string[]> = {
  name: r => [r.job.name],
  group: r => [r.info?.group ?? ''],
  status: r => [r.job.status],
  tag: r => r.tags,
  tags: r => r.tags,
  model: r => [modelOf(r), r.proc.model?.name_or_path ?? ''],
  arch: r => [r.proc.model?.arch ?? ''],
  network: r => [networkOf(r), r.proc.network?.type ?? ''],
  type: r => [r.proc.network?.type ?? ''],
  optimizer: r => [r.proc.train?.optimizer ?? ''],
  opt: r => [r.proc.train?.optimizer ?? ''],
  lr: r => [plain(r.proc.train?.lr), plain(r.proc.train?.optimizer_params?.max_lr)],
  dataset: r => [datasetOf(r), ...(r.proc.datasets ?? []).map((d: any) => d.folder_path ?? '')],
  trigger: r => [r.proc.trigger_word ?? ''],
  timestep: r => [r.proc.train?.timestep_type ?? ''],
  dtype: r => [r.proc.train?.dtype ?? '', r.proc.save?.dtype ?? ''],
  prompt: r => (r.proc.sample?.samples ?? []).map((s: any) => s?.prompt ?? ''),
};
// numbers that should match exactly (rank:32 isn't 320)
const EXACT: Record<string, (r: Row) => any> = {
  rank: r => linearOf(r),
  linear: r => linearOf(r),
  alpha: r => alphaOf(r),
  factor: r => factorOf(r),
  maxlr: r => maxLrOf(r),
  max_lr: r => maxLrOf(r),
  steptarget: r => stepTargetOf(r),
  step_target: r => stepTargetOf(r),
  ema: r => emaOf(r),
  diff: r => diffGuidanceOf(r),
  guidance: r => diffGuidanceOf(r),
  steps: r => r.proc.train?.steps,
  batch: r => r.proc.train?.batch_size,
};
const lastTrainedOf = (r: Row) => r.info?.lastLora ?? null;

// the row matches every token; returns why (the first config field a word matched), or false
export const matchRow = (r: Row, tokens: Token[]): string | false => {
  let why = '';
  for (const { key, value } of tokens) {
    if (key) {
      if (key in EXACT) {
        if (String(EXACT[key](r) ?? '').toLowerCase() !== value) return false;
        continue;
      }
      if (key in FIELDS) {
        if (!FIELDS[key](r).some(v => v.toLowerCase().includes(value))) return false;
        continue;
      }
      if (key === 'created' || key === 'trained') {
        if (!fmtDate(key === 'created' ? createdOf(r) : lastTrainedOf(r)).startsWith(value)) return false;
        continue;
      }
      if (key === 'after' || key === 'before') {
        const t = Date.parse(value);
        const at = lastTrainedOf(r) ?? createdOf(r);
        if (!isFinite(t) || !at || (key === 'after' ? at < t : at > t)) return false;
        continue;
      }
      // any config field: its path ends in (or contains) the key, its value contains the value
      const hit = r.flat.find(([k, v]) => k.toLowerCase().includes(key) && v.toLowerCase().includes(value));
      if (!hit) return false;
      why ||= `${hit[0]} = ${hit[1]}`;
      continue;
    }
    if (
      r.job.name.toLowerCase().includes(value) ||
      (r.info?.group ?? '').toLowerCase().includes(value) ||
      r.job.status.toLowerCase().includes(value) ||
      r.tags.some(t => t.toLowerCase().includes(value))
    )
      continue;
    const hit = r.flat.find(([, v]) => v.toLowerCase().includes(value));
    if (!hit) return false;
    why ||= `${hit[0]} = ${hit[1].length > 80 ? hit[1].slice(0, 80) + '…' : hit[1]}`;
  }
  return why;
};

// --- groups tree --------------------------------------------------------------------------
export type GroupNode = { path: string; label: string; count: number; children: GroupNode[] };

export const buildTree = (rows: Row[]): GroupNode[] => {
  const root: GroupNode = { path: '', label: '', count: 0, children: [] };
  for (const r of rows) {
    const g = r.info?.group ?? '';
    const parts = g && !/^[a-zA-Z]:[\\/]|^[\\/]/.test(g) ? g.split('/') : g ? [g] : ['(Training Folder)'];
    let node = root;
    let at = '';
    for (const part of parts) {
      at = at ? `${at}/${part}` : part;
      let child = node.children.find(c => c.label === part);
      if (!child) {
        child = { path: at, label: part, count: 0, children: [] };
        node.children.push(child);
      }
      child.count += 1;
      node = child;
    }
  }
  const sort = (n: GroupNode) => {
    n.children.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
};

export const inGroup = (r: Row, group: string | null) => {
  if (group === null) return true;
  const g = r.info?.group || '(Training Folder)';
  return g === group || g.startsWith(group + '/');
};
