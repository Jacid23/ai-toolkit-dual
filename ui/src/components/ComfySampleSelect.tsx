'use client';

import { useEffect, useState } from 'react';
import { Checkbox, NumberInput, SelectInput, TextInput } from '@/components/formInputs';
import { openQuickSetting } from '@/components/QuickSettingModal';
import { apiClient } from '@/utils/api';
import { ComfySampleSettings } from '@/types';

// DUAL BUILD: on = this job's training samples render on ComfyUI (its own GPU) with the sample
// workflow tied to that ComfyUI in Settings; off = the internal sampler. Size, steps, guidance,
// seed and neg come from the Sample card; this adds the ComfyUI-only choices Compare has.
// The job picks its ComfyUI: Default (Settings → ComfyUI Address at sample time) or an exact one,
// named by its GPUs. Nothing here needs ComfyUI running: setting up a job isn't running it. When
// the picked ComfyUI is reachable its lists fill the dropdowns; when it isn't, names can be typed.
type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  settings?: ComfySampleSettings;
  onSettingsChange: (settings: ComfySampleSettings) => void;
  server?: string; // '' = Default, else the ComfyUI's address
  onServerChange: (server: string) => void;
};

type Servers = { main: string; later: string | null; labels?: { main: string; later: string | null } };

interface ComfyInfo {
  ok: boolean;
  url?: string;
  error?: string;
  workflowError?: string;
  values?: Record<string, any>;
  options?: Record<string, string[]>;
  workflows?: string[];
  tiedWorkflow?: string | null;
  servers?: Servers;
}

const FIELDS = [
  { key: 'model', label: 'Diffusion Model' },
  { key: 'te', label: 'Text Encoder' },
  { key: 'vae', label: 'VAE' },
  { key: 'sampler', label: 'ComfyUI Sampler' },
  { key: 'scheduler', label: 'Scheduler' },
] as const;

const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

