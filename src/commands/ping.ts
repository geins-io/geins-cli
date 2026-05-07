import { getApiUrl } from '../config/env.ts';
import { green, red, dim } from '../output/color.ts';

const SERVICES = ['auth', 'account', 'order', 'product'] as const;

export async function pingCommand(args: string[]): Promise<void> {
  const services = args.length > 0 ? args : [...SERVICES];

  for (const service of services) {
    const start = Date.now();
    try {
      const res = await fetch(`${getApiUrl()}/${service}/ping`);
      const ms = Date.now() - start;
      if (res.ok) {
        console.log(`${green('✓')} ${service} ${dim(`${ms}ms`)}`);
      } else {
        console.log(`${red('✗')} ${service} ${dim(`${res.status} ${ms}ms`)}`);
      }
    } catch {
      const ms = Date.now() - start;
      console.log(`${red('✗')} ${service} ${dim(`unreachable ${ms}ms`)}`);
    }
  }
}
