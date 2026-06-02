# Product Enrichment from CSV (Geins CLI)

A step-by-step runbook for enriching existing Geins products from an enrichment CSV
(images, long text, category, variant group, and parameters) using the `geins` CLI.

It is written so a fresh spawn (human or LLM) can execute it end-to-end. The CLI provides
the **primitives**; you (the operator) parse the CSV — the file format drifts between
exports, so no parser is baked into the CLI.

> Worked example throughout: `test-1.csv`, leaf `41` "Kopplingsplintar", 6 products, run
> against account `prod-elproman`. Substitute your own file / account / ids.

---

## 0. Prerequisites

- `bun install` done; run the CLI with `bun run src/bin.ts …` (or `geins …` if `bun link`ed).
- The target account must exist in the credential store (`geins apikey list`). Every command
  below targets it with **`--account <name>`** (e.g. `--account prod-elproman`).
- **Caveat:** `geins whoami` shows the base logged-in account, **not** the `--account`
  override. Don't trust it to confirm routing. Instead, read one product and check it matches
  the CSV (see preflight).

---

## 1. Understand the CSV

These exports are messy. Expect:

- **Semicolon-delimited**, UTF-8 **with BOM** (strip the BOM when parsing — Python:
  `open(path, encoding="utf-8-sig")`).
- **Duplicate column headers** — e.g. two `Url` columns. The *second* `Url` is the first
  image; additional images are `ImageUrl2 … ImageUrl8`. (Image numbering starts at 2.)
- **`Geins_GeinsId`** = the Geins internal product id → idType `0` (the CLI default; no
  `--idtype` needed). Columns without the `Geins_` prefix (`leafId`, `parentCategoryId`)
  come from the *source* taxonomy, not Geins — verify before using as Geins ids.
- A wide **spec/attribute matrix** after a `VARIANTS` marker column (often ~190 columns).
  Any given product fills in only a handful; the rest are empty. Numeric values use
  **Swedish comma decimals** (`4,0`, `18,8`) — these are *not* valid floats.

Key columns used by this runbook:

| Column | Use |
|--------|-----|
| `Geins_GeinsId` | Target product id (idType 0) |
| `leafName` | Category name to create |
| `parentCategoryId` | Parent category id for the new category |
| `parentCategoryName` | Parameter **group** name |
| `Text` | Product **LongText** *and* category **description** |
| 2nd `Url`, `ImageUrl2..8` | Image source URLs |
| populated columns after `VARIANTS` | Variant **dimensions** and parameter **values** |

