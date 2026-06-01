import { red, dim, yellow } from '../output/color.ts';

export class AuthError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Auth failed (${status}): ${body}`);
    this.name = 'AuthError';
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public method: string,
    public path: string,
    public body: string,
  ) {
    super(`API ${method} ${path} → ${status}`);
    this.name = 'ApiError';
  }

  static async fromResponse(res: Response, method: string, path: string): Promise<ApiError> {
    const body = await res.text().catch(() => '');
    return new ApiError(res.status, method, path, body);
  }
}

export function formatError(err: unknown): string {
  if (err instanceof NotLoggedInError || err instanceof NoCredentialsError) {
    return yellow(err.message);
  }

  if (err instanceof AuthError) {
    if (err.status === 401) return red('Authentication failed. Check your credentials.');
    return red(`Auth error (${err.status}): ${err.body}`);
  }

  if (err instanceof ApiError) {
    const lines = [red(`${err.method} ${err.path} → ${err.status}`)];
    if (err.body) {
      try {
        const parsed = JSON.parse(err.body);
        lines.push(dim(JSON.stringify(parsed, null, 2)));
      } catch {
        lines.push(dim(err.body));
      }
    }
    return lines.join('\n');
  }

  if (err instanceof Error) {
    return red(err.message);
  }

  return red(String(err));
}

export class NotLoggedInError extends Error {
  constructor() {
    super('Not logged in. Run /login first.');
    this.name = 'NotLoggedInError';
  }
}

export class NoCredentialsError extends Error {
  constructor() {
    super('No API credentials. Run /apikey to add your Geins API User credentials.');
    this.name = 'NoCredentialsError';
  }
}

export function exitWithError(err: unknown): never {
  console.error(formatError(err));
  const code = err instanceof AuthError || err instanceof NotLoggedInError || err instanceof NoCredentialsError ? 2 : 1;
  process.exit(code);
}

export function notLoggedIn(): never {
  throw new NotLoggedInError();
}

export function noCredentials(): never {
  throw new NoCredentialsError();
}
