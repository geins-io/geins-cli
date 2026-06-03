import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.tsx';
import { loadConfig, saveConfig, addCredentials, loadCredentialsStore, useCredentials, removeCredentials, clearCredentials, type ApiCredentials } from './config/store.ts';
import { setOutputDir, getOutputDir } from './output/sink.ts';
import { request } from './api/client.ts';
import { loadSession } from './auth/session.ts';
import { formatError, exitWithError, notLoggedIn } from './api/errors.ts';
import { getApiUrl } from './config/env.ts';
import { readFileSync } from 'node:fs';
import { getProduct, queryProducts, parseProductListArgs, productName, getProductItems, productItemName, getVariantGroup, variantSummary, buildVariantGroupFromProducts, parseVariantCreateFlags, parseVariantGroupBody, listVariantLabels, addVariantLabel, renameVariantLabel, removeVariantLabel, setProductVariants, deleteVariantGroup, getProductImages, addProductImage, addExistingProductImage, deleteProductImage, setProductImagePrimary, reorderProductImage, imageNameFromUrl, listRelationTypes, getRelationType, createRelationType, updateRelationType, deleteRelationType, queryBrands, getBrand, createBrand, updateBrand, deleteBrand, brandName, type BrandWrite, setProductText, parseProductTextField, PRODUCT_TEXT_FIELD_TOKENS, type ProductTextField, queryCategories, getCategory, createCategory, updateCategory, assignProductCategory, setMainCategory, unassignProductCategory, categoryName, type CategoryWrite, getProductRelations, linkRelatedProducts, unlinkRelatedProducts, getProductParameters, getProductParameterValue, setProductParameterValue, removeProductParameterValue, getProductParameterDef, createProductParameter, updateProductParameter, getProductParameterGroup, createProductParameterGroup, updateProductParameterGroup, getPredefinedValue, createPredefinedValue, updatePredefinedValueNames, parameterValueSummary, updateProductParameterValues, replaceProductParameterValues, removeProductParameterAssignments, type ProductParameterValueWrite, type ProductParameterAssignment, type LocalizableContent, type ProductIdType } from './commands/products.ts';
import { validateManagementApi, validateMerchantApi, setProfileOverride } from './api/live-client.ts';
import { cliHelpSpec } from './help.ts';
import {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  runWorkflow,
  testRunWorkflow,
  getLiveExecution,
  getManifest,
  getExecutionLogs,
  enableWorkflow,
  disableWorkflow,
  listVariables,
  getVariable,
  saveVariable,
} from './commands/workflows.ts';
import {
  queryOrders,
  getOrder,
  countOrders,
  getOrderStatuses,
  createOrder,
  validateOrderCreation,
  setOrderStatus,
  updateOrder,
  cancelOrderRow,
  addOrderComment,
  setOrderTransaction,
  setPaymentPaid,
  deleteOrder,
  orderSummary,
  parseOrderListArgs,
  type OrderUpdate,
} from './commands/orders.ts';
import { listMarkets, listLanguages, listChannels, listLocales, marketName } from './commands/account.ts';
import { applyMemoryAccount } from './memory/index.ts';
import { listSessions, loadSessionEntries, formatTranscriptLines, transcriptJson, firstUserMessage } from './commands/sessions.ts';
import { chat, getCopilotConfig, clearConversationHistory } from './commands/copilot.ts';
import { outputJson } from './output/format.ts';

const VERSION = '0.1.0';

const PRODUCT_HELP = [
  'geins product — query the product catalog (Management API)',
  '',
  'Subcommands:',
  '  get <id> [--idtype <0-3>] [--json]        Show one product (id is the internal id by default)',
  '  list [filters] [--json]                   Query products (alias: query); defaults to page 1',
  '  items <id> [--idtype <0-3>] [--json]      List a product\'s items (SKUs of one product)',
  '  variants <id> [--idtype <0-3>] [--json]   Show the product\'s variant group (sibling products + dimensions)',
  '  variants create [flags | JSON]            Create a variant group from existing products',
  '  variants set <id> <Label=Value>...        Set/overwrite dimensions of a product already in a group',
  '  variants delete <groupId>                 Delete a whole variant group',
  '  variants labels [list|add <n>|remove <n>|rename <old> <new>]   Manage variant dimension labels',
  '  images <id> [--json]                      List a product\'s images',
  '  images add <id> <file|url> [--name <n>] [--primary] [--position <n>] [--add]   Upload an image (jpg/png/gif); keeps & prints the stored name. --add uses POST (add) instead of PUT (upsert)',
  '  images add-existing <id> <imageName>      Link an already-uploaded image to the product (no upload); imageName is the original file name (the basename of the source)',
  '  images delete <id> <imageName>            Remove an image',
  '  images set-primary <id> <imageName>       Make an image the primary one',
  '  images reorder <id> <imageName> <pos>     Change an image\'s position',
  '  brands [list|get <id>|create --name <n> [--external-id <id>] [--desc <code>:<text>]|update <id> ...|delete <id>]   Manage brands',
  '  categories [list|get <id>|create --name <code>:<text> [--parent <id>] [--desc <code>:<text>] [--hidden] [--inactive]|update <id> ...]   Manage categories',
  '  text <id> [--idtype <0-3>] [--json]       List a product\'s localized texts (Names/ShortTexts/LongTexts/TechTexts)',
  '  text set <id> <name|shorttext|longtext|techtext> <locale>:<text>...  [--idtype <0-3>]   Set/merge localized text (one locale, keeps the rest)',
  '  categories assign <productId> <categoryId> [--idtype <0-3>]     Assign a category to a product',
  '  categories set-main <productId> <categoryId> [--idtype <0-3>]   Make a category the product\'s main (writes CategoryIds with it first)',
  '  categories unassign <productId> <categoryId> [--idtype <0-3>]   Remove a category from a product (preserves main)',
  '  relation-types [list|get <id>|add <name> [--order <n>]|update <id> [--name <n>] [--order <n>]|delete <id>]   Manage relation types',
  '  relations <id> [--json]                   List a product\'s related products',
  '  relations link <id> <relationTypeId> <relatedId...>     Link related products',
  '  relations unlink <id> <relationTypeId> <relatedId...>   Unlink related products',
  '  parameters <id> [--idtype <0-3>] [--json]   List a product\'s parameter values',
  '  parameters get <id> <paramId>             Show one resolved parameter value',
  '  parameters set <id> <paramId> <value> [--desc <code>:<text>]   Assign/update a value',
  '  parameters remove <id> <paramId>          Remove a parameter assignment',
  '  parameters batch <update|replace|remove> [--file|--body|stdin]   Batch value writes (JSON)',
  '  parameters defs [get <id>|create --name <n> --group <id> --type <1-7>|update <id> ...]   Parameter definitions',
  '  parameters groups [get <id>|create --name <n> [--order <n>] [--param <id>...]|update <id> ...]   Parameter groups',
  '  parameters predefined [get <id>|add --param <pid> --name <n>|rename <id> <name>]   Predefined values',
  '',
  'parameters — a "parameter" (e.g. Material) is a definition that belongs to a group and',
  '  has a type (1-7); a product gets a parameter VALUE by assigning a string to a parameterId.',
  '  batch update = merge (keeps unlisted); batch replace = removes values not in the body.',
  '  batch update/replace body: { "values": [ { "ProductId", "ParameterId", "Value", "LocalizedDescriptions"? } ] }',
  '  batch remove body:         { "assignments": [ { "ProductId", "ParameterId" } ] }',
  '',
  'variants create — group existing products as variants of each other:',
  '  --name <name>                 Optional group name',
  '  --label <name>                Declared dimension (repeatable); omit to derive from products',
  '  --product <id>:L=V,L=V        A product + its dimension values (repeatable)',
  '  --collapse                    Set CollapseInLists',
  '  --idtype <0-3>                Id type for all product ids (default 0=internal)',
  '  --file <path> | --body <json> | stdin   JSON body form',
  '  --json                        Output the structured result',
  '  Labels must be registered first (variants labels add <name>); the main product',
  '  cannot be set via the API. JSON shape:',
  '  { "name"?, "collapse"?, "idType"?, "labels"?: [..], "products": [ { "id", "dimensions": { "Color":"Red" } } ] }',
  '',
  'list / query filters (repeatable flags accumulate):',
  '  --brand <id>                 Brand id',
  '  --category <id>              Category id',
  '  --supplier <id>              Supplier id',
  '  --id <productId>             Product id',
  '  --article <articleNumber>    Article number',
  '  --updated-after <ISO8601>    Updated after a date (e.g. 2026-01-01T00:00:00Z)',
  '  --created-after <ISO8601>    Created after a date',
  '  --sellable                   Only sellable products',
  '  --in-stock                   Only in-stock products',
  '  --page <n>                   Page number (page size 1000)',
  '  --batch <id>                 BatchId from a prior page (required for page > 1)',
  '  --include <fields>           Child collections, e.g. Names,Prices,Categories',
  '  --json                       Raw JSON output',
  '',
  'Examples:',
  '  geins product get 10001 --json',
  '  geins product items 10001',
  '  geins product variants 10001',
  '  geins product images 10001',
  '  geins product images add 10001 ./hero.jpg --primary',
  '  geins product images add 10001 https://example.com/img.png --name img.png',
  '  geins product images add-existing 10001 hero.jpg',
  '  geins product brands',
  '  geins product brands create --name Nike --external-id nike',
  '  geins product categories',
  '  geins product text 2807',
  '  geins product text set 2807 longtext sv:"Kopplingsplintar av transparent nylon."',
  '  geins product text set 2807 longtext en:"Connection terminals."   # adds en, keeps sv',
  '  geins product categories create --name en:Shoes --parent 1',
  '  geins product categories assign 10001 42',
  '  geins product relation-types add Accessories',
  '  geins product relations link 10001 1 10002 10003',
  '  geins product parameters 10001',
  '  geins product parameters set 10001 42 "100% Cotton"',
  '  geins product parameters defs create --name Material --group 3 --type 1',
  '  geins product variants labels add Color',
  '  geins product variants create --name Tee --label Color --product 1005:Color=Red --product 1010:Color=Blue',
  '  geins product list --brand 1 --in-stock',
  '  geins product list --page 2 --batch <BatchId> --json',
  '  geins product list --account prod-elproman   # pick a live-API account (headless)',
].join('\n');

