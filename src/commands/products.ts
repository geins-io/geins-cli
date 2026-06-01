import { mgmtRequest, mgmtUpload } from '../api/live-client.ts';
import { ApiError, formatError } from '../api/errors.ts';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

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

/** A product image (Product.Models.Read.Image). Lowest Order is the main image. */
export interface ProductImage {
  ProductId?: number;
  Url?: string;
  Order?: number;
  Tags?: string[];
}

/** A product relation type (Product.Models.Read.RelationType), e.g. "Accessories". */
export interface RelationType {
  Id?: number;
  Name?: string;
  Order?: number;
}

/** A related-product link on a product (Product.Models.Read.RelatedProduct). */
export interface RelatedProduct {
  ProductId?: number;
  RelatedProductId?: number;
  RelationTypeId?: number;
  [key: string]: unknown;
}

/**
 * A product parameter value as carried on a product (ProductParameter.Models.Read.ProductParameterValue):
 * the assignment of a `Value` to a parameter, with the parameter/group resolved for display.
 */
export interface ProductParameterValue {
  ParameterValueId?: number;
  ProductId?: number;
  ParameterId?: number;
  ParameterName?: string;
  GroupId?: number;
  GroupName?: string;
  /** Opaque type classification (1-7); the API does not document the meanings. */
  ParameterType?: number;
  Value?: string;
  Description?: string;
  LocalizedDescriptions?: LocalizableContent[];
  InternalIdentifier?: string;
  Order?: string;
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
  PrimaryImage?: string | null;
  Items?: ProductItem[];
  Variants?: Variant[];
  Images?: ProductImage[];
  RelatedProducts?: RelatedProduct[];
  ParameterValues?: ProductParameterValue[];
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

// ── Product images ─────────────────────────────────────────────────────────────

/** The images of a product, fetched via `include=Images`. */
export async function getProductImages(
  id: string,
  options?: { idType?: ProductIdType },
): Promise<ProductImage[]> {
  const product = await getProduct(id, { idType: options?.idType, include: 'Images' });
  return product.Images ?? [];
}

/** The image file name from an image Url (the basename, sans query string). */
export function imageNameFromUrl(url: string): string {
  return (url.split('?')[0] ?? url).split('/').pop() ?? url;
}

/** Map a file name's extension to the Content-Type the API accepts, or null if unsupported. */
export function imageContentType(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  return null;
}

/**
 * Load image bytes from a local file path or an http(s) URL, with a derived file name.
 * Tolerates the forms terminals produce on drag-and-drop: surrounding quotes,
 * backslash-escaped spaces, and file:// URLs.
 */
export async function loadImageSource(source: string): Promise<{ bytes: Uint8Array; name: string }> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to fetch image from URL (${res.status}): ${source}`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), name: imageNameFromUrl(source) };
  }
  let path = source.trim().replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ');
  if (/^file:\/\//i.test(path)) {
    path = decodeURIComponent(new URL(path).pathname);
  }
  const data = await readFile(path);
  return { bytes: new Uint8Array(data), name: basename(path) };
}

interface UploadImageOptions {
  idType?: ProductIdType;
  primary?: boolean;
  position?: number;
  /** 'PUT' upserts (default); 'POST' adds. */
  method?: 'PUT' | 'POST';
}

/** PUT/POST raw image bytes to /API/Product/{id}/Image/{imageName}. */
export async function uploadProductImage(
  id: string,
  imageName: string,
  bytes: Uint8Array,
  contentType: string,
  options?: UploadImageOptions,
): Promise<{ FileName?: string }> {
  const envelope = await mgmtUpload<Envelope<{ FileName?: string }>>(
    `/API/Product/${encodeURIComponent(id)}/Image/${encodeURIComponent(imageName)}`,
    bytes,
    contentType,
    {
      method: options?.method ?? 'PUT',
      query: {
        productIdType: options?.idType,
        isPrimaryImage: options?.primary,
        position: options?.position,
      },
    },
  );
  return envelope.Resource ?? {};
}

/** Add an image to a product from a local file path or an http(s) URL. */
export async function addProductImage(
  id: string,
  source: string,
  options?: { idType?: ProductIdType; name?: string; primary?: boolean; position?: number },
): Promise<{ FileName?: string; imageName: string }> {
  const { bytes, name } = await loadImageSource(source);
  const imageName = options?.name ?? name;
  const contentType = imageContentType(imageName);
  if (!contentType) {
    throw new Error(`Unsupported image type for "${imageName}". Use .jpg, .png, or .gif.`);
  }
  const result = await uploadProductImage(id, imageName, bytes, contentType, {
    idType: options?.idType,
    primary: options?.primary,
    position: options?.position,
  });
  return { ...result, imageName };
}

/** DELETE /API/Product/{id}/Image/{imageName}. */
export async function deleteProductImage(
  id: string,
  imageName: string,
  options?: { idType?: ProductIdType },
): Promise<void> {
  await mgmtRequest(`/API/Product/${encodeURIComponent(id)}/Image/${encodeURIComponent(imageName)}`, {
    method: 'DELETE',
    query: { productIdType: options?.idType },
  });
}

/**
 * Re-upload an existing image (located by name) with new primary/position flags — the
 * API has no dedicated reorder/set-primary endpoint, so we fetch the current bytes from
 * its Url and PUT them back with the updated flags.
 */
async function reuploadExistingImage(
  id: string,
  imageName: string,
  flags: { idType?: ProductIdType; primary?: boolean; position?: number },
): Promise<void> {
  const images = await getProductImages(id, { idType: flags.idType });
  const match = images.find((img) => img.Url && imageNameFromUrl(img.Url) === imageName);
  if (!match?.Url) {
    throw new Error(`Image "${imageName}" not found on product ${id}.`);
  }
  const { bytes } = await loadImageSource(match.Url);
  const contentType = imageContentType(imageName) ?? 'image/jpeg';
  await uploadProductImage(id, imageName, bytes, contentType, {
    idType: flags.idType,
    primary: flags.primary,
    position: flags.position,
  });
}

/** Make an existing image the primary one (re-uploads with isPrimaryImage=true). */
export async function setProductImagePrimary(
  id: string,
  imageName: string,
  options?: { idType?: ProductIdType },
): Promise<void> {
  await reuploadExistingImage(id, imageName, { idType: options?.idType, primary: true });
}

/** Change an existing image's position (re-uploads with the new position). */
export async function reorderProductImage(
  id: string,
  imageName: string,
  position: number,
  options?: { idType?: ProductIdType },
): Promise<void> {
  await reuploadExistingImage(id, imageName, { idType: options?.idType, position });
}

// ── Product relation types (account-wide registry) ─────────────────────────────

/** GET /API/Product/RelationTypes — all relation types. */
export async function listRelationTypes(): Promise<RelationType[]> {
  const envelope = await mgmtRequest<Envelope<RelationType[]>>('/API/Product/RelationTypes');
  return envelope.Resource ?? [];
}

/** GET /API/Product/RelationTypes/{id} — one relation type. */
export async function getRelationType(id: number): Promise<RelationType> {
  const envelope = await mgmtRequest<Envelope<RelationType>>(`/API/Product/RelationTypes/${id}`);
  return envelope.Resource;
}

/** POST /API/Product/RelationTypes — create a relation type. */
export async function createRelationType(input: { Name: string; Order?: number }): Promise<RelationType> {
  const envelope = await mgmtRequest<Envelope<RelationType>>('/API/Product/RelationTypes', {
    method: 'POST',
    body: input,
  });
  return envelope.Resource;
}

/** PUT /API/Product/RelationTypes/{id} — update a relation type. */
export async function updateRelationType(id: number, input: { Name?: string; Order?: number }): Promise<RelationType> {
  const envelope = await mgmtRequest<Envelope<RelationType>>(`/API/Product/RelationTypes/${id}`, {
    method: 'PUT',
    body: input,
  });
  return envelope.Resource;
}

/** DELETE /API/Product/RelationTypes/{id} — delete a relation type. */
export async function deleteRelationType(id: number): Promise<void> {
  await mgmtRequest(`/API/Product/RelationTypes/${id}`, { method: 'DELETE' });
}

// ── Product relations (linking products) ───────────────────────────────────────

/** The related products of a product, fetched via `include=RelatedProducts`. */
export async function getProductRelations(
  id: string,
  options?: { idType?: ProductIdType },
): Promise<RelatedProduct[]> {
  const product = await getProduct(id, { idType: options?.idType, include: 'RelatedProducts' });
  return product.RelatedProducts ?? [];
}

/** PUT /API/Product/{productId}/Related/{relationTypeId} — link related products. */
export async function linkRelatedProducts(
  productId: string,
  relationTypeId: number,
  relatedIds: string[],
  options?: { idType?: ProductIdType },
): Promise<void> {
  const body = relatedIds.map((rid) => ({ RelatedProductId: rid, RelationTypeId: relationTypeId }));
  await mgmtRequest(`/API/Product/${encodeURIComponent(productId)}/Related/${relationTypeId}`, {
    method: 'PUT',
    body,
    query: { productIdType: options?.idType },
  });
}

/** PUT /API/Product/{productId}/UnlinkRelated/{relationTypeId} — unlink related products. */
export async function unlinkRelatedProducts(
  productId: string,
  relationTypeId: number,
  relatedIds: string[],
  options?: { idType?: ProductIdType },
): Promise<void> {
  const body = relatedIds.map((rid) => ({ RelatedProductId: rid, RelationTypeId: relationTypeId }));
  await mgmtRequest(`/API/Product/${encodeURIComponent(productId)}/UnlinkRelated/${relationTypeId}`, {
    method: 'PUT',
    body,
    query: { productIdType: options?.idType },
  });
}

// ── Product parameters ──────────────────────────────────────────────────────────
//
// Two layers (mirroring relation-types + relations):
//   1. Definitions  — the account-wide registry of parameters, groups and predefined
//      values under /API/ProductParameter. A "parameter" (e.g. "Material") belongs to a
//      group and has a ParameterType (1-7, an opaque classification).
//   2. Values        — a product's assignments under /API/Product/{id}/Parameter/{paramId}:
//      a `Value` string (plus optional localized descriptions) for a given parameter.

/** A product parameter definition (ProductParameter.Models.Read.ProductParameter). */
export interface ProductParameter {
  ParameterId?: number;
  GroupId?: number;
  GroupName?: string;
  /** Opaque type classification (1-7); the API does not document the meanings. */
  ParameterType?: number;
  Name?: string;
  LocalizedNames?: LocalizableContent[];
  PredefinedValues?: ProductParameterPredefinedValue[];
}

/** A parameter group (ProductParameter.Models.Read.ProductParameterGroup) — organizes parameters. */
export interface ProductParameterGroup {
  GroupId?: number;
  Name?: string;
  Order?: number;
  LocalizedNames?: LocalizableContent[];
  ParameterIds?: number[];
}

/** A predefined value (ProductParameter.Models.Read.ProductParameterPredefinedValue) — a preset option for a parameter. */
export interface ProductParameterPredefinedValue {
  ParameterId?: number;
  PredefinedValueId?: number;
  Name?: string;
  LocalizedNames?: LocalizableContent[];
}

// ── Per-product parameter values ────────────────────────────────────────────────

/** The parameter values of a product, fetched via `include=ParameterValues`. */
export async function getProductParameters(
  id: string,
  options?: { idType?: ProductIdType },
): Promise<ProductParameterValue[]> {
  const product = await getProduct(id, { idType: options?.idType, include: 'ParameterValues' });
  return product.ParameterValues ?? [];
}

/** GET /API/Product/{productId}/Parameter/{parameterId} — one resolved parameter value. */
export async function getProductParameterValue(
  productId: string,
  parameterId: number,
  options?: { idType?: ProductIdType },
): Promise<ProductParameterValue> {
  const envelope = await mgmtRequest<Envelope<ProductParameterValue>>(
    `/API/Product/${encodeURIComponent(productId)}/Parameter/${parameterId}`,
    { query: { productIdType: options?.idType } },
  );
  return envelope.Resource;
}

/** POST /API/Product/{productId}/Parameter/{parameterId} — assign/update a parameter value on a product. */
export async function setProductParameterValue(
  productId: string,
  parameterId: number,
  value: string,
  options?: { idType?: ProductIdType; localizedDescriptions?: LocalizableContent[] },
): Promise<ProductParameterValue> {
  const envelope = await mgmtRequest<Envelope<ProductParameterValue>>(
    `/API/Product/${encodeURIComponent(productId)}/Parameter/${parameterId}`,
    {
      method: 'POST',
      body: { Value: value, LocalizedDescriptions: options?.localizedDescriptions },
      query: { productIdType: options?.idType },
    },
  );
  return envelope.Resource;
}

/** DELETE /API/Product/{productId}/Parameter/{parameterId} — remove a parameter assignment from a product. */
export async function removeProductParameterValue(
  productId: string,
  parameterId: number,
  options?: { idType?: ProductIdType },
): Promise<void> {
  await mgmtRequest(`/API/Product/${encodeURIComponent(productId)}/Parameter/${parameterId}`, {
    method: 'DELETE',
    query: { productIdType: options?.idType },
  });
}

/** A parameter-value assignment used by the batch endpoints (ProductParameter.Models.Write.ProductParameterValue). */
export interface ProductParameterValueWrite {
  ProductId: number;
  ParameterId: number;
  Value: string;
  LocalizedDescriptions?: LocalizableContent[];
}

/**
 * PUT /API/Product/Parameter/Values — batch UPDATE (merge): values not supplied stay on
 * the product. POST is a batch REPLACE — values not supplied are removed (see {@link replaceProductParameterValues}).
 */
export async function updateProductParameterValues(values: ProductParameterValueWrite[]): Promise<void> {
  await mgmtRequest('/API/Product/Parameter/Values', {
    method: 'PUT',
    body: { productParameterValues: values },
  });
}

/**
 * POST /API/Product/Parameter/Values — batch REPLACE: any existing value not supplied in
 * the request is removed from the product. Use {@link updateProductParameterValues} to merge instead.
 */
export async function replaceProductParameterValues(values: ProductParameterValueWrite[]): Promise<void> {
  await mgmtRequest('/API/Product/Parameter/Values', {
    method: 'POST',
    body: { productParameterValues: values },
  });
}

/** A single product/parameter pair for the batch-remove endpoint. */
export interface ProductParameterAssignment {
  ProductId: number;
  ParameterId: number;
}

/** PATCH /API/Product/Parameter/Values/Remove — batch-remove parameter assignments from products. */
export async function removeProductParameterAssignments(
  assignments: ProductParameterAssignment[],
): Promise<void> {
  await mgmtRequest('/API/Product/Parameter/Values/Remove', {
    method: 'PATCH',
    body: { ProductParameterAssignments: assignments },
  });
}

/** "Label=Value" summary of a product's parameter values, for compact display. */
export function parameterValueSummary(v: ProductParameterValue): string {
  const name = v.ParameterName ?? (v.ParameterId != null ? `#${v.ParameterId}` : '?');
  return `${name}=${v.Value ?? ''}`;
}

