import { mgmtRequest } from '../api/live-client.ts';
import { ApiError, formatError } from '../api/errors.ts';

export interface LocalizableContent {
  LanguageCode: string;
  Content: string;
}

/** Stock figures for a product item (Product.Models.Read.ProductItemStock). */
export interface ProductItemStock {
  ItemId?: number;
  Stock?: number;
  StockOversellable?: number;
  StockStatic?: number;
  StockSellable?: number;
}

/** A product item / SKU / variant (Product.Models.Read.ProductItem). */
export interface ProductItem {
  ItemId: number;
  ArticleNumber?: string;
  ProductId?: number;
  Name?: string;
  Gtin?: string;
  Active?: boolean;
  Shelf?: string;
  Weight?: number;
  DateCreated?: string;
  DateUpdated?: string;
  DateIncoming?: string;
  ExternalId?: string;
  Stock?: ProductItemStock;
  [key: string]: unknown;
}

/**
 * A variant dimension of a product (Variant.Models.Read.Variant): a Label/Value pair
 * such as Label="Color", Value="Red", distinguishing this product within its group.
 */
export interface Variant {
  ProductId?: number;
  GroupId?: number;
  Label?: string;
  Value?: string;
}

/** A product as returned by the Management API (Product.Models.Read.Product). */
export interface Product {
  ProductId: number;
  ArticleNumber: string;
  Names?: LocalizableContent[];
  Active: boolean;
  PurchasePrice?: number;
  PurchasePriceCurrency?: string;
  BrandId?: number;
  BrandName?: string;
  SupplierId?: number;
  SupplierName?: string;
  MainCategoryId?: number;
  Items?: ProductItem[];
  Variants?: Variant[];
  DateCreated?: string;
  DateUpdated?: string;
  DateFirstAvailable?: string;
  [key: string]: unknown;
}

/**
 * A variant group (Variant.Models.Read.VariantGroup): links sibling products that are
 * variants of one another (e.g. the same shirt as separate Red/Blue/Green products).
 */
export interface VariantGroup {
  GroupId: number;
  Name?: string;
  CollapseInLists?: boolean;
  MainProductId?: number;
  ProductIds?: number[];
  Products?: Product[];
}

interface Envelope<T> {
  Resource: T;
  Message?: string;
  Details?: string[];
}

interface PageResult {
  BatchId?: string;
  Page?: number;
  RowCount?: number;
  PageCount?: number;
  PageSize?: number;
  HasMoreRows?: boolean;
}

interface PagedEnvelope<T> {
  PageResult?: PageResult;
  Resource: T;
  Message?: string;
  Details?: string[];
}

/**
 * The type of product id supplied to `getProduct`.
 *   0 = Internal (Geins id, e.g. 10001)
 *   1 = ArticleNumber (e.g. ABC123)
 *   2 = MarketPrefixedInternal (e.g. SE10001)
 *   3 = MarketPrefixedArticleNumber (e.g. SEABC123)
 */
export type ProductIdType = 0 | 1 | 2 | 3;

export interface GetProductOptions {
  idType?: ProductIdType;
  /** Child-collections to include, e.g. "Names,Prices,Categories". */
  include?: string;
}

export async function getProduct(id: string, options?: GetProductOptions): Promise<Product> {
  const envelope = await mgmtRequest<Envelope<Product>>(`/API/Product/${encodeURIComponent(id)}`, {
    query: { productIdType: options?.idType, include: options?.include },
  });
  return envelope.Resource;
}

/** A product query body (Product.Models.ProductQuery). All fields optional. */
export interface ProductQuery {
  UpdatedAfter?: string;
  CreatedAfter?: string;
  CreatedBefore?: string;
  ProductIds?: number[];
  CategoryIds?: number[];
  BrandIds?: number[];
  SupplierIds?: number[];
  ArticleNumbers?: string[];
  OnlySellable?: boolean;
  OnlyInStock?: boolean;
  FeedId?: number;
  /** Required when fetching pages beyond the first; comes from PageResult.BatchId. */
  BatchId?: string;
}

export interface QueryProductsResult {
  products: Product[];
  page?: PageResult;
}

export async function queryProducts(
  query: ProductQuery = {},
  options?: { include?: string; page?: number },
): Promise<QueryProductsResult> {
  const page = options?.page;
  // The paged endpoint returns PageResult (incl. BatchId); the plain endpoint returns
  // every match in one array with no paging info. Pages beyond 1 need BatchId in the body.
  const path = page != null ? `/API/Product/Query/${page}` : '/API/Product/Query';
  const envelope = await mgmtRequest<PagedEnvelope<Product[]>>(path, {
    method: 'POST',
    body: query,
    query: { include: options?.include ?? 'Names' },
  });
  return { products: envelope.Resource ?? [], page: envelope.PageResult };
}

