// Static import so Bun inlines the JSON into the source AND into the
// `bun build --compile` binary. A runtime readFileSync of this path breaks in
// the compiled binary / desktop sidecar (the file isn't in the embedded fs).
import apiReferenceData from '../data/api-reference.json' with { type: 'json' };

interface CompactEndpoint {
  method: string;
  path: string;
  summary: string;
  requestSchema?: string;
  responseSchema?: string;
}

interface CompactSchema {
  fields: Record<string, string>;
}

interface DomainGroup {
  endpoints: CompactEndpoint[];
  schemas: Record<string, CompactSchema>;
}

type ApiReference = Record<string, DomainGroup>;

function loadApiReference(): ApiReference {
  return apiReferenceData as ApiReference;
}

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  Product: ['product', 'item', 'sku', 'stock', 'inventory', 'catalog', 'feed'],
  Order: ['order', 'checkout', 'purchase', 'payment', 'transaction'],
  User: ['user', 'customer', 'account', 'member', 'login'],
  Brand: ['brand'],
  Category: ['category', 'categories'],
  Campaign: ['campaign', 'discount', 'promotion', 'sale'],
  PriceList: ['price', 'pricing'],
  Variant: ['variant', 'size', 'color'],
  Shipping: ['shipping', 'delivery', 'parcel', 'freight'],
  Supplier: ['supplier', 'vendor'],
  Webhook: ['webhook', 'hook', 'callback'],
  Refund: ['refund'],
  Return: ['return'],
  Market: ['market', 'locale', 'currency'],
  ProductParameter: ['parameter', 'attribute', 'property', 'spec'],
};

export function detectRelevantDomains(text: string): string[] {
  const lower = text.toLowerCase();
  const matches: string[] = [];
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      matches.push(domain);
    }
  }
  return matches.length > 0 ? matches : ['Product', 'Order'];
}

function formatSchemaFields(name: string, schema: CompactSchema): string {
  const shortName = name.split('.').pop() ?? name;
  const fields = Object.entries(schema.fields)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');
  return `${shortName}:\n${fields}`;
}

function formatEndpoint(ep: CompactEndpoint): string {
  let line = `${ep.method} ${ep.path} — ${ep.summary}`;
  if (ep.requestSchema) {
    const short = ep.requestSchema.split('.').pop() ?? ep.requestSchema;
    line += ` [body: ${short}]`;
  }
  return line;
}

export function buildApiReferencePromptSection(userMessage: string, maxTokenBudget = 4000): string {
  const ref = loadApiReference();
  const domains = detectRelevantDomains(userMessage);

  const parts: string[] = ['[Geins Management API Reference]'];
  let estimatedTokens = 10;

  for (const domain of domains) {
    const group = ref[domain];
    if (!group) continue;

    const domainParts: string[] = [`\n## ${domain}`];

    domainParts.push('Endpoints:');
    for (const ep of group.endpoints) {
      domainParts.push('  ' + formatEndpoint(ep));
    }

    const schemaEntries = Object.entries(group.schemas);
    if (schemaEntries.length > 0) {
      domainParts.push('Schemas:');
      for (const [name, schema] of schemaEntries) {
        domainParts.push(formatSchemaFields(name, schema));
      }
    }

    const sectionText = domainParts.join('\n');
    const sectionTokens = Math.ceil(sectionText.length / 4);

    if (estimatedTokens + sectionTokens > maxTokenBudget) break;
    estimatedTokens += sectionTokens;
    parts.push(sectionText);
  }

  return parts.length > 1 ? parts.join('\n') : '';
}

export function getAvailableDomains(): string[] {
  return Object.keys(loadApiReference());
}