// ── Parameter definitions (account-wide registry) ──────────────────────────────

/** GET /API/ProductParameter/{id} — a parameter definition (incl. its predefined values). */
export async function getProductParameterDef(id: number): Promise<ProductParameter> {
  const envelope = await mgmtRequest<Envelope<ProductParameter>>(`/API/ProductParameter/${id}`);
  return envelope.Resource;
}

export interface ProductParameterInput {
  Name: string;
  GroupId: number;
  ParameterType: number;
  /** Only sent on update; omit on create (the API assigns it). */
  ParameterId?: number;
  LocalizedNames?: LocalizableContent[];
}

/** POST /API/ProductParameter — create a parameter definition. */
export async function createProductParameter(input: ProductParameterInput): Promise<ProductParameter> {
  const envelope = await mgmtRequest<Envelope<ProductParameter>>('/API/ProductParameter', {
    method: 'POST',
    body: input,
  });
  return envelope.Resource;
}

/** PUT /API/ProductParameter/{id} — update a parameter definition. */
export async function updateProductParameter(
  id: number,
  input: Partial<ProductParameterInput>,
): Promise<ProductParameter> {
  const envelope = await mgmtRequest<Envelope<ProductParameter>>(`/API/ProductParameter/${id}`, {
    method: 'PUT',
    body: { ParameterId: id, ...input },
  });
  return envelope.Resource;
}

