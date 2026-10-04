import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { getTextEncodersFolder } from '@/server/settings';

// DUAL BUILD: lists the custom text encoders in the Text Encoders folder
// (Settings) for the job page dropdown. An encoder is either an HF-format
// folder (config.json + weights) or a single .safetensors file.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isWeights = (f: string) => f.endsWith('.safetensors') || f.endsWith('.bin');

export async function GET() {
  const folder = await getTextEncodersFolder();
  const encoders: { name: string; path: string }[] = [];
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
        if (files.includes('config.json') && files.some(isWeights)) {
          encoders.push({ name: entry.name, path: full });
        }
      } else if (entry.isFile() && entry.name.endsWith('.safetensors')) {
        encoders.push({ name: entry.name, path: full });
      }
    }
  } catch {
    // folder missing -> empty list; the dropdown still offers the model default
  }
  encoders.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ folder, encoders }, { headers: { 'Cache-Control': 'no-store' } });
}
