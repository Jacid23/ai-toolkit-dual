import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import prisma from '@/server/prisma';
import { promptImagesDir, removePromptImage } from '@/server/promptLinks';

// DUAL BUILD: a prompt's own image in the Prompt Library (replaces its latest-sample thumbnail).
// POST form-data { id, file } sets / replaces it; DELETE ?id= goes back to the latest sample.
const EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const id = String(form.get('id') || '');
    const file = form.get('file') as File | null;
    if (!id || !file) return NextResponse.json({ error: 'id and file are required' }, { status: 400 });
    if (!(await prisma.savedPrompt.findUnique({ where: { id } })))
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    const ext = path.extname(file.name || '').toLowerCase();
    if (!EXTS.includes(ext)) return NextResponse.json({ error: 'Not an image file' }, { status: 400 });

    const dir = await promptImagesDir();
    await fs.promises.mkdir(dir, { recursive: true });
    await removePromptImage(id);
    const dest = path.join(dir, `${id}__${Date.now()}${ext}`);
    await fs.promises.writeFile(dest, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ path: dest });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await removePromptImage(id);
  return NextResponse.json({ ok: true });
}
