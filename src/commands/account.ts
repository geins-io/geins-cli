import { request } from '../api/client.ts';

// ── Account settings via the v2 Account API ────────────────────────────────────
// Reached through the v2 gateway (getApiUrl()) under /account/*, authenticated with the
// session JWT + x-account-key (handled by request()). These endpoints return bare JSON
// arrays. Note the API serializes identifiers as `_id` (and entity type as `_type`).

/** A country — `_id` is the ISO 3166-1 alpha-2 code, e.g. "SE". */
export interface Country {
  _id: string;
  name: string;
  active?: boolean;
}

/** A currency symbol and how it's positioned. */
export interface CurrencySymbol {
  value: string;
  prefixed: boolean;
}

/** A currency — `_id` is the ISO 4217 code, e.g. "SEK". */
export interface Currency {
  _id: string;
  name: string;
  symbol?: CurrencySymbol;
  conversionRate?: number;
}

/** A language — `_id` is the ISO 639-1 code, e.g. "sv". */
export interface Language {
  _id: string;
  name: string;
  active?: boolean;
}

/** A market definition — a country+currency pair; `_id` is like "SE-SEK". */
export interface Market {
  _id: string;
  country?: Country;
  currency?: Currency;
  standardVatRate?: number;
  active?: boolean;
}

/** A market scoped to a channel — additionally carries its allowed languages. */
export interface ChannelMarket extends Market {
  channelId?: number;
  allowedLanguages?: string[];
  defaultLanguage?: string;
  group?: string;
  virtual?: boolean;
}

/** A sales channel (storefront). The list/detail endpoints return counts, not the arrays. */
export interface Channel {
  _id: string;
  identifier?: string;
  name?: string;
  url?: string;
  channelType?: string;
  active?: boolean;
  languageCount?: number;
  marketCount?: number;
  defaultMarket?: string;
  defaultLanguage?: string;
}

/** An account the signed-in user can access (from /user/me?fields=accounts → basicAccounts). */
export interface UserAccount {
  accountKey: string;
  name: string;
  roles: string[];
}

/** GET /user/me?fields=accounts — the accounts this user can switch between. */
export async function listUserAccounts(): Promise<UserAccount[]> {
  const me = await request<{ basicAccounts?: UserAccount[] }>('/user/me', { query: { fields: 'accounts' } });
  return me.basicAccounts ?? [];
}

/** GET /account/market/list — all market definitions for the account. */
export async function listMarkets(): Promise<Market[]> {
  return request<Market[]>('/account/market/list');
}

/** GET /account/language/list — all languages for the account. */
export async function listLanguages(): Promise<Language[]> {
  return request<Language[]>('/account/language/list');
}

/** GET /account/channel/list — all channels (counts only; no market/language arrays). */
export async function listChannels(): Promise<Channel[]> {
  return request<Channel[]>('/account/channel/list');
}

/** GET /account/channel/{id}/market/list — a channel's markets, with allowed languages. */
export async function listChannelMarkets(channelId: string): Promise<ChannelMarket[]> {
  return request<ChannelMarket[]>(`/account/channel/${encodeURIComponent(channelId)}/market/list`);
}

/** Display name for a market — its id is already human-readable (e.g. "SE-SEK"). */
export function marketName(market: Market): string {
  return market.country?.name ? `${market._id} (${market.country.name})` : market._id;
}

/** A locale: a language paired with a market's country, e.g. "sv-SE". */
export interface Locale {
  /** BCP-47-style tag: `<languageCode>-<COUNTRY>`, e.g. "sv-SE". */
  tag: string;
  languageCode: string;
  languageName?: string;
  countryCode: string;
  /** A channel the locale is offered in (first one seen). */
  channel?: string;
}

/**
 * Distinct locales across the account's channels. The v2 API has no locale endpoint, so a
 * locale is derived by pairing each channel-market's allowed languages with its country.
 * Requires one market-list call per channel (run in parallel). Sorted by tag.
 */
export async function listLocales(opts?: { channels?: Channel[]; languages?: Language[] }): Promise<Locale[]> {
  const channels = opts?.channels ?? (await listChannels());
  const languages = opts?.languages ?? (await listLanguages());
  const nameByCode = new Map(languages.map((l) => [l._id, l.name]));

  const marketsByChannel = await Promise.all(
    channels.map((c) => listChannelMarkets(c._id).catch(() => [] as ChannelMarket[])),
  );

  const byTag = new Map<string, Locale>();
  channels.forEach((channel, i) => {
    for (const market of marketsByChannel[i] ?? []) {
      const region = market.country?._id;
      if (!region) continue;
      for (const code of market.allowedLanguages ?? []) {
        const tag = `${code}-${region}`;
        if (byTag.has(tag)) continue;
        byTag.set(tag, {
          tag,
          languageCode: code,
          languageName: nameByCode.get(code),
          countryCode: region,
          channel: channel.name ?? channel.identifier,
        });
      }
    }
  });
  return [...byTag.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}
