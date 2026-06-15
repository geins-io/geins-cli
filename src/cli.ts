import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.tsx';
import { loadConfig, saveConfig, addCredentials, loadCredentials, loadCredentialsStore, useCredentials, removeCredentials, clearCredentials, updateActiveCredentials, type ApiCredentials, type StoredCheckoutDefaults } from './config/store.ts';
import { setOutputDir, getOutputDir } from './output/sink.ts';
import { request, setAccountKeyOverride } from './api/client.ts';
import { loadSession } from './auth/session.ts';
import { formatError, exitWithError, notLoggedIn } from './api/errors.ts';
import { getApiUrl } from './config/env.ts';
import { readFileSync } from 'node:fs';
import { getProduct, createProduct, updateProduct, deleteProduct, type ProductWrite, queryProducts, queryAllProducts, parseProductListArgs, productName, getProductItems, productItemName, createProductItem, setProductStock, queryProductStock, listPriceLists, getProductPrices, setProductPrices, type PriceWrite, type ProductItemWrite, type ProductItemIdType, type ProductItemStockWrite, getVariantGroup, variantSummary, buildVariantGroupFromProducts, parseVariantCreateFlags, parseVariantGroupBody, listVariantLabels, addVariantLabel, renameVariantLabel, removeVariantLabel, setProductVariants, deleteVariantGroup, getProductImages, addProductImage, addExistingProductImage, deleteProductImage, setProductImagePrimary, reorderProductImage, imageNameFromUrl, listRelationTypes, getRelationType, createRelationType, updateRelationType, deleteRelationType, queryBrands, getBrand, createBrand, updateBrand, deleteBrand, brandName, type BrandWrite, setProductText, parseProductTextField, PRODUCT_TEXT_FIELD_TOKENS, type ProductTextField, queryCategories, getCategory, createCategory, updateCategory, assignProductCategory, setMainCategory, unassignProductCategory, categoryName, type CategoryWrite, getProductRelations, linkRelatedProducts, unlinkRelatedProducts, getProductParameters, getProductParameterValue, setProductParameterValue, removeProductParameterValue, getProductParameterDef, createProductParameter, updateProductParameter, getProductParameterGroup, createProductParameterGroup, updateProductParameterGroup, getPredefinedValue, createPredefinedValue, updatePredefinedValueNames, parameterValueSummary, updateProductParameterValues, replaceProductParameterValues, removeProductParameterAssignments, type ProductParameterValueWrite, type ProductParameterAssignment, type LocalizableContent, type ProductIdType } from './commands/products.ts';
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
import {
  listCampaigns,
  getCampaignTypes,
  getCampaign,
  createCampaign,
  buildPromoCodeCampaign,
  campaignLabel,
  type CampaignWrite,
} from './commands/campaigns.ts';
import { listMarkets, listLanguages, listChannels, listLocales, marketName, listUserAccounts } from './commands/account.ts';
import {
  resolveMerchantContext,
  searchProducts,
  getProduct as getMerchantProduct,
  listCategories as listMerchantCategories,
  listBrands as listMerchantBrands,
  createCart,
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  setCartPromoCode,
  buildCheckoutToken,
  parseCheckoutToken,
  productLine,
  cartLines,
  type ContextOverrides,
  type CheckoutTokenOptions,
  type CheckoutRedirects,
  type CheckoutBranding,
  type CustomerType,
} from './commands/merchant.ts';
import { applyMemoryAccount, recordInteraction } from './memory/index.ts';
import { memoryAdd, memoryList, memoryClear, exportMemory } from './commands/memory.ts';
import { listSessions, loadSessionEntries, formatTranscriptLines, transcriptJson, firstUserMessage } from './commands/sessions.ts';
import { chat, getCopilotConfig, clearConversationHistory, getMemoryEnabled, setMemoryEnabled } from './commands/copilot.ts';
import { outputJson } from './output/format.ts';
import { setBaseTitle } from './output/title.ts';
import { PRODUCT_HELP, VARIANTS_HELP, ORDER_HELP, CAMPAIGN_HELP, ACCOUNT_HELP, MERCHANT_HELP, MEMORY_HELP, APIKEY_HELP } from './commands/help-text.ts';
import { VERSION } from './version.ts';

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

  // Set the terminal window/tab title (held while the TUI runs). The app refines this
  // to include the session id once the session starts.
  setBaseTitle('Synapse');

  // Clear the screen (and scrollback) so the TUI starts on a clean canvas.
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

  const app = render(React.createElement(App, { version: VERSION, resume }), {
    exitOnCtrlC: false,
  });

  // Clean rebuild on terminal WIDTH change. Committed history is rendered via Ink's <Static>, whose
  // lines are already printed to scrollback and don't reflow cleanly at a new width (ghost borders,
  // duplicated headers). ChatHistory keys <Static> on the column count, so a width change remounts it
  // and RE-EMITS every item at the new width. To stop the stale old-width copies from piling up in
  // scrollback, we wipe the screen AND scrollback (`3J`) here first; Static then rewrites the full
  // history at the new width, so nothing is actually lost. `prependListener` runs this BEFORE Ink's
  // resize handler. Width-only: a pure height change doesn't reflow, so we leave scrollback intact.
  const stdout = process.stdout;
  let lastColumns = stdout.columns;
  stdout.prependListener('resize', () => {
    if (stdout.columns !== lastColumns) {
      stdout.write('\x1b[2J\x1b[3J\x1b[H');
    }
    lastColumns = stdout.columns;
  });

  await app.waitUntilExit();
}

