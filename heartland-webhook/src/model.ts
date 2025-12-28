// src/model.ts
export type HeartlandTransactionType = 'Ticket' | 'Return' | string;

export interface HeartlandTransaction {
  id: number;
  type: HeartlandTransactionType;
  customer_id?: number;
  customer_name?: string;
  source_location_id?: number;
  sales_rep?: string;
  total: number;
  parent_transaction_id?: number | null;
  status?: string;
  completed_at?: string;
  local_completed_at?: string;
  // Heartland literal field name
  'completed?'?: boolean;
  balance?: number;
  // Anything else from the payload
  [key: string]: unknown;
}

export type TransactionKind = 'sale' | 'return' | 'other';

export interface CheckSummary {
  name: string;
  executed: boolean;
  passed: boolean;
}

export interface WebhookResponseBody {
  status: 'ok';
  transactionKind: TransactionKind;
  transactionId?: number;
  transactionType?: string;
  check: boolean;
  completionStrategy?: string;
  checks: CheckSummary[];
}

/**
 * Strategy interface for determining whether a transaction
 * passes a particular check (e.g. “is complete”, “no negative inventory”).
 */
export interface TransactionCompletionStrategy {
  readonly name: string;

  /**
   * Whether this strategy applies to the given transaction.
   */
  supports(tx: HeartlandTransaction): boolean;

  /**
   * Return true if, according to this strategy, the transaction passes
   * the check.
   */
  checkTx(tx: HeartlandTransaction): Promise<boolean>;
}
