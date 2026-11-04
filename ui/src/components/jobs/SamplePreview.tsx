'use client';

// DUAL BUILD: the Jobs explorer's sample preview. Hovering the row's image icon (or clicking it to
// pin) shows the job's latest sample set, one image per prompt at its newest sampled LoRA, from the
// 300px thumbnails. Fetched once per job and cached (a running job's again after a minute).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Images } from 'lucide-react';
import classNames from 'classnames';
import { apiClient } from '@/utils/api';
import { encodeFilePathForUrl } from '@/utils/basic';

export type LatestSamples = {
  step: number | null;
  final?: boolean;
  newerUnsampled?: boolean;
  samples: { idx: number; path: string; prompt: string }[];
};

const cache = new Map<string, { at: number; data: LatestSamples }>();

const fetchLatest = async (jobId: string, running: boolean): Promise<LatestSamples> => {
  const hit = cache.get(jobId);
  if (hit && (!running || Date.now() - hit.at < 60000)) return hit.data;
  const data = (await apiClient.get(`/api/jobs/${jobId}/latest_samples`)).data as LatestSamples;
  cache.set(jobId, { at: Date.now(), data });
  return data;
};

export default function SamplePreview({
  jobId,
  running,
  onOpenImage,
}: {
  jobId: string;
  running: boolean;
  onOpenImage: (path: string, set: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [data, setData] = useState<LatestSamples | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const place = () => {
    const r = iconRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 560;
    const left = Math.max(8, Math.min(r.right + 8, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(r.top - 40, window.innerHeight - 320));
    setPos({ left, top });
  };

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      place();
      setOpen(true);
      fetchLatest(jobId, running)
        .then(d => {
          setData(d);
          setError(null);
        })
        .catch(e => setError(e?.response?.data?.error || 'Could not load samples'));
    }, 120);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    if (pinned) return;
    timer.current = setTimeout(() => setOpen(false), 200);
  };

  // a pinned card closes on a click anywhere else
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (cardRef.current?.contains(t) || iconRef.current?.contains(t)) return;
      setPinned(false);
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pinned]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const paths = data?.samples.map(s => s.path) ?? [];

  return (
    <>
      <button
        ref={iconRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          if (pinned) {
            setPinned(false);
            setOpen(false);
          } else {
            setPinned(true);
            show();
          }
        }}
        title="Latest samples (click to pin)"
        className={classNames('p-0.5 rounded hover:text-blue-300', pinned ? 'text-blue-400' : 'text-gray-500')}
      >
        <Images className="w-4 h-4" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={cardRef}
            onMouseEnter={() => timer.current && clearTimeout(timer.current)}
            onMouseLeave={hide}
            style={{ left: pos.left, top: pos.top, width: 560 }}
            className="fixed z-50 rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-2xl"
          >
            {error ? (
              <div className="text-xs text-red-400">{error}</div>
            ) : !data ? (
              <div className="text-xs text-gray-500">Loading…</div>
            ) : data.step === null ? (
              <div className="text-xs text-gray-500">No samples yet</div>
            ) : (
              <>
                <div className="mb-2 text-xs text-gray-400">
                  Step {data.step.toLocaleString()}
                  {data.final ? ' · final LoRA' : ''}
                  {data.newerUnsampled ? <span className="text-amber-400"> · newer LoRAs not sampled</span> : null}
                </div>
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: `repeat(${Math.max(1, data.samples.length)}, minmax(0, 1fr))` }}
                >
                  {data.samples.map(s => (
                    <button
                      key={s.path}
                      type="button"
                      onClick={() => onOpenImage(s.path, paths)}
                      title={s.prompt ? s.prompt.slice(0, 300) : `Prompt ${s.idx + 1}`}
                      className="group text-left"
                    >
                      <img
                        src={`/api/img/${encodeFilePathForUrl(s.path)}?thumb=1`}
                        alt={`Prompt ${s.idx + 1}`}
                        className="aspect-square w-full rounded object-cover ring-1 ring-gray-700 group-hover:ring-blue-500"
                        loading="lazy"
                      />
                      <div className="mt-1 text-[11px] text-gray-500">Prompt {s.idx + 1}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
