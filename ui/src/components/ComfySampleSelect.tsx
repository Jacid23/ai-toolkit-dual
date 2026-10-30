'use client';

import { useEffect, useState } from 'react';
import { SelectInput } from '@/components/formInputs';
import { apiClient } from '@/utils/api';

// DUAL BUILD: pick a ComfyUI workflow to render this job's training samples on
// ComfyUI (its own GPU) instead of the internal sampler. "" = internal sampler.
type Props = {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
};

export default function ComfySampleSelect({ value, onChange }: Props) {
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get('/api/compare/comfy')
      .then(r => {
        if (r.data?.ok) {
          setWorkflows(r.data.workflows ?? []);
          setStatus(null);
        } else {
          setStatus(r.data?.error || 'ComfyUI not reachable');
        }
      })
      .catch(() => setStatus('ComfyUI not reachable'));
  }, []);

  const options = [{ value: '', label: 'Internal sampler (default)' }, ...workflows.map(w => ({ value: w, label: w }))];
  if (value && !workflows.includes(value)) options.push({ value, label: value });

  return (
    <div>
      <SelectInput
        label="Sample with ComfyUI"
        value={value ?? ''}
        onChange={v => onChange(v === '' ? undefined : v)}
        options={options}
      />
      {value ? (
        <p className="text-xs text-gray-500 mt-1">
          Samples render on ComfyUI (its own GPU), non-blocking — the training cards don’t spike for sampling. Needs an
          API-format workflow; its LoRA + prompts are swapped in per sample.
        </p>
      ) : status ? (
        <p className="text-xs text-amber-400 mt-1">{status} — launch ComfyUI to use it for samples.</p>
      ) : null}
    </div>
  );
}
