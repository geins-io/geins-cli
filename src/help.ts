// Machine-readable description of the CLI's command tree, for LLMs/automation.
// Emitted by `geins help --json` (alias `--llm`). Keep in sync with the human help.

export interface HelpFlag {
  flag: string;
  description: string;
  env?: string;
}

export interface HelpSubcommand {
  name: string;
  usage: string;
  description: string;
  flags?: HelpFlag[];
  examples?: string[];
}

export interface HelpCommand {
  name: string;
  description: string;
  api?: string;
  subcommands?: HelpSubcommand[];
  usage?: string;
  examples?: string[];
}

export interface CliHelpSpec {
  name: string;
  version: string;
  description: string;
  notes: string[];
  globalFlags: HelpFlag[];
  commands: HelpCommand[];
}

const ID_TYPE = '--idtype <0-3>: 0=Internal (default), 1=ArticleNumber, 2=MarketPrefixedInternal, 3=MarketPrefixedArticleNumber';

export function cliHelpSpec(version: string): CliHelpSpec {
  return {
    name: 'geins',
    version,
    description: 'CLI for the Geins Commerce Backend. Product/management commands use the live Management API (mgmtapi.geins.io) with API-User credentials set via `apikey`.',
    notes: [
      'Direct CLI: `geins <command> <subcommand> [args] [--flags]`. Add --json for raw JSON where supported.',
      'Live-API commands (product, management) require credentials: `geins apikey set ...`. Pick an account per-invocation with --account <name> or GEINS_ACCOUNT.',
      'Responses are also written to the output folder when one is set (`geins output <dir>`), and --out <dir> targets a single call.',
      ID_TYPE,
    ],
    globalFlags: [
      { flag: '--account <name>', description: 'Use a specific live-API account (relation/product/management).', env: 'GEINS_ACCOUNT' },
      { flag: '--out <dir>', description: 'Dump responses + a request log to <dir>.', env: 'GEINS_OUTPUT_DIR' },
      { flag: '--json', description: 'Force JSON output where supported.' },
      { flag: '--help', description: 'Show help. Add --json (or --llm) for this machine-readable command tree.' },
      { flag: '--version', description: 'Show version.' },
    ],
    commands: [
      { name: 'whoami', description: 'Show the current v2 user and account.', usage: 'geins whoami' },
      { name: 'apikey', description: 'Manage live Management/Merchant API credentials (per-account profiles).', subcommands: [
        { name: 'set', usage: 'apikey set --username <u> --mgmt-key <k> --mgmt-password <p> --merchant-key <k>', description: 'Add/validate a credential profile (keyed by management key). Validates both APIs.' },
        { name: 'list', usage: 'apikey list', description: 'List credential profiles; ● marks active.' },
        { name: 'use', usage: 'apikey use <name>', description: 'Switch the active profile.' },
        { name: 'remove', usage: 'apikey remove <name>', description: 'Remove a profile.' },
        { name: 'clear', usage: 'apikey clear', description: 'Remove all profiles.' },
      ] },
      { name: 'output', description: 'Set/show the folder where responses + a request log are written.', subcommands: [
        { name: 'status', usage: 'output [status]', description: 'Show the current output folder.' },
        { name: 'set', usage: 'output <dir>', description: 'Set the output folder (persisted).' },
        { name: 'off', usage: 'output off', description: 'Disable output dumping.' },
      ] },
      {
        name: 'product',
        description: 'Query and manage products via the Management API.',
        api: 'Management API',
        subcommands: [
          { name: 'get', usage: 'product get <id> [--idtype <0-3>] [--include <fields>] [--json]', description: 'Show one product.', examples: ['geins product get 10001 --json'] },
          { name: 'list', usage: 'product list [filters] [--json]', description: 'Query products (alias: query); defaults to page 1 (page size 1000).', flags: [
            { flag: '--brand <id>', description: 'Brand id (repeatable).' },
            { flag: '--category <id>', description: 'Category id (repeatable).' },
            { flag: '--supplier <id>', description: 'Supplier id (repeatable).' },
            { flag: '--id <productId>', description: 'Product id (repeatable).' },
            { flag: '--article <articleNumber>', description: 'Article number (repeatable).' },
            { flag: '--updated-after <ISO8601>', description: 'Updated after a date.' },
            { flag: '--created-after <ISO8601>', description: 'Created after a date.' },
            { flag: '--sellable', description: 'Only sellable products.' },
            { flag: '--in-stock', description: 'Only in-stock products.' },
            { flag: '--page <n>', description: 'Page number.' },
            { flag: '--batch <id>', description: 'BatchId from a prior page (required for page > 1).' },
            { flag: '--include <fields>', description: 'Child collections, e.g. Names,Prices,Categories.' },
          ], examples: ['geins product list --brand 1 --in-stock', 'geins product list --page 2 --batch <BatchId> --json'] },
          { name: 'items', usage: 'product items <id> [--idtype <0-3>] [--json]', description: "List a product's items (SKUs of one product).", examples: ['geins product items 10001'] },
          { name: 'variants', usage: 'product variants <id> [--idtype <0-3>] [--json]', description: "Show the product's variant group (sibling products + dimensions).", examples: ['geins product variants 10001'] },
          { name: 'variants create', usage: "product variants create [--name <n>] [--label <L>] [--product <id>:L=V,L=V] [--collapse] [--idtype <0-3>] [--file <path> | --body <json> | stdin] [--json]", description: 'Create a variant group from EXISTING products. Labels must be registered first. The main product cannot be set via the API. JSON body: { name?, collapse?, idType?, labels?: string[], products: [ { id, dimensions: { Label: Value } } ] }.', examples: ['geins product variants create --name Tee --label Color --product 1005:Color=Red --product 1010:Color=Blue'] },
          { name: 'variants labels', usage: 'product variants labels [list | add <name> | remove <name> | rename <old> <new>]', description: 'Manage variant dimension labels (the registry of dimension names).', examples: ['geins product variants labels add Color'] },
          { name: 'images', usage: 'product images <id> [--json]', description: "List a product's images (★ = primary, lowest Order).", examples: ['geins product images 10001'] },
          { name: 'images add', usage: 'product images add <id> <file|url> [--name <n>] [--primary] [--position <n>] [--idtype <0-3>]', description: 'Upload an image (jpg/png/gif) from a local file path or an http(s) URL.', examples: ['geins product images add 10001 ./hero.jpg --primary'] },
          { name: 'images add-existing', usage: 'product images add-existing <id> <imageName> [--idtype <0-3>]', description: 'Link an already-uploaded image (by file name) to a product without re-uploading bytes (PUT /API/Product/{id}/ImageRelation/{imageName}).', examples: ['geins product images add-existing 10001 hero.jpg'] },
          { name: 'images delete', usage: 'product images delete <id> <imageName>', description: 'Remove an image.' },
          { name: 'images set-primary', usage: 'product images set-primary <id> <imageName>', description: 'Make an image the primary one.' },
          { name: 'images reorder', usage: 'product images reorder <id> <imageName> <position>', description: "Change an image's position." },
          { name: 'brands', usage: 'product brands [list | get <id> | create --name <n> [--external-id <id>] [--desc <code>:<text>] | update <id> [--name <n>] [--external-id <id>] [--desc <code>:<text>] | delete <id>] [--json]', description: 'Manage the account-wide brand registry. A brand has { BrandId, Name, ExternalId, Descriptions[] }. list uses POST /API/Brand/Query; get/update/delete use /API/Brand/{id}; create POSTs /API/Brand. Alias: brand.', examples: ['geins product brands', 'geins product brands create --name Nike --external-id nike', 'geins product brands update 5 --name "Nike Inc"'] },
          { name: 'categories', usage: 'product categories [list | get <id> | create --name <code>:<text> [--parent <id>] [--desc <code>:<text>] [--hidden] [--inactive] | update <id> [--name <code>:<text>] [--parent <id>] [--hidden|--show] [--active|--inactive] | assign <productId> <categoryId> [--idtype <0-3>] | unassign <productId> <categoryId> [--idtype <0-3>]] [--json]', description: 'Manage the account-wide category tree. A category has { CategoryId, ParentCategoryId, Names[], Descriptions[], Hidden, Active }. list uses POST /API/Category/Query; get/update use /API/Category/{id} (update is a partial merge); create POSTs /API/Category. assign adds a category to a product via PUT /API/Product/{id}/Category. unassign removes one: there is no delete endpoint, so it reads the product categories, drops the id, and rewrites CategoryIds via the product PUT (partial merge), keeping the existing main category first. Alias: category.', examples: ['geins product categories', 'geins product categories create --name en:Shoes --parent 1', 'geins product categories assign 10001 42', 'geins product categories unassign 10001 42'] },
          { name: 'relation-types', usage: 'product relation-types [list | get <id> | add <name> [--order <n>] | update <id> [--name <n>] [--order <n>] | delete <id>]', description: 'Manage the account-wide relation-type registry (e.g. Accessories). A relation type has { Id, Name, Order }.', examples: ['geins product relation-types add Accessories'] },
          { name: 'relations', usage: 'product relations <id> [--idtype <0-3>] [--json]', description: "List a product's related products.", examples: ['geins product relations 10001'] },
          { name: 'relations link', usage: 'product relations link <productId> <relationTypeId> <relatedId...> [--idtype <0-3>]', description: 'Link one or more existing products as related, via a relation type.', examples: ['geins product relations link 10001 1 10002 10003'] },
          { name: 'relations unlink', usage: 'product relations unlink <productId> <relationTypeId> <relatedId...> [--idtype <0-3>]', description: 'Remove related-product links via a relation type.' },
          { name: 'parameters', usage: 'product parameters <id> [--idtype <0-3>] [--json]', description: "List a product's parameter values. A parameter is a definition (belongs to a group, has a type 1-7); a product gets a parameter VALUE by assigning a string to a parameterId. Alias: params.", examples: ['geins product parameters 10001'] },
          { name: 'parameters get', usage: 'product parameters get <productId> <parameterId> [--idtype <0-3>] [--json]', description: 'Show one resolved parameter value (with parameter/group names and type).' },
          { name: 'parameters set', usage: 'product parameters set <productId> <parameterId> <value> [--desc <code>:<text>] [--idtype <0-3>]', description: 'Assign/update a parameter value on a product. --desc adds localized descriptions (repeatable).', examples: ['geins product parameters set 10001 42 "100% Cotton"'] },
          { name: 'parameters remove', usage: 'product parameters remove <productId> <parameterId> [--idtype <0-3>]', description: 'Remove a parameter assignment from a product.' },
          { name: 'parameters batch', usage: "product parameters batch <update|replace|remove> [--file <path> | --body '<json>' | stdin]", description: 'Batch value writes. update = merge (keeps unlisted); replace = removes values not in the body. Body for update/replace: { "values": [ { "ProductId", "ParameterId", "Value", "LocalizedDescriptions"? } ] }. Body for remove: { "assignments": [ { "ProductId", "ParameterId" } ] }.' },
          { name: 'parameters defs', usage: 'product parameters defs [get <id> | create --name <n> --group <groupId> --type <1-7> [--lang <code>:<text>] | update <id> [--name <n>] [--group <id>] [--type <1-7>]]', description: 'Manage parameter definitions. ParameterType 1-7 is an opaque classification (undocumented).', examples: ['geins product parameters defs create --name Material --group 3 --type 1'] },
          { name: 'parameters groups', usage: 'product parameters groups [get <id> | create --name <n> [--order <n>] [--param <id>...] | update <id> [--name <n>] [--order <n>] [--param <id>...]]', description: 'Manage parameter groups (containers that organize parameters). --param adds parameter ids to the group (repeatable).' },
          { name: 'parameters predefined', usage: 'product parameters predefined [get <id> | add --param <parameterId> --name <n> [--lang <code>:<text>] | rename <id> <name>]', description: 'Manage a parameter\'s predefined values (preset options).' },
        ],
      },
      {
        name: 'workflow',
        description: 'Orchestrator workflow commands (v2 API).',
        api: 'v2 (orchestrator)',
        subcommands: [
          { name: 'list', usage: 'workflow list [--json]', description: 'List workflows.' },
          { name: 'get', usage: 'workflow get <id>', description: 'Get a workflow definition (JSON).' },
          { name: 'create', usage: "workflow create [--file <path> | --body '<json>' | stdin]", description: 'Create a workflow.' },
          { name: 'update', usage: "workflow update <id> [--file <path> | --body '<json>']", description: 'Update a workflow.' },
          { name: 'run', usage: "workflow run <id> [--body '<json>'] [--watch]", description: 'Execute a workflow.' },
          { name: 'manifest', usage: 'workflow manifest', description: 'Full manifest: node types, actions, expressions, triggers.' },
          { name: 'logs', usage: 'workflow logs <id>', description: 'Execution logs.' },
          { name: 'enable', usage: 'workflow enable <id>', description: 'Enable a workflow.' },
          { name: 'disable', usage: 'workflow disable <id>', description: 'Disable a workflow.' },
          { name: 'vars', usage: 'workflow vars [list | get <name> | set <name> <value>]', description: 'Global workflow variables.' },
        ],
      },
      {
        name: 'order',
        description: 'Inspect and handle orders. Uses the Management API (/API/Order/*).',
        api: 'Management API',
        subcommands: [
          { name: 'list', usage: 'order list [--status <csv>] [--email <e>] [--customer <id>] [--market <id>] [--payment <name>] [--created-after <iso>] [--updated-after <iso>] [--include <fields>] [--page <n>] [--batch <id>] [--json]', description: 'Query orders (alias: query). POST /API/Order/Query. Paged; page > 1 needs --batch from the prior page.', examples: ['geins order list --status 2 --json'] },
          { name: 'get', usage: 'order get <idOrPublicId> [--include <fields>] [--json]', description: 'Get one order. A UUID is fetched by public id (GET /API/OrderByPublicId/{publicId}), otherwise by internal id (GET /API/Order/{id}). --include adds child collections, e.g. Rows,ShippingAddress.', examples: ['geins order get 100123 --include Rows'] },
          { name: 'count', usage: 'order count <email>', description: 'Number of orders for a customer email. GET /API/Order/Count/{email}.' },
          { name: 'statuses', usage: 'order statuses', description: 'List the available order status codes. GET /API/Order/Statuses.' },
          { name: 'create', usage: "order create [--file <path> | --body '<json>' | stdin]", description: 'Create (place) an order. POST /API/Order with an Order body; returns the new order id.' },
          { name: 'validate', usage: "order validate [--file <path> | --body '<json>' | stdin]", description: 'Validate an order body before creating it. POST /API/Order/ValidateCreation; returns { Success, Message }.' },
          { name: 'status', usage: 'order status <id> <status> [<transactionId> [<secondaryTransactionId>]]', description: 'Change order status. POST /API/Order/{id}/Status/{status}/{transactionId}/{secondaryTransactionId} (trailing transaction ids optional).' },
          { name: 'update', usage: "order update <id> [--external-id <s>] [--parcel <s>] [--external-status <0|10|20|30|40>] [--return-parcel <s>] | [--body '<json>']", description: 'Partial update of an order (omitted fields unchanged). PATCH /API/Order/{id}.' },
          { name: 'cancel-row', usage: 'order cancel-row <orderId> <orderRowId>', description: 'Cancel a single order row. DELETE /API/Order/{orderId}/OrderRow/{orderRowId}.' },
          { name: 'comment', usage: 'order comment <id> <text> [--system]', description: 'Add a comment to an order. POST /API/Order/{id}/Comment.' },
          { name: 'transaction', usage: 'order transaction <id> <transactionId>', description: 'Set the payment transaction id. POST /API/Order/{id}/TransactionData.' },
          { name: 'set-paid', usage: 'order set-paid <paymentDetailId>', description: 'Mark a payment detail as paid. POST /API/Order/PaymentDetail/{paymentDetailId}/SetAsPaid.' },
          { name: 'delete', usage: 'order delete <id>', description: 'Delete an order. DELETE /API/Order/{id}.' },
        ],
      },
      { name: 'management', description: 'Call the Management API directly (raw passthrough + named methods).', api: 'Management API', subcommands: [
        { name: 'raw', usage: "management <METHOD> <path> [--body '<json>']", description: 'Raw call, e.g. `management GET /API/Market/List`.', examples: ['geins management GET /API/Market/List'] },
      ] },
      { name: 'api', description: 'Raw request against the v2 API.', usage: "api <METHOD> <path> [--body '<json>']", examples: ['geins api GET /products'] },
    ],
  };
}