const ORDER_HELP = [
  'geins order — inspect and handle orders (Management API)',
  '',
  'Subcommands:',
  '  list [filters] [--json]                   Query orders (alias: query); defaults to page 1',
  '  get <idOrPublicId> [--include <fields>] [--json]   One order (UUID → fetched by public id)',
  '  count <email>                             Number of orders for a customer email',
  '  statuses                                  List the available order status codes',
  '  create [--file <path> | --body \'<json>\' | stdin]   Create (place) an order; returns the new id',
  '  validate [--file | --body | stdin]        Validate an order body before creating it',
  '  status <id> <status> [<txId> [<secondaryTxId>]]    Change order status',
  '  update <id> [--external-id <s>] [--parcel <s>] [--external-status <0|10|20|30|40>] [--return-parcel <s>] | [--body \'<json>\']   Partial update',
  '  cancel-row <orderId> <orderRowId>         Cancel a single order row',
  '  comment <id> <text> [--system]            Add a comment to an order',
  '  transaction <id> <transactionId>          Set the payment transaction id',
  '  set-paid <paymentDetailId>                Mark a payment detail as paid',
  '  delete <id>                               Delete an order',
  '',
  'list / query filters:',
  '  --status <csv>               Status codes, comma-separated (StatusList)',
  '  --email <email>              Customer email',
  '  --customer <id>              Customer id',
  '  --market <id>                Market id',
  '  --payment <name>             Payment method name',
  '  --external-status <0-40>     External order status (0|10|20|30|40)',
  '  --created-after / --created-before <ISO8601>',
  '  --updated-after / --updated-before <ISO8601>',
  '  --completed-after / --completed-before <ISO8601>',
  '  --include <fields>           Child collections, e.g. Rows,ShippingAddress',
  '  --page <n>                   Page number',
  '  --batch <id>                 BatchId from a prior page (required for page > 1)',
  '  --json                       Raw JSON output',
  '',
  'Examples:',
  '  geins order statuses',
  '  geins order list --status 2 --json',
  '  geins order get 100123 --include Rows,ShippingAddress',
  '  geins order get 7b2e... --json            # public id (UUID)',
  '  geins order count customer@example.com',
  '  geins order comment 100123 "Called customer" ',
  '  geins order status 100123 5',
  '  geins order update 100123 --external-id EXT-9 --parcel ABC123',
  '  cat order.json | geins order create',
].join('\n');

const ACCOUNT_HELP = [
  'geins account — show account settings (v2 Account API)',
  '',
  'Subcommands:',
  '  (none)                  Overview: markets + languages + locales',
  '  markets [--json]        List market definitions (country-currency, e.g. SE-SEK, with VAT)',
  '  languages [--json]      List the account\'s languages (code + name)',
  '  locales [--json]        List locales (language-country tags, e.g. sv-SE) derived from channels',
  '',
  'Examples:',
  '  geins account',
  '  geins account markets --json',
  '  geins account languages',
  '  geins account locales',
].join('\n');

/** Resolve a JSON body from --file <path>, --body '<json>', or piped stdin. */
async function resolveBody(args: string[]): Promise<unknown> {
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    const content = readFileSync(args[fileIdx + 1]!, 'utf-8');
    return JSON.parse(content);
  }
  const bodyIdx = args.indexOf('--body');
  if (bodyIdx !== -1 && args[bodyIdx + 1]) {
    return JSON.parse(args[bodyIdx + 1]!);
  }
  // Read from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) {
    console.error('No input provided. Use --file <path>, --body \'<json>\', or pipe JSON to stdin.');
    process.exit(1);
  }
  return JSON.parse(raw);
}

export async function run(argv: string[]): Promise<void> {
  const args = argv.slice(2);

  // `--resume`/`--continue [id]` with no positional command launches the TUI and either
  // opens the session picker or replays the given id. Detect it before the direct-mode gate
  // so the flag isn't routed to runDirect as a command.
  const resumeIdx = args.findIndex(a => a === '--resume' || a === '--continue');
  if (resumeIdx !== -1) {
    const maybeId = args[resumeIdx + 1];
    const id = maybeId && !maybeId.startsWith('-') ? maybeId : undefined;
    const consumedIdx = id ? resumeIdx + 1 : -1;
    const positional = args.filter((a, i) => i !== resumeIdx && i !== consumedIdx && !a.startsWith('-'));
    if (positional.length === 0) {
      await launchTui({ open: true, id });
      return;
    }
  }

  // Direct mode — no TUI
  if (args.length > 0) {
    await runDirect(args);
    return;
  }

  await launchTui();
}

async function launchTui(resume?: { open: boolean; id?: string }): Promise<void> {
  // Interactive TUI mode requires a TTY
  if (!process.stdin.isTTY) {
    console.error('Interactive mode requires a terminal. Run geins --help for usage.');
    process.exit(1);
  }

  // Set the terminal window/tab title (held while the TUI runs).
  process.stdout.write('\x1b]0;Geins terminal companion\x07');

  // Clear the screen (and scrollback) so the TUI starts on a clean canvas.
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

  const app = render(React.createElement(App, { version: VERSION, resume }), {
    exitOnCtrlC: false,
  });

  await app.waitUntilExit();
}

