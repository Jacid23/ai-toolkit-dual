import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { getVaesFolder } from '@/server/settings';

// DUAL BUILD: lists VAEs in the VAE folder (Settings, default <models>/vae) for
// the job page's VAE dropdown. A VAE is either a single weights file or a
// diffusers-format folder (config.json + weights).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isVaeFile = (f: string) =>
  f.endsWith('.safetensors') || f.endsWith('.pth') || f.endsWith('.ckpt') || f.endsWith('.bin');

export async function GET() {
  const folder = await getVaesFolder();
  const vaes: { name: string; path: string }[] = [];
  try {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        let files: string[] = [];
        try {
          files = fs.readdirSync(full);
        } catch {
          continue;
        }
        if (files.includes('config.json') && files.some(isVaeFile)) vaes.push({ name: entry.name, path: full });
      } else if (entry.isFile() && isVaeFile(entry.name)) {
        vaes.push({ name: entry.name, path: full });
      }
    }
  } catch {
    // folder missing -> empty list; the dropdown still offers the model default
  }
  vaes.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ folder, vaes }, { headers: { 'Cache-Control': 'no-store' } });
}
