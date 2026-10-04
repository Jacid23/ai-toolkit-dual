'use client';

import { useEffect, useState } from 'react';
import { SelectInput } from '@/components/formInputs';
import { apiClient } from '@/utils/api';

// DUAL BUILD: text encoder picker for the job page. "Default" leaves
// model_kwargs.text_encoder_path unset so the model loads the encoder bundled
// with it (<name_or_path>/text_encoder); the other entries are the custom
// encoders found in the Custom Text Encoders Folder (Settings).

// archs whose loader reads model_kwargs.text_encoder_path and falls back to the
// model's bundled encoder when it is unset
const TEXT_ENCODER_ARCHS = ['krea2'];

export const supportsTextEncoderSelect = (arch: string | undefined) =>
  !!arch && TEXT_ENCODER_ARCHS.some(a => arch === a || arch.startsWith(`${a}:`));

type Encoder = { name: string; path: string };

type Props = {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
};

export default function TextEncoderSelect({ value, onChange }: Props) {
  const [encoders, setEncoders] = useState<Encoder[]>([]);

  useEffect(() => {
    apiClient
      .get('/api/text_encoders')
      .then(res => setEncoders(res.data?.encoders ?? []))
      .catch(error => console.error('Error fetching text encoders:', error));
  }, []);

  const options = [
    { value: '', label: 'Default (encoder bundled with the model)' },
    ...encoders.map(e => ({ value: e.path, label: e.name })),
  ];
  // a path typed in the advanced editor (or from an older job) stays selectable
  if (value && !options.some(o => o.value === value)) {
    options.push({ value, label: value });
  }

  return (
    <SelectInput
      label="Text Encoder"
      value={value ?? ''}
      onChange={v => onChange(v === '' ? undefined : v)}
      options={options}
    />
  );
}
