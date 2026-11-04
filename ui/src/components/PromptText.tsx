'use client';

import { escapeRe, triggerOf } from '@/utils/prompts';

// DUAL BUILD: prompt text with its trigger word picked out, and an optional search term marked
export default function PromptText({ text, highlight }: { text: string; highlight?: string }) {
  const trigger = triggerOf(text);
  const terms = [trigger, highlight].filter(Boolean) as string[];
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) =>
        trigger && part.toLowerCase() === trigger.toLowerCase() ? (
          <span key={i} className="rounded bg-slate-700/70 text-slate-100 px-1 font-medium">
            {part}
          </span>
        ) : highlight && part.toLowerCase() === highlight.toLowerCase() ? (
          <mark key={i} className="bg-amber-500/30 text-amber-100 rounded px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
