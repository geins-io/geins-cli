/**
 * One-off: set BrandId = 2 (Machinery Protection Components) on every product in the catalog.
 * Reads product IDs from the cached catalog pages (/tmp/catalog*.json).
 * PUT /API/Product/{id} is a partial merge, so only BrandId changes.
 */
import { updateProduct } from '../src/commands/products.ts';

const BRAND_ID = 2;
const CONCURRENCY = 8;

const files = [
  '/tmp/catalog.json',
  '/tmp/catalog_p2.json',
  '/tmp/catalog_p3.json',
  '/tmp/catalog_p4.json',
  '/tmp/catalog_p5.json',
  '/tmp/catalog_p6.json',
];

const ids: number[] = [];
const seen = new Set<number>();
for (const f of files) {
  const j = JSON.parse(await Bun.file(f).text());
  for (const p of j.products ?? []) {
    const id = p.ProductId;
    if (typeof id === 'number' && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
}
console.log(`Setting BrandId=${BRAND_ID} on ${ids.length} products (concurrency ${CONCURRENCY})…`);

let done = 0;
let ok = 0;
const failures: Array<{ id: number; error: string }> = [];

async function worker(chunk: number[]) {
  for (const id of chunk) {
    try {
      await updateProduct(String(id), { BrandId: BRAND_ID });
      ok++;
    } catch (e) {
      failures.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
    done++;
    if (done % 100 === 0 || done === ids.length) {
      console.log(`  ${done}/${ids.length}  (ok ${ok}, failed ${failures.length})`);
    }
  }
}

const lanes: number[][] = Array.from({ length: CONCURRENCY }, () => []);
ids.forEach((id, i) => lanes[i % CONCURRENCY].push(id));
await Promise.all(lanes.map(worker));

console.log(`\nDone. Success: ${ok}/${ids.length}. Failures: ${failures.length}.`);
if (failures.length) {
  await Bun.write('/tmp/setbrand_failures.json', JSON.stringify(failures, null, 2));
  console.log('Failures written to /tmp/setbrand_failures.json. First few:');
  for (const f of failures.slice(0, 10)) console.log(`  product ${f.id}: ${f.error}`);
}
