import { getMgmtApiUrl, getMerchantApiUrl } from '../config/env.ts';
import { loadCredentials, loadCredentialsByName, type ApiCredentials } from '../config/store.ts';
import { ApiError, noCredentials } from './errors.ts';
import { recordResponse } from '../output/sink.ts';
import { fetchLogged } from './fetch-logged.ts';
import { getActiveSignal } from './abort.ts';

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

/**
 * The resolved API credentials for the active profile (honoring any --account
 * override), throwing if none are set. Exposed so callers can read profile-attached
 * config (e.g. the Merchant storefront context) consistently with merchantQuery.
 */
export async function getActiveCredentials(): Promise<ApiCredentials> {
  return getCredentials();
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
 * Call the Management API. Pass `creds` to use credentials that are not yet
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
  const res = await fetchLogged(url.toString(), {
    method,
    headers: mgmtHeaders(credentials),
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: getActiveSignal(),
  }, { method, path: apiPath, query: options?.query, body: options?.body });

  if (!res.ok) {
    const err = await ApiError.fromResponse(res, method, apiPath);
    await recordResponse({ method, path: apiPath, query: options?.query, body: options?.body, status: res.status, error: err.body || err.message });
    throw err;
  }

  const text = await res.text();
  const data = (text ? JSON.parse(text) : undefined) as T;
  await recordResponse({ method, path: apiPath, query: options?.query, body: options?.body, status: res.status, data });
  return data;
}

export interface MgmtUploadOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
}

/**
 * Upload raw binary to the Management API (e.g. a product image). Unlike mgmtRequest,
 * the body is sent as-is with the given Content-Type instead of JSON.
 */
export async function mgmtUpload<T = unknown>(
  path: string,
  body: Uint8Array,
  contentType: string,
  options?: MgmtUploadOptions,
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

  const basic = Buffer.from(`${credentials.username}:${credentials.managementApiPassword}`).toString('base64');
  const method = options?.method ?? 'PUT';
  // Binary payload — log a descriptor (type + size), not the raw bytes.
  const bodyInfo = `<binary ${contentType}, ${body.length} bytes>`;
  const res = await fetchLogged(url.toString(), {
    method,
    headers: {
      'Authorization': `Basic ${basic}`,
      'X-ApiKey': credentials.managementApiKey,
      'Content-Type': contentType,
      'Accept': 'application/json',
    },
    body,
    signal: getActiveSignal(),
  }, { method, path: apiPath, query: options?.query, body: bodyInfo });
  if (!res.ok) {
    const err = await ApiError.fromResponse(res, method, apiPath);
    await recordResponse({ method, path: apiPath, query: options?.query, body: bodyInfo, status: res.status, error: err.body || err.message });
    throw err;
  }

  const text = await res.text();
  const data = (text ? JSON.parse(text) : undefined) as T;
  await recordResponse({ method, path: apiPath, query: options?.query, body: bodyInfo, status: res.status, data });
  return data;
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
  // Log variables first so the request params stay visible even when the long query is truncated.
  const reqBody = { variables, query };
  const res = await fetchLogged(getMerchantApiUrl(), {
    method: 'POST',
    headers: {
      'X-ApiKey': credentials.merchantApiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal: getActiveSignal(),
  }, { method: 'POST', path: '/graphql', body: reqBody });
  if (!res.ok) {
    const err = await ApiError.fromResponse(res, 'POST', '/graphql');
    await recordResponse({ method: 'POST', path: '/graphql', body: reqBody, status: res.status, error: err.body || err.message });
    throw err;
  }

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    const message = json.errors.map((e) => e.message).join('; ');
    await recordResponse({ method: 'POST', path: '/graphql', body: reqBody, status: 200, error: message });
    throw new ApiError(200, 'POST', '/graphql', message);
  }
  await recordResponse({ method: 'POST', path: '/graphql', body: reqBody, status: 200, data: json.data });
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
