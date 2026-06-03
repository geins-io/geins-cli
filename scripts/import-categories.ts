/**
 * One-off importer: builds the MP Components category tree in Geins from the two
 * exported CSVs (Swedish + English). The CSVs share the old shop's category IDs,
 * which we use ONLY to join the two languages and resolve parent relationships —
 * they are never written to Geins. New Geins CategoryIds are assigned by the API.
 *
 * Usage: bun run scripts/import-categories.ts [--dry]
 */
import { readFile } from 'node:fs/promises';
import { createCategory, type CategoryWrite } from '../src/commands/products.ts';

const SV_CSV = '/Users/krille/Downloads/mpcomponents_categories_geins_import_sv.csv';
const EN_CSV = '/Users/krille/Downloads/mpcomponents_categories.csv';
const DRY = process.argv.includes('--dry');

interface Node {
  oldId: string;
  sv: string;
  en?: string;
  oldParentId?: string; // empty/undefined => root
}

// Swedish CSV: semicolon-delimited. Id;Name;Description;ParentId;Parent;LanguageId;Active;...
function parseSv(text: string): Map<string, Node> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out = new Map<string, Node>();
  for (const line of lines.slice(1)) {
    const f = line.split(';');
    const oldId = f[0]?.trim();
    const name = f[1]?.trim();
    if (!oldId || !name) continue;
    const parent = f[3]?.trim();
    out.set(oldId, { oldId, sv: name, oldParentId: parent || undefined });
  }
  return out;
}

// English CSV: comma-delimited. Category ID,Category Name,Level,Parent ID,...
function parseEn(text: string): Map<string, string> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const oldId = f[0]?.trim();
    const name = f[1]?.trim();
    if (oldId && name) out.set(oldId, name);
  }
  return out;
}

async function main() {
  const [svText, enText] = await Promise.all([readFile(SV_CSV, 'utf8'), readFile(EN_CSV, 'utf8')]);
  const nodes = parseSv(svText);
  const en = parseEn(enText);
  for (const node of nodes.values()) node.en = en.get(node.oldId);

  // Order by depth (roots first) so a parent's new id exists before its children.
  const depth = (n: Node): number => {
    let d = 0;
    let cur: Node | undefined = n;
    const seen = new Set<string>();
    while (cur?.oldParentId && !seen.has(cur.oldId)) {
      seen.add(cur.oldId);
      d++;
      cur = nodes.get(cur.oldParentId);
    }
    return d;
  };
  const ordered = [...nodes.values()].sort((a, b) => depth(a) - depth(b));

  const oldToNew = new Map<string, number>();
  let created = 0;
  for (const node of ordered) {
    const parentNewId = node.oldParentId ? oldToNew.get(node.oldParentId) : undefined;
    if (node.oldParentId && parentNewId == null) {
      console.error(`✗ Skipping "${node.sv}" — parent (old ${node.oldParentId}) was not created.`);
      continue;
    }
    const Names: CategoryWrite['Names'] = [{ LanguageCode: 'sv', Content: node.sv }];
    if (node.en) Names.push({ LanguageCode: 'en', Content: node.en });

    const indent = '  '.repeat(depth(node));
    if (DRY) {
      console.log(`${indent}${node.sv}  /  ${node.en ?? '(no en)'}${parentNewId ? `  → parent ${parentNewId}` : '  [ROOT]'}`);
      oldToNew.set(node.oldId, -Number(node.oldId)); // fake id for dry-run parent resolution
      continue;
    }
    const cat = await createCategory({ Names, ParentCategoryId: parentNewId, Active: true });
    oldToNew.set(node.oldId, cat.CategoryId!);
    created++;
    console.log(`${indent}✓ ${cat.CategoryId}  ${node.sv}`);
  }
  console.log(DRY ? `\nDry run: ${ordered.length} categories would be created.` : `\nDone. Created ${created} categories.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