/** GET /API/ProductParameter/Group/{id} — a parameter group. */
export async function getProductParameterGroup(id: number): Promise<ProductParameterGroup> {
  const envelope = await mgmtRequest<Envelope<ProductParameterGroup>>(`/API/ProductParameter/Group/${id}`);
  return envelope.Resource;
}

export interface ProductParameterGroupInput {
  Name: string;
  Order?: number;
  ParameterIds?: number[];
  LocalizedNames?: LocalizableContent[];
}

/** POST /API/ProductParameter/Group — create a parameter group. */
export async function createProductParameterGroup(
  input: ProductParameterGroupInput,
): Promise<ProductParameterGroup> {
  const envelope = await mgmtRequest<Envelope<ProductParameterGroup>>('/API/ProductParameter/Group', {
    method: 'POST',
    body: input,
  });
  return envelope.Resource;
}

/** PUT /API/ProductParameter/Group/{id} — update a parameter group. */
export async function updateProductParameterGroup(
  id: number,
  input: Partial<ProductParameterGroupInput>,
): Promise<ProductParameterGroup> {
  const envelope = await mgmtRequest<Envelope<ProductParameterGroup>>(`/API/ProductParameter/Group/${id}`, {
    method: 'PUT',
    body: input,
  });
  return envelope.Resource;
}

