'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Modal } from '@/components/Modal';
import { TextInput, SelectInput, Checkbox, NumberInput } from '@/components/formInputs';
import { apiClient } from '@/utils/api';
import { LuLoader } from 'react-icons/lu';
import { FaRegTrashAlt } from 'react-icons/fa';

type Sex = 'auto' | 'man' | 'woman';
interface SubjectRow {
  dataset: string;
  trigger: string;
  sex: Sex;
  description: string;
}

interface SideBySideModalProps {
  isOpen: boolean;
  onClose: () => void;
  datasets: string[];
  onBuilt: () => void;
}

const SEX_OPTIONS = [
  { value: 'auto', label: 'From captions' },
  { value: 'man', label: 'Man' },
  { value: 'woman', label: 'Woman' },
];

// the server names the output folder the way /api/datasets/create does
const cleanName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const emptyRow = (): SubjectRow => ({ dataset: '', trigger: '', sex: 'auto', description: '' });

// Builds the "subject next to a stranger" dataset for multi-person DOP (scripts/build_dop_side_by_side.py).
export default function SideBySideModal({ isOpen, onClose, datasets, onBuilt }: SideBySideModalProps) {
  const [subjects, setSubjects] = useState<SubjectRow[]>([emptyRow(), emptyRow()]);
  const [output, setOutput] = useState('');
  const [sameSex, setSameSex] = useState(true);
  const [seed, setSeed] = useState<number | null>(42);
  const [captionExt, setCaptionExt] = useState('txt');
  const [exclude, setExclude] = useState('');
  const [building, setBuilding] = useState(false);
  const [log, setLog] = useState('');
  const [error, setError] = useState('');
  const [builtName, setBuiltName] = useState('');

  const datasetOptions = datasets.map(d => ({ value: d, label: d }));
  const updateRow = (i: number, patch: Partial<SubjectRow>) =>
    setSubjects(rows => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const build = async () => {
    setBuilding(true);
    setLog('');
    setError('');
    setBuiltName('');
    try {
      const res = await apiClient.post('/api/datasets/side_by_side', {
        subjects: subjects.filter(s => s.dataset),
        output,
        sameSex,
        seed,
        captionExt,
        exclude: exclude
          .split(/[,\n]/)
          .map(s => s.trim())
          .filter(Boolean),
      });
      setLog(res.data.log);
      setBuiltName(res.data.name);
      onBuilt();
    } catch (err: any) {
      const data = err?.response?.data;
      setLog(data?.log ?? '');
      setError(data?.error ?? err?.message ?? 'Build failed');
    } finally {
      setBuilding(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => !building && onClose()} title="Build Side-by-Side Dataset" size="xl">
      <div className="space-y-4 text-gray-200">
        <div className="text-sm text-gray-400">
          Puts each person's photos next to a stranger (16 pictures per person), captioned stranger first, trigger
          second: "The left portrait is of a Latino woman in her 40s. The right portrait is of l3xi, a Caucasian
          woman in her 40s." Description is what follows the trigger. Train the result as one more dataset with DOP
          on and every trigger in DOP Subjects.
        </div>

        <div className="space-y-2">
          {subjects.map((row, i) => (
            <div key={i} className="flex items-end gap-2">
              <SelectInput
                className="flex-1 min-w-0"
                label={i === 0 ? 'Person dataset' : undefined}
                value={row.dataset}
                options={datasetOptions}
                onChange={value => updateRow(i, { dataset: value })}
              />
              <TextInput
                className="w-32"
                label={i === 0 ? 'Trigger' : undefined}
                value={row.trigger}
                placeholder="l3xi"
                onChange={value => updateRow(i, { trigger: value })}
              />
              <TextInput
                className="w-56"
                label={i === 0 ? 'Description' : undefined}
                value={row.description}
                placeholder="a Caucasian woman in her 40s"
                onChange={value => updateRow(i, { description: value })}
              />
              <SelectInput
                className="w-36"
                label={i === 0 ? 'Sex' : undefined}
                value={row.sex}
                options={SEX_OPTIONS}
                disabled={!sameSex}
                onChange={value => updateRow(i, { sex: value as Sex })}
              />
              <button
                type="button"
                className="text-gray-300 hover:bg-red-600 p-2 rounded-full transition-colors disabled:opacity-30"
                disabled={subjects.length <= 1}
                onClick={() => setSubjects(rows => rows.filter((_, k) => k !== i))}
              >
                <FaRegTrashAlt />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-sm text-blue-400 hover:text-blue-300"
            onClick={() => setSubjects(rows => [...rows, emptyRow()])}
          >
            + Add person
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TextInput
            className="sm:col-span-2"
            label="Output dataset"
            value={output}
            placeholder="us_side_by_side"
            onChange={setOutput}
          />
          <NumberInput label="Seed" value={seed} onChange={setSeed} />
        </div>
        {datasets.includes(cleanName(output)) && (
          <div className="text-xs text-yellow-400">
            {cleanName(output)} already exists: its side_by_side_ pictures get replaced. Don't rebuild a dataset a running
            job is training on.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TextInput
            className="sm:col-span-2"
            label="Leave out photos (file names, comma separated)"
            value={exclude}
            placeholder="j@cid (19).jpg, LX05.png"
            onChange={setExclude}
          />
          <TextInput label="Caption ext" value={captionExt} onChange={setCaptionExt} />
        </div>
        <Checkbox
          label="Pair each person with strangers of the same sex"
          checked={sameSex}
          onChange={setSameSex}
        />

        {(log || error) && (
          <pre className="max-h-48 overflow-auto rounded bg-gray-950 p-2 text-xs text-gray-300 whitespace-pre-wrap">
            {log}
            {error && <span className="text-red-400">{error}</span>}
          </pre>
        )}
        {builtName && (
          <div className="text-sm text-green-400">
            Built.{' '}
            <Link href={`/datasets/${builtName}`} className="underline">
              Open {builtName}
            </Link>{' '}
            to check the picks; rebuild with a photo left out if a crop is wrong (side_by_side_sources.json says which
            photo each picture used).
          </div>
        )}

        <div className="flex justify-end space-x-3">
          <button
            type="button"
            className="rounded-md bg-gray-700 px-4 py-2 text-gray-200 hover:bg-gray-600 disabled:opacity-50"
            disabled={building}
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-2"
            disabled={building || !output.trim() || !subjects.some(s => s.dataset && s.trigger.trim())}
            onClick={build}
          >
            {building && <LuLoader className="w-4 h-4 animate-spin" />}
            {building ? 'Building...' : 'Build'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
