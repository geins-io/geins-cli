import { mgmtRequest } from '../api/live-client.ts';

// Orders are part of the Management API (/API/Order/...). This module mirrors the
// shape of src/commands/products.ts: mgmtRequest-based, Envelope-wrapped responses.

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

/** An order address (Order.Models.Address) — fields read best-effort. */
export interface OrderAddress {
  FirstName?: string;
  LastName?: string;
  Company?: string;
  Email?: string;
  PhoneMobile?: string;
  Phone?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  Zip?: string;
  City?: string;
  Country?: string;
  [key: string]: unknown;
}

/** An order row / line item (Order.Models.OrderRow) — fields read best-effort. */
export interface OrderRow {
  Id?: number;
  OrderRowId?: number;
  ArticleNumber?: string;
  Name?: string;
  ProductId?: number;
  SkuId?: number;
  Quantity?: number;
  PriceIncVat?: number;
  PriceExVat?: number;
  RowSum?: number;
  [key: string]: unknown;
}

/** An order (Order.Models.Order). Key fields typed; the rest via the index signature. */
export interface Order {
  Id?: number;
  PublicId?: string;
  ExternalId?: string;
  Status?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
  CompletedAt?: string;
  MarketId?: number;
  MarketName?: string;
  Currency?: string;
  Language?: string;
  CustomerId?: number;
  CustomerEmail?: string;
  OrderTotal?: number;
  OrderValueIncVat?: number;
  OrderValueExVat?: number;
  VATTotal?: number;
  ShippingFee?: number;
  PaymentFee?: number;
  Message?: string;
  Rows?: OrderRow[];
  ShippingAddress?: OrderAddress;
  BillingAddress?: OrderAddress;
  ExternalOrderStatus?: number;
  [key: string]: unknown;
}

/** An order query body (Order.Models.OrderQuery). All fields optional. */
export interface OrderQuery {
  Updated?: string;
  UpdatedAfter?: string;
  UpdatedBefore?: string;
  CreatedAfter?: string;
  CreatedBefore?: string;
  CompletedAfter?: string;
  CompletedBefore?: string;
  StatusList?: string;
  MarketId?: number;
  PaymentName?: string;
  CustomerId?: number;
  Email?: string;
  Include?: string;
  ExternalOrderStatus?: number;
  GroupOrderRows?: boolean;
  /** Required when fetching pages beyond the first; comes from PageResult.BatchId. */
  BatchId?: string;
}

/** The partial-update body for an order (Order.Models.OrderUpdate). */
export interface OrderUpdate {
  ExternalId?: string;
  ParcelNumber?: string;
  ExternalOrderStatus?: number;
  ReturnParcelNumber?: string;
}

/** The body for validating order creation (Order.ValidateOrderCreationRequest). */
export interface ValidateOrderCreationRequest {
  OrderId?: number;
  UserId?: number;
  Email?: string;
  Phone?: string;
  Currency?: string;
  SumIncVat?: number;
  BalanceIncVat?: number;
  Items?: unknown[];
}

/** Result of order-creation validation (API.Order.OrderCreationValidationStatus). */
export interface OrderValidationResult {
  Success?: boolean;
  Message?: string;
}

export interface QueryOrdersResult {
  orders: Order[];
  page?: PageResult;
}

/** A v4 (8-4-4-4-12 hex) UUID, used to route get → public-id endpoint. */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isPublicOrderId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Order endpoints are inconsistent: some return a raw value (Statuses, Count, plain Query),
 * others an Envelope `{ Resource }` (paged Query, create). Unwrap `Resource` when present,
 * otherwise return the value as-is.
 */
function unwrap<T>(res: unknown): T {
  if (res && typeof res === 'object' && 'Resource' in (res as Record<string, unknown>)) {
    return (res as { Resource: T }).Resource;
  }
  return res as T;
}

/**
 * All order statuses that are safe to query. `/API/Order/Statuses` also advertises `inactive`
 * and `pending`, but querying either (alone or in a list) makes the backend return
 * 500 "A database error occured." — verified live 2026-06. They're deliberately excluded.
 */
