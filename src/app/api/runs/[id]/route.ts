import { store } from "@/server/runs";

export const maxDuration = 300;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const run = store.get(id);
  if (!run) return new Response(null, { status: 404 });
  return Response.json(run);
}
