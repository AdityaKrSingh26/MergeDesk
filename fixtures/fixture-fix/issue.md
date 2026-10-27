# Retry HTTP fetch three times

`fetchWithRetry` should retry failed HTTP fetches three times.

Requirements:
- Retry a request up to three attempts total
- Default timeout is 2000ms
- Retry on network errors and HTTP 5xx
- Do not retry 4xx
- Keep the existing `src/http.ts` module; no new packages
