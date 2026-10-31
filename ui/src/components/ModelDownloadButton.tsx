'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, CheckCircle2 } from 'lucide-react';
import { apiClient } from '@/utils/api';

// DUAL BUILD: under the model's Name or Path. If the files aitk loads for this model
// aren't in the models folder yet, one click downloads exactly those (the same itemized
// list as the model folder's download.bat).
type Status = {
  known: boolean;
  auto?: boolean;
  total?: number;
  missing?: number;
  missingBytes?: number;
  running?: boolean;
  progress?: string;
};

const gb = (n?: number) => `${((n || 0) / 1e9).toFixed(1)} GB`;
const isLocalPath = (p?: string | null) => !!p && (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\'));

export default function ModelDownloadButton({ arch, nameOrPath }: { arch: string; nameOrPath?: string | null }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!arch) return;
    apiClient
      .get('/api/models/download', { params: { arch } })
      .then(r => setStatus(r.data))
      .catch(() => setStatus(null));
  }, [arch]);

  useEffect(() => {
    setStatus(null);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [status?.running, refresh]);

  const start = async () => {
    setError(null);
    try {
      await apiClient.post('/api/models/download', { arch });
      refresh();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Download failed to start');
    }
  };

  if (!status?.known || isLocalPath(nameOrPath)) return null;

  if (status.running) {
    return (
      <div className="mt-2 text-xs text-gray-400">
        <div className="flex items-center gap-2 text-blue-300">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Downloading model files ({gb(status.missingBytes)} left)…
        </div>
        {status.progress && <div className="mt-1 font-mono text-[11px] text-gray-500 truncate">{status.progress}</div>}
      </div>
    );
  }

  if (!status.missing) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Model files are in the models folder ({gb(status.total)})
      </div>
    );
  }

  return (
    <div className="mt-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-amber-400">
          {status.missing} model file{status.missing === 1 ? '' : 's'} not downloaded ({gb(status.missingBytes)})
        </span>
        <button
          type="button"
          onClick={start}
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-700 hover:bg-blue-600 text-white"
        >
          <Download className="w-3.5 h-3.5" /> Download model
        </button>
      </div>
      {status.progress && <div className="mt-1 font-mono text-[11px] text-gray-500 truncate">{status.progress}</div>}
      {error && <div className="mt-1 text-rose-400">{error}</div>}
    </div>
  );
}
