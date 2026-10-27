import { getRunEvents, store, subscribeRun } from "@/server/runs";

export const maxDuration = 300;

function encode(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const run = store.get(id);
  if (!run) return new Response(null, { status: 404 });

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encode(event, data));
      };

      let closed = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      let unsub: (() => void) | undefined;

      const close = () => {
        if (closed) return;
        closed = true;
        if (timer !== undefined) clearInterval(timer);
        unsub?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const latest = store.get(id);
      if (latest?.status === "done") {
        if (latest.map) send("map", latest.map);
        send("coverage", latest.coverage);
        if (latest.verdict) send("verdict", latest.verdict);
        send("done", { modelParseFailed: latest.modelParseFailed === true });
        close();
        return;
      }
      if (latest?.status === "error") {
        send("error", latest.error ?? { code: "run_failed", message: "run failed" });
        close();
        return;
      }

      let sent = 0;
      let finished = false;
      const flush = () => {
        if (closed) return;
        const log = getRunEvents(id);
        while (sent < log.length) {
          const rec = log[sent++];
          send(rec.event, rec.data);
          if (rec.event === "done" || rec.event === "error") finished = true;
        }
        if (finished) {
          close();
          return;
        }
        const current = store.get(id);
        if (current?.status === "done") {
          if (!log.some((e) => e.event === "map") && current.map) send("map", current.map);
          if (!log.some((e) => e.event === "coverage")) send("coverage", current.coverage);
          if (!log.some((e) => e.event === "verdict") && current.verdict) send("verdict", current.verdict);
          if (!log.some((e) => e.event === "done")) {
            send("done", { modelParseFailed: current.modelParseFailed === true });
          }
          close();
        } else if (current?.status === "error") {
          if (!log.some((e) => e.event === "error")) {
            send("error", current.error ?? { code: "run_failed", message: "run failed" });
          }
          close();
        }
      };

      unsub = subscribeRun(id, flush);
      timer = setInterval(flush, 200);
      flush();
      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
