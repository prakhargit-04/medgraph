// Shared helper for calling external services (RxNorm, openFDA) from our API
// routes. Adds a server-side timeout (these previously had none — a hung
// RxNorm/openFDA response would hang the route indefinitely on the server,
// even though the client-side fetchWithTimeout would eventually give up) and
// a single retry, but ONLY for genuinely transient failures — a network
// error, a timeout, or a 5xx/429 from the upstream service. A 404 or other
// 4xx is a real answer ("not found"), not a hiccup, so it is never retried.

interface FetchExternalOptions {
  timeoutMs?: number;
  retries?: number;
}

export async function fetchExternal(url: string, opts: FetchExternalOptions = {}): Promise<Response> {
  const { timeoutMs = 8000, retries = 1 } = opts;
  let lastErr: any;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      // Transient upstream failure (rate limited / server error) — retry once.
      if (!res.ok && (res.status === 429 || res.status >= 500) && attempt < retries) {
        console.warn(`[fetchExternal] ${url} returned ${res.status}, retrying (attempt ${attempt + 1}/${retries})`);
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }

      return res; // Includes real 4xx answers like 404 — caller decides what those mean.
    } catch (err: any) {
      clearTimeout(timer);
      lastErr = err;
      const isTimeout = err?.name === 'AbortError';
      if (attempt < retries) {
        console.warn(`[fetchExternal] ${url} failed (${isTimeout ? 'timeout' : err?.message}), retrying (attempt ${attempt + 1}/${retries})`);
        continue;
      }
      if (isTimeout) {
        throw new Error(`Request to ${new URL(url).hostname} timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  }

  throw lastErr;
}
