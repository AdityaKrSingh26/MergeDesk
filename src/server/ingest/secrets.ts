const PATTERNS = [
  /AKIA[0-9A-Z]{8,}/,
  /-----BEGIN[ A-Z]*PRIVATE KEY-----/,
  /api_key=\S+/i,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /xoxb-[A-Za-z0-9-]+/,
  /sk-[A-Za-z0-9]{10,}/,
];

export function findSecrets(patch: string): Array<{ path: string; quote: string; startLine: number }> {
  const hits: Array<{ path: string; quote: string; startLine: number }> = [];
  let path = "unknown";
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const file = raw.match(/^\+\+\+ b\/(.+)$/);
    if (file) path = file[1];
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) newLine = Number(hunk[1]) - 1;
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      newLine += 1;
      const line = raw.slice(1);
      for (const re of PATTERNS) {
        if (re.test(line)) {
          hits.push({ path, quote: line.trim().slice(0, 240), startLine: newLine });
          break;
        }
      }
    } else if (!raw.startsWith("-") && !raw.startsWith("\\") && !raw.startsWith("diff") && !raw.startsWith("index") && !raw.startsWith("---") && !raw.startsWith("+++") && !raw.startsWith("@@")) {
      newLine += 1;
    }
  }
  return hits;
}
