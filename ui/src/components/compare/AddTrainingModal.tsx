'use client';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { apiClient } from '@/utils/api';
import { CompareRun, runKey } from '@/utils/compare';

interface JobRow {
  id: string;
  name: string;
  status: string;
  folder: string;
  count: number;
  cfg: Record<string, any> | null;
}

// pick AITK trainings (or any folder of LoRAs); every LoRA in the folder is loaded
export default function AddTrainingModal({
  open,
  existing,
  onClose,
  onAdd,
}: {
  open: boolean;
  existing: CompareRun[];
  onClose: () => void;
  onAdd: (runs: CompareRun[]) => void;
}) {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setFolder('');
    setSearch('');
    apiClient
      .get('/api/compare/jobs')
      .then(res => setJobs(res.data.jobs))
      .catch(() => setJobs([]));
  }, [open]);

  const used = new Set(existing.map(runKey));
  const shown = (jobs ?? []).filter(j => !search || j.name.toLowerCase().includes(search.toLowerCase()));

  const add = () => {
    const runs: CompareRun[] = (jobs ?? [])
      .filter(j => selected.has(j.id))
      .map(j => ({ kind: 'job', jobId: j.id, name: j.name }));
    const f = folder.trim().replace(/^"|"$/g, '');
    if (f) runs.push({ kind: 'folder', folder: f, name: f.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || f });
    onAdd(runs.filter(r => !used.has(runKey(r))));
    onClose();
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Add trainings" size="lg">
      <p className="text-sm text-gray-400 mb-3">
        Every LoRA in the training's folder is loaded. Steps are read from inside each file, so renamed and audited
        copies work too.
      </p>
      <div className="text-xs uppercase tracking-wider text-gray-400 mb-1.5">AITK trainings</div>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search trainings…"
        className="w-full px-3 py-2 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-gray-600 focus:border-transparent"
      />
      <div className="max-h-[40vh] overflow-y-auto border border-gray-700 rounded-lg divide-y divide-gray-700">
        {jobs === null && <div className="p-4 text-sm text-gray-500">Loading…</div>}
        {jobs !== null && shown.length === 0 && <div className="p-4 text-sm text-gray-500">No trainings found.</div>}
        {shown.map(j => {
          const inUse = used.has(`job:${j.id}`);
          return (
            <label key={j.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-800 cursor-pointer">
              <input
                type="checkbox"
                disabled={inUse || j.count === 0}
                checked={inUse || selected.has(j.id)}
                onChange={e => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(j.id);
                  else next.delete(j.id);
                  setSelected(next);
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-200 truncate">{j.name}</div>
                {j.cfg && (
                  <div className="text-xs text-gray-400 truncate">
                    {j.cfg.model} · {j.cfg.type} r{j.cfg.linear}/{j.cfg.linear_alpha} f{j.cfg.lokr_factor} · {j.cfg.dataset}
                  </div>
                )}
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap" title={j.count ? j.folder : 'No LoRAs found in its folder: if you moved them, add that folder below'}>
                {j.count ? `${j.count} LoRA${j.count === 1 ? '' : 's'}` : 'no LoRAs found'} · {j.status}
              </span>
            </label>
          );
        })}
      </div>
      <div className="text-xs uppercase tracking-wider text-gray-400 mt-4 mb-1.5">Or any folder of LoRAs</div>
      <input
        value={folder}
        onChange={e => setFolder(e.target.value)}
        placeholder="e.g. S:\ComfyUI\models\loras\Krea2\My_Krea2\US_v1 - FTLK-3232.4.16"
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-gray-600 focus:border-transparent"
      />
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">
          Cancel
        </button>
        <button
          type="button"
          disabled={selected.size === 0 && !folder.trim()}
          onClick={add}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-sm text-white"
        >
          Add
        </button>
      </div>
    </Modal>
  );
}
