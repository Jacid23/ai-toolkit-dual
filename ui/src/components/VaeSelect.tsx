'use client';

import { useEffect, useState } from 'react';
import { SelectInput } from '@/components/formInputs';
import { apiClient } from '@/utils/api';

// DUAL BUILD: VAE picker for the job page. "Default" leaves model_kwargs.vae_path
// unset so the model loads the VAE bundled with it; the other entries are the VAEs
// found in the VAE folder (Settings, default <models>/vae).

// archs whose loader reads model_kwargs.vae_path and falls back to the model's
// bundled VAE when it is unset / invalid
const VAE_ARCHS = ['krea2'];

export const supportsVaeSelect = (arch: string | undefined) =>
  !!arch && VAE_ARCHS.some(a => arch === a || arch.startsWith(`${a}:`));

type Vae = { name: string; path: string };

type Props = {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
};

export default function VaeSelect({ value, onChange }: Props) {
  const [vaes, setVaes] = useState<Vae[]>([]);

  useEffect(() => {
    apiClient
      .get('/api/vaes')
      .then(res => setVaes(res.data?.vaes ?? []))
      .catch(error => console.error('Error fetching vaes:', error));
  }, []);

  const options = [
    { value: '', label: 'Default (VAE bundled with the model)' },
    ...vaes.map(v => ({ value: v.path, label: v.name })),
  ];
  // a path typed in the advanced editor (or from an older job) stays selectable
  if (value && !options.some(o => o.value === value)) {
    options.push({ value, label: value });
  }

  return (
    <SelectInput
      label="VAE"
      value={value ?? ''}
      onChange={v => onChange(v === '' ? undefined : v)}
      options={options}
    />
  );
}
