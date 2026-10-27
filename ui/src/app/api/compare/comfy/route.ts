import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeWorkflow,
  comfyJson,
  describeMap,
  getComfyUrl,
  listWorkflows,
  loadWorkflow,
  workflowOptions,
  workflowValues,
} from '@/server/compare';

// ComfyUI status, the user's workflows, and for the chosen one: what Compare will patch,
// the values it holds now, and the model/TE/VAE/sampler choices Comfy offers
export async function GET(request: NextRequest) {
  const url = await getComfyUrl();
  const workflow = request.nextUrl.searchParams.get('workflow') || '';
  try {
    await comfyJson('/system_stats', { timeoutMs: 4000 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, url, error: `ComfyUI not reachable at ${url}` });
  }
  try {
    const workflows = await listWorkflows();
    if (!workflow) return NextResponse.json({ ok: true, url, workflows });
    try {
      const api = await loadWorkflow(workflow);
      const map = await analyzeWorkflow(api);
      return NextResponse.json({
        ok: true,
        url,
        workflows,
        detected: describeMap(api, map),
        values: await workflowValues(api, map),
        options: await workflowOptions(api, map),
      });
    } catch (e: any) {
      return NextResponse.json({ ok: true, url, workflows, workflowError: e?.message ?? String(e) });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, url, error: e?.message ?? String(e) });
  }
}
