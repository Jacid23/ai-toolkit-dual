'use client';

import { useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { apiClient } from '@/utils/api';

// DUAL BUILD: pick a local API-format workflow JSON and push it into ComfyUI's workflows
// folder (via /api/compare/comfy/import). onImported fires with the saved name so the
// caller can refresh its picker and select it.
export default function ComfyWorkflowImport({
  onImported,
  className,
}: {
  onImported?: (name: string) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked later
    if (!file) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const text = await file.text();
      const name = file.name.replace(/\.json$/i, '');
      const r = await apiClient.post('/api/compare/comfy/import', { name, workflow: text });
      if (r.data?.ok) {
        setMsg(`Imported as ${r.data.name}`);
        onImported?.(r.data.name);
      } else {
        setErr(r.data?.error || 'Import failed');
      }
    } catch (e: any) {
      setErr(e?.response?.data?.error || e?.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <input ref={inputRef} type="file" accept=".json,application/json" onChange={onFile} className="hidden" />
      <button
        type="button"
        onClick={() => {
          setErr(null);
          setMsg(null);
          inputRef.current?.click();
        }}
        disabled={busy}
        className="inline-flex items-center gap-1.5 text-xs rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200 px-2.5 py-1.5 disabled:opacity-50"
        title="Import an API-format workflow JSON (ComfyUI → File → Export (API))"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        Import API workflow
      </button>
      {msg && <p className="text-[11px] text-green-400 mt-1">{msg}</p>}
      {err && <p className="text-[11px] text-red-400 mt-1">{err}</p>}
    </div>
  );
}