export interface ProductListArgs {
  query: ProductQuery;
  page?: number;
  include?: string;
  json: boolean;
}

/** Parse `product list` flags into a query + options, shared by the TUI and direct CLI. */
export function parseProductListArgs(args: string[]): ProductListArgs {
  const query: ProductQuery = {};
  let page: number | undefined;
  let include: string | undefined;
  let json = false;

  const num = (s?: string): number | undefined =>
    s != null && s.trim() !== '' && !Number.isNaN(Number(s)) ? Number(s) : undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--brand': { const v = num(args[++i]); if (v != null) (query.BrandIds ??= []).push(v); break; }
      case '--category': { const v = num(args[++i]); if (v != null) (query.CategoryIds ??= []).push(v); break; }
      case '--supplier': { const v = num(args[++i]); if (v != null) (query.SupplierIds ??= []).push(v); break; }
      case '--id': { const v = num(args[++i]); if (v != null) (query.ProductIds ??= []).push(v); break; }
      case '--article': { const v = args[++i]; if (v) (query.ArticleNumbers ??= []).push(v); break; }
      case '--updated-after': { const v = args[++i]; if (v) query.UpdatedAfter = v; break; }
      case '--created-after': { const v = args[++i]; if (v) query.CreatedAfter = v; break; }
      case '--sellable': query.OnlySellable = true; break;
      case '--in-stock': query.OnlyInStock = true; break;
      case '--page': page = num(args[++i]); break;
      case '--batch': { const v = args[++i]; if (v) query.BatchId = v; break; }
      case '--include': include = args[++i]; break;
      case '--json': json = true; break;
    }
  }

  return { query, page, include, json };
}

/** Best-effort display name for a product, falling back to its article number. */
export function productName(product: Product): string {
  const localized = product.Names?.find((n) => n.Content?.trim())?.Content;
  return (localized ?? product.ArticleNumber ?? String(product.ProductId)).trim();
}

/** The items (SKUs) of a product, fetched via `include=Items`. */
export async function getProductItems(
  id: string,
  options?: { idType?: ProductIdType },
): Promise<ProductItem[]> {
  const product = await getProduct(id, { idType: options?.idType, include: 'Items' });
  return product.Items ?? [];
}

/** Best-effort display name for a product item, falling back to its article number or id. */
export function productItemName(item: ProductItem): string {
  return (item.Name ?? item.ArticleNumber ?? String(item.ItemId)).trim();
}

/**
 * The variant group a product belongs to — the sibling products that are variants of
 * each other. Returns null if the product has no variant group. By default expands the
 * member Products with their Names and Variant dimensions.
 */
