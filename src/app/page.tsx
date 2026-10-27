"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { HEADER_TAGLINE, ONE_LINER, PRODUCT_NAME, displayStamp } from "@/server/shared";
import type { FixtureId } from "@/server/shared";

const FIXTURES: ReadonlyArray<{ id: FixtureId; label: string }> = [
  { id: "fixture-ship", label: displayStamp("SHIP") },
  { id: "fixture-fix", label: displayStamp("FIX") },
  { id: "fixture-block", label: displayStamp("BLOCK") },
];

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 3;

export default function Home() {
  const router = useRouter();
  const [prUrl, setPrUrl] = useState("");
  const [issue, setIssue] = useState("");
  const [diff, setDiff] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function postAndGo(body: {
    prUrl?: string;
    fixtureId?: FixtureId;
    issue?: string;
    diff?: string;
    imageUrls?: string[];
  }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { id?: string; message?: string };
      if (!res.ok || !data.id) {
        setError(data.message ?? "Could not start a run.");
        return;
      }
      router.push(`/r/${data.id}`);
    } catch {
      setError("Could not start a run.");
    } finally {
      setBusy(false);
    }
  }

  function onImages(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files);
    if (list.length > MAX_IMAGES) {
      setError("At most 3 images.");
      setImageUrls([]);
      return;
    }
    if (list.some((file) => file.size > MAX_IMAGE_BYTES)) {
      setError("Each image must be 4MB or smaller.");
      setImageUrls([]);
      return;
    }
    setError(null);
    void Promise.all(
      list.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ""));
            reader.onerror = () => reject(reader.error ?? new Error("read failed"));
            reader.readAsDataURL(file);
          }),
      ),
    )
      .then((urls) => setImageUrls(urls))
      .catch(() => setError("Could not read images."));
  }

  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-10 px-4 py-10 lg:flex-row lg:items-start lg:gap-16">
      <section className="max-w-xl shrink-0 lg:pt-6">
        <p className="text-xs font-medium tracking-[0.22em] text-[var(--desk-brass)] uppercase">
          Exception desk
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">{PRODUCT_NAME}</h1>
        <p className="mt-3 text-lg leading-8 text-[var(--desk-muted)]">{ONE_LINER}</p>
        <p className="mt-6 max-w-md text-sm leading-6 text-[var(--desk-muted)]">
          {HEADER_TAGLINE} Drop a public pull request on the blotter. The map comes first; the
          stamp is second. No chat. No patches. No merge.
        </p>
      </section>

      <section className="desk-ticket w-full max-w-2xl p-6 sm:p-8">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void postAndGo({ prUrl });
          }}
        >
          <label htmlFor="pr-url" className="text-sm font-medium">
            GitHub PR URL
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="pr-url"
              name="prUrl"
              type="url"
              required
              value={prUrl}
              onChange={(event) => setPrUrl(event.target.value)}
              placeholder="https://github.com/org/repo/pull/123"
              className="min-w-0 flex-1 border border-[var(--desk-rule)] bg-[var(--desk-paper)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--desk-brass)]"
            />
            <button
              type="submit"
              disabled={busy}
              className="border border-[var(--foreground)] bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] disabled:opacity-60"
            >
              Orient PR
            </button>
          </div>
        </form>

        <div className="mt-8">
          <p className="text-xs font-medium tracking-[0.18em] text-[var(--desk-muted)] uppercase">
            Known desks
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {FIXTURES.map((fixture) => (
              <button
                key={fixture.id}
                type="button"
                disabled={busy}
                onClick={() => void postAndGo({ fixtureId: fixture.id })}
                className="desk-ticket px-3 py-4 text-left text-sm font-medium leading-5 hover:-translate-y-0.5 disabled:opacity-60"
              >
                {fixture.label}
              </button>
            ))}
          </div>
        </div>

        <details className="mt-8 border-t border-dashed border-[var(--desk-rule)] pt-4">
          <summary className="cursor-pointer text-sm font-medium">Paste issue + diff</summary>
          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void postAndGo({
                issue,
                diff,
                ...(imageUrls.length > 0 ? { imageUrls } : {}),
              });
            }}
          >
            <label htmlFor="issue" className="text-sm font-medium">
              Issue
            </label>
            <textarea
              id="issue"
              name="issue"
              rows={6}
              value={issue}
              onChange={(event) => setIssue(event.target.value)}
              className="border border-[var(--desk-rule)] bg-[var(--desk-paper)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--desk-brass)]"
            />
            <label htmlFor="diff" className="text-sm font-medium">
              Diff
            </label>
            <textarea
              id="diff"
              name="diff"
              rows={8}
              value={diff}
              onChange={(event) => setDiff(event.target.value)}
              className="border border-[var(--desk-rule)] bg-[var(--desk-paper)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--desk-brass)]"
            />
            <label htmlFor="shots" className="text-sm font-medium">
              Screenshots
            </label>
            <input
              id="shots"
              name="shots"
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              multiple
              onChange={(event) => onImages(event.target.files)}
              className="text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="self-start border border-[var(--foreground)] px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              Orient paste
            </button>
          </form>
        </details>

        {error ? (
          <p role="alert" className="mt-4 text-sm text-[var(--desk-wax)]">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
