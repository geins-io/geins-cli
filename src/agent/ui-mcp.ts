// MCP tools that act on the user's open Studio tab. Each call is relayed over
// the /agent WebSocket and answered by the tab. Served in-process to the Claude
// Agent SDK, and over HTTP (/ui-mcp/<secret>) to CLI harnesses such as Codex.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import * as z from 'zod';
import type { AgentUiTool } from './protocol.ts';
import { VERSION } from '../version.ts';

export type UiCall = (tool: AgentUiTool, input: Record<string, unknown>) => Promise<unknown>;

interface UiToolDef {
  name: AgentUiTool;
  description: string;
  shape: z.ZodRawShape;
  readOnly?: boolean;
}

const UI_TOOLS: UiToolDef[] = [
  {
    name: 'get_page_context',
    description:
      "What the user has open in Studio: path and title; on an edit page the entity (key, id, create mode, tab, unsaved changes and the form `values` — their keys are the paths fill_form accepts); on a list page each table's search, sort, sortable columns, row count and the visible rows' ids.",
    shape: {},
    readOnly: true,
  },
  {
    name: 'navigate',
    description:
      "Open a page in the user's Studio tab: a path (\"/orders/quotations/123\", \"/orders/quotations/new\") or a `url` from the studio tools. On list pages, `?q=<text>` sets the table search and `?sort=<column>` / `?sort=-<column>` sets the sort (columns from get_page_context). Returns `blocked: true` when unsaved changes stopped the navigation.",
    shape: { path: z.string().describe('Studio path or same-origin Studio URL') },
  },
  {
    name: 'fill_form',
    description:
      'Fill fields on the open edit or create page so the user sees them change. Never saves — tell the user to review and click Save (or Create). Fields apply in the order given; on a quotation set details.accountId before details.ownerId / details.buyerId / details.channelId, because choosing a company resets those. Returns unknown paths and validation errors.',
    shape: {
      fields: z
        .record(z.string(), z.unknown())
        .describe('Form path → value, e.g. { "details.name": "Q-123" }. Use ids for select fields.'),
    },
  },
  {
    name: 'set_workflow_graph',
    description:
      "Replace the nodes and connections on the open workflow page; the user watches the canvas update, then clicks Save. Never saves. Build it from studio.get_workflow_manifest (functionName, config fields) and run studio.validate_workflow first. Entry edges use `from: \"TRIGGER\"`. Expressions are NCalc in `{{ }}`, e.g. `{{Now()}}`, `{{output.<nodeId>.<field>}}`. Omit `ui.position` and the canvas auto-arranges. On /orchestrator/workflows/new it can't show the canvas yet: the graph is kept and sent when the user clicks Create. Set the name there with fill_form (details.name).",
    shape: {
      nodes: z
        .array(
          z
            .object({
              id: z.string().describe('Unique, e.g. "core-network-httpRequest-01"'),
              name: z.string().optional(),
              functionName: z.string().describe('From the manifest, e.g. "core.network.httpRequest"'),
              config: z.record(z.string(), z.unknown()).optional(),
            })
            .passthrough(),
        )
        .describe('All nodes — this replaces the current graph'),
      connections: z.array(
        z
          .object({
            from: z.string().describe('Node id, or "TRIGGER" for the entry edge'),
            to: z.string(),
            type: z.enum(['sequential', 'conditional', 'parallel']),
            label: z.string().optional().describe('Branch label for condition/iterator nodes'),
          })
          .passthrough(),
      ),
    },
  },
  {
    name: 'switch_tab',
    description: 'Switch the open edit page to another tab (0-based), e.g. to show the user where you made changes.',
    shape: { tab: z.number().int().min(0) },
  },
  {
    name: 'highlight',
    description:
      'Point the user at rows in the list on the current page: pages to and scrolls to the first one and briefly highlights them all. Use row ids from get_page_context or the studio tools.',
    shape: { ids: z.array(z.string()).min(1) },
    readOnly: true,
  },
  {
    name: 'notify',
    description: 'Show a short toast in Studio, e.g. when a long task finishes. Keep it brief; answer in chat otherwise.',
    shape: { title: z.string(), description: z.string().optional() },
  },
  {
    name: 'refresh',
    description: 'Reload the data shown in the Studio tab, e.g. after records changed.',
    shape: {},
  },
];

async function asResult(pending: Promise<unknown>) {
  try {
    return { content: [{ type: 'text' as const, text: JSON.stringify(await pending) }] };
  } catch (err) {
    return {
      content: [{ type: 'text' as const, text: String((err as Error).message ?? err) }],
      isError: true,
    };
  }
}

/** For the Claude Agent SDK: an in-process server. */
export function createUiMcpServer(call: UiCall) {
  return createSdkMcpServer({
    name: 'ui',
    version: VERSION,
    // Few tools, used on nearly every turn: skip the deferred-schema round trip.
    alwaysLoad: true,
    tools: UI_TOOLS.map((def) =>
      tool(
        def.name,
        def.description,
        def.shape,
        (args) => asResult(call(def.name, args as Record<string, unknown>)),
        def.readOnly ? { annotations: { readOnlyHint: true } } : undefined,
      ),
    ),
  });
}

/**
 * For CLI harnesses: one stateless Streamable-HTTP request. A fresh server per
 * request keeps nothing between calls; the session's `call` is the only state.
 */
export async function handleUiMcpRequest(req: Request, call: UiCall): Promise<Response> {
  const server = new McpServer({ name: 'ui', version: VERSION });
  for (const def of UI_TOOLS) {
    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: def.shape,
        annotations: def.readOnly ? { readOnlyHint: true } : undefined,
      },
      (args: Record<string, unknown>) => asResult(call(def.name, args)),
    );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}
