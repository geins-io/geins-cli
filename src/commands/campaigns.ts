import { mgmtRequest } from '../api/live-client.ts';

// Campaigns are part of the Management API (/API/Campaign/...). This module mirrors the
// shape of src/commands/orders.ts: mgmtRequest-based, Envelope-wrapped responses.

/** A localized string (LocalizedItem) — used by Title. */
export interface LocalizedItem {
  Language: string;
  Value: string;
}

/** A row in `GET /API/Campaign/List` (CampaignListItem). */
export interface CampaignListItem {
  CampaignId?: string;
  Type?: string;
  CampaignBaseType?: string;
  Market?: string;
  StartDate?: string;
  CreateDate?: string;
  Status?: string;
  Title?: string;
  PromoCode?: string;
  Description?: string;
  Priority?: number;
}

/** A campaign type from `GET /API/Campaign/Types` (CampaignTypeItem). */
export interface CampaignTypeItem {
  Id?: number;
  Name?: string;
}

/**
 * A full campaign (CampaignDetailItem). Key fields typed; the rest via the index signature.
 * Note: read responses serialize enums as strings ("code", "Percentage"); writes take ints.
 */
export interface CampaignDetailItem {
  CampaignNumber?: number;
  CampaignId?: string;
  Status?: string;
  CampaignBaseType?: string | number;
  CampaignTypeId?: number;
  Title?: LocalizedItem[];
  Description?: string;
  MarketId?: string;
  PromoCode?: string;
  PercentageValue?: number;
  Amounts?: Record<string, number>;
  ValidFrom?: string;
  ValidTo?: string;
  UsageLimit?: number;
  OncePerCustomer?: boolean;
  Priority?: number;
  Enabled?: boolean;
  [key: string]: unknown;
}

/**
 * The create/update body (CampaignDetailItemBase). Only the promocode-relevant fields are
 * typed; the index signature lets callers pass any other supported field through verbatim.
 */
export interface CampaignWrite {
  CampaignBaseType?: number;
  CampaignTypeId?: number;
  Title?: LocalizedItem[];
  Description?: string;
  MarketId?: string;
  PromoCode?: string;
  PercentageValue?: number;
  Amounts?: Record<string, number>;
  ValidFrom?: string;
  ValidTo?: string;
  UsageLimit?: number;
  OncePerCustomer?: boolean;
  Priority?: number;
  Enabled?: boolean;
  /**
   * Admin "Only include discounted products". The API DEFAULTS this to `true` when omitted,
   * which silently restricts the campaign to already-discounted products — almost never what a
   * plain promo code wants. Always send it explicitly (false for a normal store-wide discount).
   */
  UseSalePrice?: boolean;
  [key: string]: unknown;
}

/**
 * Campaign base types (CampaignBaseType enum). `code` is the promocode kind.
 * 0 = NOT_SET, 1 = cart, 2 = code, 3 = product.
 */
export const CAMPAIGN_BASE_TYPE = { cart: 1, code: 2, product: 3 } as const;

/**
 * Common campaign type ids (from `GET /API/Campaign/Types`). The list is account-defined, so
 * always confirm with `campaign types`; these are the stable built-ins used for promocodes.
 */
export const CAMPAIGN_TYPE = { percentage: 3, fixedAmount: 4 } as const;

/** Campaign endpoints return an Envelope `{ Resource }`; unwrap it when present. */
function unwrap<T>(res: unknown): T {
  if (res && typeof res === 'object' && 'Resource' in (res as Record<string, unknown>)) {
    return (res as { Resource: T }).Resource;
  }
  return res as T;
}

/** GET /API/Campaign/List — all campaigns (summary rows). */
export async function listCampaigns(): Promise<CampaignListItem[]> {
  return unwrap<CampaignListItem[]>(await mgmtRequest('/API/Campaign/List')) ?? [];
}

/** GET /API/Campaign/Types — the available campaign (discount) types. */
export async function getCampaignTypes(): Promise<CampaignTypeItem[]> {
  return unwrap<CampaignTypeItem[]>(await mgmtRequest('/API/Campaign/Types')) ?? [];
}

/** GET /API/Campaign/{id} — one campaign in full. */
export async function getCampaign(id: string): Promise<CampaignDetailItem> {
  return unwrap<CampaignDetailItem>(await mgmtRequest(`/API/Campaign/${encodeURIComponent(id)}`));
}

/** POST /API/Campaign — create a campaign. Returns the new campaign. */
export async function createCampaign(body: CampaignWrite): Promise<CampaignDetailItem> {
  return unwrap<CampaignDetailItem>(await mgmtRequest('/API/Campaign', { method: 'POST', body }));
}

export interface PromoCodeCampaignOptions {
  promoCode: string;
  marketId: string;
  /** Percentage discount (CampaignTypeId 3). Mutually exclusive with `amounts`. */
  percentage?: number;
  /** Fixed-amount discount keyed by ISO currency (CampaignTypeId 4). e.g. { SEK: 50 }. */
  amounts?: Record<string, number>;
  title?: LocalizedItem[];
  validFrom?: string;
  validTo?: string;
  usageLimit?: number;
  oncePerCustomer?: boolean;
  priority?: number;
  enabled?: boolean;
  /**
   * Restrict the campaign to already-discounted products (admin "Only include discounted products",
   * i.e. UseSalePrice). Defaults to false — a plain promo code should apply to all products.
   */
  onlyDiscountedProducts?: boolean;
}

/**
 * Assemble a code-base campaign body from parsed flags. Pure — cli.ts feeds it parsed values.
 * Picks the discount mechanic from `percentage` (Percentage) or `amounts` (Fixed amount).
 */
export function buildPromoCodeCampaign(opts: PromoCodeCampaignOptions): CampaignWrite {
  const body: CampaignWrite = {
    CampaignBaseType: CAMPAIGN_BASE_TYPE.code,
    PromoCode: opts.promoCode,
    MarketId: opts.marketId,
    Title: opts.title ?? [],
    Enabled: opts.enabled ?? true,
    ValidFrom: opts.validFrom ?? new Date().toISOString(),
    // The API defaults UseSalePrice to true (admin "Only include discounted products"), which would
    // silently limit the code to discounted products. Force it off unless the caller opts in.
    UseSalePrice: opts.onlyDiscountedProducts ?? false,
  };
  if (opts.amounts && Object.keys(opts.amounts).length > 0) {
    body.CampaignTypeId = CAMPAIGN_TYPE.fixedAmount;
    body.Amounts = opts.amounts;
  } else {
    body.CampaignTypeId = CAMPAIGN_TYPE.percentage;
    body.PercentageValue = opts.percentage;
  }
  if (opts.validTo != null) body.ValidTo = opts.validTo;
  if (opts.usageLimit != null) body.UsageLimit = opts.usageLimit;
  if (opts.oncePerCustomer != null) body.OncePerCustomer = opts.oncePerCustomer;
  if (opts.priority != null) body.Priority = opts.priority;
  return body;
}

/** A short human label for a campaign — promo code, then title, then id. */
export function campaignLabel(c: CampaignDetailItem | CampaignListItem): string {
  if (c.PromoCode) return c.PromoCode;
  const title = Array.isArray(c.Title) ? c.Title[0]?.Value : c.Title;
  return (title || c.CampaignId || '?').toString().trim();
}