async function runDirect(rawArgs: string[]): Promise<void> {
  // Global flags stripped before command parsing so they can appear anywhere:
  //   --account/--profile/--apikey <name>  selects the live-API apikey profile (product/order/…)
  //   --account-name <name>                selects the v2 account (workflow/account/…) by name
  //   --out <dir>                          dumps responses + a request log to <dir>
  let accountOverride = process.env['GEINS_ACCOUNT'];
  let accountNameOverride = process.env['GEINS_ACCOUNT_NAME'];
  let outOverride: string | undefined;
  const args: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--account-name' && rawArgs[i + 1]) {
      accountNameOverride = rawArgs[i + 1];
      i++;
      continue;
    }
    if ((rawArgs[i] === '--account' || rawArgs[i] === '--profile' || rawArgs[i] === '--apikey') && rawArgs[i + 1]) {
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

  // Resolve the v2 account name to its account key (the x-account-key value). A 32-char hex
  // value is treated as a key directly; anything else is matched against the user's accounts
  // by friendly name (case-insensitive) via one /user/me lookup.
  if (accountNameOverride) {
    const wanted = accountNameOverride;
    if (/^[0-9a-f]{32}$/i.test(wanted)) {
      setAccountKeyOverride(wanted);
    } else {
      const accounts = await listUserAccounts();
      const match = accounts.find(a => a.name.toLowerCase() === wanted.toLowerCase());
      if (!match) {
        console.error(`Unknown account: '${wanted}'. Run 'geins account list' to see available accounts.`);
        process.exit(1);
      }
      setAccountKeyOverride(match.accountKey);
    }
  }

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
    console.log('  campaign   Campaign commands (list, get, types, create — incl. promocode) — uses Management API');
    console.log('  merchant   Storefront commands (product search, cart, checkout token) — uses Merchant API (GraphQL)');
    console.log('  api       Raw API request');
    console.log('  output    Set/show the folder where responses + logs are dumped');
    console.log('  ask       Ask the copilot a question (-c/--continue to keep the prior conversation)');
    console.log('  resume    Print a past session transcript (no id → list sessions)\n');
    console.log('Global flags:');
    console.log('  --account <name>      Live-API apikey profile, e.g. prod-labs (alias --profile/--apikey; or GEINS_ACCOUNT)');
    console.log('  --account-name <name> v2 account by friendly name, e.g. labs (or GEINS_ACCOUNT_NAME) — sets x-account-key');
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
    // `product variants … --help` gets the focused variants guide, not the whole product help.
    if (commandName === 'product') console.log(commandArgs[0]?.toLowerCase() === 'variants' ? VARIANTS_HELP : PRODUCT_HELP);
    else if (commandName === 'order') console.log(ORDER_HELP);
    else if (commandName === 'campaign') console.log(CAMPAIGN_HELP);
    else if (commandName === 'account') console.log(ACCOUNT_HELP);
    else if (commandName === 'merchant') console.log(MERCHANT_HELP);
    else if (commandName === 'memory') console.log(MEMORY_HELP);
    else if (commandName === 'apikey') console.log(APIKEY_HELP);
    else console.log(`${commandName} — CLI command`);
    return;
  }

  try {
    switch (commandName) {
      case 'serve': {
        const { serveCommand } = await import('./server/serve.ts');
        await serveCommand(commandArgs);
        return;
      }
      case 'update': {
        const { updateCommand } = await import('./commands/update.ts');
        await updateCommand(commandArgs);
        return;
      }
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
        const credStore = await loadCredentialsStore();
        if (credStore.active) console.log(`API key: ${credStore.active}`);
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
        await recordInteraction(prompt, response);
        if (jsonMode) outputJson({ response });
        else console.log(response);
        break;
      }
      case 'memory': {
        const sub = commandArgs[0]?.toLowerCase() ?? 'list';
        const subArgs = commandArgs.slice(1);
        const jsonMode = commandArgs.includes('--json');
        switch (sub) {
          case 'add': {
            const positional = subArgs.filter(a => !a.startsWith('-'));
            const [category, ...rest] = positional;
            if (!category) {
              console.error('Usage: geins memory add <project|workflow|api|preference|pattern> "<fact>"');
              process.exit(1);
            }
            await memoryAdd(category, rest.join(' '));
            break;
          }
          case 'list':
          case 'show':
            await memoryList(jsonMode);
            break;
          case 'export': {
            const file = await exportMemory(jsonMode ? 'json' : 'md');
            console.log(`✓ Exported memory to ${file}`);
            break;
          }
          case 'clear':
            await memoryClear();
            break;
          case 'on':
            await setMemoryEnabled(true);
            console.log('✓ Copilot memory enabled — facts are recalled into the prompt and persisted.');
            break;
          case 'off':
            await setMemoryEnabled(false);
            console.log('✓ Copilot memory disabled — nothing is recalled or persisted (stored memory is kept).');
            break;
          case 'status':
            console.log(`Copilot memory is ${(await getMemoryEnabled()) ? 'on' : 'off'}.`);
            break;
          default:
            console.error(`Unknown subcommand: memory ${sub}. Use: add | list | export | clear | on | off | status`);
            process.exit(1);
        }
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
          case 'help': {
            console.log(APIKEY_HELP);
            break;
          }
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
            console.error('Subcommands: set, list, use <name>, remove <name>, clear, help');
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
          case 'create': {
            const flagVal = (flag: string) => { const i = subArgs.indexOf(flag); return i !== -1 ? subArgs[i + 1] : undefined; };
            const numFlag = (flag: string) => { const v = flagVal(flag); const n = v != null ? Number(v) : NaN; return Number.isNaN(n) ? undefined : n; };
            const collect = (flag: string) => subArgs.flatMap((a, i) => (subArgs[i - 1] === flag ? [a] : []));
            // VatId must be a whole positive id; anything else (undefined, 0, a rate like 0.25) is dropped.
            const vatIdFlag = (v: number | undefined) => (v !== undefined && Number.isInteger(v) && v > 0 ? v : undefined);
            const parseLoc = (flag: string): LocalizableContent[] | undefined => {
              const parts = collect(flag);
              if (parts.length === 0) return undefined;
              return parts.map((p) => { const c = p.indexOf(':'); return { LanguageCode: c === -1 ? p : p.slice(0, c), Content: c === -1 ? '' : p.slice(c + 1) }; });
            };

            // Full JSON body via --file/--body/stdin, otherwise build from convenience flags.
            const hasBody = subArgs.includes('--file') || subArgs.includes('--body');
            const hasFlags = subArgs.includes('--article') || subArgs.includes('--name');
            let input: ProductWrite;
            if (hasBody || (!hasFlags && !process.stdin.isTTY)) {
              input = (await resolveBody(subArgs)) as ProductWrite;
            } else if (hasFlags) {
              const names = parseLoc('--name');
              input = {
                ArticleNumber: flagVal('--article'),
                Names: names,
                Active: subArgs.includes('--active') ? true : subArgs.includes('--inactive') ? false : undefined,
                BrandId: numFlag('--brand'),
                SupplierId: numFlag('--supplier'),
                PurchasePrice: numFlag('--price'),
                PurchasePriceCurrency: flagVal('--currency'),
                CategoryIds: collect('--category').map(Number).filter((n) => !Number.isNaN(n)),
                ExternalId: flagVal('--external-id'),
                // VAT is written by id (1 = 25%), not by rate; the read model's numeric `Vat`
                // rate is NOT writable (a decimal there makes the API fail to parse the body).
                // Accept --vat-id (preferred) or legacy --vat, and only send a whole positive id
                // so a stray rate like 0.25 is ignored rather than triggering a cryptic 400.
                VatId: vatIdFlag(numFlag('--vat-id') ?? numFlag('--vat')),
              };
              if (!input.CategoryIds?.length) delete input.CategoryIds;
              if (input.VatId === undefined) delete input.VatId;
            } else {
              console.error("Usage: geins product create --article <s> --name <code>:<text> [--active] [--brand <id>] [--supplier <id>] [--price <n>] [--currency <c>] [--category <id>]... [--vat-id <id>] [--external-id <s>]\n       geins product create [--file <path> | --body '<json>' | stdin]");
              process.exit(1);
            }

            const product = await createProduct(input);
            if (jsonMode) { console.log(JSON.stringify(product, null, 2)); break; }
            console.log(`✓ Created product ${productName(product)}  (${product.ProductId})`);
            if (product.ArticleNumber) console.log(`  Article: ${product.ArticleNumber}`);
            console.log(`  Active: ${product.Active ? 'yes' : 'no'}`);
            break;
          }
          case 'update': {
            const id = subArgs[0];
            if (!id) {
              console.error("Usage: geins product update <id> [--idtype <0-3>] [--file <path> | --body '<json>' | stdin]");
              process.exit(1);
            }
            let idType: ProductIdType | undefined;
            const itIdx = subArgs.indexOf('--idtype');
            if (itIdx !== -1 && subArgs[itIdx + 1] != null) {
              const n = Number(subArgs[itIdx + 1]);
              if (n >= 0 && n <= 3) idType = n as ProductIdType;
            }
            const changes = (await resolveBody(subArgs.slice(1))) as ProductWrite;
            const product = await updateProduct(id, changes, { idType });
            if (jsonMode) { console.log(JSON.stringify(product, null, 2)); break; }
            console.log(`✓ Updated product ${productName(product)}  (${product.ProductId})`);
            break;
          }
          case 'delete':
          case 'remove': {
            const id = subArgs[0];
            if (!id) {
              console.error('Usage: geins product delete <id> [--idtype <0-3>]   (--idtype 1 = delete by article number)');
              process.exit(1);
            }
            let idType: ProductIdType | undefined;
            const itIdx = subArgs.indexOf('--idtype');
            if (itIdx !== -1 && subArgs[itIdx + 1] != null) {
              const n = Number(subArgs[itIdx + 1]);
              if (n >= 0 && n <= 3) idType = n as ProductIdType;
            }
            await deleteProduct(id, { idType });
            if (jsonMode) { console.log(JSON.stringify({ deleted: id }, null, 2)); break; }
            console.log(`✓ Deleted product ${id}`);
            break;
          }
          case 'items': {
            const flagVal = (flag: string) => { const i = subArgs.indexOf(flag); return i !== -1 ? subArgs[i + 1] : undefined; };
            const numFlag = (flag: string) => { const v = flagVal(flag); const n = v != null ? Number(v) : NaN; return Number.isNaN(n) ? undefined : n; };
            const readIdType = (args: string[]): ProductIdType | undefined => {
              const i = args.indexOf('--idtype');
              if (i !== -1 && args[i + 1] != null) { const n = Number(args[i + 1]); if (n >= 0 && n <= 3) return n as ProductIdType; }
              return undefined;
            };

            // items create <productId> [--article s] [--name s] [--gtin s] [--inactive] [--weight g] [--external-id s] [--body json|stdin]
            if (subArgs[0]?.toLowerCase() === 'create') {
              const rest = subArgs.slice(1);
              const productId = rest.find((a, i) => !a.startsWith('--') && rest[i - 1] !== '--article' && rest[i - 1] !== '--name' && rest[i - 1] !== '--gtin' && rest[i - 1] !== '--weight' && rest[i - 1] !== '--external-id' && rest[i - 1] !== '--idtype' && rest[i - 1] !== '--body' && rest[i - 1] !== '--file');
              if (!productId) {
                console.error("Usage: geins product items create <productId> [--article <s>] [--name <s>] [--gtin <ean>] [--weight <g>] [--external-id <s>] [--inactive] [--idtype <0-3>]\n       geins product items create <productId> [--file <path> | --body '<json>' | stdin]");
                process.exit(1);
              }
              const hasBody = rest.includes('--file') || rest.includes('--body') || !process.stdin.isTTY;
              let body: ProductItemWrite;
              if (rest.includes('--article') || rest.includes('--name') || rest.includes('--gtin') || rest.includes('--weight') || rest.includes('--external-id') || rest.includes('--inactive') || rest.includes('--active')) {
                body = {
                  ArticleNumber: flagVal('--article'),
                  Name: flagVal('--name'),
                  Gtin: flagVal('--gtin'),
                  Weight: numFlag('--weight'),
                  ExternalId: flagVal('--external-id'),
                  Active: rest.includes('--inactive') ? false : rest.includes('--active') ? true : undefined,
                };
              } else if (hasBody) {
                body = (await resolveBody(rest)) as ProductItemWrite;
              } else {
                body = {};
              }
              const item = await createProductItem(productId, body, { idType: readIdType(rest) });
              if (jsonMode) { console.log(JSON.stringify(item, null, 2)); break; }
              console.log(`✓ Created item ${productItemName(item)}  (${item.ItemId}) on product ${productId}`);
              console.log('  Set its stock with: geins product stock set ' + item.ItemId + ' <count>');
              break;
            }

            const id = subArgs[0];
            if (!id) {
              console.error('Usage: geins product items <productId> [--idtype <0-3>] [--json]\n       geins product items create <productId> [flags]');
              process.exit(1);
            }
            const idType = readIdType(subArgs);
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
          case 'stock': {
            // stock get <itemId...>            — read stock (internal item ids)
            // stock set <itemId> <count> [--type 0|1|2] [--idtype 0-4]   — set stock on an item
            const action = subArgs[0]?.toLowerCase();
            if (action === 'set') {
              const itemId = subArgs[1];
              const count = Number(subArgs[2]);
              if (!itemId || Number.isNaN(count)) {
                console.error('Usage: geins product stock set <itemId> <count> [--type <0-2>] [--idtype <0-4>]\n  --type: 0 Available (default), 1 Oversellable, 2 Static   --idtype: 0 internal id (default), 1 article, 4 external');
                process.exit(1);
              }
              const ti = subArgs.indexOf('--type');
              const stockType = ti !== -1 && subArgs[ti + 1] != null ? Number(subArgs[ti + 1]) : 0;
              const ii = subArgs.indexOf('--idtype');
              const idType = ii !== -1 && subArgs[ii + 1] != null ? Number(subArgs[ii + 1]) : 0;
              const write: ProductItemStockWrite = { Id: String(itemId), Stock: count, StockType: (stockType as 0 | 1 | 2) };
              const result = await setProductStock([write], { idType: idType as ProductItemIdType });
              if (jsonMode) { console.log(JSON.stringify(result, null, 2)); break; }
              const typeName = stockType === 1 ? 'oversellable' : stockType === 2 ? 'static' : 'available';
              console.log(`✓ Set ${typeName} stock = ${count} on item ${itemId}`);
              break;
            }
            if (action === 'get') {
              const ids = subArgs.slice(1).map(Number).filter((n) => !Number.isNaN(n));
              if (ids.length === 0) { console.error('Usage: geins product stock get <itemId> [<itemId>...]   (internal item ids)'); process.exit(1); }
              const stocks = await queryProductStock(ids);
              if (jsonMode) { console.log(JSON.stringify(stocks, null, 2)); break; }
              if (stocks.length === 0) { console.log('No stock records.'); break; }
              for (const s of stocks) {
                console.log(`item ${s.ItemId}  total ${s.Stock ?? 0}  sellable ${s.StockSellable ?? 0}  oversellable ${s.StockOversellable ?? 0}  static ${s.StockStatic ?? 0}`);
              }
              break;
            }
            console.error('Usage: geins product stock <get|set> ...   (run "geins product help")');
            process.exit(1);
            break;
          }
          case 'price':
          case 'prices': {
            // price lists                          — show the account's price lists (ids, market, currency)
            // price get <productId> [--idtype N]   — read a product's resolved prices
            // price set <productId> <price> --pricelist <id> [--currency X] [--staggered N]  — set a price
            const action = subArgs[0]?.toLowerCase();
            if (action === 'lists' || action === 'list') {
              const lists = await listPriceLists();
              if (jsonMode) { console.log(JSON.stringify(lists, null, 2)); break; }
              if (lists.length === 0) { console.log('No price lists.'); break; }
              for (const l of lists) {
                const market = l.MarketId != null ? `  market ${l.MarketId}${l.MarketPrefix ? ` (${l.MarketPrefix})` : ''}` : '';
                const flags = [l.Forced ? 'forced' : '', l.Active === false ? 'inactive' : ''].filter(Boolean).join(', ');
                console.log(`${l.Id}  ${l.Name ?? l.Identifier ?? ''}  ${l.Currency ?? ''}${market}${flags ? `  [${flags}]` : ''}`);
              }
              break;
            }
            if (action === 'get') {
              const productId = subArgs[1];
              if (!productId) { console.error('Usage: geins product price get <productId> [--idtype <0-4>]'); process.exit(1); }
              const ii = subArgs.indexOf('--idtype');
              const idType = ii !== -1 && subArgs[ii + 1] != null ? Number(subArgs[ii + 1]) : 0;
              const prices = await getProductPrices(productId, { idType: idType as ProductIdType });
              if (jsonMode) { console.log(JSON.stringify(prices, null, 2)); break; }
              if (prices.length === 0) { console.log('No prices for this product.'); break; }
              for (const p of prices) {
                const list = p.PriceListName ?? (p.PriceListId != null ? `list ${p.PriceListId}` : '');
                const staggered = p.StaggeredCount ? `  qty≥${p.StaggeredCount}` : '';
                console.log(`${list}  ${p.PriceIncVat ?? '?'} inc / ${p.PriceExVat ?? '?'} ex  ${p.Currency ?? ''}  (VAT ${p.VatRate ?? '?'})${staggered}`);
              }
              break;
            }
            if (action === 'set') {
              const productId = subArgs[1];
              const price = Number(subArgs[2]);
              const li = subArgs.indexOf('--pricelist');
              const priceListId = li !== -1 && subArgs[li + 1] != null ? Number(subArgs[li + 1]) : NaN;
              if (!productId || Number.isNaN(price) || Number.isNaN(priceListId)) {
                console.error('Usage: geins product price set <productId> <price> --pricelist <id> [--currency <code>] [--staggered <qty>]\n  Run "geins product price lists" to find the price-list id.');
                process.exit(1);
              }
              const ci = subArgs.indexOf('--currency');
              const currency = ci !== -1 ? subArgs[ci + 1] : undefined;
              const si = subArgs.indexOf('--staggered');
              const staggered = si !== -1 && subArgs[si + 1] != null ? Number(subArgs[si + 1]) : undefined;
              const write: PriceWrite = { PriceListId: priceListId, ProductId: String(productId), Price: price, Currency: currency, StaggeredCount: staggered };
              const result = await setProductPrices([write]);
              if (jsonMode) { console.log(JSON.stringify(result, null, 2)); break; }
              const updated = result.UpdateCount ?? 0;
              const invalid = result.Invalid?.length ?? 0;
              const notFound = result.NotFound?.length ?? 0;
              if (updated > 0 && invalid === 0 && notFound === 0) {
                console.log(`✓ Set price ${price}${currency ? ` ${currency}` : ''} on product ${productId} (list ${priceListId})`);
              } else {
                console.log(`Updated ${updated}${invalid ? `, ${invalid} invalid` : ''}${notFound ? `, ${notFound} not found` : ''}${result.Message ? ` — ${result.Message}` : ''}`);
              }
              break;
            }
            console.error('Usage: geins product price <lists|get|set> ...   (run "geins product help")');
            process.exit(1);
            break;
          }
          case 'variants': {
            const action = subArgs[0]?.toLowerCase();

            // Help: `variants help`, `variants --help/-h`, or `variants <action> --help` all print
            // the focused, copy-paste-ready variants guide (leads with the single-line flag form).
            if (action === 'help' || subArgs.some((a) => a === '--help' || a === '-h')) {
              console.log(VARIANTS_HELP);
              break;
            }

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
              // Bare `variants` — show the full guide rather than a terse one-liner.
              console.log(VARIANTS_HELP);
              break;
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
              if (!names) { console.error('Usage: geins product categories create --name <code>:<text> [--name ...] [--parent <id>] [--desc <code>:<text>] [--hidden] [--active|--inactive]'); process.exit(1); }
              const input: CategoryWrite = {
                Names: names,
                ParentCategoryId: numFlag('--parent'),
                Descriptions: parseLoc('--desc'),
                Hidden: subArgs.includes('--hidden') ? true : undefined,
                // The API defaults a new category to INACTIVE when Active is omitted, which makes it
                // unusable (product assignments read back empty). Default to active unless --inactive.
                Active: subArgs.includes('--inactive') ? false : true,
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
            const { query, page, include, json, all } = parseProductListArgs(subArgs);
            // --all pages through the whole catalog (auto-carrying BatchId); otherwise one page.
            const result = all
              ? await queryAllProducts(query, { include })
              : await queryProducts(query, { page: page ?? 1, include });
            if (json) {
              console.log(JSON.stringify(result, null, 2));
              break;
            }
            for (const p of result.products) {
              const status = p.Active ? '●' : '○';
              console.log(`${status} ${productName(p)}  (${p.ProductId})  ${p.ArticleNumber ?? ''}`.trimEnd());
            }
            const pr = result.page;
            if (all) {
              console.log(`\n${result.products.length} products (all ${pr?.PageCount ?? 1} pages)`);
            } else if (pr) {
              console.log(`\n${result.products.length} shown · ${pr.RowCount ?? '?'} total · page ${pr.Page ?? 1}/${pr.PageCount ?? 1}`);
              if (pr.HasMoreRows) {
                console.log(`Next page: geins product list --page ${(pr.Page ?? 1) + 1} --batch ${pr.BatchId}   (or --all for the whole catalog)`);
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
            // Both Query endpoints 500 ("A database error occured.") without a StatusList or
            // CustomerId predicate, so queryOrders defaults StatusList to all queryable statuses.
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
      case 'campaign': {
        const sub = commandArgs[0]?.toLowerCase() ?? 'list';
        const subArgs = commandArgs.slice(1);
        const jsonMode = commandArgs.includes('--json');

        switch (sub) {
          case 'list': {
            const campaigns = await listCampaigns();
            if (jsonMode) { console.log(JSON.stringify(campaigns, null, 2)); break; }
            if (campaigns.length === 0) { console.log('No campaigns.'); break; }
            for (const c of campaigns) {
              const code = c.PromoCode ? `[${c.PromoCode}] ` : '';
              const bits = [c.Type, c.CampaignBaseType, c.Status].filter(Boolean).join(' · ');
              console.log(`${code}${c.Title ?? '(untitled)'}${bits ? `  — ${bits}` : ''}`);
            }
            break;
          }
          case 'types': {
            const types = await getCampaignTypes();
            if (jsonMode) { console.log(JSON.stringify(types, null, 2)); break; }
            if (types.length === 0) { console.log('No campaign types.'); break; }
            for (const t of types) console.log(`  ${t.Id}\t${t.Name}`);
            break;
          }
          case 'get': {
            const id = subArgs[0];
            if (!id) { console.error('Usage: geins campaign get <id> [--json]'); process.exit(1); }
            const c = await getCampaign(id);
            if (jsonMode) { console.log(JSON.stringify(c, null, 2)); break; }
            console.log(`${campaignLabel(c)}  (${c.CampaignId})`);
            const bits = [c.Status, `base=${c.CampaignBaseType}`, `type=${c.CampaignTypeId}`].filter(Boolean).join(' · ');
            console.log(`  ${bits}`);
            if (c.PromoCode) console.log(`  Code: ${c.PromoCode}`);
            if (c.PercentageValue != null) console.log(`  Discount: ${c.PercentageValue}%`);
            if (c.Amounts && Object.keys(c.Amounts).length) {
              console.log(`  Amounts: ${Object.entries(c.Amounts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
            }
            if (c.MarketId) console.log(`  Market: ${c.MarketId}`);
            console.log(`  Valid: ${c.ValidFrom ?? '—'} → ${c.ValidTo ?? '—'}`);
            console.log(`  Enabled: ${c.Enabled ? 'yes' : 'no'}`);
            break;
          }
          case 'create': {
            const flagVal = (flag: string) => { const i = subArgs.indexOf(flag); return i !== -1 ? subArgs[i + 1] : undefined; };
            const numFlag = (flag: string) => { const v = flagVal(flag); const n = v != null ? Number(v) : NaN; return Number.isNaN(n) ? undefined : n; };
            const collect = (flag: string) => subArgs.flatMap((a, i) => (subArgs[i - 1] === flag ? [a] : []));

            const hasBody = subArgs.includes('--file') || subArgs.includes('--body');
            const hasFlags = subArgs.includes('--promocode');
            let body: CampaignWrite;
            if (hasBody || (!hasFlags && !process.stdin.isTTY)) {
              body = (await resolveBody(subArgs)) as CampaignWrite;
            } else if (hasFlags) {
              const promoCode = flagVal('--promocode');
              const marketId = flagVal('--market');
              if (!promoCode || !marketId) {
                console.error('Usage: geins campaign create --promocode <CODE> --market <id> (--percentage <n> | --amount <CUR>:<n>) [--title <t> --lang <code>] [--from <iso>] [--to <iso>] [--usage-limit <n>] [--once-per-customer] [--priority <n>] [--enabled|--disabled]');
                process.exit(1);
              }
              const amounts: Record<string, number> = {};
              for (const pair of collect('--amount')) {
                const c = pair.indexOf(':');
                const cur = c === -1 ? pair : pair.slice(0, c);
                const val = c === -1 ? NaN : Number(pair.slice(c + 1));
                if (cur && !Number.isNaN(val)) amounts[cur.toUpperCase()] = val;
              }
              const titleText = flagVal('--title');
              body = buildPromoCodeCampaign({
                promoCode,
                marketId,
                percentage: numFlag('--percentage'),
                amounts: Object.keys(amounts).length ? amounts : undefined,
                title: titleText ? [{ Language: flagVal('--lang') ?? 'en', Value: titleText }] : undefined,
                validFrom: flagVal('--from'),
                validTo: flagVal('--to'),
                usageLimit: numFlag('--usage-limit'),
                oncePerCustomer: subArgs.includes('--once-per-customer') ? true : undefined,
                priority: numFlag('--priority'),
                enabled: subArgs.includes('--disabled') ? false : subArgs.includes('--enabled') ? true : undefined,
                onlyDiscountedProducts: subArgs.includes('--only-discounted') ? true : undefined,
              });
            } else {
              console.error("Usage: geins campaign create --promocode <CODE> --market <id> (--percentage <n> | --amount <CUR>:<n>) [--title <t> --lang <code>] [--from <iso>] [--to <iso>] [--usage-limit <n>] [--once-per-customer] [--priority <n>] [--enabled|--disabled]\n       geins campaign create [--file <path> | --body '<json>' | stdin]");
              process.exit(1);
            }

            const campaign = await createCampaign(body);
            if (jsonMode) { console.log(JSON.stringify(campaign, null, 2)); break; }
            console.log(`✓ Created campaign ${campaignLabel(campaign)}  (${campaign.CampaignId})`);
            if (campaign.PromoCode) console.log(`  Code: ${campaign.PromoCode}`);
            console.log(`  Enabled: ${campaign.Enabled ? 'yes' : 'no'}`);
            break;
          }
          case 'help':
            console.log(CAMPAIGN_HELP);
            break;
          default:
            console.error(`Unknown subcommand: campaign ${sub}\n`);
            console.error(CAMPAIGN_HELP);
            process.exit(1);
        }
        break;
      }
      case 'merchant': {
        const sub = commandArgs[0]?.toLowerCase() ?? '';
        const subArgs = commandArgs.slice(1);
        const jsonMode = commandArgs.includes('--json');

        function flag(name: string): string | undefined {
          const idx = commandArgs.indexOf(name);
          return idx !== -1 ? commandArgs[idx + 1] : undefined;
        }
        // JSON from an inline string or @file path (for --branding / --user).
        function jsonFlag(name: string): unknown {
          const v = flag(name);
          if (v === undefined) return undefined;
          const raw = v.startsWith('@') ? readFileSync(v.slice(1), 'utf-8') : v;
          return JSON.parse(raw);
        }
        function intList(name: string): number[] | undefined {
          const v = flag(name);
          if (!v) return undefined;
          return v.split(',').map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n));
        }
        function redirectsFromFlags(): CheckoutRedirects | undefined {
          const r: CheckoutRedirects = {};
          if (flag('--terms')) r.terms = flag('--terms');
          if (flag('--privacy')) r.privacy = flag('--privacy');
          if (flag('--success')) r.success = flag('--success');
          if (flag('--cancel')) r.cancel = flag('--cancel');
          if (flag('--continue')) r.continue = flag('--continue');
          return Object.keys(r).length ? r : undefined;
        }
        function customerTypeFromFlag(): CustomerType | undefined {
          const c = flag('--customer-type')?.toLowerCase();
          return c === 'organization' ? 'ORGANIZATION' : c === 'person' ? 'PERSON' : undefined;
        }
        const overrides: ContextOverrides = {
          channel: flag('--channel'),
          tld: flag('--tld'),
          market: flag('--market'),
          locale: flag('--locale'),
          // NB: --account-name is a reserved global flag (v2 account), so the storefront
          // account slug uses --store-account here.
          accountName: flag('--store-account'),
          environment: flag('--environment') as ContextOverrides['environment'],
        };

        // `config` manages stored context and needs no live call; everything else resolves context.
        if (sub === 'config') {
          if (subArgs[0]?.toLowerCase() === 'set') {
            const ctxPatch = Object.fromEntries(
              Object.entries(overrides).filter(([, v]) => v !== undefined),
            );
            // Persisted checkout defaults (merged onto the existing ones).
            const cur = await loadCredentials();
            const urls = redirectsFromFlags();
            const branding = jsonFlag('--branding') as CheckoutBranding | undefined;
            const dp = flag('--default-payment');
            const ds = flag('--default-shipping');
            const ct = customerTypeFromFlag();
            const hasCheckout = !!(urls || branding || dp || ds || ct);
            let checkout: StoredCheckoutDefaults | undefined;
            if (hasCheckout) {
              checkout = { ...(cur?.checkout ?? {}) };
              if (urls) checkout.redirectUrls = { ...cur?.checkout?.redirectUrls, ...urls };
              if (branding) checkout.branding = branding as StoredCheckoutDefaults['branding'];
              if (dp) checkout.defaultPaymentId = Number(dp);
              if (ds) checkout.defaultShippingId = Number(ds);
              if (ct) checkout.customerType = ct;
            }
            const patch = { ...ctxPatch, ...(hasCheckout ? { checkout } : {}) };
            if (Object.keys(patch).length === 0) {
              console.error('Usage: geins merchant config set [--channel <c>] [--tld <t>] [--market <m>] [--locale <l>] [--store-account <slug>] [--environment prod|qa|dev]');
              console.error('  checkout defaults: [--success <url>] [--cancel <url>] [--continue <url>] [--terms <url>] [--privacy <url>] [--default-payment <id>] [--default-shipping <id>] [--customer-type person|organization] [--branding <json|@file>]');
              process.exit(1);
            }
            const name = await updateActiveCredentials(patch);
            if (!name) {
              console.error('No active api-key profile. Run geins apikey set to add one.');
              process.exit(1);
            }
            console.log(`✓ Merchant context saved on profile '${name}'.`);
          }
          const ctx = await resolveMerchantContext(overrides);
          if (jsonMode) {
            outputJson(ctx);
          } else {
            console.log(`account-name: ${ctx.accountName ?? '(unset)'}`);
            console.log(`channel:      ${ctx.channel ?? '(unset)'}`);
            console.log(`tld:          ${ctx.tld ?? '(unset)'}`);
            console.log(`market:       ${ctx.market ?? '(unset)'}`);
            console.log(`locale:       ${ctx.locale ?? '(unset)'}`);
            console.log(`environment:  ${ctx.environment}`);
            console.log(`channelId:    ${ctx.channel && ctx.tld ? `${ctx.channel}|${ctx.tld}` : '(unset)'}`);
            const cd = ctx.checkoutDefaults;
            if (cd && Object.keys(cd).length > 0) {
              console.log('checkout defaults:');
              if (cd.defaultPaymentId != null) console.log(`  payment:   ${cd.defaultPaymentId}`);
              if (cd.defaultShippingId != null) console.log(`  shipping:  ${cd.defaultShippingId}`);
              if (cd.customerType) console.log(`  customer:  ${cd.customerType}`);
              for (const [k, v] of Object.entries(cd.redirectUrls ?? {})) console.log(`  ${k}: ${v}`);
              if (cd.branding) console.log(`  branding:  ${JSON.stringify(cd.branding)}`);
            }
          }
          break;
        }

        if (sub === 'help' || sub === '') {
          console.log(MERCHANT_HELP);
          break;
        }

        // `token parse` is pure offline decoding — no credentials/context needed.
        if (sub === 'token' && subArgs[0]?.toLowerCase() === 'parse') {
          const token = subArgs[1];
          if (!token) { console.error('Usage: geins merchant token parse <token>'); process.exit(1); }
          outputJson(parseCheckoutToken(token));
          break;
        }

        const ctx = await resolveMerchantContext(overrides);

        switch (sub) {
          case 'product': {
            if (subArgs[0]?.toLowerCase() === 'search') {
              const positional = subArgs.slice(1).filter((a) => !a.startsWith('--'));
              const searchText = positional[0];
              const result = await searchProducts(
                {
                  searchText,
                  categoryAlias: flag('--category'),
                  brandAlias: flag('--brand'),
                  take: flag('--take') ? Number(flag('--take')) : undefined,
                  skip: flag('--skip') ? Number(flag('--skip')) : undefined,
                },
                ctx,
              );
              if (jsonMode) {
                outputJson(result);
              } else {
                for (const p of result.products ?? []) console.log(productLine(p));
                if (result.count !== undefined) console.log(`\n${result.count} products`);
              }
            } else {
              const idOrTerm = subArgs[0];
              if (!idOrTerm) {
                console.error('Usage: geins merchant product <productId|term> | geins merchant product search [text]');
                process.exit(1);
              }
              const product = await getMerchantProduct(idOrTerm, ctx);
              if (!product) {
                console.error('No product found.');
                process.exit(2);
              }
              outputJson(product);
            }
            break;
          }
          case 'categories':
          case 'category': {
            const cats = await listMerchantCategories();
            if (jsonMode) {
              outputJson(cats);
            } else {
              for (const c of cats) console.log(`${c.categoryId}  ${c.name ?? ''}${c.alias ? `  (${c.alias})` : ''}`);
              console.log(`\n${cats.length} categories`);
            }
            break;
          }
          case 'brands':
          case 'brand': {
            const brands = await listMerchantBrands();
            if (jsonMode) {
              outputJson(brands);
            } else {
              for (const b of brands) console.log(`${b.brandId}  ${b.name ?? ''}${b.alias ? `  (${b.alias})` : ''}`);
              console.log(`\n${brands.length} brands`);
            }
            break;
          }
          case 'cart': {
            const action = subArgs[0]?.toLowerCase() ?? '';
            switch (action) {
              case 'create': {
                const cart = await createCart(ctx);
                if (jsonMode) outputJson(cart);
                else console.log(cart.id);
                break;
              }
              case 'get': {
                const id = subArgs[1];
                if (!id) { console.error('Usage: geins merchant cart get <id>'); process.exit(1); }
                const cart = await getCart(id, ctx);
                if (jsonMode) outputJson(cart);
                else for (const line of cartLines(cart)) console.log(line);
                break;
              }
              case 'add': {
                const id = subArgs[1];
                const sku = flag('--sku');
                if (!id || !sku) { console.error('Usage: geins merchant cart add <id> --sku <skuId> [--qty N]'); process.exit(1); }
                const cart = await addToCart(id, { skuId: Number(sku), quantity: flag('--qty') ? Number(flag('--qty')) : 1 }, ctx);
                if (jsonMode) outputJson(cart);
                else for (const line of cartLines(cart)) console.log(line);
                break;
              }
              case 'update': {
                const id = subArgs[1];
                const item = flag('--item');
                const qty = flag('--qty');
                if (!id || !item || qty === undefined) { console.error('Usage: geins merchant cart update <id> --item <itemId> --qty <n>'); process.exit(1); }
                const cart = await updateCartItem(id, { id: item, quantity: Number(qty) }, ctx);
                if (jsonMode) outputJson(cart);
                else for (const line of cartLines(cart)) console.log(line);
                break;
              }
              case 'remove': {
                const id = subArgs[1];
                const item = flag('--item');
                if (!id || !item) { console.error('Usage: geins merchant cart remove <id> --item <itemId>'); process.exit(1); }
                const cart = await removeFromCart(id, item, ctx);
                if (jsonMode) outputJson(cart);
                else for (const line of cartLines(cart)) console.log(line);
                break;
              }
              case 'promo': {
                const id = subArgs[1];
                const code = subArgs[2];
                if (!id || !code) { console.error('Usage: geins merchant cart promo <id> <code>'); process.exit(1); }
                const cart = await setCartPromoCode(id, code, ctx);
                if (jsonMode) outputJson(cart);
                else for (const line of cartLines(cart)) console.log(line);
                break;
              }
              default:
                console.error('Usage: geins merchant cart [create | get <id> | add <id> --sku <skuId> | update <id> --item <itemId> --qty N | remove <id> --item <itemId> | promo <id> <code>]');
                process.exit(1);
            }
            break;
          }
          case 'token': {
            // `token parse` is handled earlier (offline, no context).
            const cartId = subArgs[0];
            if (!cartId) { console.error('Usage: geins merchant token <cartId> [options]'); process.exit(1); }
            const opts: CheckoutTokenOptions = {
              cartId,
              selectedPaymentMethodId: flag('--payment') ? Number(flag('--payment')) : undefined,
              selectedShippingMethodId: flag('--shipping') ? Number(flag('--shipping')) : undefined,
              availablePaymentMethodIds: intList('--available-payments'),
              availableShippingMethodIds: intList('--available-shipping'),
              customerType: customerTypeFromFlag(),
              isCartEditable: commandArgs.includes('--editable') ? true : undefined,
              copyCart: commandArgs.includes('--no-copy') ? false : undefined,
              redirectUrls: redirectsFromFlags(),
              branding: jsonFlag('--branding') as CheckoutBranding | undefined,
              user: jsonFlag('--user') as Record<string, unknown> | undefined,
            };
            const token = buildCheckoutToken(opts, ctx);
            const url = commandArgs.includes('--url');
            // The hosted checkout takes the token at the ROOT path (per @geins/sdk:
            // `https://checkout.geins.services/${token}`). A `/checkout/<token>` path is a
            // different (redirect) route that drops the token and never renders.
            const checkoutUrl = `https://checkout.geins.services/${token}`;
            if (jsonMode) outputJson(url ? { token, url: checkoutUrl } : { token });
            else console.log(url ? checkoutUrl : token);
            break;
          }
          default:
            console.error(`Unknown subcommand: merchant ${sub}\n`);
            console.error(MERCHANT_HELP);
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
        // First non-flag arg is the subcommand, so `account --json` isn't mistaken for one.
        const sub = commandArgs.find((a) => !a.startsWith('-'))?.toLowerCase();
        const jsonMode = commandArgs.includes('--json');
        const vatPct = (rate?: number) => (rate != null ? `VAT ${+(rate * 100).toFixed(2)}%` : null);

        if (sub === 'list' || sub === 'accounts') {
          const accounts = await listUserAccounts();
          if (jsonMode) { outputJson(accounts); break; }
          const session = await loadSession();
          for (const a of accounts) {
            const marker = a.accountKey === session?.accountKey ? '●' : '○';
            console.log(`${marker} ${a.name}  (${a.accountKey})  ${a.roles.join(', ')}`);
          }
          console.log(`\n${accounts.length} account${accounts.length === 1 ? '' : 's'}  · ● = current. Use with: --account-name <name>`);
          break;
        }

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

        // A subcommand was given but didn't match any branch above — error instead of
        // silently showing the overview.
        if (sub) {
          console.error(`Unknown subcommand: account ${sub}`);
          console.error('Usage: geins account [markets | languages | locales] [--json]');
          process.exit(1);
        }

        // Default (no subcommand): a compact summary (counts only). --json keeps the full
        // data; the subcommands print the full human-readable lists.
        const [markets, languages, channels] = await Promise.all([listMarkets(), listLanguages(), listChannels()]);
        const locales = await listLocales({ channels, languages });
        if (jsonMode) { outputJson({ markets, languages, locales }); break; }
        console.log(`Markets: ${markets.length} · Languages: ${languages.length} · Locales: ${locales.length}`);
        console.log('Run: geins account [list | markets | languages | locales] [--json]');
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
