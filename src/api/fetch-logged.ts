import { recordResponse } from '../output/sink.ts';

export interface FetchLogCtx {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}

/**
 * `fetch` that logs a thrown NETWORK failure to the output folder before rethrowing. A connection
 * error (host unreachable, DNS failure, "Unable to connect") rejects `fetch` with no HTTP status,
 * so the normal `recordResponse` paths — which only run once a response exists — never see it, and
 * the failure is logged nowhere. Here we record it as a `status: 0` error so direct CLI runs leave
 * a trace too, then rethrow unchanged so callers behave exactly as before.
 *
 * User aborts (Ctrl-C → AbortError) are NOT logged as failures — they're expected, not errors.
 */
export async function fetchLogged(input: string, init: RequestInit, ctx: FetchLogCtx): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    const signal = init.signal as AbortSignal | null | undefined;
    const aborted = (err instanceof Error && err.name === 'AbortError') || signal?.aborted === true;
    if (!aborted) {
      await recordResponse({ ...ctx, status: 0, error: err instanceof Error ? err.message : String(err) });
    }
    throw err;
  }
}
