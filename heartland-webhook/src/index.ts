// src/index.ts
import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
  HeartlandTransaction,
  TransactionKind,
  CheckSummary,
  WebhookResponseBody,
  TransactionCompletionStrategy,
} from './model';
import {
  DefaultGroupMeClient,
  DefaultHeartlandApiClient,
  GroupMeClient,
} from './clients';
import { InventoryNonNegativeStrategy } from './strategies/inventory-non-negative-strategy';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';


/**
 * Strategy 1:
 * Use Heartland's explicit fields: type/status/completed?
 */
class TypeAndStatusCompletionStrategy implements TransactionCompletionStrategy {
  public readonly name = 'type-and-status';

  supports(_tx: HeartlandTransaction): boolean {
    return true;
  }

  async checkTx(tx: HeartlandTransaction): Promise<boolean> {
    if (typeof tx['completed?'] === 'boolean') {
      return tx['completed?'] === true;
    }

    if (typeof tx.status === 'string') {
      return tx.status.toLowerCase() === 'complete';
    }

    return false;
  }
}

/**
 * Strategy 2:
 * Based on financial fields: a transaction is “good” if
 * balance is 0 and the amounts look settled.
 */
class BalanceCompletionStrategy implements TransactionCompletionStrategy {
  public readonly name = 'balance-based';

  supports(tx: HeartlandTransaction): boolean {
    return typeof tx.balance === 'number';
  }

  async checkTx(tx: HeartlandTransaction): Promise<boolean> {
    if (typeof tx.balance !== 'number') {
      return false;
    }
    return Math.abs(tx.balance) < 0.0001;
  }
}

/**
 * Strategy 3:
 * Fallback heuristic: if there's a completed_at timestamp,
 * treat it as complete.
 */
class CompletedTimestampStrategy implements TransactionCompletionStrategy {
  public readonly name = 'completed-timestamp';

  supports(tx: HeartlandTransaction): boolean {
    return (
      typeof tx.completed_at === 'string' ||
      typeof tx.local_completed_at === 'string'
    );
  }

  async checkTx(tx: HeartlandTransaction): Promise<boolean> {
    return Boolean(tx.completed_at || tx.local_completed_at);
  }
}

const secretsClient = new SecretsManagerClient({});
let cachedHeartlandToken: string | null = null;
let cachedStrategies: TransactionCompletionStrategy[] | null = null;

async function getHeartlandApiTokenFromSecret(): Promise<string> {
  if (cachedHeartlandToken) {
    return cachedHeartlandToken;
  }

  const secretArn = process.env.HEARTLAND_SECRET_ARN;
  if (!secretArn) {
    throw new Error('HEARTLAND_SECRET_ARN environment variable is not set');
  }

  const result = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!result.SecretString) {
    throw new Error('SecretString is empty in Secrets Manager response');
  }

  const parsed: { token?: string } = JSON.parse(result.SecretString) as { token?: string };
  

  const token = parsed.token;
  if (!token) {
    throw new Error('Heartland secret JSON does not contain a "token" field');
  }

  cachedHeartlandToken = token;
  return token;
}


/**
 * Build the default strategy list.
 *
 * This is async because we may need to fetch the Heartland API token from
 * Secrets Manager to construct the inventory strategy's API client.
 */
async function buildDefaultCompletionStrategies(): Promise<TransactionCompletionStrategy[]> {
  if (cachedStrategies) {
    return cachedStrategies;
  }

  const strategies: TransactionCompletionStrategy[] = [
    new TypeAndStatusCompletionStrategy(),
    new BalanceCompletionStrategy(),
    new CompletedTimestampStrategy(),
  ];

  const baseUrl = process.env.HEARTLAND_API_BASE_URL;
  const secretArn = process.env.HEARTLAND_SECRET_ARN;

  if (!baseUrl || !secretArn) {
    console.warn(
      '[inventory-non-negative] Not added: missing HEARTLAND_API_BASE_URL or HEARTLAND_SECRET_ARN'
    );
    cachedStrategies = strategies;
    return strategies;
  }

  try {
    const token = await getHeartlandApiTokenFromSecret();
    const apiClient = new DefaultHeartlandApiClient(baseUrl, token);
    
    let groupMeClient: GroupMeClient | undefined;
    const botId = process.env.GROUPME_BOT_ID;
    
    if (!botId) {
      console.warn(
        '[inventory-non-negative] GROUPME_BOT_ID not set; inventory strategy will not send GroupMe alerts'
      );
    } else {
      groupMeClient = new DefaultGroupMeClient(botId);
    }
    
    strategies.push(
      new InventoryNonNegativeStrategy(apiClient, baseUrl, groupMeClient)
    );

  } catch (err) {
    console.error(
      '[inventory-non-negative] Error creating inventory strategy',
      err
    );
  }

  cachedStrategies = strategies;
  return strategies;
}

