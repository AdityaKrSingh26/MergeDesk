export async function fetchWithRetry(url: string): Promise<Response> {
  return fetch(url);
}

export async function fetchJson(url: string): Promise<unknown> {
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
}
