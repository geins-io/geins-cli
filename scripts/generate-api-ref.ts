import { parse } from 'yaml';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const yamlPath = resolve(__dirname, '../src/data/mgmtapi.yaml');
const outPath = resolve(__dirname, '../src/data/api-reference.json');

interface OpenAPISpec {
  paths: Record<string, Record<string, PathOperation>>;
  components: { schemas: Record<string, SchemaObject> };
}

interface PathOperation {
  tags?: string[];
  summary?: string;
  operationId?: string;
  requestBody?: { content?: { 'application/json'?: { schema?: SchemaRef } } };
  responses?: Record<string, { content?: { 'application/json'?: { schema?: SchemaRef } } }>;
}

interface SchemaObject {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  enum?: string[];
  description?: string;
  items?: SchemaRef;
}

interface SchemaProperty {
  type?: string;
  format?: string;
  description?: string;
  $ref?: string;
  items?: SchemaRef;
  enum?: string[];
}

type SchemaRef = { $ref?: string; type?: string; items?: SchemaRef; properties?: Record<string, SchemaProperty> };

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

function resolveRef(ref: string): string {
  return ref.replace('#/components/schemas/', '');
}

function isEnvelopeSchema(name: string): boolean {
  return name.startsWith('Envelope') || name.startsWith('Paged') || name === 'BaseEnvelope' || name === 'PageResult';
}

function flattenFields(schema: SchemaObject, allSchemas: Record<string, SchemaObject>, depth = 0): Record<string, string> {
  if (depth > 2 || !schema.properties) return {};
  const fields: Record<string, string> = {};
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (prop.$ref) {
      const refName = resolveRef(prop.$ref);
      const refSchema = allSchemas[refName];
      if (refSchema && !isEnvelopeSchema(refName)) {
        fields[name] = refName;
      } else {
        fields[name] = 'object';
      }
    } else if (prop.type === 'array' && prop.items?.$ref) {
      fields[name] = `${resolveRef(prop.items.$ref)}[]`;
    } else {
      let type = prop.type ?? 'unknown';
      if (prop.format) type += `(${prop.format})`;
      if (prop.enum) type = prop.enum.join('|');
      fields[name] = type;
    }
  }
  return fields;
}

function extractRefFromSchema(schemaRef: SchemaRef | undefined, allSchemas: Record<string, SchemaObject>): string | undefined {
  if (!schemaRef) return undefined;
  if (schemaRef.$ref) {
    const name = resolveRef(schemaRef.$ref);
    if (isEnvelopeSchema(name)) {
      const envelope = allSchemas[name];
      if (envelope?.properties?.Resource?.$ref) {
        return resolveRef(envelope.properties.Resource.$ref);
      }
      const resourceItems = envelope?.properties?.Resource?.items;
      if (resourceItems && '$ref' in resourceItems) {
        return resolveRef(resourceItems.$ref!);
      }
    }
    return name;
  }
  return undefined;
}

function domainFromTag(tag: string): string {
  return tag;
}

const raw = readFileSync(yamlPath, 'utf-8');
const spec = parse(raw) as OpenAPISpec;

const domains = new Map<string, DomainGroup>();

function ensureDomain(name: string): DomainGroup {
  if (!domains.has(name)) {
    domains.set(name, { endpoints: [], schemas: {} });
  }
  return domains.get(name)!;
}

for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (!op.tags?.length) continue;
    const domain = domainFromTag(op.tags[0]!);
    const group = ensureDomain(domain);

    const endpoint: CompactEndpoint = {
      method: method.toUpperCase(),
      path,
      summary: op.summary ?? op.operationId ?? '',
    };

    const reqSchema = op.requestBody?.content?.['application/json']?.schema;
    if (reqSchema) {
      endpoint.requestSchema = extractRefFromSchema(reqSchema, spec.components.schemas);
    }

    const res200 = op.responses?.['200']?.content?.['application/json']?.schema;
    if (res200) {
      endpoint.responseSchema = extractRefFromSchema(res200, spec.components.schemas);
    }

    group.endpoints.push(endpoint);
  }
}

const referencedSchemas = new Set<string>();
for (const group of domains.values()) {
  for (const ep of group.endpoints) {
    if (ep.requestSchema) referencedSchemas.add(ep.requestSchema);
    if (ep.responseSchema) referencedSchemas.add(ep.responseSchema);
  }
}

for (const schemaName of referencedSchemas) {
  const schema = spec.components.schemas[schemaName];
  if (!schema || isEnvelopeSchema(schemaName)) continue;

  const tag = schemaName.split('.')[0]!;
  let domain = [...domains.keys()].find(d => d.toLowerCase() === tag.toLowerCase());
  if (!domain) {
    domain = [...domains.keys()].find(d => schemaName.toLowerCase().includes(d.toLowerCase()));
  }
  if (!domain) domain = 'Shared';

  const group = ensureDomain(domain);
  const fields = flattenFields(schema, spec.components.schemas);
  if (Object.keys(fields).length > 0) {
    group.schemas[schemaName] = { fields };
  }
}

for (const [name, schema] of Object.entries(spec.components.schemas)) {
  if (referencedSchemas.has(name) || isEnvelopeSchema(name)) continue;
  if (!name.includes('.Write.') && !name.includes('.Read.')) continue;

  const tag = name.split('.')[0]!;
  let domain = [...domains.keys()].find(d => d.toLowerCase() === tag.toLowerCase());
  if (!domain) continue;

  const group = ensureDomain(domain);
  const fields = flattenFields(schema, spec.components.schemas);
  if (Object.keys(fields).length > 0) {
    group.schemas[name] = { fields };
  }
}

const output: Record<string, DomainGroup> = {};
for (const [name, group] of [...domains.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  output[name] = group;
}

writeFileSync(outPath, JSON.stringify(output, null, 2));

const stats = {
  domains: Object.keys(output).length,
  endpoints: Object.values(output).reduce((sum, g) => sum + g.endpoints.length, 0),
  schemas: Object.values(output).reduce((sum, g) => sum + Object.keys(g.schemas).length, 0),
  sizeKB: Math.round(JSON.stringify(output).length / 1024),
};
console.log(`Generated API reference: ${stats.domains} domains, ${stats.endpoints} endpoints, ${stats.schemas} schemas (${stats.sizeKB}KB)`);
