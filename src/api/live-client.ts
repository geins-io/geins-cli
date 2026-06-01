import { getMgmtApiUrl, getMerchantApiUrl } from '../config/env.ts';
import { loadCredentials, loadCredentialsByName, type ApiCredentials } from '../config/store.ts';
import { ApiError, noCredentials } from './errors.ts';

// Live Geins APIs, authenticated with API User credentials (see ApiCredentials):
//   - Management API (REST):    Basic Auth + X-ApiKey
//   - Merchant API (GraphQL):   X-ApiKey

export interface MgmtRequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

let cachedCredentials: ApiCredentials | null = null;
let profileOverride: string | null = null;

/**
 * Force a specific credentials profile (by name) for this process instead of the
 * stored active one. Used by the headless `--account <name>` flag / GEINS_ACCOUNT.
 * Pass null to clear the override.
 */
export function setProfileOverride(name: string | null): void {
  profileOverride = name;
  cachedCredentials = null;
}

async function getCredentials(): Promise<ApiCredentials> {
  if (!cachedCredentials) {
    cachedCredentials = profileOverride
      ? await loadCredentialsByName(profileOverride)
      : await loadCredentials();
  }
  if (!cachedCredentials) {
    if (profileOverride) {
      throw new Error(`Unknown API account '${profileOverride}'. Run 'geins apikey list' to see available accounts.`);
    }
    noCredentials();
  }
  return cachedCredentials;
}

/** Clear the in-memory credentials cache (call after saving/clearing credentials). */
export function resetCredentialsCache(): void {
  cachedCredentials = null;
}

function mgmtHeaders(creds: ApiCredentials): Record<string, string> {
  const basic = Buffer.from(`${creds.username}:${creds.managementApiPassword}`).toString('base64');
  return {
    'Authorization': `Basic ${basic}`,
    'X-ApiKey': creds.managementApiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

/**
 * Call the live Management API. Pass `creds` to use credentials that are not yet
 * stored (e.g. during validation); otherwise the stored credentials are used.
 */
export async function mgmtRequest<T = unknown>(
  path: string,
  options?: MgmtRequestOptions,
  creds?: ApiCredentials,
): Promise<T> {
  const credentials = creds ?? (await getCredentials());
  const apiPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${getMgmtApiUrl()}${apiPath}`);
  if (options?.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const method = options?.method ?? 'GET';
  const res = await fetch(url.toString(), {
    method,
    headers: mgmtHeaders(credentials),
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) throw await ApiError.fromResponse(res, method, apiPath);

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/** Call the live Merchant API (GraphQL). */
export async function merchantQuery<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  creds?: ApiCredentials,
): Promise<T> {
  const credentials = creds ?? (await getCredentials());
  const res = await fetch(getMerchantApiUrl(), {
    method: 'POST',
    headers: {
      'X-ApiKey': credentials.merchantApiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw await ApiError.fromResponse(res, 'POST', '/graphql');

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    const message = json.errors.map((e) => e.message).join('; ');
    throw new ApiError(200, 'POST', '/graphql', message);
  }
  return json.data as T;
}

/** Validate Management API credentials with a lightweight read. Throws on failure. */
export async function validateManagementApi(creds: ApiCredentials): Promise<void> {
  await mgmtRequest('/API/Market/List', undefined, creds);
}

/** Validate the Merchant API key with a lightweight query. Throws on failure. */
export async function validateMerchantApi(creds: ApiCredentials): Promise<void> {
  await merchantQuery('query { categories { categoryId name } }', undefined, creds);
}