export const QUERYABLE_ORDER_STATUSES = [
  'cancelled',
  'on-hold',
  'refunded',
  'partial',
  'backorder',
  'completed',
] as const;

/**
 * POST /API/Order/Query (or /Query/{page} for paging beyond the first page).
 * The paged endpoint returns PageResult (incl. BatchId); pages > 1 need BatchId in the body.
 *
 * Both endpoints 500 ("A database error occured.") unless the query has a primary predicate —
 * a `StatusList` or `CustomerId`. An empty body, or one with only secondary filters (date,
 * `MarketId`, `Email`), errors server-side. So when the caller supplies neither, we default
 * `StatusList` to every queryable status, which makes an unfiltered `order list` "just work".
 */
export async function queryOrders(
  query: OrderQuery = {},
  options?: { page?: number },
): Promise<QueryOrdersResult> {
  const page = options?.page;
  const path = page != null ? `/API/Order/Query/${page}` : '/API/Order/Query';
  const body: OrderQuery =
    query.StatusList || query.CustomerId != null
      ? query
      : { ...query, StatusList: QUERYABLE_ORDER_STATUSES.join(',') };
  // The plain endpoint returns a raw Order[]; the paged endpoint returns a PagedEnvelope.
  const res = await mgmtRequest<Order[] | PagedEnvelope<Order[]>>(path, {
    method: 'POST',
    body,
  });
  if (Array.isArray(res)) return { orders: res };
  return { orders: res.Resource ?? [], page: res.PageResult };
}

/**
 * GET one order. If `idOrPublicId` is a UUID it's fetched by public id, otherwise by the
 * internal id. `include` is an optional path segment (e.g. "Rows,ShippingAddress").
 */
export async function getOrder(
  idOrPublicId: string,
  options?: { include?: string },
): Promise<Order> {
  const includeSeg = options?.include ? `/${encodeURIComponent(options.include)}` : '';
  const path = isPublicOrderId(idOrPublicId)
    ? `/API/OrderByPublicId/${encodeURIComponent(idOrPublicId)}${includeSeg}`
    : `/API/Order/${encodeURIComponent(idOrPublicId)}${includeSeg}`;
  return unwrap<Order>(await mgmtRequest(path));
}

/** GET /API/Order/Count/{email} — number of orders for a customer email. */
export async function countOrders(email: string): Promise<number> {
  return unwrap<number>(await mgmtRequest(`/API/Order/Count/${encodeURIComponent(email)}`)) ?? 0;
}

/** GET /API/Order/Statuses — the available order status codes (raw array). */
export async function getOrderStatuses(): Promise<unknown> {
  return unwrap(await mgmtRequest('/API/Order/Statuses'));
}

/** POST /API/Order — create (place) an order. Returns the new order id. */
export async function createOrder(body: Order): Promise<number> {
  return unwrap<number>(await mgmtRequest('/API/Order', { method: 'POST', body }));
}

/** POST /API/Order/ValidateCreation — validate an order body before creating it. */
export async function validateOrderCreation(body: ValidateOrderCreationRequest): Promise<OrderValidationResult> {
  return unwrap<OrderValidationResult>(await mgmtRequest('/API/Order/ValidateCreation', {
    method: 'POST',
    body,
  })) ?? {};
}

/**
 * POST /API/Order/{id}/Status/{status}/{transactionId}/{secondaryTransactionId}.
 * The route carries four path segments; transaction ids default to empty when omitted.
 */
export async function setOrderStatus(
  id: string,
  status: string,
  transactionId = '',
  secondaryTransactionId = '',
): Promise<void> {
  const path = `/API/Order/${encodeURIComponent(id)}/Status/${encodeURIComponent(status)}/${encodeURIComponent(transactionId)}/${encodeURIComponent(secondaryTransactionId)}`;
  await mgmtRequest(path, { method: 'POST' });
}

