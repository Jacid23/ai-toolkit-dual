'use client';

import { useState } from 'react';
import { Job } from '@prisma/client';
import { getJobConfig } from '@/utils/jobs';
import { apiClient } from '@/utils/api';
import SimpleJob from '@/app/jobs/new/SimpleJob';
import { useNestedState } from '@/utils/hooks';
import useGPUInfo from '@/hooks/useGPUInfo';
import { objectCopy } from '@/utils/basic';
import { migrateJobConfig } from '@/app/jobs/new/jobConfig';
import { JobConfig } from '@/types';

// DUAL BUILD: Live Edit = the real New Job form, editable in place. Sections that
// can't change on a running job are marked with a red border (SimpleJob liveEdit);
// "Queue for next save" collects the live-editable fields and sends them to the
// trainer to apply at the next checkpoint.
export default function JobLiveEdit({ job }: { job: Job }) {
  const { gpuList } = useGPUInfo();
  const [formConfig, setFormConfig] = useNestedState<JobConfig>(
    objectCopy(migrateJobConfig(getJobConfig(job) as JobConfig)),
  );
  const datasetOptions = ((getJobConfig(job).config.process[0].datasets as any[]) || []).map((d: any) => ({
    value: d.folder_path,
    label: (d.folder_path || '').split(/[/\\]/).filter(Boolean).pop() || d.folder_path,
  }));
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const queue = async () => {
    setSaving(true);
    setMsg(null);
    const p: any = formConfig.config.process[0];
    const n = (v: any) => (v === '' || v == null ? undefined : Number(v));
    const updates: Record<string, any> = {};
    if (n(p.train?.steps) != null) updates.steps = n(p.train?.steps);
    if (n(p.train?.lr) != null) updates.lr = n(p.train?.lr);
    if (n(p.sample?.sample_every) != null) updates.sample_every = n(p.sample?.sample_every);
    if (n(p.sample?.sample_steps) != null) updates.sample_steps = n(p.sample?.sample_steps);
    if (n(p.sample?.guidance_scale) != null) updates.guidance_scale = n(p.sample?.guidance_scale);
    if (n(p.sample?.width) != null) updates.sample_width = n(p.sample?.width);
    if (n(p.sample?.height) != null) updates.sample_height = n(p.sample?.height);
    if (n(p.sample?.seed) != null) updates.sample_seed = n(p.sample?.seed);
    if (p.sample?.sampler) updates.sampler = p.sample.sampler;
    const prompts = ((p.sample?.samples as any[]) || []).map(s => s?.prompt).filter(Boolean);
    if (prompts.length) updates.sample_prompts = prompts;
    if (n(p.save?.save_every) != null) updates.save_every = n(p.save?.save_every);
    if (n(p.save?.save_start_step) != null) updates.save_start_step = n(p.save?.save_start_step);
    if (n(p.save?.max_step_saves_to_keep) != null) updates.max_step_saves_to_keep = n(p.save?.max_step_saves_to_keep);
    const sched = (p.save?.save_schedule as number[]) || [];
    if (sched.length) updates.save_schedule = sched;
    try {
      const r = await apiClient.post(`/api/jobs/${job.id}/queue_updates`, updates);
      setMsg(`Queued ${(r.data?.queued || []).length} change(s) — applies at the next save.`);
    } catch (e: any) {
      setMsg(e?.response?.data?.error || 'Failed to queue changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button
          type="button"
          onClick={queue}
          disabled={saving}
          className="bg-green-700 hover:bg-green-600 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Queuing…' : 'Queue for next save'}
        </button>
        <span className="text-xs text-gray-400">
          Edit the job below. Anything in a <span className="text-red-400">red-bordered</span> section can’t change on a
          running job (it’s ignored). Everything else is queued and applied at the next checkpoint.
        </span>
        {msg && <span className="text-xs text-gray-200">{msg}</span>}
      </div>
      <SimpleJob
        liveEdit
        jobConfig={formConfig}
        setJobConfig={setFormConfig}
        status="idle"
        handleSubmit={e => e.preventDefault()}
        runId={job.id}
        gpuIDs={job.gpu_ids ?? null}
        setGpuIDs={() => {}}
        gpuList={gpuList}
        datasetOptions={datasetOptions}
        isLoading={false}
      />
    </div>
  );
}
