import { NextRequest, NextResponse } from 'next/server';
import { comfyFetch, isApiWorkflow } from '@/server/compare';

// DUAL BUILD: import an API-format workflow straight into ComfyUI's own workflows folder
// (via its userdata endpoint), so it shows up in the picker without hand-copying files.
// Rejects UI-format saves up front so the user gets a clear message, not a load-time error.
export async function POST(req: NextRequest) {
  try {
    const { name, workflow } = await req.json();
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Give the workflow a name.' }, { status: 400 });
    }

    let obj: any;
    try {
      obj = typeof workflow === 'string' ? JSON.parse(workflow) : workflow;
    } catch {
      return NextResponse.json({ error: "That file isn't valid JSON." }, { status: 400 });
    }
    if (!isApiWorkflow(obj)) {
      return NextResponse.json(
        { error: "That's a UI workflow save, not the API format. In ComfyUI use File → Export (API)." },
        { status: 400 },
      );
    }

    // keep only a filename; force .json; tag "api" so it reads as API and sorts first in the picker
    let fname = name.split(/[/\\]/).pop()!.trim();
    if (!fname.toLowerCase().endsWith('.json')) fname += '.json';
    if (!/\bapi\b/i.test(fname)) fname = fname.replace(/\.json$/i, ' api.json');

    const enc = encodeURIComponent('workflows/' + fname);
    const res = await comfyFetch(`/api/userdata/${enc}?overwrite=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `ComfyUI wouldn't save it (HTTP ${res.status}). Is it reachable?` },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, name: fname });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Import failed' }, { status: 500 });
  }
}
