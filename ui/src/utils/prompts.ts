// DUAL BUILD: shared by the Prompt Library page and the library popup.

export type PromptSample = { path: string; jobId: string; jobName: string; step: number; jobs: number };
export type PromptOverview = {
  links: { dataset: string; group: string }[];
  samples: Record<string, PromptSample>;
  images?: Record<string, string>; // prompt id -> the image uploaded for it (shown instead of its sample)
};

export const UNGROUPED = '';
export const groupLabel = (g: string) => (g === UNGROUPED ? 'Ungrouped' : g);

// same key api/prompts/overview uses for its samples map
export const normalizePrompt = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();

// the trigger word is the prompt's leading single-word token ("jac1d, 6' tall…")
export const triggerOf = (text: string) => {
  const m = text.match(/^\s*([^\s,.;:]{2,24})\s*[,.;:]/);
  return m ? m[1] : '';
};

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// groups A–Z with Ungrouped last
export const sortGroupNames = (names: string[]) =>
  [...names].sort((a, b) =>
    a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );

// the group the library page / popup last showed
export const loadSelectedGroup = () => {
  try {
    return localStorage.getItem('prompts.group');
  } catch {
    return null;
  }
};
export const storeSelectedGroup = (g: string) => {
  try {
    localStorage.setItem('prompts.group', g);
  } catch {}
};
