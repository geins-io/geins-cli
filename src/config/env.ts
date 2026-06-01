const DEFAULT_API_URL = 'https://mgmtapi.geins.services/v2';
const DEFAULT_MGMT_API_URL = 'https://mgmtapi.geins.io';
const DEFAULT_MERCHANT_API_URL = 'https://merchantapi.geins.io/graphql';

export function getApiUrl(): string {
  return process.env['GEINS_API_URL'] ?? DEFAULT_API_URL;
}

/** Geins Management API (live) — REST, Basic Auth + X-ApiKey. */
export function getMgmtApiUrl(): string {
  return (process.env['GEINS_MGMT_API_URL'] ?? DEFAULT_MGMT_API_URL).replace(/\/$/, '');
}

/** Geins Merchant API (live) — GraphQL, X-ApiKey. */
export function getMerchantApiUrl(): string {
  return process.env['GEINS_MERCHANT_API_URL'] ?? DEFAULT_MERCHANT_API_URL;
}

export const isInteractive = process.stdin.isTTY ?? false;
