'use client';

import { useEffect, useRef, useState } from 'react';

// DUAL BUILD: the New Job / Edit Job form keeps a draft in this browser while it has unsaved
// changes, offers it back when the form is opened again, and asks before an in-app link or a
// reload leaves the page. The draft goes once the job is saved (or the draft is discarded).

export interface JobDraft {
  config: any;
  gpuIDs: string | null;
  savedAt: number;
}

const PREFIX = 'aitk-job-draft:';

const readDraft = (key: string): JobDraft | null => {
  try {
    const s = localStorage.getItem(PREFIX + key);
    return s ? (JSON.parse(s) as JobDraft) : null;
  } catch {
    return null;
  }
};
const writeDraft = (key: string, d: JobDraft) => {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(d));
  } catch {}
};
const removeDraft = (key: string) => {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {}
};

const LEAVE_MSG = 'Leave this job form? Your changes are kept as a draft and offered back when you open it again.';

export default function useJobDraft({
  key,
  ready,
  config,
  gpuIDs,
}: {
  key: string; // 'new', 'edit:<id>' or 'clone:<id>'
  ready: boolean; // the form has finished loading (defaults applied / the job fetched)
  config: any;
  gpuIDs: string | null;
}) {
  const snap = JSON.stringify({ config, gpuIDs });
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const [baseline, setBaseline] = useState<string | null>(null);
  const [offer, setOffer] = useState<JobDraft | null>(null);
  const [saved, setSaved] = useState(false);

  // the loaded form is the baseline (after load-time effects settle); offer an older draft
  useEffect(() => {
    if (!ready || baseline !== null) return;
    const t = setTimeout(() => {
      const base = snapRef.current;
      setBaseline(base);
      const d = readDraft(key);
      if (d && JSON.stringify({ config: d.config, gpuIDs: d.gpuIDs }) !== base) setOffer(d);
      else if (d) removeDraft(key);
    }, 600);
    return () => clearTimeout(t);
  }, [ready, baseline, key]);

  const dirty = baseline !== null && !saved && snap !== baseline;

  // keep the draft current; editing while a draft is offered means starting fresh
  useEffect(() => {
    if (baseline === null || saved) return;
    if (offer && dirty) setOffer(null);
    if (offer) return;
    const t = setTimeout(() => {
      if (dirty) writeDraft(key, { config, gpuIDs, savedAt: Date.now() });
      else removeDraft(key);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, baseline, saved, offer]);

  // ask before leaving with unsaved changes: reload / close, and in-app links (sidebar etc.)
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname + url.search === location.pathname + location.search) return;
      if (!confirm(LEAVE_MSG)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('click', onClick, true); // capture: before Next's <Link> navigates
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  return {
    dirty,
    offer, // an older unsaved draft for this form, until restored or discarded
    restore: () => {
      const d = offer;
      setOffer(null);
      return d;
    },
    discard: () => {
      removeDraft(key);
      setOffer(null);
    },
    // the job was saved: drop the draft and stop asking before leaving
    clear: () => {
      removeDraft(key);
      setOffer(null);
      setSaved(true);
    },
  };
}
