import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';

// Prompt library: saved test prompts used by the Compare page, the New Job sample
// prompts, and the dedicated /prompts manager. Prompts carry an optional group.
export async function GET() {
  const prompts = await prisma.savedPrompt.findMany({ orderBy: { created_at: 'asc' } });
  return NextResponse.json({ prompts });
}

export async function POST(request: NextRequest) {
  try {
    const { name, text, group } = await request.json();
    if (!text || !String(text).trim()) return NextResponse.json({ error: 'Prompt text is empty' }, { status: 400 });
    const existing = await prisma.savedPrompt.findFirst({ where: { text } });
    if (existing) return NextResponse.json({ prompt: existing });
    const fallbackName = String(text).split(/[,.\n]/)[0].trim().slice(0, 40);
    const prompt = await prisma.savedPrompt.create({
      data: { name: (name || fallbackName || 'Prompt').trim(), text, group: (group || '').trim() } as any,
    });
    return NextResponse.json({ prompt });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to save prompt' }, { status: 500 });
  }
}

// Edit a saved prompt: rename, change text, or move to another group.
export async function PATCH(request: NextRequest) {
  try {
    const { id, name, text, group } = await request.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const data: Record<string, any> = {};
    if (typeof name === 'string') data.name = name.trim() || 'Prompt';
    if (typeof text === 'string') {
      if (!text.trim()) return NextResponse.json({ error: 'Prompt text is empty' }, { status: 400 });
      data.text = text;
    }
    if (typeof group === 'string') data.group = group.trim();
    const prompt = await prisma.savedPrompt.update({ where: { id }, data: data as any });
    return NextResponse.json({ prompt });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to update prompt' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  await prisma.savedPrompt.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
