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

/** Product name shown in the welcome banner. Set NAME to override; defaults to "Synapse". */
export function getName(): string {
  return process.env['NAME']?.trim() || 'Synapse';
}

/**
 * Welcome banner logo. Set BRAND_LOGO=none (alias "text") to hide the ASCII banner entirely
 * and show just the text name. Defaults to the SYNAPSE wordmark.
 */
export function getLogo(): LogoVariant {
  const v = process.env['BRAND_LOGO'];
  if (v === 'none' || v === 'text') return 'none';
  return 'synapse';
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

/** Show the "❯_" prompt flourish before the wordmark. Set BRAND_PREFIX=false to hide; defaults to true. */
export function getLogoPrefix(): boolean {
  return envBool('BRAND_PREFIX', true);
}

export const isInteractive = process.stdin.isTTY ?? false;

/**
 * Base URL for OTA release artifacts + the `latest.json` update manifest.
 * Defaults to the GitHub Releases "latest" download path. Override with
 * GEINS_UPDATE_URL (e.g. to point at a staging release for testing).
 */
export function getUpdateManifestUrl(): string {
  return (
    process.env['GEINS_UPDATE_URL'] ??
    'https://github.com/geins-io/geins-cli/releases/latest/download/latest.json'
  );
}
