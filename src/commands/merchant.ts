import { merchantQuery, getActiveCredentials } from '../api/live-client.ts';
import type { StoredCheckoutDefaults } from '../config/store.ts';

// Geins Merchant API (GraphQL, https://merchantapi.geins.io/graphql) — the storefront API
// that powers what a customer sees: products for sale in a sales channel, carts, and checkout.
// Auth is the profile's merchantApiKey (X-ApiKey header, injected by merchantQuery). Channel,
// market and locale are GraphQL *variables*, not headers — derived from the merchant context:
//   channelId = `${channel}|${tld}`   languageId = locale   marketId = market

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

export interface MerchantContext {
  /** Merchant API key (X-ApiKey). */
  apiKey: string;
  accountName?: string;
  channel?: string;
  tld?: string;
  market?: string;
  locale?: string;
  environment: 'prod' | 'qa' | 'dev';
  /** Persisted default checkout settings (merged into checkout tokens). */
  checkoutDefaults?: StoredCheckoutDefaults;
}

export interface ContextOverrides {
  channel?: string;
  tld?: string;
  market?: string;
  locale?: string;
  accountName?: string;
  environment?: 'prod' | 'qa' | 'dev';
}

/**
 * Resolve the storefront context for the active api-key profile. Precedence per field:
 * per-command override → GEINS_* env var → value stored on the profile (`merchant config set`).
 */
export async function resolveMerchantContext(over: ContextOverrides = {}): Promise<MerchantContext> {
  const creds = await getActiveCredentials();
  const env = process.env;
  const environment = (over.environment ?? env['GEINS_ENVIRONMENT'] ?? creds.environment ?? 'prod') as
    | 'prod'
    | 'qa'
    | 'dev';
  return {
    apiKey: creds.merchantApiKey,
    accountName: over.accountName ?? env['GEINS_MERCHANT_ACCOUNT'] ?? creds.accountName,
    channel: over.channel ?? env['GEINS_CHANNEL'] ?? creds.channel,
    tld: over.tld ?? env['GEINS_TLD'] ?? creds.tld,
    market: over.market ?? env['GEINS_MARKET'] ?? creds.market,
    locale: over.locale ?? env['GEINS_LOCALE'] ?? creds.locale,
    environment,
    checkoutDefaults: creds.checkout,
  };
}

