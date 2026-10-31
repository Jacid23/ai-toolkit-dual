'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/utils/api';

// DUAL BUILD: a job's sample regen queue (api/jobs/[jobID]/comfy_regen). Polls fast while
// something is queued or rendering, slowly otherwise; `version` bumps on every saved image.
export type RegenSlot = { step: number; idx: number };
export type RegenQueueStatus = {
  running: boolean;
  current: { step: number; indices: number[]; done: number[] } | null;
  pending: RegenSlot[];
  errors: string[];
  version: number;
  missing: RegenSlot[];
  checkpointSteps: number[];
  promptCount: number;
};
export type SlotState = 'queued' | 'rendering' | null;

export default function useRegenQueue(jobId: string | undefined) {
  const [status, setStatus] = useState<RegenQueueStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!jobId) return null;
    try {
      const res = await apiClient.get(`/api/jobs/${jobId}/comfy_regen`);
      setStatus(res.data);
      return res.data as RegenQueueStatus;
    } catch {
      return null;
    }
  }, [jobId]);

  const active = !!status && (status.running || status.pending.length > 0);
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      await refresh();
      if (!stop) timer.current = window.setTimeout(tick, active ? 2500 : 15000);
    };
    timer.current = window.setTimeout(tick, active ? 2500 : 0);
    return () => {
      stop = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [jobId, active, refresh]);

  const enqueue = useCallback(
    async (body: { items: RegenSlot[] } | { step: number }) => {
      if (!jobId) return;
      setError(null);
      try {
        const res = await apiClient.post(`/api/jobs/${jobId}/comfy_regen`, body);
        setStatus(prev => (prev ? { ...prev, ...res.data } : prev));
      } catch (e: any) {
        setError(e?.response?.data?.error ?? e?.message ?? String(e));
      }
      refresh();
    },
    [jobId, refresh],
  );

  const clear = useCallback(async () => {
    if (!jobId) return;
    await apiClient.delete(`/api/jobs/${jobId}/comfy_regen`).catch(() => {});
    setError(null);
    refresh();
  }, [jobId, refresh]);

  const slotState = useCallback(
    (step: number, idx: number): SlotState => {
      if (!status) return null;
      const c = status.current;
      if (c && c.step === step && c.indices.includes(idx) && !c.done.includes(idx)) return 'rendering';
      if (status.pending.some(p => p.step === step && p.idx === idx)) return 'queued';
      return null;
    },
    [status],
  );

  return { status, active, error, enqueue, clear, refresh, slotState };
}
