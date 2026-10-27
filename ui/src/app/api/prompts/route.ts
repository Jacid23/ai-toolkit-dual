import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';

// Prompt library: saved test prompts used by the Compare page and New Job sample prompts
export async function GET() {
  const prompts = await prisma.savedPrompt.findMany({ orderBy: { created_at: 'asc' } });
  return NextResponse.json({ prompts });
}

export async function POST(request: NextRequest) {
  try {
    const { name, text } = await request.json();
    if (!text || !String(text).trim()) return NextResponse.json({ error: 'Prompt text is empty' }, { status: 400 });
    const existing = await prisma.savedPrompt.findFirst({ where: { text } });
    if (existing) return NextResponse.json({ prompt: existing });
    const fallbackName = String(text).split(/[,.\n]/)[0].trim().slice(0, 40);
    const prompt = await prisma.savedPrompt.create({ data: { name: (name || fallbackName || 'Prompt').trim(), text } });
    return NextResponse.json({ prompt });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to save prompt' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  await prisma.savedPrompt.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
