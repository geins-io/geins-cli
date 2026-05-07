const DEFAULT_API_URL = 'https://mgmtapi.geins.services/v2';

export function getApiUrl(): string {
  return process.env['GEINS_API_URL'] ?? DEFAULT_API_URL;
}

export const isInteractive = process.stdin.isTTY ?? false;
