'use client';

import { useEffect, useState } from 'react';
import { Job } from '@prisma/client';
import { NumberInput, TextInput } from '@/components/formInputs';
import { getJobConfig } from '@/utils/jobs';
import { apiClient } from '@/utils/api';
import Card from '@/components/Card';

// DUAL BUILD: "edit on the fly" — queue a few light settings that the trainer
// applies at its next save point (see apply_pending_updates in BaseSDTrainProcess).
export default function JobLiveEdit({ job }: { job: Job }) {
  const p = getJobConfig(job).config.process[0];
  const curSchedule: number[] = (p.save?.save_schedule as number[]) || [];

  const [steps, setSteps] = useState<number | null>(p.train?.steps ?? null);
  const [lr, setLr] = useState<number | null>(p.train?.lr ?? null);
  const [sampleEvery, setSampleEvery] = useState<number | null>(p.sample?.sample_every ?? null);
  const [sampleSteps, setSampleSteps] = useState<number | null>(p.sample?.sample_steps ?? null);
  const [scheduleText, setScheduleText] = useState<string>(curSchedule.join(', '));

  const [pending, setPending] = useState<Record<string, any> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const running = job.status === 'running';

  const loadPending = () => {
    apiClient
      .get(`/api/jobs/${job.id}/queue_updates`)
      .then(r => setPending(r.data?.pending ? r.data.updates : null))
      .catch(() => {});
  };
  useEffect(loadPending, [job.id]);

  const parseSteps = (t: string) =>
    Array.from(
      new Set(
        t
          .split(/[\s,]+/)
          .map(x => parseInt(x, 10))
          .filter(n => !isNaN(n) && n > 0),
      ),
    ).sort((a, b) => a - b);

  const queue = async () => {
    setSaving(true);
    setMsg(null);
    const updates: Record<string, any> = {};
    if (steps != null) updates.steps = steps;
    if (lr != null) updates.lr = lr;
    if (sampleEvery != null) updates.sample_every = sampleEvery;
    if (sampleSteps != null) updates.sample_steps = sampleSteps;
    const sched = parseSteps(scheduleText);
    if (sched.length) updates.save_schedule = sched;
    try {
      const r = await apiClient.post(`/api/jobs/${job.id}/queue_updates`, updates);
      setMsg(`Queued: ${(r.data?.queued || []).join(', ')} — applies at the next save.`);
      loadPending();
    } catch (e: any) {
      setMsg(e?.response?.data?.error || 'Failed to queue changes');
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    await apiClient.delete(`/api/jobs/${job.id}/queue_updates`).catch(() => {});
    setMsg('Queued changes cancelled.');
    loadPending();
  };

  return (
    <div className="max-w-xl">
      <Card title="Edit on the fly">
        {!running && (
          <p className="text-amber-400 text-sm mb-2">
            This job isn’t running — queued changes apply at the next save point once it is.
          </p>
        )}
        {pending && (
          <div className="mb-3 text-sm bg-amber-900/30 border border-amber-700 rounded px-3 py-2 text-amber-200">
            Changes queued ({Object.keys(pending).join(', ')}) — will apply at the next save.
            <button type="button" onClick={cancel} className="ml-2 underline hover:text-white">
              cancel
            </button>
          </div>
        )}
        <p className="text-xs text-gray-500 mb-3">
          Light settings only — queued and applied at the next checkpoint. Rank, optimizer, model, batch and resolution
          need a stop-and-resume.
        </p>
        <NumberInput label="Total Steps" value={steps} onChange={v => setSteps(v)} min={1} />
        <NumberInput label="Learning Rate" className="pt-2" value={lr} onChange={v => setLr(v)} />
        <NumberInput label="Sample Every" className="pt-2" value={sampleEvery} onChange={v => setSampleEvery(v)} min={1} />
        <NumberInput
          label="Sample Steps"
          className="pt-2"
          value={sampleSteps}
          onChange={v => setSampleSteps(v)}
          min={1}
        />
        <div className="pt-2">
          <TextInput
            label="Save / Sample at steps"
            value={scheduleText}
            onChange={(v: string) => setScheduleText(v)}
            placeholder="eg. 500, 1000, 1500"
          />
        </div>
        <button
          type="button"
          onClick={queue}
          disabled={saving}
          className="mt-3 bg-green-700 hover:bg-green-600 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {saving ? 'Queuing…' : 'Queue for next save'}
        </button>
        {msg && <p className="text-xs text-gray-400 mt-2">{msg}</p>}
      </Card>
    </div>
  );
}
