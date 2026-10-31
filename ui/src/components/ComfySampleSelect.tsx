'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Checkbox, NumberInput, SelectInput } from '@/components/formInputs';
import { apiClient } from '@/utils/api';
import { ComfySampleSettings } from '@/types';

// DUAL BUILD: on = this job's training samples render on ComfyUI (its own GPU) with the
// default sample workflow from Settings; off = the internal sampler. Size, steps, guidance,
// seed and neg come from the Sample card; this adds the ComfyUI-only choices Compare has.
type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  settings?: ComfySampleSettings;
  onSettingsChange: (settings: ComfySampleSettings) => void;
};

interface ComfyInfo {
  ok: boolean;
  error?: string;
  workflowError?: string;
  values?: Record<string, any>;
  options?: Record<string, string[]>;
}

const FIELDS = [
  { key: 'model', label: 'Diffusion Model' },
  { key: 'te', label: 'Text Encoder' },
  { key: 'vae', label: 'VAE' },
  { key: 'sampler', label: 'ComfyUI Sampler' },
  { key: 'scheduler', label: 'Scheduler' },
] as const;

export default function ComfySampleToggle({ checked, onChange, settings, onSettingsChange }: Props) {
  const [workflow, setWorkflow] = useState<string>('');
  const [comfy, setComfy] = useState<ComfyInfo | null>(null);
  const s = settings ?? {};

  useEffect(() => {
    apiClient
      .get('/api/settings')
      .then(r => setWorkflow(r.data?.COMFY_SAMPLE_WORKFLOW || ''))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!checked) return;
    apiClient
      .get('/api/compare/comfy', { params: workflow ? { workflow } : {} })
      .then(r => setComfy(r.data))
      .catch(() => setComfy({ ok: false, error: 'ComfyUI not reachable' }));
  }, [checked, workflow]);

  const comfyError = comfy && !comfy.ok ? comfy.error || 'ComfyUI not reachable' : comfy?.workflowError || null;
  const set = (patch: ComfySampleSettings) => onSettingsChange({ ...s, ...patch });

  return (
    <div>
      <Checkbox label="Sample with ComfyUI" checked={checked} onChange={onChange} />
      {checked && (
        <p className={`text-xs mt-1 ${workflow && !comfyError ? 'text-gray-500' : 'text-amber-400'}`}>
          {!workflow ? (
            <>
              No default sample workflow set.{' '}
              <Link href="/settings" className="text-blue-400 hover:underline">
                Set one in Settings
              </Link>
            </>
          ) : comfyError ? (
            `${comfyError}. Start ComfyUI before training.`
          ) : (
            <>
              Renders on ComfyUI&apos;s GPU with <span className="text-gray-300">{workflow}</span>; training doesn&apos;t
              pause for samples. Size, steps, guidance, seed and negative prompt below are sent to ComfyUI.
            </>
          )}
        </p>
      )}
      {checked && workflow && comfy?.options && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 pt-2">
          {FIELDS.map(({ key, label }) => {
            const opts = comfy.options?.[key];
            if (!opts) return null;
            const value = s[key] ?? '';
            const own = comfy.values?.[key];
            const list = value && !opts.includes(value) ? [value, ...opts] : opts;
            return (
              <SelectInput
                key={key}
                label={label}
                className="pt-2"
                value={value}
                onChange={v => set({ [key]: v || undefined })}
                options={[
                  { value: '', label: own ? `Workflow's own (${own})` : "Workflow's own" },
                  ...list.map(o => ({ value: o, label: o })),
                ]}
              />
            );
          })}
          <NumberInput
            label="LoRA Strength"
            className="pt-2"
            value={s.strength ?? 1}
            onChange={v => set({ strength: v ?? undefined })}
            placeholder="eg. 1.0"
            allowEmpty
          />
        </div>
      )}
    </div>
  );
}
