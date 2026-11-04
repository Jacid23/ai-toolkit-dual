'use client';
import { useEffect, useState } from 'react';
import { createGlobalState } from 'react-global-hooks';
import { Modal } from './Modal';
import { apiClient } from '@/utils/api';

// DUAL BUILD: set one Settings value in a small popup, without leaving the page (New Job's
// "Set workflow" / "Set token" links used to go to /settings and lose the form).
export type QuickSettingKey = 'HF_TOKEN' | 'COMFY_SAMPLE_WORKFLOW' | 'COMFY_LATER_WORKFLOW';

export interface QuickSetting {
  title: string;
  settingKey: QuickSettingKey;
  label: string;
  value?: string;
  help?: React.ReactNode;
  options?: string[]; // a dropdown when given, else a text field
  noneLabel?: string; // dropdown: the blank choice
  secret?: boolean;
  placeholder?: string;
  onSaved?: (value: string) => void;
}

const quickSettingState = createGlobalState<QuickSetting | null>(null);

export const openQuickSetting = (s: QuickSetting) => quickSettingState.set(s);

const fieldCls =
  'w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-slate-500';

export default function QuickSettingModal() {
  const [state, setState] = quickSettingState.use();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    setValue(state.value ?? '');
    setError(null);
  }, [state]);

  const close = () => setState(null);
  const save = async () => {
    if (!state) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient.patch('/api/settings', { [state.settingKey]: value });
      state.onSaved?.(value.trim());
      close();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const options = state?.options;
  const list = options && value && !options.includes(value) ? [value, ...options] : options;

  return (
    <Modal isOpen={state !== null} onClose={close} title={state?.title} size="md">
      <form
        onSubmit={e => {
          e.preventDefault();
          save();
        }}
        className="space-y-3"
      >
        <label className="block">
          <span className="block text-sm text-gray-300 mb-1">{state?.label}</span>
          {list ? (
            <select autoFocus value={value} onChange={e => setValue(e.target.value)} className={fieldCls}>
              <option value="">{state?.noneLabel ?? 'None'}</option>
              {list.map(o => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              type={state?.secret ? 'password' : 'text'}
              autoComplete="off"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={state?.placeholder}
              className={fieldCls}
            />
          )}
        </label>
        {state?.help && <div className="text-xs text-gray-500">{state.help}</div>}
        {error && <div className="text-sm text-red-400">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={close}
            className="rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-slate-600 hover:bg-slate-500 text-gray-100 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
