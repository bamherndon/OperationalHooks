# OperationalHooks

Automation and operational webhooks for Bricks & Minifigs Herndon, built on AWS Lambda, TypeScript, and AWS CDK.

## Handlers

### `heartland-webhook/src/handlers/transaction/` — Sales transaction webhook
Receives `sales_transaction_completed` webhooks from Heartland Retail via a Lambda Function URL. Runs a set of `TransactionCompletionStrategy` checks on each sale/return and posts alerts to GroupMe on failures.

Strategies:
- `InventoryNonNegativeStrategy` — alerts if any item's inventory goes negative after the sale
- `PriceAdjustedItemStrategy` — detects price-adjusted line items
- `HighDiscountTicketStrategy` — detects tickets with high overall discount percentages

### `heartland-webhook/src/handlers/item/` — Item created webhook
Receives `item_created` webhooks from Heartland Retail via a Lambda Function URL. For each new item:

1. **Fetches an image** from BrickLink or Toyhouse and uploads it to the item in Heartland.
   - Image source is determined by `subDepartment`: `"New In Box"` → Toyhouse master data CSV (on S3); all others → BrickLink.
   - BrickLink item type is derived from `department`: `"Minifigs"` → `MINIFIG`; all others → `SET`.
   - Posts a GroupMe alert if an image cannot be found or applied.
2. **Sets tags** on the item: `"add, <bamCategory>, <category>"`.

### `heartland-webhook/src/handlers/undersold-items/` — Stale inventory report
Triggered daily at 03:00 UTC by EventBridge. Queries Heartland for items not sold in 60 days, builds an Excel workbook, uploads it to S3, and sends a presigned download link to GroupMe.

### `heartland-webhook/src/handlers/receive-open-orders/` — Auto-receive open purchase orders
Triggered daily at 03:00 UTC by EventBridge. Pages through all open purchase orders and for each PO with a `receive_at_location_id`, creates a receipt (one receipt line per PO line) and completes it (`status: accepted`). Posts a GroupMe alert per failed PO and continues processing the rest.

---

## Project Layout

```
OperationalHooks/
  heartland-webhook/              # Main Lambda package (all three handlers)
    src/
      handlers/
        transaction/index.ts      # Sales transaction webhook handler
        item/index.ts             # Item created webhook handler
        undersold-items/index.ts        # Stale inventory report handler
        receive-open-orders/index.ts    # Auto-receive open purchase orders handler
      strategies/                 # TransactionCompletionStrategy implementations
      clients.ts                  # HeartlandApiClient (getTicketLines, getInventoryValues, getInventoryItem, updateInventoryItem, updateInventoryItemImage, runReport, listPurchaseOrders, getPurchaseOrderLines, createReceipt, getReceiptByOrderId, addReceiptLine, createReceiptFromPurchaseOrder, completeReceipt), BrickLinkClient, GroupMeClient, ToyhouseMasterDataClient
      model.ts                    # Shared types and interfaces
    tests/
    package.json
    tsconfig.json

  heartland-webhook-custom-resource/   # CloudFormation custom resource Lambda
    src/index.ts                       # Registers/deregisters webhooks with Heartland on stack create/delete
    package.json
    tsconfig.json

  operational-hooks-cdk/          # AWS CDK app
    bin/operational-hooks-cdk.ts  # CDK app entry point
    lib/operational-hooks-stack.ts
    package.json

  operational-stack-int-tests/    # Integration tests against the deployed stack
    tests/handlers-int.test.ts
    tests/undersold-items-int.test.ts
    tests/receive-open-orders-int.test.ts
    package.json
```

---

## Secrets and Configuration

All secrets live in a single Secrets Manager secret named `OperationalSecrets` (ARN hardcoded in the CDK stack):

```json
{
  "heartland": { "token": "string" },
  "bricklink": {
    "consumerKey": "string",
    "consumerSecret": "string",
    "tokenValue": "string",
    "tokenSecret": "string"
  }
}
```

Lambda environment variables:

| Variable | Used by | Description |
|---|---|---|
| `HEARTLAND_API_BASE_URL` | all | e.g. `https://bamherndon.retail.heartland.us` |
| `OPERATIONAL_SECRET_ARN` | all | Secrets Manager secret name/ARN |
| `GROUPME_BOT_ID` | transaction, item, undersold-items, receive-open-orders | GroupMe bot ID for alerts |
| `TOYHOUSE_MASTER_DATA_S3_URI` | item | S3 URI to `toyhouse_master_data.csv` |
| `UNDERSOLD_REPORTS_S3_BUCKET` | undersold-items | S3 bucket for generated Excel reports |

---

## Development

See [CLAUDE.md](./CLAUDE.md) for build commands, architecture details, and development guidance.