/** GET /API/ProductParameter/PredefinedValue/{id} — a predefined value. */
export async function getPredefinedValue(id: number): Promise<ProductParameterPredefinedValue> {
  const envelope = await mgmtRequest<Envelope<ProductParameterPredefinedValue>>(
    `/API/ProductParameter/PredefinedValue/${id}`,
  );
  return envelope.Resource;
}

export interface PredefinedValueInput {
  ParameterId: number;
  Name: string;
  PredefinedValueId?: number;
  LocalizedNames?: LocalizableContent[];
}

/** POST /API/ProductParameter/PredefinedValue — create a predefined value for a parameter. */
export async function createPredefinedValue(
  input: PredefinedValueInput,
): Promise<ProductParameterPredefinedValue> {
  const envelope = await mgmtRequest<Envelope<ProductParameterPredefinedValue>>(
    '/API/ProductParameter/PredefinedValue',
    { method: 'POST', body: input },
  );
  return envelope.Resource;
}

/** PUT /API/ProductParameter/PredefinedValue/{predefinedValueId} — rename a predefined value (name + localized names). */
export async function updatePredefinedValueNames(
  predefinedValueId: number,
  name: string,
  localizedNames?: LocalizableContent[],
): Promise<ProductParameterPredefinedValue> {
  const envelope = await mgmtRequest<Envelope<ProductParameterPredefinedValue>>(
    `/API/ProductParameter/PredefinedValue/${predefinedValueId}`,
    { method: 'PUT', body: { PredefinedValueId: predefinedValueId, Name: name, LocalizedNames: localizedNames } },
  );
  return envelope.Resource;
}