export async function getVariantGroup(
  id: string,
  options?: { idType?: ProductIdType; include?: string },
): Promise<VariantGroup | null> {
  try {
    const envelope = await mgmtRequest<Envelope<VariantGroup>>(
      `/API/Variant/${encodeURIComponent(id)}/VariantGroup`,
      { query: { productIdType: options?.idType, include: options?.include ?? 'Names,Variants' } },
    );
    return envelope.Resource ?? null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * The variant dimensions of a product as "Label=Value" pairs, e.g. "Color=Red, Size=M".
 * Within a variant group every member carries the whole group's Variants array, so we
 * filter to the entries belonging to this product (falling back to all if none match).
 */
export function variantSummary(product: Product): string {
  const all = product.Variants ?? [];
  const own = all.filter((v) => v.ProductId === product.ProductId);
  const list = own.length > 0 ? own : all;
  return list
    .filter((v) => v.Label || v.Value)
    .map((v) => `${v.Label ?? '?'}=${v.Value ?? '?'}`)
    .join(', ');
}

// ── Variant write operations (creating groups from existing products) ──────────

/** A single variant dimension assignment, e.g. { Label: "Color", Value: "Red" }. */
export interface VariantAssignment {
  Label: string;
  Value: string;
}

/** Body for POST /API/VariantGroup (Variant.Models.Write.VariantGroup). */
export interface CreateVariantGroupInput {
  Name?: string;
  CollapseInLists?: boolean;
  VariantLabels?: string[];
}

/** POST /API/VariantGroup — create an empty variant group. Returns it (incl. GroupId). */
export async function createVariantGroup(input: CreateVariantGroupInput): Promise<VariantGroup> {
  const envelope = await mgmtRequest<Envelope<VariantGroup>>('/API/VariantGroup', {
    method: 'POST',
    body: input,
  });
  return envelope.Resource;
}

/**
 * PUT /API/VariantGroup/{groupId}/{productId} — attach an EXISTING product to the group
 * and set its variant dimensions in one call.
 */
export async function addProductToVariantGroup(
  groupId: number,
  productId: string,
  dimensions: VariantAssignment[],
  options?: { idType?: ProductIdType },
): Promise<VariantGroup> {
  const envelope = await mgmtRequest<Envelope<VariantGroup>>(
    `/API/VariantGroup/${groupId}/${encodeURIComponent(productId)}`,
    { method: 'PUT', body: dimensions, query: { productIdType: options?.idType } },
  );
  return envelope.Resource;
}

/** PUT /API/Variant/{productId} — update the dimensions of a product already in a group. */
export async function setProductVariants(
  productId: string,
  dimensions: VariantAssignment[],
  options?: { idType?: ProductIdType },
): Promise<void> {
  await mgmtRequest(`/API/Variant/${encodeURIComponent(productId)}`, {
    method: 'PUT',
    body: dimensions,
    query: { productIdType: options?.idType },
  });
}

/** DELETE /API/VariantGroup/{groupId} — used for best-effort cleanup on total failure. */
export async function deleteVariantGroup(groupId: number): Promise<void> {
  await mgmtRequest(`/API/VariantGroup/${groupId}`, { method: 'DELETE' });
}

// ── Variant label (dimension) registry ────────────────────────────────────────

/** GET /API/Variant/Labels — the registered variant labels (dimension names). */
export async function listVariantLabels(): Promise<string[]> {
  const envelope = await mgmtRequest<Envelope<string[]>>('/API/Variant/Labels');
  return envelope.Resource ?? [];
}

/** POST /API/Variant/Label — register a new variant label. */
export async function addVariantLabel(label: string): Promise<void> {
  await mgmtRequest('/API/Variant/Label', { method: 'POST', body: { Label: label } });
}

/** PUT /API/Variant/Label/{oldLabel} — rename a variant label. */
export async function renameVariantLabel(oldLabel: string, newLabel: string): Promise<void> {
  await mgmtRequest(`/API/Variant/Label/${encodeURIComponent(oldLabel)}`, {
    method: 'PUT',
    body: { Label: newLabel },
  });
}

/** DELETE /API/Variant/Label/{label} — remove a variant label. */
export async function removeVariantLabel(label: string): Promise<void> {
  await mgmtRequest(`/API/Variant/Label/${encodeURIComponent(label)}`, { method: 'DELETE' });
}

// ── Orchestrator: build a variant group from existing products ─────────────────

export interface VariantGroupProductSpec {
  id: string;
  dimensions: VariantAssignment[];
}

export interface BuildVariantGroupInput {
  name?: string;
  collapseInLists?: boolean;
  /** Declared dimensions the group tracks. If omitted, derived from the products' labels. */
  labels?: string[];
  products: VariantGroupProductSpec[];
  idType?: ProductIdType;
}

export interface VariantGroupProductResult {
  id: string;
  ok: boolean;
  error?: string;
}

export interface BuildVariantGroupResult {
  groupId: number;
  labels: string[];
  products: VariantGroupProductResult[];
  allSucceeded: boolean;
  cleanedUp: boolean;
  /** Caveat surfaced in the result (also in --json) so callers don't over-promise. */
  note: string;
}

/**
 * Create a variant group from existing products and assign each its dimensions.
 * Validates (before any write) that all declared labels are registered and that every
 * product's dimension labels are within the declared set. Then POSTs the group and PUTs
 * each product. Keeps the group on partial success; cleans it up only if every product
 * failed to attach. Throws before any write on validation errors.
 */
export async function buildVariantGroupFromProducts(
  input: BuildVariantGroupInput,
): Promise<BuildVariantGroupResult> {
  if (!input.products || input.products.length === 0) {
    throw new Error('No products supplied. Provide at least one product to group.');
  }

  // Resolve declared labels (explicit list, or the union of the products' labels).
  const labels = input.labels && input.labels.length > 0
    ? input.labels
    : [...new Set(input.products.flatMap((p) => p.dimensions.map((d) => d.Label)))];

  if (labels.length === 0) {
    throw new Error('No dimensions specified. Declare at least one label (e.g. --label Color).');
  }

  // Require labels to be registered (explicit model — no auto-registration).
  const registered = await listVariantLabels();
  const unknown = labels.filter((l) => !registered.includes(l));
  if (unknown.length > 0) {
    throw new Error(
      `Unregistered variant label(s): ${unknown.join(', ')}.\n` +
        `Register them first, e.g.: geins product variants labels add ${unknown[0]}`,
    );
  }

  // Every product's dimension labels must be within the declared set.
  for (const p of input.products) {
    const bad = p.dimensions.map((d) => d.Label).filter((l) => !labels.includes(l));
    if (bad.length > 0) {
      throw new Error(
        `Product ${p.id} references undeclared label(s): ${bad.join(', ')}. ` +
          `Declared labels: ${labels.join(', ')}`,
      );
    }
  }

  // Create the group, then attach each product sequentially.
  const group = await createVariantGroup({
    Name: input.name,
    CollapseInLists: input.collapseInLists,
    VariantLabels: labels,
  });

  const results: VariantGroupProductResult[] = [];
  for (const p of input.products) {
    try {
      await addProductToVariantGroup(group.GroupId, p.id, p.dimensions, { idType: input.idType });
      results.push({ id: p.id, ok: true });
    } catch (err) {
      results.push({ id: p.id, ok: false, error: formatError(err) });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  let cleanedUp = false;
  if (succeeded === 0) {
    // Nothing attached — remove the orphan group (best-effort).
    try {
      await deleteVariantGroup(group.GroupId);
      cleanedUp = true;
    } catch {
      cleanedUp = false;
    }
  }

  return {
    groupId: group.GroupId,
    labels,
    products: results,
    allSucceeded: succeeded === input.products.length,
    cleanedUp,
    note: 'The main product cannot be set via the Management API (no MainProductId on write).',
  };
}

// ── Input parsing (shared by CLI flags and JSON body) ──────────────────────────

/** Parse a JSON body ({ name, collapse, idType, labels, products:[{id,dimensions}] }). */
export function parseVariantGroupBody(raw: unknown): BuildVariantGroupInput {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawProducts = Array.isArray(obj.products) ? obj.products : [];
  const products: VariantGroupProductSpec[] = rawProducts.map((p) => {
    const pr = (p ?? {}) as Record<string, unknown>;
    const id = String(pr.id ?? '');
    const dims = pr.dimensions;
    let dimensions: VariantAssignment[] = [];
    if (Array.isArray(dims)) {
      dimensions = dims.map((d) => {
        const dd = (d ?? {}) as Record<string, unknown>;
        return { Label: String(dd.Label ?? dd.label ?? ''), Value: String(dd.Value ?? dd.value ?? '') };
      });
    } else if (dims && typeof dims === 'object') {
      dimensions = Object.entries(dims as Record<string, unknown>).map(([Label, Value]) => ({
        Label,
        Value: String(Value),
      }));
    }
    return { id, dimensions };
  });

  const idTypeNum = obj.idType != null ? Number(obj.idType) : undefined;
  return {
    name: obj.name != null ? String(obj.name) : undefined,
    collapseInLists: obj.collapse != null ? Boolean(obj.collapse) : undefined,
    labels: Array.isArray(obj.labels) ? obj.labels.map(String) : undefined,
    products,
    idType: idTypeNum != null && idTypeNum >= 0 && idTypeNum <= 3 ? (idTypeNum as ProductIdType) : undefined,
  };
}

/**
 * Parse `variants create` flags into a BuildVariantGroupInput.
 *   --name <n>  --label <L> (repeatable)  --collapse  --idtype <0-3>
 *   --product <id>:Label=Value,Label=Value  (repeatable)
 */
export function parseVariantCreateFlags(args: string[]): BuildVariantGroupInput {
  const labels: string[] = [];
  const products: VariantGroupProductSpec[] = [];
  let name: string | undefined;
  let collapseInLists: boolean | undefined;
  let idType: ProductIdType | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--name': name = args[++i]; break;
      case '--label': { const v = args[++i]; if (v) labels.push(v); break; }
      case '--collapse': collapseInLists = true; break;
      case '--idtype': {
        const n = Number(args[++i]);
        if (n >= 0 && n <= 3) idType = n as ProductIdType;
        break;
      }
      case '--product': {
        const spec = args[++i];
        if (!spec) break;
        // <id>:Label=Value,Label=Value   (the part after the first ':' is the dimensions)
        const colon = spec.indexOf(':');
        const id = colon === -1 ? spec : spec.slice(0, colon);
        const dimsPart = colon === -1 ? '' : spec.slice(colon + 1);
        const dimensions: VariantAssignment[] = dimsPart
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((pair) => {
            const eq = pair.indexOf('=');
            return eq === -1
              ? { Label: pair, Value: '' }
              : { Label: pair.slice(0, eq).trim(), Value: pair.slice(eq + 1).trim() };
          });
        products.push({ id, dimensions });
        break;
      }
    }
  }

  return { name, collapseInLists, labels: labels.length > 0 ? labels : undefined, products, idType };
}
