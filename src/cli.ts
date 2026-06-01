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
import { getProduct, queryProducts, parseProductListArgs, productName, type ProductIdType } from './commands/products.ts';
import { validateManagementApi, validateMerchantApi, setProfileOverride } from './api/live-client.ts';
import { managementRequest, isHttpMethod, methods as managementMethods } from './commands/management.ts';
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

const VERSION = '0.1.0';

const PRODUCT_HELP = [
  'geins product — query the product catalog (Management API)',
  '',
  'Subcommands:',
  '  get <id> [--idtype <0-3>] [--json]   Show one product (id is the internal id by default)',
  '  list [filters] [--json]              Query products (alias: query); defaults to page 1',
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
  '  geins product list --brand 1 --in-stock',
  '  geins product list --page 2 --batch <BatchId> --json',
  '  geins product list --account prod-elproman   # pick a live-API account (headless)',
].join('\n');

export async function run(argv: string[]): Promise<void> {
  const args = argv.slice(2);

  // Direct mode — no TUI
  if (args.length > 0) {
    await runDirect(args);
    return;
  }

  // Interactive TUI mode requires a TTY
  if (!process.stdin.isTTY) {
    console.error('Interactive mode requires a terminal. Run geins --help for usage.');
    process.exit(1);
  }

  const app = render(React.createElement(App, { version: VERSION }), {
    exitOnCtrlC: true,
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

  if (args[0] === '--help' || args[0] === 'help') {
    console.log(`geins v${VERSION}`);
    console.log('CLI for Geins Commerce Backend\n');
    console.log('Usage: geins <command> [args] [flags]');
    console.log('       geins (interactive mode)\n');
    console.log('Commands:');
    console.log('  login     Authenticate with Geins (v2 session)');
    console.log('  logout    Clear stored credentials');
    console.log('  whoami    Show current user and account');
    console.log('  apikey    Manage live API accounts (set, list, use, remove, clear)');
    console.log('  workflow   Workflow commands (list, get, create, update, run, manifest, logs, enable, disable, vars)');
    console.log('  product    Product commands (get, list) — uses Management API');
    console.log('  management Call the Management API (raw + named methods)');
    console.log('  api       Raw API request');
    console.log('  output    Set/show the folder where responses + logs are dumped\n');
    console.log('Global flags:');
    console.log('  --account <name>   Use a specific live-API account (or set GEINS_ACCOUNT)');
    console.log('  --out <dir>        Dump responses + request log to <dir> (or set GEINS_OUTPUT_DIR)');
    console.log('  --json      Force JSON output');
    console.log('  --help      Show help');
    console.log('  --version   Show version');
    console.log("\nRun 'geins product --help' for that command's options and examples.");
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
      case 'workflow': {
        const sub = commandArgs[0]?.toLowerCase() ?? 'list';
        const subArgs = commandArgs.slice(1);
        const jsonMode = commandArgs.includes('--json');

        // Helper: resolve body from --file, --body, or stdin
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
      case 'management': {
        const sub = commandArgs[0] ?? '';
        const methodNames = Object.keys(managementMethods);

        if (!sub || sub.toLowerCase() === 'help') {
          console.log("Usage: geins management <METHOD> <path> [--body '<json>']   Raw Management API call");
          for (const name of methodNames) {
            const m = managementMethods[name]!;
            console.log(`       geins management ${name}${m.usage ? ` ${m.usage}` : ''}    ${m.description}`);
          }
          break;
        }

        // Raw passthrough: geins management GET /API/Market/List
        if (isHttpMethod(sub)) {
          const method = sub.toUpperCase();
          const path = commandArgs[1];
          if (!path) {
            console.error('Usage: geins management <METHOD> <path>');
            process.exit(1);
          }
          let body: unknown;
          const bodyIdx = commandArgs.indexOf('--body');
          if (bodyIdx !== -1 && commandArgs[bodyIdx + 1]) {
            body = JSON.parse(commandArgs[bodyIdx + 1]!);
          }
          const data = await managementRequest(method, path, body);
          console.log(JSON.stringify(data, null, 2));
          break;
        }

        // Named method
        const named = managementMethods[sub.toLowerCase()];
        if (!named) {
          console.error(`Unknown method: management ${sub}`);
          console.error('Run geins management help for available methods');
          process.exit(1);
        }
        const data = await named.run(commandArgs.slice(1));
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
      default:
        console.error(`Unknown command: ${commandName}. Run geins --help for usage.`);
        process.exit(1);
    }
  } catch (err) {
    exitWithError(err);
  }
}
