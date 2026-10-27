import { connection } from "next/server";
import { notFound } from "next/navigation";
import { store } from "@/server/runs";
import { RunView } from "./RunView";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  const run = store.get(id);
  if (!run) notFound();
  return <RunView run={run} />;
}
