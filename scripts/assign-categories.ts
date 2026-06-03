/**
 * One-off: assign the 520 matched MP Components products to their leaf category in
 * the new tree, setting that leaf as the MAIN category (first in CategoryIds).
 * Reads the plan produced during the dry run (/tmp/assign_plan.json).
 *
 * Uses the same machinery as `geins product categories set-main`.
 * Runs with bounded concurrency; logs every result and writes failures to disk.
 */
import { setMainCategory } from '../src/commands/products.ts';

interface PlanRow {
  article: string;
  productId: number;
  csvName: string;
  targetCatId: number;
  targetCatName: string;
}

const CONCURRENCY = 6;
const plan: PlanRow[] = JSON.parse(await Bun.file('/tmp/assign_plan.json').text());

let done = 0;
let ok = 0;
const failures: Array<{ row: PlanRow; error: string }> = [];

async function worker(rows: PlanRow[]) {
  for (const row of rows) {
    try {
      await setMainCategory(String(row.productId), row.targetCatId);
      ok++;
    } catch (e) {
      failures.push({ row, error: e instanceof Error ? e.message : String(e) });
    }
    done++;
    if (done % 25 === 0 || done === plan.length) {
      console.log(`  ${done}/${plan.length}  (ok ${ok}, failed ${failures.length})`);
    }
  }
}

// Round-robin partition into CONCURRENCY lanes.
const lanes: PlanRow[][] = Array.from({ length: CONCURRENCY }, () => []);
plan.forEach((row, i) => lanes[i % CONCURRENCY].push(row));

console.log(`Assigning ${plan.length} products (concurrency ${CONCURRENCY})…`);
await Promise.all(lanes.map(worker));

console.log(`\nDone. Success: ${ok}/${plan.length}. Failures: ${failures.length}.`);
if (failures.length) {
  await Bun.write('/tmp/assign_failures.json', JSON.stringify(failures, null, 2));
  console.log('Failures written to /tmp/assign_failures.json. First few:');
  for (const f of failures.slice(0, 10)) {
    console.log(`  [${f.row.article}] product ${f.row.productId} → cat ${f.row.targetCatId}: ${f.error}`);
  }
}
