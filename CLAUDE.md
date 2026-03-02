# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Prerequisites

- Node.js v20

## Commands

### heartland-webhook (main Lambda package)
```bash
cd heartland-webhook
npm install          # first time
npm test             # run Jest tests with coverage
npm run lint         # ESLint
npm run build        # lint + test + tsc (required before deploy)
npm run zip          # build + package dist/ into lambda.zip
```

Run a single test file:
```bash
cd heartland-webhook && npx jest tests/handlers/item-handler.test.ts
```

### heartland-webhook-custom-resource
```bash
cd heartland-webhook-custom-resource
npm run build        # lint + tsc
```

### operational-hooks-cdk (deploy)
```bash
cd operational-hooks-cdk
npm run deploy       # builds both Lambda packages, then runs cdk deploy
npm run synth        # synthesize CloudFormation without deploying
npm run destroy      # tear down the stack
```

### operational-stack-int-tests (integration tests against deployed stack)
```bash
cd operational-stack-int-tests
npm test             # requires live AWS credentials and deployed stack
```

## Architecture

This is a monorepo with three TypeScript subprojects, each with its own `package.json` and `tsconfig.json`. There is no root-level build; you must `cd` into each subproject.

### Lambda handlers (`heartland-webhook/src/handlers/`)

| Handler | Trigger | Purpose |
|---|---|---|
| `transaction/index.ts` | Heartland `sales_transaction_completed` webhook (Lambda Function URL) | Runs a set of `TransactionCompletionStrategy` checks on each sale/return; alerts GroupMe on failures |
| `item/index.ts` | Heartland `item_created` webhook (Lambda Function URL) | Fetches an image from BrickLink or Toyhouse master data CSV and updates the new item in Heartland; sets tags |
| `undersold-items/index.ts` | EventBridge schedule (daily 03:00 UTC) | Queries Heartland analyzer report for stale inventory (not sold in 60 days), builds an Excel workbook, uploads to S3, sends a presigned link to GroupMe |

### Strategy pattern for transaction checks

`TransactionCompletionStrategy` (defined in `model.ts`) is the core extensibility point for the transaction handler. Each strategy implements:
- `supports(tx)` — whether it applies to this transaction
- `checkTx(tx)` — async check; returns `true` on pass

Strategies are built once per Lambda cold start and cached. The business-logic strategies are in `src/strategies/`:
- `InventoryNonNegativeStrategy` — fetches ticket lines and inventory values; alerts GroupMe if any item goes negative
- `PriceAdjustedItemStrategy` — detects price adjustments
- `HighDiscountTicketStrategy` — detects high-discount sales

The three completion-detection strategies (`TypeAndStatusCompletionStrategy`, `BalanceCompletionStrategy`, `CompletedTimestampStrategy`) live inline in `handlers/transaction/index.ts`.

### Client abstractions (`heartland-webhook/src/clients.ts`)

All external API calls go through interfaces with default implementations:
- `HeartlandApiClient` / `DefaultHeartlandApiClient` — Heartland REST API (Bearer token auth)
- `GroupMeClient` / `DefaultGroupMeClient` — GroupMe bot messages
- `BrickLinkClient` / `DefaultBrickLinkClient` — BrickLink REST API (OAuth 1.0a)
- `ToyhouseMasterDataClient` / `DefaultToyhouseMasterDataClient` — reads `toyhouse_master_data.csv` from S3; cached in Lambda memory

### CDK stack (`operational-hooks-cdk/lib/operational-hooks-stack.ts`)

One stack deploys everything into a VPC with a NAT Gateway (fixed Elastic IP for Heartland IP-allowlisting). The CDK reads compiled JS directly from `../heartland-webhook/dist` and `../heartland-webhook-custom-resource/dist`, so Lambda packages must be built before deploying.

A CloudFormation custom resource Lambda (`heartland-webhook-custom-resource`) auto-registers/deregisters webhooks with Heartland on stack create/delete.

### Secrets & environment variables

All secrets live in a single Secrets Manager secret named `OperationalSecrets` (configurable via `OperationalSecretsName` CDK parameter):

```json
{
  "heartland": { "token": "string" },
  "bricklink": {
    "consumerKey": "string", "consumerSecret": "string",
    "tokenValue": "string", "tokenSecret": "string"
  }
}
```

Lambda environment variables used at runtime:
- `HEARTLAND_API_BASE_URL` — e.g. `https://bamherndon.retail.heartland.us`
- `OPERATIONAL_SECRET_ARN` — Secrets Manager secret name/ARN
- `GROUPME_BOT_ID` — GroupMe bot ID for alerts
- `TOYHOUSE_MASTER_DATA_S3_PATH` / `TOYHOUSE_MASTER_DATA_S3_URI` — S3 path to `toyhouse_master_data.csv`
- `UNDERSOLD_REPORTS_S3_BUCKET` — S3 bucket for generated Excel reports (undersold-items handler only)

### External APIs
- Heartland Retail: https://dev.retail.heartland.us/
- BrickLink: https://www.bricklink.com/v3/api.page
- GroupMe: https://dev.groupme.com/docs/v3