async function runDirect(rawArgs: string[]): Promise<void> {
  // Global flags stripped before command parsing so they can appear anywhere:
  //   --account/--profile <name>  selects the live-API account
  //   --out <dir>                 dumps responses + a request log to <dir>
  let accountOverride = process.env['GEINS_ACCOUNT'];
  let outOverride: string | undefined;
  const args: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if ((rawArgs[i] === '--account' || rawArgs[i] === '--profile') && rawArgs[i + 1]) {
      accountOverride = rawArgs[i + 1];
      i++;
      continue;
    }
    if (rawArgs[i] === '--out' && rawArgs[i + 1]) {
      outOverride = rawArgs[i + 1];
      i++;
      continue;
    }
    args.push(rawArgs[i]!);
  }
  if (accountOverride) setProfileOverride(accountOverride);
  if (outOverride) setOutputDir(outOverride);

  // Scope memory to the same composite (session + apikey) bucket the TUI uses, so headless
  // `resume`/`ask` read & write the same sessions and chat history. Without this, headless
  // would fall back to the `_shared` bucket and never see the TUI's sessions.
  await applyMemoryAccount();

  if (args[0] === '--help' || args[0] === 'help') {
    // Machine-readable command tree for LLMs/automation.
    if (args.includes('--json') || args.includes('--llm')) {
      console.log(JSON.stringify(cliHelpSpec(VERSION), null, 2));
      return;
    }
    console.log(`geins v${VERSION}`);
    console.log('CLI for Geins Commerce Backend\n');
    console.log('Usage: geins <command> [args] [flags]');
    console.log('       geins (interactive mode)\n');
    console.log('Commands:');
    console.log('  login     Authenticate with Geins (v2 session)');
    console.log('  logout    Clear stored credentials');
    console.log('  whoami    Show current user and account');
    console.log('  account   Show account settings — markets, languages, locales — uses the v2 Account API');
    console.log('  apikey    Manage live API accounts (set, list, use, remove, clear)');
    console.log('  workflow   Workflow commands (list, get, create, update, run, manifest, logs, enable, disable, vars)');
    console.log('  product    Product commands (get, list, items, variants, images, relations, parameters) — uses Management API');
    console.log('  order      Order commands (list, get, count, statuses, create, status, update, comment) — uses Management API');
    console.log('  api       Raw API request');
    console.log('  output    Set/show the folder where responses + logs are dumped');
    console.log('  ask       Ask the copilot a question (-c/--continue to keep the prior conversation)');
    console.log('  resume    Print a past session transcript (no id → list sessions)\n');
    console.log('Global flags:');
    console.log('  --account <name>   Use a specific live-API account (or set GEINS_ACCOUNT)');
    console.log('  --out <dir>        Dump responses + request log to <dir> (or set GEINS_OUTPUT_DIR)');
    console.log('  --json      Force JSON output');
    console.log('  --resume [id]  Open the TUI and resume a session (picker if no id)');
    console.log('  --help      Show help');
    console.log('  --version   Show version');
    console.log("\nRun 'geins product --help' for that command's options and examples.");
    console.log("Run 'geins help --json' for the full command tree as JSON (for LLMs/automation).");
    return;
  }

  if (args[0] === '--version' || args[0] === 'version') {
    console.log(VERSION);
    return;
  }

  const commandName = args[0]!;
  const commandArgs = args.slice(1);

  if (commandArgs.includes('--help')) {
    if (commandName === 'product') console.log(PRODUCT_HELP);
    else if (commandName === 'order') console.log(ORDER_HELP);
    else if (commandName === 'account') console.log(ACCOUNT_HELP);
    else console.log(`${commandName} — CLI command`);
    return;
  }

  try {
    switch (commandName) {
      case 'whoami': {
        const session = await loadSession();
        if (!session) notLoggedIn();
        console.log(`${session.user.name} <${session.user.email}>`);
        if (session.accountKey) {
          const label = session.accountName
            ? `${session.accountName} (${session.accountKey})`
            : session.accountKey;
          console.log(`Account: ${label}`);
        }
        if (session.user.roles.length > 0) console.log(`Roles: ${session.user.roles.join(', ')}`);
        break;
      }
      case 'resume': {
        const jsonMode = commandArgs.includes('--json');
        const id = commandArgs.find(a => !a.startsWith('-'));
        if (!id) {
          const sessions = await listSessions();
          if (sessions.length === 0) {
            if (jsonMode) outputJson({ sessions: [] });
            else console.error('No sessions found.');
            return;
          }
          if (jsonMode) {
            outputJson({ sessions });
            return;
          }
          console.log('Recent sessions (resume with: geins resume <id>):\n');
          for (const s of sessions) {
            const entries = await loadSessionEntries(s.id);
            const when = new Date(s.startedAt).toLocaleString();
            console.log(`  ${s.id}  ${when}  (${entries.length})  ${firstUserMessage(entries)}`);
          }
          return;
        }
        const entries = await loadSessionEntries(id);
        if (entries.length === 0) {
          console.error(`Session '${id}' not found or empty.`);
          process.exit(1);
        }
        if (jsonMode) outputJson(transcriptJson(id, entries));
        else formatTranscriptLines(entries, { color: true }).forEach(l => console.log(l));
        break;
      }
      case 'ask': {
        const jsonMode = commandArgs.includes('--json');
        const cont = commandArgs.includes('-c') || commandArgs.includes('--continue');
        const prompt = commandArgs.filter(a => !a.startsWith('-')).join(' ').trim();
        if (!prompt) {
          console.error('Usage: geins ask "<prompt>" [-c|--continue] [--json]');
          process.exit(1);
        }
        if (!(await getCopilotConfig())) {
          console.error('No copilot configured. Run geins (interactive) → /copilot to set one up.');
          process.exit(1);
        }
        // Default = a fresh one-shot (clear rolling history first so scripted asks are
        // deterministic); -c/--continue keeps prior turns so the conversation continues.
        if (!cont) clearConversationHistory();
        const response = await chat(prompt);
        if (jsonMode) outputJson({ response });
        else console.log(response);
        break;
      }
      case 'workflow': {
        const sub = commandArgs[0]?.toLowerCase() ?? 'list';
        const subArgs = commandArgs.slice(1);
        const jsonMode = commandArgs.includes('--json');

        switch (sub) {
          case 'list': {
            const data = await listWorkflows();
            if (jsonMode) {
              console.log(JSON.stringify(data, null, 2));
            } else {
              for (const wf of data.items) {
                const status = wf.enabled ? '●' : '○';
                const tags = wf.tags?.length ? ` [${wf.tags.join(', ')}]` : '';
                console.log(`${status} ${wf.name}  ${wf.type}  v${wf.version}${tags}`);
                console.log(`  ${wf.id}`);
              }
              if (data.totalCount > 0) {
                console.log(`\n${data.totalCount} workflows`);
              }
            }
            break;
          }
          case 'get': {
            const id = subArgs[0];
            if (!id) {
              console.error('Usage: geins workflow get <id>');
              process.exit(1);
            }
            const data = await getWorkflow(id);
            console.log(JSON.stringify(data, null, 2));
            break;
          }
          case 'create': {
            const definition = await resolveBody(subArgs);
            const data = await createWorkflow(definition);
            console.log(JSON.stringify(data, null, 2));
            break;
          }
          case 'update': {
            const id = subArgs[0];
            if (!id) {
              console.error('Usage: geins workflow update <id> [--file <path> | --body \'<json>\']');
              process.exit(1);
            }
            const definition = await resolveBody(subArgs.slice(1));
            const data = await updateWorkflow(id, definition);
            console.log(JSON.stringify(data, null, 2));
            break;
          }
          case 'run': {
            const id = subArgs[0];
            if (!id) {
              console.error('Usage: geins workflow run <id> [--body \'<json>\'] [--watch]');
              process.exit(1);
            }
            const watch = subArgs.includes('--watch');
            const bodyIdx = subArgs.indexOf('--body');
            let input: unknown;
            if (bodyIdx !== -1 && subArgs[bodyIdx + 1]) {
              input = JSON.parse(subArgs[bodyIdx + 1]!);
            }
            if (!watch) {
              const data = await runWorkflow(id, input);
              console.log(JSON.stringify(data, null, 2));
              break;
            }
            const execResult = await testRunWorkflow(id, input);
            console.log(`✓ Test run started: ${execResult.ExecutionId}`);
            let lastSeq = -1;
            for (let i = 0; i < 120; i++) {
              await Bun.sleep(2000);
              try {
                const live = await getLiveExecution(execResult.ExecutionId);
                if (live.Seq !== lastSeq) {
                  lastSeq = live.Seq;
                  process.stdout.write('\x1b[2J\x1b[H');
                  console.log(`Execution: ${live.InstanceId}`);
                  console.log(`Status: ${live.Status}  (${live.OrchestrationStatus})`);
                  console.log(`Nodes: ${Object.keys(live.Nodes).length}/${live.TotalNodes}\n`);
                  for (const [nodeId, node] of Object.entries(live.Nodes)) {
                    const icon = node.Status === 'completed' ? '✓'
                      : node.Status === 'failed' ? '✗'
                      : node.Status === 'running' ? '⟳'
                      : '·';
                    const dur = node.DurationMs ? ` ${node.DurationMs}ms` : '';
                    const name = node.Name || nodeId;
                    console.log(`${icon} ${name}  ${node.Status}${dur}`);
                    if (node.Error) console.log(`  Error: ${node.Error}`);
                  }
                }
                if (live.IsComplete) {
                  console.log(`\n${live.Status === 'completed' ? '✓' : '✗'} Finished: ${live.Status}`);
                  break;
                }
              } catch {
                // ignore polling errors, retry
              }
            }
            break;
          }
          case 'manifest': {
            const data = await getManifest();
            console.log(JSON.stringify(data, null, 2));
            break;
          }
          case 'logs': {
            const id = subArgs[0];
            if (!id) {
              console.error('Usage: geins workflow logs <id>');
              process.exit(1);
            }
            const data = await getExecutionLogs(id);
            console.log(JSON.stringify(data, null, 2));
            break;
          }
          case 'enable': {
            const id = subArgs[0];
            if (!id) {
              console.error('Usage: geins workflow enable <id>');
              process.exit(1);
            }
            const data = await enableWorkflow(id);
            console.log(JSON.stringify(data, null, 2));
            break;
          }
          case 'disable': {
            const id = subArgs[0];
            if (!id) {
              console.error('Usage: geins workflow disable <id>');
              process.exit(1);
            }
            const data = await disableWorkflow(id);
            console.log(JSON.stringify(data, null, 2));
            break;
          }
          case 'vars': {
            const varsAction = subArgs[0]?.toLowerCase() ?? 'list';
            switch (varsAction) {
              case 'list': {
                const vars = await listVariables();
                if (jsonMode) {
                  console.log(JSON.stringify(vars, null, 2));
                } else {
                  for (const v of Array.isArray(vars) ? vars : [vars]) {
                    const desc = v.description ? ` — ${v.description}` : '';
                    console.log(`${v.key} = ${JSON.stringify(v.value)}${desc}`);
                  }
                }
                break;
              }
              case 'get': {
                const name = subArgs[1];
                if (!name) {
                  console.error('Usage: geins workflow vars get <name>');
                  process.exit(1);
                }
                const data = await getVariable(name);
                console.log(JSON.stringify(data, null, 2));
                break;
              }
              case 'set': {
                const name = subArgs[1];
                const value = subArgs[2];
                if (!name || value === undefined) {
                  console.error('Usage: geins workflow vars set <name> <value> [description]');
                  process.exit(1);
                }
                let parsed: unknown;
                try { parsed = JSON.parse(value); } catch { parsed = value; }
                const desc = subArgs.slice(3).join(' ') || undefined;
                await saveVariable({ key: name, value: parsed, description: desc });
                console.log(`✓ Variable '${name}' saved`);
                break;
              }
              default:
                console.error(`Unknown vars action: ${varsAction}`);
                console.error('Usage: geins workflow vars [list|get|set]');
                process.exit(1);
            }
            break;
          }
          default:
            console.error(`Unknown subcommand: workflow ${sub}`);
            console.error('Subcommands: list, get, create, update, run, manifest, logs, enable, disable, vars');
            process.exit(1);
        }
        break;
      }
      case 'apikey': {
        const sub = commandArgs[0]?.toLowerCase() ?? 'status';

        function flag(name: string): string | undefined {
          const idx = commandArgs.indexOf(name);
          return idx !== -1 ? commandArgs[idx + 1] : undefined;
        }

        switch (sub) {
          case 'set': {
            const credentials: ApiCredentials = {
              username: flag('--username') ?? process.env['GEINS_API_USERNAME'] ?? '',
              managementApiKey: flag('--mgmt-key') ?? process.env['GEINS_MGMT_API_KEY'] ?? '',
              managementApiPassword: flag('--mgmt-password') ?? process.env['GEINS_MGMT_API_PASSWORD'] ?? '',
              merchantApiKey: flag('--merchant-key') ?? process.env['GEINS_MERCHANT_API_KEY'] ?? '',
            };
            const missing = Object.entries(credentials).filter(([, v]) => !v).map(([k]) => k);
            if (missing.length > 0) {
              console.error('Usage: geins apikey set --username <u> --mgmt-key <k> --mgmt-password <p> --merchant-key <k>');
              console.error('(or set GEINS_API_USERNAME, GEINS_MGMT_API_KEY, GEINS_MGMT_API_PASSWORD, GEINS_MERCHANT_API_KEY)');
              console.error(`Missing: ${missing.join(', ')}`);
              process.exit(1);
            }
            const [mgmtErr, merchantErr] = await Promise.all([
              validateManagementApi(credentials).then(() => null).catch((e) => formatError(e)),
              validateMerchantApi(credentials).then(() => null).catch((e) => formatError(e)),
            ]);
            console.log(`${mgmtErr ? '✗' : '✓'} Management API${mgmtErr ? `: ${mgmtErr}` : ''}`);
            console.log(`${merchantErr ? '✗' : '✓'} Merchant API${merchantErr ? `: ${merchantErr}` : ''}`);
            if (mgmtErr || merchantErr) {
              console.error('Validation failed. Credentials not saved.');
              process.exit(1);
            }
            const name = await addCredentials(credentials);
            console.log(`✓ Credentials '${name}' saved and activated.`);
            break;
          }
          case 'list':
          case 'status': {
            const store = await loadCredentialsStore();
            const names = Object.keys(store.profiles);
            if (names.length === 0) {
              console.error('No API credentials. Run geins apikey set to add an account.');
              process.exit(2);
            }
            for (const profileName of names) {
              const marker = profileName === store.active ? '●' : '○';
              console.log(`${marker} ${profileName}  (user: ${store.profiles[profileName]!.username})`);
            }
            break;
          }
          case 'use': {
            const name = commandArgs[1];
            if (!name) {
              console.error('Usage: geins apikey use <name>');
              process.exit(1);
            }
            if (await useCredentials(name)) {
              console.log(`✓ Switched to '${name}'.`);
            } else {
              console.error(`Unknown credentials profile: ${name}`);
              process.exit(1);
            }
            break;
          }
          case 'remove': {
            const name = commandArgs[1];
            if (!name) {
              console.error('Usage: geins apikey remove <name>');
              process.exit(1);
            }
            if (await removeCredentials(name)) {
              console.log(`✓ Removed '${name}'.`);
            } else {
              console.error(`Unknown credentials profile: ${name}`);
              process.exit(1);
            }
            break;
          }
          case 'clear': {
            await clearCredentials();
            console.log('✓ All API credentials cleared.');
            break;
          }
          default:
            console.error(`Unknown subcommand: apikey ${sub}`);
            console.error('Subcommands: set, list, use <name>, remove <name>, clear');
            process.exit(1);
        }
        break;
      }
      case 'product': {
        const sub = commandArgs[0]?.toLowerCase() ?? '';
        const subArgs = commandArgs.slice(1);
        const jsonMode = commandArgs.includes('--json');

        switch (sub) {
          case 'get': {
            const id = subArgs[0];
            if (!id) {
              console.error('Usage: geins product get <id> [--idtype <0-3>] [--include <fields>] [--json]');
              process.exit(1);
            }
            let idType: ProductIdType | undefined;
            const itIdx = subArgs.indexOf('--idtype');
            if (itIdx !== -1 && subArgs[itIdx + 1] != null) {
              const n = Number(subArgs[itIdx + 1]);
              if (n >= 0 && n <= 3) idType = n as ProductIdType;
            }
            const incIdx = subArgs.indexOf('--include');
            const include = incIdx !== -1 ? subArgs[incIdx + 1] : undefined;
            const product = await getProduct(id, { idType, include });
            if (jsonMode) {
              console.log(JSON.stringify(product, null, 2));
            } else {
              const status = product.Active ? '●' : '○';
              console.log(`${status} ${productName(product)}  (${product.ProductId})`);
              if (product.ArticleNumber) console.log(`  Article: ${product.ArticleNumber}`);
              if (product.PurchasePrice != null) console.log(`  Price: ${product.PurchasePrice} ${product.PurchasePriceCurrency ?? ''}`.trimEnd());
              if (product.BrandName) console.log(`  Brand: ${product.BrandName}`);
              if (product.MainCategoryId != null) console.log(`  Category: ${product.MainCategoryId}`);
              if (product.DateUpdated) console.log(`  Updated: ${product.DateUpdated}`);
            }
            break;
          }
          case 'items': {
            const id = subArgs[0];
            if (!id) {
              console.error('Usage: geins product items <productId> [--idtype <0-3>] [--json]');
              process.exit(1);
            }
            let idType: ProductIdType | undefined;
            const itIdx = subArgs.indexOf('--idtype');
            if (itIdx !== -1 && subArgs[itIdx + 1] != null) {
              const n = Number(subArgs[itIdx + 1]);
              if (n >= 0 && n <= 3) idType = n as ProductIdType;
            }
            const items = await getProductItems(id, { idType });
            if (jsonMode) {
              console.log(JSON.stringify(items, null, 2));
              break;
            }
            for (const it of items) {
              const status = it.Active ? '●' : '○';
              const stock = it.Stock?.StockSellable ?? it.Stock?.Stock;
              const article = it.ArticleNumber ? `  ${it.ArticleNumber}` : '';
              const stockStr = stock != null ? `  stock ${stock}` : '';
              console.log(`${status} ${productItemName(it)}  (${it.ItemId})${article}${stockStr}`);
            }
            console.log(`\n${items.length} item${items.length === 1 ? '' : 's'}`);
            break;
          }
          case 'variants': {
            const action = subArgs[0]?.toLowerCase();

            // Label registry management: variants labels [add|remove|rename]
            if (action === 'labels') {
              const labelAction = subArgs[1]?.toLowerCase();
              if (!labelAction || labelAction === 'list') {
                const labels = await listVariantLabels();
                if (jsonMode) { console.log(JSON.stringify(labels, null, 2)); break; }
                if (labels.length === 0) console.log('No variant labels registered.');
                else for (const l of labels) console.log(l);
                break;
              }
              if (labelAction === 'add') {
                const name = subArgs[2];
                if (!name) { console.error('Usage: geins product variants labels add <name>'); process.exit(1); }
                await addVariantLabel(name);
                console.log(`✓ Registered variant label: ${name}`);
                break;
              }
              if (labelAction === 'remove') {
                const name = subArgs[2];
                if (!name) { console.error('Usage: geins product variants labels remove <name>'); process.exit(1); }
                await removeVariantLabel(name);
                console.log(`✓ Removed variant label: ${name}`);
                break;
              }
              if (labelAction === 'rename') {
                const oldName = subArgs[2];
                const newName = subArgs[3];
                if (!oldName || !newName) { console.error('Usage: geins product variants labels rename <old> <new>'); process.exit(1); }
                await renameVariantLabel(oldName, newName);
                console.log(`✓ Renamed variant label: ${oldName} → ${newName}`);
                break;
              }
              console.error(`Unknown labels action: ${labelAction}`);
              console.error('Usage: geins product variants labels [list|add <name>|remove <name>|rename <old> <new>]');
              process.exit(1);
            }

            // Create a variant group from existing products: variants create [flags | JSON]
            if (action === 'create') {
              const createArgs = subArgs.slice(1);
              const hasBody = createArgs.includes('--file') || createArgs.includes('--body');
              const hasFlags = createArgs.some((a) => ['--product', '--label', '--name', '--collapse'].includes(a));
              const input = hasBody || !hasFlags
                ? parseVariantGroupBody(await resolveBody(createArgs))
                : parseVariantCreateFlags(createArgs);

              const result = await buildVariantGroupFromProducts(input);
              if (jsonMode) {
                console.log(JSON.stringify(result, null, 2));
              } else {
                console.log(`Variant group ${result.groupId} (labels: ${result.labels.join(', ')})`);
                for (const p of result.products) {
                  console.log(`${p.ok ? '✓' : '✗'} ${p.id}${p.ok ? '' : `  ${p.error}`}`);
                }
                if (result.cleanedUp) console.log('All products failed to attach — the empty group was removed.');
                console.log('\nNote: the main product cannot be set via the Management API (no MainProductId on write).');
              }
              if (!result.allSucceeded) process.exit(1);
              break;
            }

            // Update the variant dimensions of a product already in a group.
            if (action === 'set') {
              const productId = subArgs[1];
              let setIdType: ProductIdType | undefined;
              const pairs: string[] = [];
              let skip = false;
              for (const a of subArgs.slice(2)) {
                if (skip) { const n = Number(a); if (n >= 0 && n <= 3) setIdType = n as ProductIdType; skip = false; continue; }
                if (a === '--idtype') { skip = true; continue; }
                pairs.push(a);
              }
              if (!productId || pairs.length === 0) {
                console.error('Usage: geins product variants set <productId> <Label=Value> [<Label=Value>...] [--idtype <0-3>]');
                process.exit(1);
              }
              // Split each pair on the first '=' (values may contain '/', spaces, commas).
              const dimensions = pairs.map((p) => { const i = p.indexOf('='); return i === -1 ? { Label: p, Value: '' } : { Label: p.slice(0, i), Value: p.slice(i + 1) }; });
              await setProductVariants(productId, dimensions, { idType: setIdType });
              console.log(`✓ Set variant dimensions on product ${productId}: ${dimensions.map((d) => `${d.Label}=${d.Value}`).join(', ')}`);
              break;
            }

            // Delete a whole variant group by id.
            if (action === 'delete') {
              const gid = Number(subArgs[1]);
              if (Number.isNaN(gid)) { console.error('Usage: geins product variants delete <groupId>'); process.exit(1); }
              await deleteVariantGroup(gid);
              console.log(`✓ Deleted variant group ${gid}`);
              break;
            }

            const id = subArgs[0];
            if (!id) {
              console.error('Usage: geins product variants <productId> [--idtype <0-3>] [--json]');
              process.exit(1);
            }
            let idType: ProductIdType | undefined;
            const itIdx = subArgs.indexOf('--idtype');
            if (itIdx !== -1 && subArgs[itIdx + 1] != null) {
              const n = Number(subArgs[itIdx + 1]);
              if (n >= 0 && n <= 3) idType = n as ProductIdType;
            }
            const group = await getVariantGroup(id, { idType });
            if (jsonMode) {
              console.log(JSON.stringify(group, null, 2));
              break;
            }
            if (!group) {
              console.log('No variant group for this product.');
              break;
            }
            console.log(`Variant group ${group.GroupId}${group.Name ? ` (${group.Name})` : ''}`);
            const members = group.Products ?? [];
            if (members.length > 0) {
              for (const p of members) {
                const status = p.Active ? '●' : '○';
                const main = p.ProductId === group.MainProductId ? ' ★' : '';
                const dims = variantSummary(p);
                console.log(`${status} ${productName(p)}  (${p.ProductId})${main}${dims ? `  ${dims}` : ''}`);
              }
              console.log(`\n${members.length} product${members.length === 1 ? '' : 's'} in group`);
            } else if (group.ProductIds?.length) {
              console.log(`Products: ${group.ProductIds.join(', ')}`);
              if (group.MainProductId) console.log(`Main product: ${group.MainProductId}`);
            }
            break;
          }
          case 'images': {
            const parseImgFlags = (args: string[]) => {
              let idType: ProductIdType | undefined;
              let primary = false;
              let name: string | undefined;
              let position: number | undefined;
              let method: 'PUT' | 'POST' | undefined;
              for (let i = 0; i < args.length; i++) {
                if (args[i] === '--idtype') { const n = Number(args[++i]); if (n >= 0 && n <= 3) idType = n as ProductIdType; }
                else if (args[i] === '--primary') primary = true;
                else if (args[i] === '--add') method = 'POST';
                else if (args[i] === '--name') name = args[++i];
                else if (args[i] === '--position') { const n = Number(args[++i]); if (!Number.isNaN(n)) position = n; }
              }
              return { idType, primary, name, position, method };
            };
            const action = subArgs[0]?.toLowerCase();

            if (action === 'add') {
              const id = subArgs[1];
              const source = subArgs[2];
              if (!id || !source) {
                console.error("Usage: geins product images add <productId> <file|url> [--name <n>] [--primary] [--position <n>] [--idtype <0-3>]");
                process.exit(1);
              }
              const f = parseImgFlags(subArgs.slice(3));
              const r = await addProductImage(id, source, { idType: f.idType, name: f.name, primary: f.primary, position: f.position, method: f.method });
              // The API keeps the original file name on upload (verified on prod-labs), so
              // FileName normally equals the sent name. We still surface FileName as the
              // authoritative stored name to reuse with `add-existing`, falling back to the
              // sent name if the API omits it — and flag a mismatch should one ever occur.
              const stored = r.FileName ?? r.imageName;
              if (jsonMode) {
                console.log(JSON.stringify({ source, imageName: r.imageName, fileName: r.FileName ?? null, stored }, null, 2));
              } else {
                const renamed = r.FileName != null && r.FileName !== r.imageName;
                console.log(`✓ Uploaded ${r.imageName}${renamed ? ` → stored as ${stored}` : ''}${f.primary ? ' (primary)' : ''} to product ${id}`);
                if (renamed) console.log(`  Reuse with: geins product images add-existing <id> ${stored}`);
              }
              break;
            }
            if (action === 'add-existing' || action === 'link') {
              const id = subArgs[1];
              const name = subArgs[2];
              if (!id || !name) {
                console.error('Usage: geins product images add-existing <productId> <imageName> [--idtype <0-3>]');
                process.exit(1);
              }
              const f = parseImgFlags(subArgs.slice(3));
              const r = await addExistingProductImage(id, name, { idType: f.idType });
              if (jsonMode) console.log(JSON.stringify(r, null, 2));
              else console.log(`✓ Linked existing image ${r.FileName ?? name} to product ${id}`);
              break;
            }
            if (action === 'delete' || action === 'remove') {
              const id = subArgs[1];
              const name = subArgs[2];
              if (!id || !name) { console.error('Usage: geins product images delete <productId> <imageName> [--idtype <0-3>]'); process.exit(1); }
              const f = parseImgFlags(subArgs.slice(3));
              await deleteProductImage(id, name, { idType: f.idType });
              console.log(`✓ Deleted image ${name} from product ${id}`);
              break;
            }
            if (action === 'set-primary') {
              const id = subArgs[1];
              const name = subArgs[2];
              if (!id || !name) { console.error('Usage: geins product images set-primary <productId> <imageName> [--idtype <0-3>]'); process.exit(1); }
              const f = parseImgFlags(subArgs.slice(3));
              await setProductImagePrimary(id, name, { idType: f.idType });
              console.log(`✓ Set ${name} as primary image for product ${id}`);
              break;
            }
            if (action === 'reorder') {
              const id = subArgs[1];
              const name = subArgs[2];
              const pos = Number(subArgs[3]);
              if (!id || !name || Number.isNaN(pos)) { console.error('Usage: geins product images reorder <productId> <imageName> <position> [--idtype <0-3>]'); process.exit(1); }
              const f = parseImgFlags(subArgs.slice(4));
              await reorderProductImage(id, name, pos, { idType: f.idType });
              console.log(`✓ Moved ${name} to position ${pos} for product ${id}`);
              break;
            }

            // list (default): `images <id>` or `images list <id>`
            const id = action === 'list' ? subArgs[1] : subArgs[0];
            if (!id) { console.error('Usage: geins product images <productId> [--idtype <0-3>] [--json]'); process.exit(1); }
            const f = parseImgFlags(action === 'list' ? subArgs.slice(2) : subArgs.slice(1));
            const images = await getProductImages(id, { idType: f.idType });
            if (jsonMode) { console.log(JSON.stringify(images, null, 2)); break; }
            if (images.length === 0) { console.log('No images.'); break; }
            const sorted = [...images].sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0));
            sorted.forEach((img, i) => {
              const primary = i === 0 ? ' ★' : '';
              console.log(`${img.Order ?? i}${primary}  ${imageNameFromUrl(img.Url ?? '')}  ${img.Url ?? ''}`);
            });
            console.log(`\n${images.length} image${images.length === 1 ? '' : 's'}`);
            break;
          }
          case 'relation-types': {
            const action = subArgs[0]?.toLowerCase();
            const orderOf = (args: string[]) => {
              const i = args.indexOf('--order');
              return i !== -1 && args[i + 1] != null ? Number(args[i + 1]) : undefined;
            };
            const nameOf = (args: string[]) => {
              const i = args.indexOf('--name');
              return i !== -1 ? args[i + 1] : undefined;
            };

            if (action === 'add' || action === 'create') {
              const name = subArgs[1];
              if (!name) { console.error('Usage: geins product relation-types add <name> [--order <n>]'); process.exit(1); }
              const rt = await createRelationType({ Name: name, Order: orderOf(subArgs) });
              console.log(`✓ Created relation type ${rt.Id}: ${rt.Name}`);
              break;
            }
            if (action === 'get') {
              const id = Number(subArgs[1]);
              if (Number.isNaN(id)) { console.error('Usage: geins product relation-types get <id>'); process.exit(1); }
              const rt = await getRelationType(id);
              console.log(jsonMode ? JSON.stringify(rt, null, 2) : `${rt.Id}  ${rt.Name}  (order ${rt.Order ?? 0})`);
              break;
            }
            if (action === 'update') {
              const id = Number(subArgs[1]);
              if (Number.isNaN(id)) { console.error('Usage: geins product relation-types update <id> [--name <n>] [--order <n>]'); process.exit(1); }
              const rt = await updateRelationType(id, { Name: nameOf(subArgs), Order: orderOf(subArgs) });
              console.log(`✓ Updated relation type ${rt.Id}: ${rt.Name}`);
              break;
            }
            if (action === 'delete' || action === 'remove') {
              const id = Number(subArgs[1]);
              if (Number.isNaN(id)) { console.error('Usage: geins product relation-types delete <id>'); process.exit(1); }
              await deleteRelationType(id);
              console.log(`✓ Deleted relation type ${id}`);
              break;
            }
            // list (default)
            const types = await listRelationTypes();
            if (jsonMode) { console.log(JSON.stringify(types, null, 2)); break; }
            if (types.length === 0) { console.log('No relation types.'); break; }
            for (const t of types) console.log(`${t.Id}  ${t.Name}  (order ${t.Order ?? 0})`);
            console.log(`\n${types.length} relation type${types.length === 1 ? '' : 's'}`);
            break;
          }
          case 'relations': {
            const action = subArgs[0]?.toLowerCase();
            const idTypeOf = (args: string[]) => {
              const i = args.indexOf('--idtype');
              if (i !== -1 && args[i + 1] != null) { const n = Number(args[i + 1]); if (n >= 0 && n <= 3) return n as ProductIdType; }
              return undefined;
            };

            if (action === 'link' || action === 'unlink') {
              const productId = subArgs[1];
              const relationTypeId = Number(subArgs[2]);
              const relatedIds = subArgs.slice(3).filter((a) => !a.startsWith('--'));
              if (!productId || Number.isNaN(relationTypeId) || relatedIds.length === 0) {
                console.error(`Usage: geins product relations ${action} <productId> <relationTypeId> <relatedId...> [--idtype <0-3>]`);
                process.exit(1);
              }
              const idType = idTypeOf(subArgs);
              if (action === 'link') await linkRelatedProducts(productId, relationTypeId, relatedIds, { idType });
              else await unlinkRelatedProducts(productId, relationTypeId, relatedIds, { idType });
              console.log(`✓ ${action === 'link' ? 'Linked' : 'Unlinked'} ${relatedIds.join(', ')} ${action === 'link' ? 'to' : 'from'} product ${productId} (relation type ${relationTypeId})`);
              break;
            }

            // view (default): relations <productId>
            const id = subArgs[0];
            if (!id) { console.error('Usage: geins product relations <productId>  |  link/unlink <productId> <relationTypeId> <relatedId...>'); process.exit(1); }
            const relations = await getProductRelations(id, { idType: idTypeOf(subArgs) });
            if (jsonMode) { console.log(JSON.stringify(relations, null, 2)); break; }
            if (relations.length === 0) { console.log('No related products.'); break; }
            for (const r of relations) console.log(`${r.RelatedProductId}  (relation type ${r.RelationTypeId ?? '?'})`);
            console.log(`\n${relations.length} related product${relations.length === 1 ? '' : 's'}`);
            break;
          }
          case 'brands':
          case 'brand': {
            const action = subArgs[0]?.toLowerCase();
            const flagVal = (flag: string) => { const i = subArgs.indexOf(flag); return i !== -1 ? subArgs[i + 1] : undefined; };
            // Repeatable --desc <code>:<text> → localized descriptions.
            const parseDesc = (): LocalizableContent[] | undefined => {
              const parts = subArgs.flatMap((a, i) => (subArgs[i - 1] === '--desc' ? [a] : []));
              if (parts.length === 0) return undefined;
              return parts.map((p) => { const c = p.indexOf(':'); return { LanguageCode: c === -1 ? p : p.slice(0, c), Content: c === -1 ? '' : p.slice(c + 1) }; });
            };

            if (action === 'get') {
              const bid = Number(subArgs[1]);
              if (Number.isNaN(bid)) { console.error('Usage: geins product brands get <id> [--json]'); process.exit(1); }
              const brand = await getBrand(bid);
              if (jsonMode) { console.log(JSON.stringify(brand, null, 2)); break; }
              console.log(`${brand.BrandId}  ${brandName(brand)}${brand.ExternalId ? `  (ext: ${brand.ExternalId})` : ''}`);
              for (const d of brand.Descriptions ?? []) console.log(`  ${d.LanguageCode}: ${d.Content}`);
              break;
            }
            if (action === 'create' || action === 'add') {
              const name = flagVal('--name');
              if (!name) { console.error('Usage: geins product brands create --name <n> [--external-id <id>] [--desc <code>:<text>]'); process.exit(1); }
              const input: BrandWrite = { Name: name, ExternalId: flagVal('--external-id'), Descriptions: parseDesc() };
              const brand = await createBrand(input);
              console.log(`✓ Created brand ${brand.BrandId}: ${brandName(brand)}`);
              break;
            }
            if (action === 'update') {
              const bid = Number(subArgs[1]);
              if (Number.isNaN(bid)) { console.error('Usage: geins product brands update <id> [--name <n>] [--external-id <id>] [--desc <code>:<text>]'); process.exit(1); }
              const brand = await updateBrand(bid, { Name: flagVal('--name'), ExternalId: flagVal('--external-id'), Descriptions: parseDesc() });
              console.log(`✓ Updated brand ${brand.BrandId}: ${brandName(brand)}`);
              break;
            }
            if (action === 'delete' || action === 'remove') {
              const bid = Number(subArgs[1]);
              if (Number.isNaN(bid)) { console.error('Usage: geins product brands delete <id>'); process.exit(1); }
              await deleteBrand(bid);
              console.log(`✓ Deleted brand ${bid}`);
              break;
            }
            // list (default)
            const brands = await queryBrands();
            if (jsonMode) { console.log(JSON.stringify(brands, null, 2)); break; }
            if (brands.length === 0) { console.log('No brands.'); break; }
            for (const b of brands) console.log(`${b.BrandId}  ${brandName(b)}${b.ExternalId ? `  (ext: ${b.ExternalId})` : ''}`);
            console.log(`\n${brands.length} brand${brands.length === 1 ? '' : 's'}`);
            break;
          }
          case 'text':
          case 'texts': {
            const idTypeFor = () => { const i = subArgs.indexOf('--idtype'); if (i !== -1 && subArgs[i + 1] != null) { const n = Number(subArgs[i + 1]); if (n >= 0 && n <= 3) return n as ProductIdType; } return undefined; };
            const TEXT_FIELDS: ProductTextField[] = ['Names', 'ShortTexts', 'LongTexts', 'TechTexts'];
            const action = subArgs[0]?.toLowerCase();

            if (action === 'set') {
              const id = subArgs[1];
              const field = parseProductTextField(subArgs[2] ?? '');
              // Positional <locale>:<text> entries follow the field; skip --idtype and its value.
              const entryArgs: string[] = [];
              let skipNext = false;
              for (const a of subArgs.slice(3)) {
                if (skipNext) { skipNext = false; continue; }
                if (a === '--idtype') { skipNext = true; continue; }
                entryArgs.push(a);
              }
              // <code>:<text>, first colon only (no colon → default-language content).
              const entries: LocalizableContent[] = entryArgs.map((p) => { const c = p.indexOf(':'); return c === -1 ? { LanguageCode: '', Content: p } : { LanguageCode: p.slice(0, c), Content: p.slice(c + 1) }; });
              if (!id || !field || entries.length === 0) {
                console.error(`Usage: geins product text set <id> <${PRODUCT_TEXT_FIELD_TOKENS.join('|')}> <locale>:<text> [<locale>:<text>...] [--idtype <0-3>]`);
                if (subArgs[2] && !field) console.error(`Unknown text field "${subArgs[2]}". Use one of: ${PRODUCT_TEXT_FIELD_TOKENS.join(', ')}.`);
                process.exit(1);
              }
              const product = await setProductText(id, field, entries, { idType: idTypeFor() });
              const result = (product[field] as LocalizableContent[] | undefined) ?? [];
              console.log(`✓ Set ${field} on product ${id} (${entries.map((e) => e.LanguageCode || '–').join(', ')})`);
              for (const e of result) console.log(`  ${e.LanguageCode || '–'}: ${e.Content}`);
              break;
            }

            // list (default): geins product text <id> [--json]
            const id = subArgs[0];
            if (!id) { console.error('Usage: geins product text <id> [--json]  |  geins product text set <id> <field> <locale>:<text>...'); process.exit(1); }
            const product = await getProduct(id, { idType: idTypeFor(), include: TEXT_FIELDS.join(',') });
            if (jsonMode) {
              console.log(JSON.stringify(Object.fromEntries(TEXT_FIELDS.map((f) => [f, product[f] ?? []])), null, 2));
              break;
            }
            for (const f of TEXT_FIELDS) {
              const entries = (product[f] as LocalizableContent[] | undefined) ?? [];
              if (entries.length === 0) continue;
              console.log(f);
              for (const e of entries) console.log(`  ${e.LanguageCode || '–'}: ${e.Content}`);
            }
            break;
          }
          case 'categories':
          case 'category': {
            const action = subArgs[0]?.toLowerCase();
            const flagVal = (flag: string) => { const i = subArgs.indexOf(flag); return i !== -1 ? subArgs[i + 1] : undefined; };
            const numFlag = (flag: string) => { const v = flagVal(flag); const n = v != null ? Number(v) : NaN; return Number.isNaN(n) ? undefined : n; };
            // Repeatable --name/--desc as <code>:<text> (no colon → default-language content).
            const parseLoc = (flag: string): LocalizableContent[] | undefined => {
              const parts = subArgs.flatMap((a, i) => (subArgs[i - 1] === flag ? [a] : []));
              if (parts.length === 0) return undefined;
              return parts.map((p) => { const c = p.indexOf(':'); return c === -1 ? { LanguageCode: '', Content: p } : { LanguageCode: p.slice(0, c), Content: p.slice(c + 1) }; });
            };
            const idTypeFor = () => { const i = subArgs.indexOf('--idtype'); if (i !== -1 && subArgs[i + 1] != null) { const n = Number(subArgs[i + 1]); if (n >= 0 && n <= 3) return n as ProductIdType; } return undefined; };

            if (action === 'assign') {
              const productId = subArgs[1];
              const categoryId = Number(subArgs[2]);
              if (!productId || Number.isNaN(categoryId)) { console.error('Usage: geins product categories assign <productId> <categoryId> [--idtype <0-3>]'); process.exit(1); }
              await assignProductCategory(productId, categoryId, { idType: idTypeFor() });
              console.log(`✓ Assigned category ${categoryId} to product ${productId}`);
              break;
            }
            if (action === 'set-main' || action === 'main') {
              const productId = subArgs[1];
              const categoryId = Number(subArgs[2]);
              if (!productId || Number.isNaN(categoryId)) { console.error('Usage: geins product categories set-main <productId> <categoryId> [--idtype <0-3>]'); process.exit(1); }
              const ordered = await setMainCategory(productId, categoryId, { idType: idTypeFor() });
              console.log(`✓ Set category ${categoryId} as main for product ${productId} (CategoryIds: ${ordered.join(', ')})`);
              break;
            }
            if (action === 'unassign' || action === 'remove') {
              const productId = subArgs[1];
              const categoryId = Number(subArgs[2]);
              if (!productId || Number.isNaN(categoryId)) { console.error('Usage: geins product categories unassign <productId> <categoryId> [--idtype <0-3>]'); process.exit(1); }
              const r = await unassignProductCategory(productId, categoryId, { idType: idTypeFor() });
              if (!r.wasAssigned) { console.log(`Category ${categoryId} is not assigned to product ${productId}. Categories: ${r.remaining.join(', ') || '(none)'}`); break; }
              if (r.stillPresent) {
                console.error(`Could not remove category ${categoryId} from product ${productId}: it's an ancestor of another assigned category, and the API keeps ancestors. Remove the more specific (leaf) category instead.`);
                console.error(`Categories: ${r.remaining.join(', ')}`);
                process.exit(1);
              }
              console.log(`✓ Removed category ${categoryId} from product ${productId}. Remaining: ${r.remaining.join(', ') || '(none)'}`);
              if (r.wasMain) console.log(`  Note: ${categoryId} was the main category; main is now ${r.newMain ?? '(none)'}.`);
              break;
            }
            if (action === 'get') {
              const cid = Number(subArgs[1]);
              if (Number.isNaN(cid)) { console.error('Usage: geins product categories get <id> [--json]'); process.exit(1); }
              const cat = await getCategory(cid);
              if (jsonMode) { console.log(JSON.stringify(cat, null, 2)); break; }
              const flags = [cat.Hidden ? 'hidden' : null, cat.Active === false ? 'inactive' : null].filter(Boolean).join(', ');
              console.log(`${cat.CategoryId}  ${categoryName(cat)}${cat.ParentCategoryId ? `  (parent ${cat.ParentCategoryId})` : ''}${flags ? `  [${flags}]` : ''}`);
              for (const n of cat.Names ?? []) console.log(`  name ${n.LanguageCode || '–'}: ${n.Content}`);
              for (const d of cat.Descriptions ?? []) console.log(`  desc ${d.LanguageCode || '–'}: ${d.Content}`);
              if (cat.GoogleCategoryPath) console.log(`  google: ${cat.GoogleCategoryPath}`);
              break;
            }
            if (action === 'create' || action === 'add') {
              const names = parseLoc('--name');
              if (!names) { console.error('Usage: geins product categories create --name <code>:<text> [--name ...] [--parent <id>] [--desc <code>:<text>] [--hidden] [--inactive]'); process.exit(1); }
              const input: CategoryWrite = {
                Names: names,
                ParentCategoryId: numFlag('--parent'),
                Descriptions: parseLoc('--desc'),
                Hidden: subArgs.includes('--hidden') ? true : undefined,
                Active: subArgs.includes('--inactive') ? false : undefined,
              };
              const cat = await createCategory(input);
              console.log(`✓ Created category ${cat.CategoryId}: ${categoryName(cat)}`);
              break;
            }
            if (action === 'update') {
              const cid = Number(subArgs[1]);
              if (Number.isNaN(cid)) { console.error('Usage: geins product categories update <id> [--name <code>:<text>] [--parent <id>] [--desc <code>:<text>] [--hidden] [--show] [--active] [--inactive]'); process.exit(1); }
              const changes: CategoryWrite = {
                Names: parseLoc('--name'),
                ParentCategoryId: numFlag('--parent'),
                Descriptions: parseLoc('--desc'),
                Hidden: subArgs.includes('--hidden') ? true : subArgs.includes('--show') ? false : undefined,
                Active: subArgs.includes('--active') ? true : subArgs.includes('--inactive') ? false : undefined,
              };
              const cat = await updateCategory(cid, changes);
              console.log(`✓ Updated category ${cat.CategoryId}: ${categoryName(cat)}`);
              break;
            }
            // list (default)
            const categories = await queryCategories();
            if (jsonMode) { console.log(JSON.stringify(categories, null, 2)); break; }
            if (categories.length === 0) { console.log('No categories.'); break; }
            for (const c of categories) {
              const flags = [c.Hidden ? 'hidden' : null, c.Active === false ? 'inactive' : null].filter(Boolean).join(', ');
              console.log(`${c.CategoryId}  ${categoryName(c)}${c.ParentCategoryId ? `  (parent ${c.ParentCategoryId})` : ''}${flags ? `  [${flags}]` : ''}`);
            }
            console.log(`\n${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`);
            break;
          }
          case 'parameters':
          case 'params': {
            const action = subArgs[0]?.toLowerCase();
            const idTypeOf = (args: string[]) => {
              const i = args.indexOf('--idtype');
              if (i !== -1 && args[i + 1] != null) { const n = Number(args[i + 1]); if (n >= 0 && n <= 3) return n as ProductIdType; }
              return undefined;
            };
            const flagVal = (args: string[], flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };
            const numFlag = (args: string[], flag: string) => { const v = flagVal(args, flag); const n = v != null ? Number(v) : NaN; return Number.isNaN(n) ? undefined : n; };
            // Repeatable --param <id> (group membership) and --lang/--desc <code>:<text>.
            const collect = (args: string[], flag: string) => args.flatMap((a, i) => (args[i - 1] === flag ? [a] : []));
            const parseLocalized = (args: string[], flag: string): LocalizableContent[] | undefined => {
              const parts = collect(args, flag);
              if (parts.length === 0) return undefined;
              return parts.map((p) => { const c = p.indexOf(':'); return { LanguageCode: c === -1 ? p : p.slice(0, c), Content: c === -1 ? '' : p.slice(c + 1) }; });
            };

            // ── Definitions registry ──
            if (action === 'defs' || action === 'def') {
              const sub2 = subArgs[1]?.toLowerCase();
              if (sub2 === 'get') {
                const pid = Number(subArgs[2]);
                if (Number.isNaN(pid)) { console.error('Usage: geins product parameters defs get <parameterId>'); process.exit(1); }
                const def = await getProductParameterDef(pid);
                if (jsonMode) { console.log(JSON.stringify(def, null, 2)); break; }
                console.log(`${def.ParameterId}  ${def.Name}  (type ${def.ParameterType ?? '?'}, group ${def.GroupName ?? def.GroupId ?? '?'})`);
                for (const pv of def.PredefinedValues ?? []) console.log(`  · ${pv.PredefinedValueId}  ${pv.Name}`);
                break;
              }
              if (sub2 === 'create' || sub2 === 'add') {
                const name = flagVal(subArgs, '--name');
                const group = numFlag(subArgs, '--group');
                const type = numFlag(subArgs, '--type');
                if (!name || group == null || type == null) { console.error('Usage: geins product parameters defs create --name <n> --group <groupId> --type <1-7> [--lang <code>:<text>]'); process.exit(1); }
                const def = await createProductParameter({ Name: name, GroupId: group, ParameterType: type, LocalizedNames: parseLocalized(subArgs, '--lang') });
                console.log(`✓ Created parameter ${def.ParameterId}: ${def.Name}`);
                break;
              }
              if (sub2 === 'update') {
                const pid = Number(subArgs[2]);
                if (Number.isNaN(pid)) { console.error('Usage: geins product parameters defs update <parameterId> [--name <n>] [--group <id>] [--type <1-7>]'); process.exit(1); }
                const def = await updateProductParameter(pid, { Name: flagVal(subArgs, '--name'), GroupId: numFlag(subArgs, '--group'), ParameterType: numFlag(subArgs, '--type'), LocalizedNames: parseLocalized(subArgs, '--lang') });
                console.log(`✓ Updated parameter ${def.ParameterId}: ${def.Name}`);
                break;
              }
              console.error('Usage: geins product parameters defs [get <id> | create --name <n> --group <id> --type <1-7> | update <id> ...]');
              process.exit(1);
            }

            // ── Parameter groups ──
            if (action === 'groups' || action === 'group') {
              const sub2 = subArgs[1]?.toLowerCase();
              if (sub2 === 'get') {
                const gid = Number(subArgs[2]);
                if (Number.isNaN(gid)) { console.error('Usage: geins product parameters groups get <groupId>'); process.exit(1); }
                const g = await getProductParameterGroup(gid);
                if (jsonMode) { console.log(JSON.stringify(g, null, 2)); break; }
                console.log(`${g.GroupId}  ${g.Name}  (order ${g.Order ?? 0})`);
                if (g.ParameterIds?.length) console.log(`  parameters: ${g.ParameterIds.join(', ')}`);
                break;
              }
              if (sub2 === 'create' || sub2 === 'add') {
                const name = flagVal(subArgs, '--name');
                if (!name) { console.error('Usage: geins product parameters groups create --name <n> [--order <n>] [--param <id>...]'); process.exit(1); }
                const paramIds = collect(subArgs, '--param').map(Number).filter((n) => !Number.isNaN(n));
                const g = await createProductParameterGroup({ Name: name, Order: numFlag(subArgs, '--order'), ParameterIds: paramIds.length ? paramIds : undefined, LocalizedNames: parseLocalized(subArgs, '--lang') });
                console.log(`✓ Created parameter group ${g.GroupId}: ${g.Name}`);
                break;
              }
              if (sub2 === 'update') {
                const gid = Number(subArgs[2]);
                if (Number.isNaN(gid)) { console.error('Usage: geins product parameters groups update <groupId> [--name <n>] [--order <n>] [--param <id>...]'); process.exit(1); }
                const paramIds = collect(subArgs, '--param').map(Number).filter((n) => !Number.isNaN(n));
                const g = await updateProductParameterGroup(gid, { Name: flagVal(subArgs, '--name'), Order: numFlag(subArgs, '--order'), ParameterIds: paramIds.length ? paramIds : undefined, LocalizedNames: parseLocalized(subArgs, '--lang') });
                console.log(`✓ Updated parameter group ${g.GroupId}: ${g.Name}`);
                break;
              }
              console.error('Usage: geins product parameters groups [get <id> | create --name <n> [--order <n>] [--param <id>...] | update <id> ...]');
              process.exit(1);
            }

            // ── Predefined values ──
            if (action === 'predefined' || action === 'predef') {
              const sub2 = subArgs[1]?.toLowerCase();
              if (sub2 === 'get') {
                const vid = Number(subArgs[2]);
                if (Number.isNaN(vid)) { console.error('Usage: geins product parameters predefined get <predefinedValueId>'); process.exit(1); }
                const pv = await getPredefinedValue(vid);
                console.log(jsonMode ? JSON.stringify(pv, null, 2) : `${pv.PredefinedValueId}  ${pv.Name}  (parameter ${pv.ParameterId ?? '?'})`);
                break;
              }
              if (sub2 === 'add' || sub2 === 'create') {
                const param = numFlag(subArgs, '--param');
                const name = flagVal(subArgs, '--name');
                if (param == null || !name) { console.error('Usage: geins product parameters predefined add --param <parameterId> --name <n> [--lang <code>:<text>]'); process.exit(1); }
                const pv = await createPredefinedValue({ ParameterId: param, Name: name, LocalizedNames: parseLocalized(subArgs, '--lang') });
                console.log(`✓ Created predefined value ${pv.PredefinedValueId}: ${pv.Name}`);
                break;
              }
              if (sub2 === 'rename' || sub2 === 'update') {
                const vid = Number(subArgs[2]);
                const name = subArgs[3] ?? flagVal(subArgs, '--name');
                if (Number.isNaN(vid) || !name) { console.error('Usage: geins product parameters predefined rename <predefinedValueId> <name>'); process.exit(1); }
                const pv = await updatePredefinedValueNames(vid, name, parseLocalized(subArgs, '--lang'));
                console.log(`✓ Renamed predefined value ${pv.PredefinedValueId} to ${pv.Name}`);
                break;
              }
              console.error('Usage: geins product parameters predefined [get <id> | add --param <pid> --name <n> | rename <id> <name>]');
              process.exit(1);
            }

            // ── Batch value writes (JSON body) ──
            if (action === 'batch') {
              const op = subArgs[1]?.toLowerCase();
              if (op !== 'update' && op !== 'replace' && op !== 'remove') {
                console.error("Usage: geins product parameters batch <update|replace|remove> [--file <path> | --body '<json>' | stdin]\n" +
                  '  update/replace body: { "values": [ { "ProductId", "ParameterId", "Value", "LocalizedDescriptions"? } ] }\n' +
                  '  remove body:         { "assignments": [ { "ProductId", "ParameterId" } ] }');
                process.exit(1);
              }
              const body = (await resolveBody(subArgs.slice(2))) as Record<string, unknown>;
              if (op === 'remove') {
                const assignments = (body.assignments ?? body.ProductParameterAssignments ?? []) as ProductParameterAssignment[];
                await removeProductParameterAssignments(assignments);
                console.log(`✓ Removed ${assignments.length} parameter assignment${assignments.length === 1 ? '' : 's'}`);
              } else {
                const values = (body.values ?? body.productParameterValues ?? []) as ProductParameterValueWrite[];
                if (op === 'update') await updateProductParameterValues(values);
                else await replaceProductParameterValues(values);
                console.log(`✓ ${op === 'update' ? 'Updated' : 'Replaced'} ${values.length} parameter value${values.length === 1 ? '' : 's'}`);
              }
              break;
            }

            // ── Per-product values ──
            if (action === 'set') {
              const id = subArgs[1];
              const paramId = Number(subArgs[2]);
              const value = subArgs[3];
              if (!id || Number.isNaN(paramId) || value == null) { console.error('Usage: geins product parameters set <productId> <parameterId> <value> [--desc <code>:<text>] [--idtype <0-3>]'); process.exit(1); }
              const v = await setProductParameterValue(id, paramId, value, { idType: idTypeOf(subArgs), localizedDescriptions: parseLocalized(subArgs, '--desc') });
              if (jsonMode) { console.log(JSON.stringify(v, null, 2)); break; }
              console.log(`✓ Set ${v.ParameterName ?? paramId}=${v.Value ?? value} on product ${id}`);
              break;
            }
            if (action === 'remove' || action === 'delete') {
              const id = subArgs[1];
              const paramId = Number(subArgs[2]);
              if (!id || Number.isNaN(paramId)) { console.error('Usage: geins product parameters remove <productId> <parameterId> [--idtype <0-3>]'); process.exit(1); }
              await removeProductParameterValue(id, paramId, { idType: idTypeOf(subArgs) });
              console.log(`✓ Removed parameter ${paramId} from product ${id}`);
              break;
            }
            if (action === 'get') {
              const id = subArgs[1];
              const paramId = Number(subArgs[2]);
              if (!id || Number.isNaN(paramId)) { console.error('Usage: geins product parameters get <productId> <parameterId> [--idtype <0-3>] [--json]'); process.exit(1); }
              const v = await getProductParameterValue(id, paramId, { idType: idTypeOf(subArgs) });
              if (jsonMode) { console.log(JSON.stringify(v, null, 2)); break; }
              console.log(`${parameterValueSummary(v)}  (parameter ${v.ParameterId}, type ${v.ParameterType ?? '?'}, group ${v.GroupName ?? v.GroupId ?? '?'})`);
              break;
            }

            // list (default): parameters <productId> or parameters list <productId>
            const id = action === 'list' ? subArgs[1] : subArgs[0];
            if (!id) { console.error('Usage: geins product parameters <productId>  |  set/remove/get <productId> <parameterId> ...  |  defs|groups|predefined|batch ...'); process.exit(1); }
            const values = await getProductParameters(id, { idType: idTypeOf(subArgs) });
            if (jsonMode) { console.log(JSON.stringify(values, null, 2)); break; }
            if (values.length === 0) { console.log('No parameter values.'); break; }
            for (const v of values) console.log(`${v.ParameterId}  ${parameterValueSummary(v)}${v.GroupName ? `  [${v.GroupName}]` : ''}`);
            console.log(`\n${values.length} parameter value${values.length === 1 ? '' : 's'}`);
            break;
          }
          case 'list':
          case 'query': {
            const { query, page, include, json } = parseProductListArgs(subArgs);
            const result = await queryProducts(query, { page: page ?? 1, include });
            if (json) {
              console.log(JSON.stringify(result, null, 2));
              break;
            }
            for (const p of result.products) {
              const status = p.Active ? '●' : '○';
              console.log(`${status} ${productName(p)}  (${p.ProductId})  ${p.ArticleNumber ?? ''}`.trimEnd());
            }
            const pr = result.page;
            if (pr) {
              console.log(`\n${result.products.length} shown · ${pr.RowCount ?? '?'} total · page ${pr.Page ?? 1}/${pr.PageCount ?? 1}`);
              if (pr.HasMoreRows) {
                console.log(`Next page: geins product list --page ${(pr.Page ?? 1) + 1} --batch ${pr.BatchId}`);
              }
            }
            break;
          }
          case 'help':
            console.log(PRODUCT_HELP);
            break;
          default:
            if (!sub) {
              console.log(PRODUCT_HELP);
            } else {
              console.error(`Unknown subcommand: product ${sub}\n`);
              console.error(PRODUCT_HELP);
              process.exit(1);
            }
        }
        break;
      }
      case 'order': {
        const sub = commandArgs[0]?.toLowerCase() ?? 'list';
        const subArgs = commandArgs.slice(1);
        const jsonMode = commandArgs.includes('--json');

        switch (sub) {
          case 'list':
          case 'query': {
            const { query, page, json } = parseOrderListArgs(subArgs);
            // The plain /Query endpoint accepts an empty body; the paged /Query/{page}
            // endpoint 500s on some accounts unless filtered, so only page when asked.
            const result = await queryOrders(query, { page });
            if (json) { console.log(JSON.stringify(result, null, 2)); break; }
            if (result.orders.length === 0) { console.log('No orders found.'); break; }
            for (const o of result.orders) console.log(orderSummary(o));
            const pr = result.page;
            if (pr) {
              console.log(`\n${result.orders.length} shown · ${pr.RowCount ?? '?'} total · page ${pr.Page ?? 1}/${pr.PageCount ?? 1}`);
              if (pr.HasMoreRows) console.log(`Next page: geins order list --page ${(pr.Page ?? 1) + 1} --batch ${pr.BatchId}`);
            }
            break;
          }
          case 'get': {
            const id = subArgs[0];
            if (!id) { console.error('Usage: geins order get <idOrPublicId> [--include <fields>] [--json]'); process.exit(1); }
            const incIdx = subArgs.indexOf('--include');
            const include = incIdx !== -1 ? subArgs[incIdx + 1] : undefined;
            const order = await getOrder(id, { include });
            if (jsonMode) { console.log(JSON.stringify(order, null, 2)); break; }
            console.log(orderSummary(order));
            if (order.PublicId) console.log(`  Public id: ${order.PublicId}`);
            if (order.MarketName) console.log(`  Market: ${order.MarketName}`);
            const email = order.CustomerEmail ?? order.BillingAddress?.Email ?? order.ShippingAddress?.Email;
            if (email) console.log(`  Customer: ${email}`);
            for (const r of order.Rows ?? []) {
              const qty = r.Quantity != null ? `${r.Quantity}× ` : '';
              const price = r.PriceIncVat != null ? `  ${r.PriceIncVat} ${order.Currency ?? ''}`.trimEnd() : '';
              console.log(`  ${qty}${r.Name ?? r.ArticleNumber ?? r.ProductId ?? '?'}${price}`);
            }
            break;
          }
          case 'count': {
            const email = subArgs[0];
            if (!email) { console.error('Usage: geins order count <email>'); process.exit(1); }
            const n = await countOrders(email);
            console.log(jsonMode ? JSON.stringify({ email, count: n }, null, 2) : `${n}`);
            break;
          }
          case 'statuses': {
            const statuses = await getOrderStatuses();
            console.log(JSON.stringify(statuses, null, 2));
            break;
          }
          case 'create': {
            const body = await resolveBody(subArgs);
            const id = await createOrder(body as Parameters<typeof createOrder>[0]);
            console.log(jsonMode ? JSON.stringify({ orderId: id }, null, 2) : `✓ Created order ${id}`);
            break;
          }
          case 'validate': {
            const body = await resolveBody(subArgs);
            const result = await validateOrderCreation(body as Parameters<typeof validateOrderCreation>[0]);
            if (jsonMode) { console.log(JSON.stringify(result, null, 2)); break; }
            console.log(`${result.Success ? '✓' : '✗'} ${result.Success ? 'Valid' : 'Invalid'}${result.Message ? `: ${result.Message}` : ''}`);
            if (!result.Success) process.exit(1);
            break;
          }
          case 'status': {
            const id = subArgs[0];
            const status = subArgs[1];
            if (!id || !status) { console.error('Usage: geins order status <id> <status> [<transactionId> [<secondaryTransactionId>]]'); process.exit(1); }
            await setOrderStatus(id, status, subArgs[2], subArgs[3]);
            console.log(`✓ Order ${id} status set to ${status}`);
            break;
          }
          case 'update': {
            const id = subArgs[0];
            if (!id) { console.error('Usage: geins order update <id> [--external-id <s>] [--parcel <s>] [--external-status <n>] [--return-parcel <s>] | [--body \'<json>\']'); process.exit(1); }
            const flag = (name: string) => { const i = subArgs.indexOf(name); return i !== -1 ? subArgs[i + 1] : undefined; };
            let changes: OrderUpdate;
            if (subArgs.includes('--body') || subArgs.includes('--file')) {
              changes = (await resolveBody(subArgs.slice(1))) as OrderUpdate;
            } else {
              const extStatus = flag('--external-status');
              changes = {
                ExternalId: flag('--external-id'),
                ParcelNumber: flag('--parcel'),
                ReturnParcelNumber: flag('--return-parcel'),
                ExternalOrderStatus: extStatus != null && !Number.isNaN(Number(extStatus)) ? Number(extStatus) : undefined,
              };
            }
            await updateOrder(id, changes);
            console.log(`✓ Updated order ${id}`);
            break;
          }
          case 'cancel-row': {
            const orderId = subArgs[0];
            const orderRowId = subArgs[1];
            if (!orderId || !orderRowId) { console.error('Usage: geins order cancel-row <orderId> <orderRowId>'); process.exit(1); }
            await cancelOrderRow(orderId, orderRowId);
            console.log(`✓ Cancelled row ${orderRowId} on order ${orderId}`);
            break;
          }
          case 'comment': {
            const id = subArgs[0];
            const text = subArgs.slice(1).filter((a) => a !== '--system').join(' ');
            if (!id || !text) { console.error('Usage: geins order comment <id> <text> [--system]'); process.exit(1); }
            await addOrderComment(id, text, { system: subArgs.includes('--system') });
            console.log(`✓ Added comment to order ${id}`);
            break;
          }
          case 'transaction': {
            const id = subArgs[0];
            const transactionId = subArgs[1];
            if (!id || !transactionId) { console.error('Usage: geins order transaction <id> <transactionId>'); process.exit(1); }
            await setOrderTransaction(id, transactionId);
            console.log(`✓ Set transaction ${transactionId} on order ${id}`);
            break;
          }
          case 'set-paid': {
            const paymentDetailId = subArgs[0];
            if (!paymentDetailId) { console.error('Usage: geins order set-paid <paymentDetailId>'); process.exit(1); }
            await setPaymentPaid(paymentDetailId);
            console.log(`✓ Marked payment ${paymentDetailId} as paid`);
            break;
          }
          case 'delete': {
            const id = subArgs[0];
            if (!id) { console.error('Usage: geins order delete <id>'); process.exit(1); }
            await deleteOrder(id);
            console.log(`✓ Deleted order ${id}`);
            break;
          }
          case 'help':
            console.log(ORDER_HELP);
            break;
          default:
            console.error(`Unknown subcommand: order ${sub}\n`);
            console.error(ORDER_HELP);
            process.exit(1);
        }
        break;
      }
      case 'api': {
        const method = commandArgs[0]?.toUpperCase() ?? 'GET';
        const path = commandArgs[1];
        if (!path) {
          console.error('Usage: geins api <METHOD> <path>');
          process.exit(1);
        }
        let body: unknown;
        const bodyIdx = commandArgs.indexOf('--body');
        if (bodyIdx !== -1 && commandArgs[bodyIdx + 1]) {
          body = JSON.parse(commandArgs[bodyIdx + 1]!);
        }
        const apiPath = path.startsWith('/') ? path : `/${path}`;
        const data = await request(apiPath, { method, body });
        console.log(JSON.stringify(data, null, 2));
        break;
      }
      case 'output': {
        const sub = commandArgs[0];
        if (!sub || sub.toLowerCase() === 'status') {
          const dir = await getOutputDir();
          console.log(dir ? `Output folder: ${dir}` : 'Output folder: (disabled)');
          break;
        }
        if (['off', 'clear', 'none', 'disable'].includes(sub.toLowerCase())) {
          const config = await loadConfig();
          delete config.outputDir;
          await saveConfig(config);
          setOutputDir(null);
          console.log('✓ Output folder disabled.');
          break;
        }
        const config = await loadConfig();
        config.outputDir = sub;
        await saveConfig(config);
        setOutputDir(sub);
        const resolved = await getOutputDir();
        console.log(`✓ Output folder set: ${resolved}`);
        break;
      }
      case 'account': {
        const sub = commandArgs[0]?.toLowerCase();
        const jsonMode = commandArgs.includes('--json');
        const vatPct = (rate?: number) => (rate != null ? `VAT ${+(rate * 100).toFixed(2)}%` : null);

        if (sub === 'languages' || sub === 'language' || sub === 'langs') {
          const languages = await listLanguages();
          if (jsonMode) { outputJson(languages); break; }
          for (const l of languages) console.log(`${l._id}  ${l.name}${l.active === false ? '  (inactive)' : ''}`);
          console.log(`\n${languages.length} language${languages.length === 1 ? '' : 's'}`);
          break;
        }

        if (sub === 'locales' || sub === 'locale') {
          const locales = await listLocales();
          if (jsonMode) { outputJson(locales); break; }
          for (const l of locales) {
            const extra = [l.languageName, l.channel && `channel: ${l.channel}`].filter(Boolean).join('  ');
            console.log(`${l.tag}${extra ? `  ${extra}` : ''}`);
          }
          console.log(`\n${locales.length} locale${locales.length === 1 ? '' : 's'}`);
          break;
        }

        if (sub === 'markets' || sub === 'market') {
          const markets = await listMarkets();
          if (jsonMode) { outputJson(markets); break; }
          for (const m of markets) {
            const bits = [m.currency?._id, vatPct(m.standardVatRate)].filter(Boolean).join(' · ');
            console.log(`${marketName(m)}${bits ? `  (${bits})` : ''}${m.active === false ? '  (inactive)' : ''}`);
          }
          console.log(`\n${markets.length} market${markets.length === 1 ? '' : 's'}`);
          break;
        }

        // Default: overview of markets, languages, and locales.
        const [markets, languages, channels] = await Promise.all([listMarkets(), listLanguages(), listChannels()]);
        const locales = await listLocales({ channels, languages });
        if (jsonMode) { outputJson({ markets, languages, locales }); break; }
        console.log(`Markets (${markets.length}):`);
        for (const m of markets) {
          const bits = [m.currency?._id, vatPct(m.standardVatRate)].filter(Boolean).join(' · ');
          console.log(`  ${marketName(m)}${bits ? `  (${bits})` : ''}`);
        }
        console.log(`\nLanguages (${languages.length}):`);
        for (const l of languages) console.log(`  ${l._id}  ${l.name}`);
        console.log(`\nLocales (${locales.length}): ${locales.map((l) => l.tag).join(', ')}`);
        break;
      }
      default:
        console.error(`Unknown command: ${commandName}. Run geins --help for usage.`);
        process.exit(1);
    }
  } catch (err) {
    exitWithError(err);
  }
}