/** PATCH /API/Order/{id} — partial update (omitted fields unchanged). */
export async function updateOrder(id: string, changes: OrderUpdate): Promise<void> {
  await mgmtRequest(`/API/Order/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes });
}

/** DELETE /API/Order/{orderId}/OrderRow/{orderRowId} — cancel a single order row. */
export async function cancelOrderRow(orderId: string, orderRowId: string): Promise<void> {
  await mgmtRequest(`/API/Order/${encodeURIComponent(orderId)}/OrderRow/${encodeURIComponent(orderRowId)}`, {
    method: 'DELETE',
  });
}

/** POST /API/Order/{id}/Comment — add a comment to an order. */
export async function addOrderComment(id: string, comment: string, options?: { system?: boolean }): Promise<void> {
  await mgmtRequest(`/API/Order/${encodeURIComponent(id)}/Comment`, {
    method: 'POST',
    body: { OrderId: Number(id), Comment: comment, System: options?.system ?? false },
  });
}

/** POST /API/Order/{id}/TransactionData — set the payment transaction id. */
export async function setOrderTransaction(id: string, transactionId: string): Promise<void> {
  await mgmtRequest(`/API/Order/${encodeURIComponent(id)}/TransactionData`, {
    method: 'POST',
    body: { OrderId: Number(id), TransactionId: transactionId },
  });
}

/** POST /API/Order/PaymentDetail/{paymentDetailId}/SetAsPaid — mark a payment as paid. */
export async function setPaymentPaid(paymentDetailId: string): Promise<void> {
  await mgmtRequest(`/API/Order/PaymentDetail/${encodeURIComponent(paymentDetailId)}/SetAsPaid`, { method: 'POST' });
}

/** DELETE /API/Order/{id} — delete an order. */
export async function deleteOrder(id: string): Promise<void> {
  await mgmtRequest(`/API/Order/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** A short, dim-friendly date (drops the time when present). */
function shortDate(value?: string): string {
  if (!value) return '';
  return value.split('T')[0] ?? value;
}

/** One-line summary of an order for compact list/get output. */
export function orderSummary(order: Order): string {
  const total = order.OrderTotal ?? order.OrderValueIncVat;
  const money = total != null ? `${total} ${order.Currency ?? ''}`.trim() : '';
  const parts = [
    `#${order.Id ?? '?'}`,
    order.Status ?? '',
    shortDate(order.CreatedAt),
    money,
  ].filter(Boolean);
  return parts.join('  ');
}

export interface OrderListArgs {
  query: OrderQuery;
  page?: number;
  json: boolean;
}

/** Parse `order list` flags into an OrderQuery + options. Shared by the TUI and direct CLI. */
export function parseOrderListArgs(args: string[]): OrderListArgs {
  const query: OrderQuery = {};
  let page: number | undefined;
  let json = false;

  const num = (s?: string): number | undefined =>
    s != null && s.trim() !== '' && !Number.isNaN(Number(s)) ? Number(s) : undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--status': { const v = args[++i]; if (v) query.StatusList = v; break; }
      case '--email': { const v = args[++i]; if (v) query.Email = v; break; }
      case '--customer': { const v = num(args[++i]); if (v != null) query.CustomerId = v; break; }
      case '--market': { const v = num(args[++i]); if (v != null) query.MarketId = v; break; }
      case '--payment': { const v = args[++i]; if (v) query.PaymentName = v; break; }
      case '--external-status': { const v = num(args[++i]); if (v != null) query.ExternalOrderStatus = v; break; }
      case '--created-after': { const v = args[++i]; if (v) query.CreatedAfter = v; break; }
      case '--created-before': { const v = args[++i]; if (v) query.CreatedBefore = v; break; }
      case '--updated-after': { const v = args[++i]; if (v) query.UpdatedAfter = v; break; }
      case '--updated-before': { const v = args[++i]; if (v) query.UpdatedBefore = v; break; }
      case '--completed-after': { const v = args[++i]; if (v) query.CompletedAfter = v; break; }
      case '--completed-before': { const v = args[++i]; if (v) query.CompletedBefore = v; break; }
      case '--include': { const v = args[++i]; if (v) query.Include = v; break; }
      case '--batch': { const v = args[++i]; if (v) query.BatchId = v; break; }
      case '--page': page = num(args[++i]); break;
      case '--json': json = true; break;
    }
  }

  return { query, page, json };
}
