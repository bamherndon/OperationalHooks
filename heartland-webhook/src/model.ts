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

export interface HeartlandItemCustomFields {
  upc?: string;
  tags?: string;
  theme?: string;
  series?: string;
  retired?: string;
  category?: string;
  department?: string;
  launchDate?: string;
  bamCategory?: string;
  bricklinkId?: string;
  taxCategory?: string;
  subDepartment?: string;
  retirementDate?: string;
  [key: string]: unknown;
}

export interface HeartlandItemCreatedPayload {
  id: number;
  metadata?: Record<string, unknown> | null;
  cost?: number | null;
  price?: number | null;
  description?: string;
  allowFractionalQty?: boolean;
  publicId?: string;
  defaultLookupId?: number | null;
  longDescription?: string;
  custom?: HeartlandItemCustomFields | null;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
  financialClassId?: number | null;
  importBatchId?: number | null;
  primaryVendorId?: number | null;
  primaryBarcode?: string | null;
  gridId?: number | null;
  originalPrice?: number | null;
  sortKey?: number | null;
  metadataPrivate?: Record<string, unknown> | null;
  importSetId?: number | null;
  createdByUserId?: number | null;
  promptForPrice?: boolean;
  promptForDescription?: boolean;
  useDynamicMargin?: boolean;
  dynamicMargin?: number | null;
  updatedByUserId?: number | null;
  weight?: number | null;
  width?: number | null;
  height?: number | null;
  depth?: number | null;
  trackInventory?: boolean;
  addOnForItemsMatchingFilter?: boolean;
  addOnItemFilter?: string | null;
  uuid?: string;
  primaryImageId?: number | null;
  defaultPriceListId?: number | null;
  type?: string;
  availableOnline?: boolean;
  hasImages?: boolean | null;
  weightUnit?: string | null;
  widthUnit?: string | null;
  heightUnit?: string | null;
  depthUnit?: string | null;
  productType?: string;
  [key: string]: unknown;
}
