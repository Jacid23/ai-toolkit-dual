import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeWorkflow,
  comfyJson,
  comfyServerUrl,
  describeMap,
  comfyServers,
  withComfyUrl,
  listWorkflows,
  tiedWorkflow,
  loadWorkflow,
  workflowOptions,
  workflowValues,
} from '@/server/compare';

// ComfyUI status, the user's workflows, and for the chosen one: what Compare will patch,
// the values it holds now, and the model/TE/VAE/sampler choices Comfy offers.
// ?server= picks the ComfyUI ('later' or an exact address from Settings; blank = main).
// ?servers=1 only lists the two ComfyUIs with their GPU names.
export async function GET(request: NextRequest) {
  const servers = await comfyServers();
  if (request.nextUrl.searchParams.get('servers')) return NextResponse.json({ ok: true, servers });
  let url: string;
  try {
    url = await comfyServerUrl(request.nextUrl.searchParams.get('server'));
  } catch (e: any) {
    return NextResponse.json({ ok: false, url: '', servers, error: e?.message ?? String(e) });
  }
  const workflow = request.nextUrl.searchParams.get('workflow') || '';
  return withComfyUrl(url, async () => {
  // the sample workflow tied to this ComfyUI (Settings), so Compare / the job card can show it
  const tied = await tiedWorkflow();
  try {
    await comfyJson('/system_stats', { timeoutMs: 4000 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, url, servers, tiedWorkflow: tied, error: `ComfyUI not reachable at ${url}` });
  }
  try {
    const workflows = await listWorkflows();
    if (!workflow) return NextResponse.json({ ok: true, url, servers, workflows, tiedWorkflow: tied });
    try {
      const api = await loadWorkflow(workflow);
      const map = await analyzeWorkflow(api);
      return NextResponse.json({
        ok: true,
        url,
        servers,
        workflows,
        tiedWorkflow: tied,
        detected: describeMap(api, map),
        values: await workflowValues(api, map),
        options: await workflowOptions(api, map),
      });
    } catch (e: any) {
      return NextResponse.json({ ok: true, url, servers, workflows, tiedWorkflow: tied, workflowError: e?.message ?? String(e) });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, url, servers, error: e?.message ?? String(e) });
  }
  });
}
