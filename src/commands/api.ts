import { request } from '../api/client.ts';
import { exitWithError } from '../api/errors.ts';
import { output } from '../output/format.ts';

export async function apiCommand(args: string[]): Promise<void> {
  const method = args[0]?.toUpperCase() ?? 'GET';
  const path = args[1];

  if (!path) {
    console.error('Usage: geins api <METHOD> <path> [--body <json>]');
    console.error('  geins api GET /products');
    console.error('  geins api POST /auth/refresh --body \'{"refreshToken": "..."}\'');
    process.exit(1);
  }

  let body: unknown;
  const bodyIndex = args.indexOf('--body');
  if (bodyIndex !== -1 && args[bodyIndex + 1]) {
    try {
      body = JSON.parse(args[bodyIndex + 1]!);
    } catch {
      console.error('Invalid JSON in --body');
      process.exit(1);
    }
  }

  const query: Record<string, string> = {};
  const queryIndex = args.indexOf('--query');
  if (queryIndex !== -1 && args[queryIndex + 1]) {
    const params = new URLSearchParams(args[queryIndex + 1]!);
    for (const [k, v] of params) {
      query[k] = v;
    }
  }

  try {
    const apiPath = path.startsWith('/') ? path : `/${path}`;
    const data = await request(apiPath, { method, body, query });
    output(data);
  } catch (err) {
    exitWithError(err);
  }
}
