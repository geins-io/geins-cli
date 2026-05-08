import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.tsx';
import { loadConfig } from './config/store.ts';
import { request } from './api/client.ts';
import { loadSession } from './auth/session.ts';
import { formatError, exitWithError, notLoggedIn } from './api/errors.ts';
import { getApiUrl } from './config/env.ts';
import { readFileSync } from 'node:fs';
import { getProduct } from './commands/products.ts';
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

async function runDirect(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === 'help') {
    console.log(`geins v${VERSION}`);
    console.log('CLI for Geins Commerce Backend\n');
    console.log('Usage: geins <command> [args] [flags]');
    console.log('       geins (interactive mode)\n');
    console.log('Commands:');
    console.log('  login     Authenticate with Geins Management API');
    console.log('  logout    Clear stored credentials');
    console.log('  whoami    Show current user and account');
    console.log('  workflow   Workflow commands (list, get, create, update, run, manifest, logs, enable, disable, vars)');
    console.log('  product    Product commands (get)');
    console.log('  api       Raw API request\n');
    console.log('Global flags:');
    console.log('  --json      Force JSON output');
    console.log('  --help      Show help');
    console.log('  --version   Show version');
    return;
  }

  if (args[0] === '--version' || args[0] === 'version') {
    console.log(VERSION);
    return;
  }

  const commandName = args[0]!;
  const commandArgs = args.slice(1);

  if (commandArgs.includes('--help')) {
    console.log(`${commandName} — CLI command`);
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
      case 'product': {
        const sub = commandArgs[0]?.toLowerCase() ?? '';
        const subArgs = commandArgs.slice(1);
        const jsonMode = commandArgs.includes('--json');

        switch (sub) {
          case 'get': {
            const id = subArgs[0];
            if (!id) {
              console.error('Usage: geins product get <id>');
              process.exit(1);
            }
            const product = await getProduct(id);
            if (jsonMode) {
              console.log(JSON.stringify(product, null, 2));
            } else {
              const status = product.active ? '●' : '○';
              console.log(`${status} ${product.name.trim()}  (${product._id})`);
              if (product.articleNumber) console.log(`  Article: ${product.articleNumber}`);
              console.log(`  Price: ${product.purchasePrice} ${product.purchasePriceCurrency}`);
              if (product.brand) console.log(`  Brand: ${product.brand._id}`);
              console.log(`  Category: ${product.mainCategoryId}`);
              console.log(`  Updated: ${product.dateUpdated}`);
            }
            break;
          }
          default:
            if (!sub) {
              console.error('Usage: geins product <subcommand>');
            } else {
              console.error(`Unknown subcommand: product ${sub}`);
            }
            console.error('Subcommands: get');
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
      default:
        console.error(`Unknown command: ${commandName}. Run geins --help for usage.`);
        process.exit(1);
    }
  } catch (err) {
    exitWithError(err);
  }
}
