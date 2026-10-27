// Compare page types and helpers shared by the page and the API routes (no server imports here).

export type CompareRun = { kind: 'job'; jobId: string; name: string } | { kind: 'folder'; folder: string; name: string };

export interface CompareSettings {
  workflow: string;
  model: string;
  te: string;
  vae: string;
  seed: number;
  steps: number;
  cfg: number;
  strength: number;
  sampler: string;
  scheduler: string;
  width: number;
  height: number;
  neg: string;
  regen: 'missing' | 'all';
}

export interface CompareData {
  runs: CompareRun[];
  prompts: string[];
  settings: CompareSettings;
  excluded: string[]; // LoRA file paths removed via "Remove row"
  order: 'asc' | 'desc';
  infoMode: 'head' | 'cell' | 'off';
  minSize: number;
}

export interface ScannedFile {
  path: string;
  file: string;
  step: number | null;
}

export interface ScannedRun {
  name: string;
  folder: string;
  files: ScannedFile[];
  cfg: Record<string, string | number | null> | null;
  cfgSource: 'job' | 'config.yaml' | 'none';
  error?: string;
}

export interface CompareCellRow {
  lora_path: string;
  prompt: string;
  status: 'pending' | 'done' | 'error';
  image_path: string | null;
  error: string | null;
  settings: string;
  updated_at: string;
}

export const DEFAULT_COMPARE_SETTINGS: CompareSettings = {
  workflow: '',
  model: '',
  te: '',
  vae: '',
  seed: 42,
  steps: 20,
  cfg: 1,
  strength: 1,
  sampler: '',
  scheduler: '',
  width: 1024,
  height: 1024,
  neg: '',
  regen: 'missing',
};

export const newCompareData = (settings?: Partial<CompareSettings>): CompareData => ({
  runs: [],
  prompts: [''],
  settings: { ...DEFAULT_COMPARE_SETTINGS, ...(settings ?? {}) },
  excluded: [],
  order: 'asc',
  infoMode: 'head',
  minSize: 160,
});

export const runKey = (r: CompareRun) => (r.kind === 'job' ? `job:${r.jobId}` : `folder:${r.folder}`);
export const cellKey = (loraPath: string, prompt: string) => `${loraPath}\u0000${prompt}`;

// Settings shown in the column headers when they differ between trainings
export const CFG_LABELS: Record<string, string> = {
  model: 'Model',
  quant: 'Quant',
  type: 'Network',
  linear: 'Linear rank',
  linear_alpha: 'Linear alpha',
  lokr_factor: 'LoKr factor',
  dtype: 'dtype',
  res: 'Resolutions',
  dataset: 'Dataset',
  optimizer: 'Optimizer',
  timestep_type: 'Timestep',
  style: 'Content/Style',
  lr: 'LR',
  total: 'Steps trained',
};

export interface AlignedRow {
  step: number;
  cells: (ScannedFile | null)[];
}

// Rows are a shared step timeline. Walk every checkpoint of every training in step order; each one
// joins the closest existing row within half the tightest save interval that this training hasn't
// filled yet, otherwise it starts a new row. Gaps stay empty. Files with no known step fall back
// to their position in the folder.
export function alignRows(lists: ScannedFile[][]): AlignedRow[] {
  if (!lists.length) return [];
  const withSteps = lists.map(files => {
    const known = files.filter(f => f.step !== null).map(f => f.step as number);
    let next = known.length ? Math.max(...known) : 0;
    return files.map(f => ({ f, s: f.step ?? ++next }));
  });
  const interval = (c: number[]) => {
    if (c.length < 2) return Infinity;
    const d = c
      .slice(1)
      .map((s, i) => s - c[i])
      .sort((a, b) => a - b);
    return d[Math.floor(d.length / 2)];
  };
  const tol = Math.min(...withSteps.map(c => interval(c.map(x => x.s)))) / 2;
  const entries = withSteps
    .flatMap((c, ri) => c.map(x => ({ ...x, ri })))
    .sort((a, b) => a.s - b.s || a.ri - b.ri);
  const rows: AlignedRow[] = [];
  for (const { f, s, ri } of entries) {
    let best: AlignedRow | null = null;
    for (let j = rows.length - 1; j >= 0 && rows[j].step >= s - tol; j--) {
      const r = rows[j];
      if (r.cells[ri] === null && (!best || Math.abs(r.step - s) < Math.abs(best.step - s))) best = r;
    }
    if (!best) {
      best = { step: s, cells: lists.map(() => null) };
      rows.push(best);
    }
    best.cells[ri] = f;
  }
  return rows;
}
