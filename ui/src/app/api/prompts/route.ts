import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import { promptOrderBy, relinkDatasets } from '@/server/promptLinks';

// Prompt library: saved test prompts used by the Compare page, the New Job sample
// prompts, and the dedicated /prompts manager. Prompts carry an optional group and a
// sort_order within it (a group's order is the order New Job loads them as sample slots).
export async function GET() {
  const prompts = await prisma.savedPrompt.findMany({ orderBy: promptOrderBy });
  return NextResponse.json({ prompts });
}

const nextOrder = async (group: string) => {
  const last: any = await prisma.savedPrompt.findFirst({ where: { group } as any, orderBy: { sort_order: 'desc' } as any });
  return (last?.sort_order ?? -1) + 1;
};

export async function POST(request: NextRequest) {
  try {
    const { name, text, group } = await request.json();
    if (!text || !String(text).trim()) return NextResponse.json({ error: 'Prompt text is empty' }, { status: 400 });
    const g = String(group || '').trim();
    // the same text is the same prompt (Compare's ★ saves ungrouped); a named group can hold
    // its own copy of a prompt that already lives in another group
    const existing = await prisma.savedPrompt.findFirst({ where: (g ? { text, group: g } : { text }) as any });
    if (existing) return NextResponse.json({ prompt: existing });
    const fallbackName = String(text).split(/[,.\n]/)[0].trim().slice(0, 40);
    const prompt = await prisma.savedPrompt.create({
      data: { name: (name || fallbackName || 'Prompt').trim(), text, group: g, sort_order: await nextOrder(g) } as any,
    });
    return NextResponse.json({ prompt });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to save prompt' }, { status: 500 });
  }
}

// Edit a saved prompt: rename, change text, or move to another group (lands last there).
// { order: [ids] } re-numbers those prompts in that order; { renameGroup: { from, to } }
// moves a whole group (and the datasets linked to it) to a new name.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    if (Array.isArray(body?.order)) {
      await prisma.$transaction(
        body.order.map((id: string, i: number) =>
          prisma.savedPrompt.update({ where: { id }, data: { sort_order: i } as any }),
        ),
      );
      return NextResponse.json({ ok: true });
    }
    if (body?.renameGroup) {
      const from = String(body.renameGroup.from ?? '').trim();
      const to = String(body.renameGroup.to ?? '').trim();
      if (!from || !to) return NextResponse.json({ error: 'Group name is empty' }, { status: 400 });
      if (from !== to) {
        const base = await nextOrder(to);
        const rows: any[] = await prisma.savedPrompt.findMany({ where: { group: from } as any, orderBy: promptOrderBy });
        await prisma.$transaction(
          rows.map((r, i) => prisma.savedPrompt.update({ where: { id: r.id }, data: { group: to, sort_order: base + i } as any })),
        );
        await relinkDatasets(from, to);
      }
      return NextResponse.json({ ok: true });
    }

    const { id, name, text, group } = body;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const data: Record<string, any> = {};
    if (typeof name === 'string') data.name = name.trim() || 'Prompt';
    if (typeof text === 'string') {
      if (!text.trim()) return NextResponse.json({ error: 'Prompt text is empty' }, { status: 400 });
      data.text = text;
    }
    if (typeof group === 'string') {
      const current: any = await prisma.savedPrompt.findUnique({ where: { id } });
      data.group = group.trim();
      if (current && current.group !== data.group) data.sort_order = await nextOrder(data.group);
    }
    const prompt = await prisma.savedPrompt.update({ where: { id }, data: data as any });
    return NextResponse.json({ prompt });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to update prompt' }, { status: 500 });
  }
}

// ?id= deletes one prompt; ?group= deletes a whole group and unlinks its datasets
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  const group = request.nextUrl.searchParams.get('group');
  if (group !== null) {
    if (!group.trim()) return NextResponse.json({ error: 'Missing group' }, { status: 400 });
    await prisma.savedPrompt.deleteMany({ where: { group } as any });
    await relinkDatasets(group, '');
    return NextResponse.json({ ok: true });
  }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  await prisma.savedPrompt.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
