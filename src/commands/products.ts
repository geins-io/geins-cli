import { mgmtRequest } from '../api/live-client.ts';

export interface LocalizableContent {
  LanguageCode: string;
  Content: string;
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
  DateCreated?: string;
  DateUpdated?: string;
  DateFirstAvailable?: string;
  [key: string]: unknown;
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
