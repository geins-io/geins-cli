import { isInteractive } from '../config/env.ts';
import { bold, dim } from './color.ts';

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function outputTable(rows: Record<string, unknown>[], columns?: string[]): void {
  if (rows.length === 0) {
    console.error(dim('No results.'));
    return;
  }

  const keys = columns ?? Object.keys(rows[0]!);
  const widths = keys.map((k) => {
    const values = rows.map((r) => String(r[k] ?? ''));
    return Math.max(k.length, ...values.map((v) => v.length));
  });

  const header = keys.map((k, i) => bold(k.toUpperCase().padEnd(widths[i]!))).join('  ');
  console.log(header);

  for (const row of rows) {
    const line = keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i]!)).join('  ');
    console.log(line);
  }
}

export function output(data: unknown, forceFormat?: 'json' | 'table'): void {
  const format = forceFormat ?? (isInteractive ? 'table' : 'json');

  if (format === 'json' || !Array.isArray(data)) {
    outputJson(data);
    return;
  }

  outputTable(data as Record<string, unknown>[]);
}