/** The GraphQL channel/market/locale variables every storefront query/mutation accepts. */
function ctxVars(ctx: MerchantContext): Record<string, unknown> {
  return {
    channelId: ctx.channel && ctx.tld ? `${ctx.channel}|${ctx.tld}` : undefined,
    languageId: ctx.locale,
    marketId: ctx.market,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Products
// ─────────────────────────────────────────────────────────────────────────────

export interface MerchantPrice {
  sellingPriceIncVatFormatted?: string;
  regularPriceIncVatFormatted?: string;
  isDiscounted?: boolean;
  currency?: { code?: string };
}

export interface MerchantSku {
  skuId: number;
  name?: string;
  stock?: { inStock?: number; totalStock?: number };
}

export interface MerchantProduct {
  productId: number;
  name?: string;
  alias?: string;
  canonicalUrl?: string;
  brand?: { name?: string };
  unitPrice?: MerchantPrice;
  skus?: MerchantSku[];
  productImages?: { fileName?: string }[];
  primaryCategory?: { categoryId?: number; name?: string };
  categories?: { categoryId?: number; name?: string }[];
}

export interface ProductsResult {
  count?: number;
  products?: MerchantProduct[];
}

const PRODUCT_FIELDS = `
  productId name alias canonicalUrl
  brand { name }
  unitPrice { sellingPriceIncVatFormatted regularPriceIncVatFormatted isDiscounted currency { code } }
  skus { skuId name stock { inStock totalStock } }
  productImages { fileName }
`;

const PRODUCT_DETAIL_FIELDS = `
  ${PRODUCT_FIELDS}
  primaryCategory { categoryId name }
  categories { categoryId name }
`;

export interface ProductSearch {
  searchText?: string;
  categoryAlias?: string;
  brandAlias?: string;
  skip?: number;
  take?: number;
}

/** Search products for sale in the current sales channel/market. */
export async function searchProducts(s: ProductSearch, ctx: MerchantContext): Promise<ProductsResult> {
  const query = `query products($channelId:String,$languageId:String,$marketId:String,$filter:FilterInputType,$skip:Int,$take:Int,$categoryAlias:String,$brandAlias:String){
    products(channelId:$channelId,languageId:$languageId,marketId:$marketId,filter:$filter,skip:$skip,take:$take,categoryAlias:$categoryAlias,brandAlias:$brandAlias){
      count
      products { ${PRODUCT_FIELDS} }
    }
  }`;
  const data = await merchantQuery<{ products: ProductsResult }>(query, {
    ...ctxVars(ctx),
    filter: s.searchText ? { searchText: s.searchText } : undefined,
    skip: s.skip,
    take: s.take ?? 20,
    categoryAlias: s.categoryAlias,
    brandAlias: s.brandAlias,
  });
  return data.products;
}

/**
 * Full detail for a single product. A numeric argument is looked up by productId; anything
 * else is treated as a search term and the first match is returned.
 */
export async function getProduct(idOrTerm: string, ctx: MerchantContext): Promise<MerchantProduct | undefined> {
  const isId = /^\d+$/.test(idOrTerm);
  const query = `query products($channelId:String,$languageId:String,$marketId:String,$filter:FilterInputType,$take:Int){
    products(channelId:$channelId,languageId:$languageId,marketId:$marketId,filter:$filter,take:$take){
      products { ${PRODUCT_DETAIL_FIELDS} }
    }
  }`;
  const data = await merchantQuery<{ products: ProductsResult }>(query, {
    ...ctxVars(ctx),
    filter: isId ? { productIds: [Number(idOrTerm)] } : { searchText: idOrTerm },
    take: 1,
  });
  return data.products.products?.[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Categories & brands (drive product filtering by alias)
// ─────────────────────────────────────────────────────────────────────────────

export interface MerchantCategory {
  categoryId: number;
  name?: string;
  alias?: string;
}

export interface MerchantBrand {
  brandId: number;
  name?: string;
  alias?: string;
}

/** List the channel's categories (categoryId + name + alias for filtering). */
export async function listCategories(): Promise<MerchantCategory[]> {
  const data = await merchantQuery<{ categories: MerchantCategory[] }>(
    `query { categories { categoryId name alias } }`,
  );
  return data.categories ?? [];
}

/** List the channel's brands (brandId + name + alias for filtering). */
export async function listBrands(): Promise<MerchantBrand[]> {
  const data = await merchantQuery<{ brands: MerchantBrand[] }>(`query { brands { brandId name alias } }`);
  return data.brands ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Cart
// ─────────────────────────────────────────────────────────────────────────────

export interface CartItem {
  id?: string;
  skuId?: number;
  quantity: number;
  message?: string;
  product?: { productId?: number; name?: string; alias?: string };
  unitPrice?: { sellingPriceIncVatFormatted?: string };
  totalPrice?: { sellingPriceIncVatFormatted?: string };
}

export interface Cart {
  id: string;
  isCompleted?: boolean;
  promoCode?: string;
  items?: CartItem[];
  summary?: {
    subTotal?: { sellingPriceIncVatFormatted?: string };
    total?: { sellingPriceIncVatFormatted?: string; sellingPriceIncVat?: number; currency?: { code?: string } };
  };
}

/** A practical subset of the SDK's OmsCart fragment — enough to show a cart and its total. */
const CART_FRAGMENT = `fragment Cart on CartType {
  id
  isCompleted
  promoCode
  items {
    id
    skuId
    quantity
    message
    product { productId name alias }
    unitPrice { sellingPriceIncVatFormatted }
    totalPrice { sellingPriceIncVatFormatted }
  }
  summary {
    subTotal { sellingPriceIncVatFormatted }
    total { sellingPriceIncVatFormatted sellingPriceIncVat currency { code } }
  }
}`;

/** The item shape accepted by addToCart/updateCartItem (exactly one of skuId/id). */
export interface CartItemInput {
  skuId?: number;
  id?: string;
  quantity: number;
  message?: string;
}

/** Create a new cart (the API mints one when getCart is called with no id). */
export async function createCart(ctx: MerchantContext): Promise<Cart> {
  const query = `${CART_FRAGMENT}
  query createCart($channelId:String,$languageId:String,$marketId:String){
    getCart(channelId:$channelId,languageId:$languageId,marketId:$marketId){ ...Cart }
  }`;
  const data = await merchantQuery<{ getCart: Cart }>(query, ctxVars(ctx));
  return data.getCart;
}

/** Fetch an existing cart by id. */
export async function getCart(id: string, ctx: MerchantContext): Promise<Cart> {
  const query = `${CART_FRAGMENT}
  query getCart($id:String,$channelId:String,$languageId:String,$marketId:String){
    getCart(id:$id,includeCompleted:true,channelId:$channelId,languageId:$languageId,marketId:$marketId){ ...Cart }
  }`;
  const data = await merchantQuery<{ getCart: Cart }>(query, { id, ...ctxVars(ctx) });
  return data.getCart;
}

/** Add an item (by skuId or item id) to a cart. */
export async function addToCart(id: string, item: CartItemInput, ctx: MerchantContext): Promise<Cart> {
  const query = `${CART_FRAGMENT}
  mutation addToCart($id:String!,$item:CartItemInputType!,$channelId:String,$languageId:String,$marketId:String){
    addToCart(id:$id,item:$item,channelId:$channelId,languageId:$languageId,marketId:$marketId){ ...Cart }
  }`;
  const data = await merchantQuery<{ addToCart: Cart }>(query, { id, item, ...ctxVars(ctx) });
  return data.addToCart;
}

/** Update an item's quantity in a cart (quantity 0 removes it). */
export async function updateCartItem(id: string, item: CartItemInput, ctx: MerchantContext): Promise<Cart> {
  const query = `${CART_FRAGMENT}
  mutation updateCartItem($id:String!,$item:CartItemInputType!,$channelId:String,$languageId:String,$marketId:String){
    updateCartItem(id:$id,item:$item,channelId:$channelId,languageId:$languageId,marketId:$marketId){ ...Cart }
  }`;
  const data = await merchantQuery<{ updateCartItem: Cart }>(query, { id, item, ...ctxVars(ctx) });
  return data.updateCartItem;
}

/** Remove an item from a cart (implemented as updateCartItem with quantity 0, per SDK convention). */
export async function removeFromCart(id: string, itemId: string, ctx: MerchantContext): Promise<Cart> {
  return updateCartItem(id, { id: itemId, quantity: 0 }, ctx);
}

/** Apply a promotion/discount code to a cart. */
export async function setCartPromoCode(id: string, promoCode: string, ctx: MerchantContext): Promise<Cart> {
  const query = `${CART_FRAGMENT}
  mutation setCartPromoCode($id:String!,$promoCode:String!,$channelId:String,$languageId:String,$marketId:String){
    setCartPromoCode(id:$id,promoCode:$promoCode,channelId:$channelId,languageId:$languageId,marketId:$marketId){ ...Cart }
  }`;
  const data = await merchantQuery<{ setCartPromoCode: Cart }>(query, { id, promoCode, ...ctxVars(ctx) });
  return data.setCartPromoCode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout token — client-side unsigned JWT (no API call, no secret)
//
// Byte-exact replication of @geins/sdk: header {"alg":"none","typ":"JWT"}, two
// base64url segments joined by "." with NO trailing dot, base64 over latin1/binary
// bytes (btoa semantics — not utf8). The hosted Geins checkout decodes this token.
// ─────────────────────────────────────────────────────────────────────────────

/** base64url over latin1 bytes (matches the SDK's `btoa(...).replace(...)`). */
function b64urlEncode(s: string): string {
  return Buffer.from(s, 'binary').toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Inverse of b64urlEncode, decoding the latin1 bytes back to a UTF-8 string (mirrors the SDK). */
function b64urlDecode(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = Buffer.from(b64, 'base64').toString('binary');
  return decodeURIComponent(
    bin
      .split('')
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''),
  );
}

function encodeUnsignedJWT(payload: Record<string, unknown>): string {
  const header = { alg: 'none', typ: 'JWT' };
  return `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(payload))}`;
}

export type CustomerType = 'PERSON' | 'ORGANIZATION';

/** Redirect URLs shown/used by the hosted checkout (CheckoutRedirectsType in the SDK). */
export interface CheckoutRedirects {
  terms?: string;
  privacy?: string;
  success?: string;
  cancel?: string;
  continue?: string;
}

/** Visual styling tokens (CheckoutStyleType) — all CSS-ish strings. */
export interface CheckoutStyle {
  logoSize?: string;
  radius?: string;
  background?: string;
  foreground?: string;
  card?: string;
  cardForeground?: string;
  accent?: string;
  accentForeground?: string;
  border?: string;
  sale?: string;
  error?: string;
}

/** Checkout page branding (CheckoutBrandingType). */
export interface CheckoutBranding {
  title?: string;
  icon?: string;
  logo?: string;
  styles?: CheckoutStyle;
}

export interface CheckoutTokenOptions {
  cartId: string;
  selectedPaymentMethodId?: number;
  selectedShippingMethodId?: number;
  availablePaymentMethodIds?: number[];
  availableShippingMethodIds?: number[];
  isCartEditable?: boolean;
  copyCart?: boolean;
  customerType?: CustomerType;
  redirectUrls?: CheckoutRedirects;
  branding?: CheckoutBranding;
  /** Logged-in user object, passed through verbatim (GeinsUserType). */
  user?: Record<string, unknown>;
}

/**
 * Geins checkout placeholder parameters appended to the success URL so the merchant's
 * confirmation page receives order/payment info (mirrors @geins/core CHECKOUT_PARAMETERS).
 * The hosted checkout substitutes the {…} placeholders at redirect time.
 */
const CHECKOUT_PARAMETERS: [string, string][] = [
  ['geins-cart', '{geins.cartid}'],
  ['geins-pm', '{geins.paymentMethodId}'],
  ['geins-pt', '{geins.paymentType}'],
  ['geins-uid', '{payment.uid}'],
];

/** Split a URL into its base and existing query params (mirrors SDK extractParametersFromUrl). */
function extractParams(url: string): { base: string; params: [string, string][] } {
  if (!url || !url.includes('?')) return { base: url, params: [] };
  const [base, qs] = url.split('?');
  const params = (qs ? qs.split('&') : []).map((p) => p.split('=') as [string, string]);
  return { base: base!, params };
}

/**
 * Append the Geins checkout placeholders to the success URL (SDK UrlProcessor.processUrls).
 * Existing params are preserved; the four geins-* params lead, then any user params override.
 */
function processSuccessUrl(url: string): string {
  const { base, params } = extractParams(url);
  const merged = new Map<string, string>(CHECKOUT_PARAMETERS);
  for (const [k, v] of params) merged.set(k, v);
  const qs = Array.from(merged.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return qs ? `${base}?${qs}` : base;
}

/**
 * Merge per-token redirects over persisted defaults (keys: terms, success, cancel,
 * continue, privacy), dropping empties, then transform the success URL. Always returns
 * an object — the SDK emits `redirectUrls` even when empty.
 */
function resolveRedirects(over?: CheckoutRedirects, defaults?: CheckoutRedirects): CheckoutRedirects {
  const keys: (keyof CheckoutRedirects)[] = ['terms', 'success', 'cancel', 'continue', 'privacy'];
  const out: CheckoutRedirects = {};
  for (const k of keys) {
    const v = over?.[k] ?? defaults?.[k];
    if (v) out[k] = v;
  }
  if (out.success) out.success = processSuccessUrl(out.success);
  return out;
}

/** Context fields required to mint a usable checkout token. */
const REQUIRED_CTX: (keyof MerchantContext)[] = ['accountName', 'channel', 'tld', 'market', 'locale'];

/**
 * Build a checkout token from a cart id. Per-command options override the profile's
 * persisted checkout defaults. Throws (with guidance) if the merchant context is
 * incomplete, since the hosted checkout needs the full geinsSettings. The encoded
 * shape matches @geins/sdk exactly (key order, defaults, success-param transform).
 */
export function buildCheckoutToken(opts: CheckoutTokenOptions, ctx: MerchantContext): string {
  if (!opts.cartId) throw new Error('cartId is required to create a checkout token.');
  const missing = REQUIRED_CTX.filter((k) => !ctx[k]);
  if (!ctx.apiKey) missing.unshift('apiKey' as keyof MerchantContext);
  if (missing.length > 0) {
    throw new Error(
      `Checkout token needs full merchant context (missing: ${missing.join(', ')}). ` +
        `Run: geins merchant config set --channel <c> --tld <t> --market <m> --locale <l> --store-account <slug>`,
    );
  }
  const d = ctx.checkoutDefaults ?? {};
  const payload = {
    cartId: opts.cartId,
    user: opts.user, // dropped by JSON.stringify when undefined
    checkoutSettings: {
      isCartEditable: opts.isCartEditable ?? false,
      copyCart: opts.copyCart ?? true,
      selectedPaymentMethodId: opts.selectedPaymentMethodId ?? d.defaultPaymentId ?? 0,
      selectedShippingMethodId: opts.selectedShippingMethodId ?? d.defaultShippingId ?? 0,
      availablePaymentMethodIds: opts.availablePaymentMethodIds,
      availableShippingMethodIds: opts.availableShippingMethodIds,
      customerType: opts.customerType ?? d.customerType ?? 'PERSON',
      redirectUrls: resolveRedirects(opts.redirectUrls, d.redirectUrls),
      branding: opts.branding ?? d.branding,
    },
    geinsSettings: {
      apiKey: ctx.apiKey,
      accountName: ctx.accountName,
      channel: ctx.channel,
      tld: ctx.tld,
      locale: ctx.locale,
      market: ctx.market,
      environment: ctx.environment,
    },
  };
  return encodeUnsignedJWT(payload as Record<string, unknown>);
}

/** Decode a checkout token's payload (the second segment). For inspection/debugging. */
export function parseCheckoutToken(token: string): unknown {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) throw new Error('Invalid checkout token format.');
  return JSON.parse(b64urlDecode(parts[1]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact summaries (shared by direct CLI + TUI output)
// ─────────────────────────────────────────────────────────────────────────────

/** One-line product summary: name · price · stock. */
export function productLine(p: MerchantProduct): string {
  const price = p.unitPrice?.sellingPriceIncVatFormatted ?? '—';
  const wasDiscounted =
    p.unitPrice?.isDiscounted && p.unitPrice.regularPriceIncVatFormatted
      ? ` (was ${p.unitPrice.regularPriceIncVatFormatted})`
      : '';
  const stock = (p.skus ?? []).reduce((sum, s) => sum + (s.stock?.inStock ?? 0), 0);
  const stockLabel = p.skus && p.skus.length > 0 ? `  ${stock > 0 ? `${stock} in stock` : 'out of stock'}` : '';
  return `${p.name ?? p.alias ?? p.productId}  ${price}${wasDiscounted}${stockLabel}`;
}

/** Multi-line cart summary: each item + the total. */
export function cartLines(cart: Cart): string[] {
  const lines: string[] = [];
  for (const item of cart.items ?? []) {
    const name = item.product?.name ?? item.product?.alias ?? `sku ${item.skuId ?? ''}`;
    const total = item.totalPrice?.sellingPriceIncVatFormatted ?? '';
    lines.push(`${item.quantity}× ${name}${total ? `  ${total}` : ''}`);
  }
  if (cart.promoCode) lines.push(`promo: ${cart.promoCode}`);
  const total = cart.summary?.total?.sellingPriceIncVatFormatted;
  if (total) lines.push(`Total: ${total}`);
  if ((cart.items ?? []).length === 0) lines.push('(empty)');
  return lines;
}
