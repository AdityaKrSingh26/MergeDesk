import type { ChangedFile } from "@/server/shared";

export function changedFilesFromDiff(diff: string): ChangedFile[] {
  const rows: ChangedFile[] = [];
  let current: ChangedFile | undefined;
  const flush = () => {
    if (current) rows.push(current);
    current = undefined;
  };
  for (const line of diff.split("\n")) {
    const plus = line.match(/^\+\+\+ b\/(.+)$/) ?? line.match(/^\+\+\+ (.+)$/);
    if (plus) {
      flush();
      const path = plus[1];
      if (path !== "/dev/null") current = { path, linesAdded: 0, linesRemoved: 0 };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) current.linesAdded += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) current.linesRemoved += 1;
  }
  flush();
  return rows;
}