export default function ComfySampleToggle({ checked, onChange, settings, onSettingsChange, server, onServerChange }: Props) {
  const [servers, setServers] = useState<Servers | null>(null);
  const [comfy, setComfy] = useState<ComfyInfo | null>(null);
  const [reload, setReload] = useState(0); // bumped after the workflow popup saves
  const s = settings ?? {};
  const pick = server ?? '';

  // the two ComfyUIs and their GPU names (works with neither running)
  useEffect(() => {
    apiClient
      .get('/api/compare/comfy', { params: { servers: 1 } })
      .then(r => r.data?.servers && setServers(r.data.servers))
      .catch(() => {});
  }, []);

  // the picked ComfyUI's workflow + lists; first ask for its tied workflow, then analyze it
  useEffect(() => {
    if (!checked) return;
    let live = true;
    setComfy(null);
    (async () => {
      try {
        const base = (await apiClient.get('/api/compare/comfy', { params: { server: pick } })).data as ComfyInfo;
        if (base.servers) setServers(base.servers);
        const wf = base.tiedWorkflow;
        const full = base.ok && wf ? ((await apiClient.get('/api/compare/comfy', { params: { server: pick, workflow: wf } })).data as ComfyInfo) : base;
        if (live) setComfy(full);
      } catch {
        if (live) setComfy({ ok: false, error: 'not reachable' });
      }
    })();
    return () => {
      live = false;
    };
  }, [checked, pick, reload]);

  const nameOf = (url: string | null | undefined) => {
    if (!url) return 'ComfyUI';
    const l = servers?.labels;
    return (url === servers?.main ? l?.main : url === servers?.later ? l?.later : null) ?? hostOf(url);
  };
  const resolved = !pick ? servers?.main : pick === 'later' ? servers?.later : pick === 'main' ? servers?.main : pick;
  const known = !pick || [servers?.main, servers?.later, 'main', 'later'].includes(pick);
  const workflow = comfy?.tiedWorkflow ?? null;
  const offline = comfy !== null && !comfy.ok;
  const set = (patch: ComfySampleSettings) => onSettingsChange({ ...s, ...patch });

  // the picked ComfyUI's own workflow setting, set in a popup so the job form stays put
  const workflowKey = resolved && resolved === servers?.main ? 'COMFY_SAMPLE_WORKFLOW' : resolved && resolved === servers?.later ? 'COMFY_LATER_WORKFLOW' : null;
  const setWorkflow = () => {
    if (!workflowKey || !resolved) return;
    const name = nameOf(resolved);
    openQuickSetting({
      title: `Sample workflow · ${name}`,
      settingKey: workflowKey,
      label: `Workflow for ${name} (${hostOf(resolved)})`,
      value: workflow ?? '',
      options: comfy?.ok && comfy.workflows ? comfy.workflows : undefined,
      placeholder: 'eg. AITK - 3090 workflow V3 api.json',
      help: comfy?.ok
        ? `Every job that samples on ${name} uses it (Settings shows the same value).`
        : `${name} isn't running, so its workflows can't be listed: type the file name from its workflows folder.`,
      onSaved: () => setReload(n => n + 1),
    });
  };
  const setLink = (label: string) =>
    workflowKey ? (
      <button type="button" onClick={setWorkflow} className="text-blue-400 hover:underline">
        {label}
      </button>
    ) : null;

  const serverOptions = [
    { value: '', label: `Default${servers?.main ? ` · ${nameOf(servers.main)} (${hostOf(servers.main)})` : ''}` },
    ...(servers?.main ? [{ value: servers.main, label: `${nameOf(servers.main)} (${hostOf(servers.main)})` }] : []),
    ...(servers?.later && servers.later !== servers.main
      ? [{ value: servers.later, label: `${nameOf(servers.later)} (${hostOf(servers.later)})` }]
      : []),
    ...(pick && !['', servers?.main, servers?.later].includes(pick)
      ? [{ value: pick, label: `${pick === 'main' || pick === 'later' ? nameOf(resolved) : hostOf(pick)}${known ? '' : ' (not in Settings)'}` }]
      : []),
  ];

  return (
    <div>
      <Checkbox label="Sample with ComfyUI" checked={checked} onChange={onChange} />
      {checked && (
        <>
          <SelectInput
            label="ComfyUI"
            className="pt-2 max-w-md"
            value={pick}
            onChange={v => onServerChange(v)}
            options={serverOptions}
          />
          <p className={`text-xs mt-1 ${comfy && (!known || (comfy.ok && (!workflow || comfy.workflowError))) ? 'text-amber-400' : 'text-gray-500'}`}>
            {!known ? (
              `${hostOf(pick)} isn't one of the ComfyUIs in Settings any more: this job's samples will be skipped until you pick another.`
            ) : comfy === null ? (
              'Checking…'
            ) : comfy.ok && !workflow ? (
              <>
                No sample workflow set for {nameOf(resolved)}. {setLink('Set workflow')}
              </>
            ) : comfy.workflowError ? (
              <>
                {workflow}: {comfy.workflowError} {setLink('Change workflow')}
              </>
            ) : offline ? (
              <>
                {workflow ? (
                  <>
                    Renders on {nameOf(resolved)} with <span className="text-gray-300">{workflow}</span> (
                    {setLink('change')}).{' '}
                  </>
                ) : (
                  <>No sample workflow set for {nameOf(resolved)} ({setLink('set workflow')}). </>
                )}
                {nameOf(resolved)} isn&apos;t running right now, which is fine until this job samples. If it isn&apos;t
                running then, those samples are skipped (regenerate them from the Samples tab). Type names below, or
                leave them on the workflow&apos;s own.
              </>
            ) : (
              <>
                Renders on {nameOf(resolved)} with <span className="text-gray-300">{workflow}</span> ({setLink('change')});
                training doesn&apos;t pause for samples. Size, steps, guidance, seed and negative prompt below are sent to
                ComfyUI.
              </>
            )}
          </p>
        </>
      )}
      {checked && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 pt-2">
          {FIELDS.map(({ key, label }) => {
            const opts = comfy?.options?.[key];
            const value = s[key] ?? '';
            if (!opts) {
              return (
                <TextInput
                  key={key}
                  label={label}
                  className="pt-2"
                  value={value}
                  onChange={v => set({ [key]: v.trim() || undefined })}
                  placeholder="Workflow's own"
                />
              );
            }
            const own = comfy?.values?.[key];
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
