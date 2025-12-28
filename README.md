# OperationalHooks

Automation and operational webhooks for Bricks & Minifigs Herndon, built on AWS Lambda, TypeScript, and AWS CDK.

This repo currently contains:

- **`heartland-webhook/`**  
  Lambda that receives `sales_transaction_completed` webhooks from Heartland Retail via a Lambda Function URL.  
  It runs a set of “transaction checks”, including an inventory check that calls Heartland’s API and posts alerts to GroupMe when inventory goes negative.

- **`heartland-webhook-custom-resource/`**  
  Lambda that acts as a CloudFormation custom resource.  
  On stack create/delete, it registers/deregisters the webhook with Heartland Retail using the Heartland API and a shared API token from Secrets Manager.

- **`operational-hooks-cdk/`**  
  AWS CDK app that:
  - Builds/uses the Lambda bundles from the two subprojects.
  - Deploys the Lambdas.
  - Creates a Lambda Function URL for the Heartland webhook.
  - Sets environment variables and permissions (Secrets Manager, etc.).

---

## Project Layout

```text
OperationalHooks/
  heartland-webhook/
    src/
      index.ts                 # Lambda handler + transaction strategies
      model.ts                 # Shared types/interfaces
      strategies/
        inventory-non-negative-strategy.ts  # Heartland + GroupMe integration
    tests/
      inventory-non-negative-strategy.test.ts
    dist/                      # Compiled JS (tsc output)
    scripts/
      make-zip.js              # Creates lambda.zip from dist/
    package.json
    tsconfig.json
    eslint.config.cjs

  heartland-webhook-custom-resource/
    src/
      index.ts                 # Custom resource Lambda logic
    dist/
    scripts/
      make-zip.js
    package.json
    tsconfig.json
    eslint.config.cjs

  operational-hooks-cdk/
    bin/
      operational-hooks-cdk.ts # CDK app entry
    lib/
      operational-hooks-stack.ts  # Main stack definition
    cdk.json
    package.json