Find which spec columns are actually populated (don't use empty ones as dimensions):

```bash
python3 - "$CSV" <<'PY'
import csv, sys
rows = list(csv.reader(open(sys.argv[1], encoding='utf-8-sig'), delimiter=';'))
hdr = rows[0]
v_idx = hdr.index('VARIANTS')
for c in range(v_idx+1, len(hdr)):
    vals = [r[c] for r in rows[1:] if len(r) > c and r[c].strip()]
    if vals:
        print(f"[col {c+1}] {hdr[c]!r}: {len(vals)} populated -> {sorted(set(vals))[:4]}")
PY
```

---

## 2. Preflight (read-only — always do this first on production)

```bash
A="--account prod-elproman"

# Confirm --account routes correctly: read a product, check article/brand vs the CSV row.
bun run src/bin.ts product get 2807 $A

# Confirm the parent category exists in Geins (parentCategoryId from the CSV).
bun run src/bin.ts product categories get 3 $A

# Existing variant labels (you'll register new ones below).
bun run src/bin.ts product variants labels list $A
```

> `product categories list` and a global "list parameter groups/defs" are **unreliable / absent**
> on some accounts (the Category Query endpoint returned `[]` on `prod-elproman`). You often
> cannot pre-check for an existing category/group by name — create fresh and reconcile later
> if a re-run produces duplicates.

---

## 3. Long text (the `Text` column → product LongText)

Per product, set the `sv` LongText (read each row's own `Text`):

```bash
bun run src/bin.ts product text set <GeinsId> longtext "sv:<Text>" --account prod-elproman
```

- Field tokens: `name | shorttext | longtext | techtext` (`text` is an alias for `longtext`).
- Locale-aware and **additive**: setting `en` later keeps the existing `sv` (read-merge-write).
- Verify: `geins product text <GeinsId> --account …`.

---

## 4. Category (once per leaf)

Create the leaf category named `leafName`, parented to `parentCategoryId`, with the `Text`
as its description (`Text` is constant across a leaf's rows; if it ever varies, take the
first row):

```bash
bun run src/bin.ts product categories create \
  --name "sv:Kopplingsplintar" \
  --parent 3 \
  --desc "sv:<Text>" \
  --account prod-elproman
# -> "✓ Created category 365: Kopplingsplintar"  (capture the id)
```

**GOTCHA — new categories are created INACTIVE.** Activate it, or product assignments will
not surface (they are stored but hidden until the category is active):

```bash
bun run src/bin.ts product categories update 365 --active --account prod-elproman
```

Assign every product of the leaf to the new category id, then make the leaf the **main**
category:

```bash
bun run src/bin.ts product categories assign   <GeinsId> 365 --account prod-elproman
bun run src/bin.ts product categories set-main <GeinsId> 365 --account prod-elproman
```

- The parent (e.g. `3`) is auto-included as an ancestor in the product's `Categories`.
- `assign` only **adds** a category — it never changes the main.
- **Main category = the FIRST entry of `CategoryIds`** on a product create/update; there is
  **no writable `MainCategoryId`** (it's read-only, silently ignored on PUT). `set-main` reads
  the current categories, moves the target to the front, and updates `CategoryIds` —
  preserving the other assignments. (`assign` then `set-main` is fine; `set-main` also assigns
  if needed via the reorder.)
- Verify: `geins product get <GeinsId> --include Categories --account … --json` →
  `MainCategoryId` should equal the leaf.

---

## 5. Images

All rows here share one image; upload once, link the rest with no re-upload.

```bash
# Upload to the first product; capture the STORED name from the JSON output.
bun run src/bin.ts product images add <firstGeinsId> \
  "https://elproman.se/category-images/6438.jpg" --account prod-elproman --json
# -> { "source": "...", "imageName": "6438.jpg", "fileName": "6438.jpg", "stored": "6438.jpg" }

# Link the same image to the other products (no bytes re-uploaded).
bun run src/bin.ts product images add-existing <otherGeinsId> 6438.jpg --account prod-elproman
```

**Naming behavior (verified live):**

- Default `images add` uses **PUT** — keeps the exact file name in a **flat global media
  namespace** (`…/product/raw/<name>`). Re-uploading the same name **replaces** it; two
  *different* images with the same basename would **clobber** each other across products.
- `images add --add` uses **POST**, which **auto-suffixes on collision** (`6438.jpg` →
  `6438_1.jpg`). The suffixed name is unpredictable, so always read it back from `stored` /
  `fileName` and use that for `add-existing`.
- Use PUT (default) when names are unique and you want idempotent re-runs; use `--add` when
  basenames might collide and each distinct image must be kept.

Verify: `geins product images <GeinsId> --account …`.

---

## 6. Variant group (products with the same `leafId`)

Group the leaf's products as variants of each other using **one dimension named `Variant`**,
whose value is the **slash-joined populated spec values** (in column order). Do **not** create
one axis per spec column — a single concatenated `Variant` value keeps the storefront to one
selectable axis.

> Example value: `100 / 0,5 / 1-4 / 16x4x0,10`

**Preflight — are the products already in a variant group?**

```bash
bun run src/bin.ts product variants <GeinsId> --account prod-elproman
```

A product belongs to **at most one** variant group, so the path depends on the answer:

### Case A — not grouped yet

Register the `Variant` label once (if not already registered), then create with a JSON body
(use the body, **not** the `--product id:L=V` flags — values contain `/`, commas, spaces):

```bash
bun run src/bin.ts product variants labels add "Variant" --account prod-elproman  # idempotent-ish; skip if present

python3 - "$CSV" > /tmp/variant-body.json <<'PY'
import csv, sys, json
rows = list(csv.reader(open(sys.argv[1], encoding='utf-8-sig'), delimiter=';'))
hdr = rows[0]; idx = {n:i for i,n in enumerate(hdr)}
dims = ["Beskrivning","För max area (mm2)","Bredd (mm)","Delning (mm)","Höjd (mm)"]  # the leaf's populated spec cols
products=[]
for r in rows[1:]:
    gid=r[idx["Geins_GeinsId"]].strip()
    if not gid: continue
    vals=[r[idx[c]].strip() for c in dims if r[idx[c]].strip()]
    products.append({"id":int(gid),"dimensions":{"Variant":" / ".join(vals)}})
print(json.dumps({"name":"<leafName>","labels":["Variant"],"products":products}, ensure_ascii=False, indent=2))
PY

bun run src/bin.ts product variants create --file /tmp/variant-body.json --account prod-elproman
```

### Case B — already grouped (overwrite each member's `Variant` value in place)

If the group already uses a `Variant` label (a common case), just set the new value per
product — no rebuild needed:

```bash
bun run src/bin.ts product variants set <GeinsId> "Variant=100 / 0,5 / 1-4 / 16x4x0,10" --account prod-elproman
```

### Case C — grouped with the *wrong* dimensions (rebuild)

If the group uses different/multiple labels, delete it and recreate via Case A:

```bash
bun run src/bin.ts product variants delete <groupId> --account prod-elproman
# then Case A
```

Notes:
- Deleting + recreating yields a **new group id** and resets **main** to the first-attached
  product (main can't be set via the Management API).
- Verify: `geins product variants <GeinsId> --account …`.

---

## 7. Parameters

A parameter **group** named after `parentCategoryName`, parameter **definitions** = the
variant dimensions, and a **value** per product.

**Step 7a — create the group** (capture the id):

```bash
bun run src/bin.ts product parameters groups create --name "Kabeltillbehör" --account prod-elproman
# -> "✓ Created parameter group 3: Kabeltillbehör"
```

**Step 7b — create one definition per dimension.** Use **`--type 1` (String)** — the values
use comma decimals (`4,0`), which would fail `--type 2` (Float requires a period like `4.0`).
Capture each parameter id.

```bash
A="--account prod-elproman"
bun run src/bin.ts product parameters defs create --name "Beskrivning"       --group 3 --type 1 $A
bun run src/bin.ts product parameters defs create --name "För max area (mm2)" --group 3 --type 1 $A
bun run src/bin.ts product parameters defs create --name "Bredd (mm)"         --group 3 --type 1 $A
bun run src/bin.ts product parameters defs create --name "Delning (mm)"       --group 3 --type 1 $A
bun run src/bin.ts product parameters defs create --name "Höjd (mm)"          --group 3 --type 1 $A
# -> parameter ids, e.g. 11..15
```

> Parameter types: `1=String  2=Float(period decimal)  3=DateTime(ISO8601)  4=Multi
> 5=Single  6=Headline  7=Tags(pipe-separated)`. Multi/Single reference predefined value ids.

**Step 7c — write all values in one batch** (6 products × 5 params). Map each dimension
column to its parameter id:

```bash
python3 - "$CSV" > /tmp/param-batch.json <<'PY'
import csv, sys, json
rows = list(csv.reader(open(sys.argv[1], encoding='utf-8-sig'), delimiter=';'))
hdr = rows[0]; idx = {n:i for i,n in enumerate(hdr)}
pmap = [("Beskrivning",11),("För max area (mm2)",12),("Bredd (mm)",13),("Delning (mm)",14),("Höjd (mm)",15)]
values=[]
for r in rows[1:]:
    gid=r[idx["Geins_GeinsId"]].strip()
    if not gid: continue
    for col,pid in pmap:
        v=r[idx[col]].strip()
        if v: values.append({"ProductId":int(gid),"ParameterId":pid,"Value":v})
print(json.dumps({"values":values}, ensure_ascii=False, indent=2))
PY

bun run src/bin.ts product parameters batch update --file /tmp/param-batch.json --account prod-elproman
```

- Batch body: `{ "values": [ { "ProductId", "ParameterId", "Value" } ] }`.
  `update` merges; `replace` overwrites a product's whole set; `remove` takes `{ "assignments": [...] }`.
- Verify: `geins product parameters <GeinsId> --account …` (lists all groups' values).

---

## 8. Gotchas & lessons (the things that bite)

- **`whoami` ignores `--account`** — verify routing by reading a product, not whoami.
- **New categories are inactive** — activate them, or assignments stay hidden in reads.
- **Main category = first in `CategoryIds`** on product create/update — `MainCategoryId` is
  read-only and silently ignored on PUT. Use `categories set-main` (reorders `CategoryIds`).
- **Category/param listing is unreliable** on some accounts — you may not be able to check
  for existing items by name; create fresh and reconcile duplicates afterward.
- **Image names are global & flat**: PUT clobbers same-named files across products; use
  `--add` (POST) to auto-suffix, and read the `stored` name back.
- **Comma decimals** (`4,0`) are strings, not floats → variant values and parameters must be
  String (`--type 1`); don't try Float.
- **Variant model = one `Variant` axis** with concatenated values; labels must be
  pre-registered, and **use the JSON body** for create (flag syntax breaks on `/`/commas/spaces).
- **Products may already be in a variant group** (a source export often pre-groups them) — a
  product can only be in one group. Use `variants set` to overwrite a member's value in place,
  or `variants delete` + recreate. Variant **main** = first attached; can't be set via the API.
- **Same `parentCategoryName` across leaves → reuse the parameter group** (don't recreate it).
  Each leaf's dimensions become new parameter *defs* inside that shared group.
- **Already-enriched products** may already have a primary image — `images add` then adds the
  CSV image as a **secondary** image (it does not replace the primary).
- **Writes are flaky (transient HTTP 400)** on busy accounts: the same `text set` / `assign` /
  `variants set` may 400 once and succeed on retry. **Retry each write a few times** (a small
  bash `for` loop with `if bun … ; then break; fi` works well).
- **Shell**: in zsh, don't stuff a command into a variable (`$B`) — it won't word-split; and
  inline `for` loops in the eval context can trip the sandbox. Prefer a **bash script file**
  (`bash script.sh`) for loops/retries, or run commands sequentially.

---

## 9. Re-runs / idempotency

- `text set`, `images add` (PUT), `parameters batch update`, `categories assign`, and
  `variants set` are effectively idempotent (re-applying the same value is a no-op/replace).
- `categories create`, `parameters groups/defs create`, `variants labels add`, and
  `variants create` are **not** idempotent — re-running creates duplicates. Capture the ids
  from the first run and reuse them, or delete the duplicates (`variants delete <groupId>`).

---

## 10. One-line operation summary

| Operation | Command |
|-----------|---------|
| Long text | `product text set <id> longtext "sv:<Text>"` |
| Category | `product categories create --name "sv:<Leaf>" --parent <pid> --desc "sv:<Text>"` → `update <cat> --active` → `categories assign <id> <cat>` → `categories set-main <id> <cat>` |
| Image (upload) | `product images add <id> <url> --json` (capture `stored`) |
| Image (reuse) | `product images add-existing <id> <stored>` |
| Variant group | one `Variant` axis = slash-joined spec values. New: `variants create --file body.json`; existing: `variants set <id> "Variant=…"`; rebuild: `variants delete <groupId>` then create |
| Parameters | `parameters groups create` → `parameters defs create --type 1` → `parameters batch update --file batch.json` |

All commands take `--account <name>` and (optionally) `--json`.