// Build strategies once per cold start and reuse for all invocations
const strategiesPromise: Promise<TransactionCompletionStrategy[]> =
  buildDefaultCompletionStrategies();


/**
 * Evaluate the transaction against all strategies.
 * - overall `check` passes only if all executed checks pass.
 */
async function evaluateChecks(
  tx: HeartlandTransaction,
  strategies: TransactionCompletionStrategy[]
): Promise<{ check: boolean; checks: CheckSummary[] }> {
  const checks: CheckSummary[] = [];

  let overall = true;
  let anyExecuted = false;

  for (const strategy of strategies) {
    const supported = strategy.supports(tx);

    if (!supported) {
      checks.push({
        name: strategy.name,
        executed: false,
        passed: false,
      });
      continue;
    }

    let passed = false;
    try {
      passed = await strategy.checkTx(tx);
    } catch (err) {
      console.error(
        `[${strategy.name}] Error during checkTx`,
        JSON.stringify({ error: String(err) }, null, 2)
      );
      passed = false;
    }

    checks.push({
      name: strategy.name,
      executed: true,
      passed,
    });

    anyExecuted = true;
    if (!passed) {
      overall = false;
    }
  }

  if (!anyExecuted) {
    overall = false;
  }

  return {
    check: overall,
    checks,
  };
}

/**
 * Classify as sale / return / other
 */
function classifyTransaction(tx: HeartlandTransaction): TransactionKind {
  if (tx.type === 'Ticket') return 'sale';
  if (tx.type === 'Return') return 'return';

  if (typeof tx.total === 'number') {
    if (tx.total > 0) return 'sale';
    if (tx.total < 0) return 'return';
  }

  return 'other';
}

function logTransactionSummary(tx: HeartlandTransaction, kind: TransactionKind): void {
  const summary = {
    kind,
    id: tx.id,
    type: tx.type,
    total: tx.total,
    parent_transaction_id: tx.parent_transaction_id,
    customer_id: tx.customer_id,
    customer_name: tx.customer_name,
    source_location_id: tx.source_location_id,
    sales_rep: tx.sales_rep,
    status: tx.status,
    completed_flag: tx['completed?'],
    balance: tx.balance,
    completed_at: tx.completed_at,
    local_completed_at: tx.local_completed_at,
  };

  console.log('Heartland transaction summary:', JSON.stringify(summary, null, 2));
}

/**
 * Helper for consistent 200 responses
 */
function createResponse(body: WebhookResponseBody): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

/**
 * Lambda handler
 */
export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  console.log(
    'Received Heartland webhook event (envelope):',
    JSON.stringify(
      {
        headers: event.headers,
        requestContext: {
          http: event.requestContext?.http,
          timeEpoch: event.requestContext?.timeEpoch,
        },
      },
      null,
      2
    )
  );

  if (!event.body) {
    console.warn('Received webhook with no body');
    return createResponse({
      status: 'ok',
      transactionKind: 'other',
      check: false,
      checks: [],
    });
  }

  let tx: HeartlandTransaction;
  try {
    tx = JSON.parse(event.body) as HeartlandTransaction;
  } catch (err) {
    console.error('Failed to parse webhook body as JSON:', err);
    console.error('Raw body:', event.body);

    return createResponse({
      status: 'ok',
      transactionKind: 'other',
      check: false,
      checks: [],
    });
  }

  const kind = classifyTransaction(tx);
  const strategies = await strategiesPromise;
  const { check, checks } = await evaluateChecks(tx, strategies);

  logTransactionSummary(tx, kind);
  console.log('Completion checks summary:', JSON.stringify(checks, null, 2));

  const firstPassing = checks.find((c) => c.executed && c.passed)?.name;

  const responseBody: WebhookResponseBody = {
    status: 'ok',
    transactionKind: kind,
    transactionId: tx.id,
    transactionType: tx.type,
    check,
    completionStrategy: firstPassing,
    checks,
  };

  return createResponse(responseBody);
};
