import type { LogoVariant } from '../ui/logos';

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

/** Product name shown in the welcome banner. Set NAME to override; defaults to "Geins Synapse". */
export function getName(): string {
  return process.env['NAME']?.trim() || 'Geins Synapse';
}

/** Welcome banner logo variant. Set BRAND_LOGO=litium to switch; defaults to geins. */
export function getLogo(): LogoVariant {
  return process.env['BRAND_LOGO'] === 'litium' ? 'litium' : 'geins';
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

/** Show the prefix flourish before the logo. Set BRAND_PREFIX=false to hide; defaults to true. */
export function getLogoPrefix(): boolean {
  return envBool('BRAND_PREFIX', true);
}

/** Show the "SYNAPSE" flourish after the logo. Set BRAND_SUFIX=false to hide; defaults to true. */
export function getLogoSuffix(): boolean {
  return envBool('BRAND_SUFIX', true);
}

export const isInteractive = process.stdin.isTTY ?? false;
