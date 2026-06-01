import { mgmtRequest } from '../api/live-client.ts';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

export function isHttpMethod(token: string): boolean {
  return HTTP_METHODS.has(token.toUpperCase());
}

/** Raw call to the Management API (mgmtapi.geins.io), authenticated with the active API credentials. */
export async function managementRequest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  return mgmtRequest<T>(path, { method, body });
}

/**
 * A named, friendly Management API method exposed as `/management <name> [args]`.
 * `run` returns the data to display (printed as JSON by default).
 */
export interface ManagementMethod {
  description: string;
  usage?: string;
  run: (args: string[]) => Promise<unknown>;
}

/**
 * Named Management API methods. Populated as specific endpoints are requested —
 * each entry maps a friendly subcommand to a typed call against the Management API.
 */
export const methods: Record<string, ManagementMethod> = {};
