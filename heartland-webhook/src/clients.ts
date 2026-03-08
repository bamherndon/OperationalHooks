import * as https from 'https';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { HeartlandItemCustomFields } from './model';

interface PaginatedResponse<T> {
  total: number;
  pages: number;
  results: T[];
}

/**
 * Ticket line as returned by:
 * GET /api/sales/tickets/{{ticket_id}}/lines
 */
export interface TicketLine {
  id: number;
  type: string; // ItemLine, TaxLine, etc.
  item_id?: number;
  // Heartland often includes description-ish fields; we keep this loose.
  item_description?: string;
  description?: string;
  [key: string]: unknown;
}
export type TicketLinesResponse = PaginatedResponse<TicketLine>;

/**
 * Inventory value row as returned by:
 * GET /api/inventory/values?group[]=item_id&group[]=location_id&item_id=...
 */
export interface InventoryValueRow {
  item_id: number;
  location_id?: number;
  qty?: number;
  qty_on_hand?: number;
  qty_committed?: number;
  qty_on_po?: number;
  qty_in_transit?: number;
  qty_available?: number;
  unit_cost?: number;
  [key: string]: unknown;
}
export type InventoryValuesResponse = PaginatedResponse<InventoryValueRow>;

export interface InventoryItem {
  id: number;
  description?: string;
  long_description?: string;
  cost?: number | null;
  price?: number | null;
  public_id?: string;
  default_lookup_id?: number | null;
  custom?: HeartlandItemCustomFields | null;
  [key: string]: unknown;
}

export type PurchaseOrderStatus = 'pending' | 'open' | 'closed' | 'canceled';

export interface PurchaseOrder {
  id: number;
  status?: string;
  receive_at_location_id?: number | null;
  created_at?: string;
  updated_at?: string;
  created_by_user_id?: number | null;
  updated_by_user_id?: number | null;
  [key: string]: unknown;
}

export type PurchaseOrdersResponse = PaginatedResponse<PurchaseOrder>;

export interface PurchaseOrderLine {
  id: number;
  purchase_order_id?: number;
  item_id?: number;
  qty?: number;
  unit_cost?: number | null;
  [key: string]: unknown;
}

export type PurchaseOrderLinesResponse = PaginatedResponse<PurchaseOrderLine>;

export interface Receipt {
  id: number;
  purchase_order_id?: number | null;
  location_id?: number | null;
  [key: string]: unknown;
}

export interface ReceiptLine {
  item_id: number;
  qty: number;
  receipt_id?: number;
  unit_cost?: number | null;
}

type QueryValue = string | number | boolean;
export type HeartlandReportQuery = Record<
  string,
  QueryValue | QueryValue[] | undefined
>;

/**
 * Wrapper interface for calling Heartland API.
 * Documentation: https://dev.retail.heartland.us/
 */
export interface HeartlandApiClient {
  getTicketLines(ticketId: number): Promise<TicketLinesResponse>;
  getInventoryValues(itemId: number): Promise<InventoryValuesResponse>;
  getInventoryItem(itemId: number): Promise<InventoryItem>;
  updateInventoryItem(
    itemId: number,
    updates: Partial<InventoryItem>
  ): Promise<InventoryItem>;
  updateInventoryItemImage(itemId: number, imageUrl: string): Promise<unknown>;
  runReport<T = unknown>(
    reportType: string,
    query?: HeartlandReportQuery
  ): Promise<T>;
  listPurchaseOrders(
    status: PurchaseOrderStatus,
    page?: number
  ): Promise<PurchaseOrdersResponse>;
  getPurchaseOrderLines(purchaseOrderId: number): Promise<PurchaseOrderLinesResponse>;
  createReceipt(purchaseOrderId: number, locationId: number): Promise<void>;
  getReceiptByOrderId(orderId: number): Promise<Receipt>;
  addReceiptLine(receiptId: number, line: ReceiptLine): Promise<unknown>;
  createReceiptFromPurchaseOrder(
    purchaseOrderId: number,
    locationId: number
  ): Promise<Receipt>;
  completeReceipt(receiptId: number): Promise<Receipt>;
}

/**
 * Default HTTP-based implementation of HeartlandApiClient.
 * Configured entirely via constructor.
 */
export class DefaultHeartlandApiClient implements HeartlandApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async getTicketLines(ticketId: number): Promise<TicketLinesResponse> {
    const path = `/api/sales/tickets/${ticketId}/lines?per_page=500`;
    const url = buildHeartlandUrl(this.baseUrl, path);
    return httpGetJson<TicketLinesResponse>(url, this.token);
  }

  async getInventoryValues(itemId: number): Promise<InventoryValuesResponse> {
    const path =
      `/api/inventory/values` +
      `?group[]=item_id&group[]=location_id` +
      `&item_id=${encodeURIComponent(String(itemId))}` +
      `&exclude_empty_locations=true&per_page=50`;

    const url = buildHeartlandUrl(this.baseUrl, path);
    return httpGetJson<InventoryValuesResponse>(url, this.token);
  }

  async getInventoryItem(itemId: number): Promise<InventoryItem> {
    const path = `/api/items/${encodeURIComponent(String(itemId))}`;
    const url = buildHeartlandUrl(this.baseUrl, path);
    return httpGetJson<InventoryItem>(url, this.token);
  }

  async updateInventoryItem(
    itemId: number,
    updates: Partial<InventoryItem>
  ): Promise<InventoryItem> {
    const path = `/api/items/${encodeURIComponent(String(itemId))}`;
    const url = buildHeartlandUrl(this.baseUrl, path);
    return httpPutJson<InventoryItem>(url, this.token, updates);
  }

  async updateInventoryItemImage(
    itemId: number,
    imageUrl: string
  ): Promise<unknown> {
    const path = `/api/items/${encodeURIComponent(String(itemId))}/images`;
    const url = buildHeartlandUrl(this.baseUrl, path);
    const payload = { source: 'url', url: imageUrl };
    return httpPostJson<unknown>(url, this.token, payload);
  }

  async listPurchaseOrders(
    status: PurchaseOrderStatus,
    page = 1
  ): Promise<PurchaseOrdersResponse> {
    const path =
      `/api/purchasing/orders` +
      `?status=${encodeURIComponent(status)}` +
      `&page=${encodeURIComponent(String(page))}`;
    const url = buildHeartlandUrl(this.baseUrl, path);
    return httpGetJson<PurchaseOrdersResponse>(url, this.token);
  }

  async getPurchaseOrderLines(
    purchaseOrderId: number
  ): Promise<PurchaseOrderLinesResponse> {
    const path =
      `/api/purchasing/orders/${encodeURIComponent(String(purchaseOrderId))}/lines` +
      `?per_page=500`;
    const url = buildHeartlandUrl(this.baseUrl, path);
    return httpGetJson<PurchaseOrderLinesResponse>(url, this.token);
  }

  async createReceipt(purchaseOrderId: number, locationId: number): Promise<void> {
    const url = buildHeartlandUrl(this.baseUrl, `/api/purchasing/receipts`);
    await httpPostJson<unknown>(url, this.token, {
      order_id: purchaseOrderId,
      receive_at_location_id: locationId,
    });
  }

  async getReceiptByOrderId(orderId: number): Promise<Receipt> {
    const url = buildHeartlandUrl(
      this.baseUrl,
      `/api/purchasing/receipts?order_id=${encodeURIComponent(String(orderId))}&status=pending`
    );
    const response = await httpGetJson<PaginatedResponse<Receipt>>(url, this.token);
    const receipt = response.results[0];
    if (!receipt) {
      throw new Error(`No pending receipt found for order_id ${orderId}`);
    }
    return receipt;
  }

  async addReceiptLine(receiptId: number, line: ReceiptLine): Promise<unknown> {
    const path = `/api/purchasing/receipts/${encodeURIComponent(String(receiptId))}/lines`;
    const url = buildHeartlandUrl(this.baseUrl, path);
    return httpPostJson<unknown>(url, this.token, line);
  }

  async createReceiptFromPurchaseOrder(
    purchaseOrderId: number,
    locationId: number
  ): Promise<Receipt> {
    const linesResponse = await this.getPurchaseOrderLines(purchaseOrderId);
    console.log(
      `[DEBUG] PO ${purchaseOrderId} lines: total=${linesResponse.total}, count=${linesResponse.results.length}`,
      linesResponse.results.length > 0
        ? `first line: ${JSON.stringify(linesResponse.results[0])}`
        : '(no lines)'
    );

    await this.createReceipt(purchaseOrderId, locationId);
    const receipt = await this.getReceiptByOrderId(purchaseOrderId);
    console.log(`[DEBUG] Created receipt ${receipt.id} for PO ${purchaseOrderId}`);

    for (const line of linesResponse.results) {
      if (line.item_id == null) {
        console.log(`[DEBUG] Skipping PO line ${line.id}: item_id is null/undefined`);
        continue;
      }
      const linePayload = { item_id: line.item_id, qty: line.qty ?? 0, receipt_id: receipt.id, unit_cost: line.unit_cost };
      console.log(`[DEBUG] Adding receipt line for PO line ${line.id}:`, JSON.stringify(linePayload));
      try {
        const result = await this.addReceiptLine(receipt.id, linePayload);
        console.log(`[DEBUG] Receipt line added for PO line ${line.id}:`, JSON.stringify(result));
      } catch (err) {
        console.error(`[DEBUG] Failed to add receipt line for PO line ${line.id}:`, err);
        throw err;
      }
    }
    return receipt;
  }

  async completeReceipt(receiptId: number): Promise<Receipt> {
    const path = `/api/purchasing/receipts/${encodeURIComponent(String(receiptId))}`;
    const url = buildHeartlandUrl(this.baseUrl, path);
    return httpPutJson<Receipt>(url, this.token, { status: 'accepted' });
  }

  async runReport<T = unknown>(
    reportType: string,
    query: HeartlandReportQuery = {}
  ): Promise<T> {
    const reportPath = `/api/reporting/${encodeURIComponent(reportType)}`;
    const queryWithClientUuid: HeartlandReportQuery = {
      ...query,
      request_client_uuid: crypto.randomUUID(),
    };
    const queryString = buildQueryString(queryWithClientUuid);
    const path = queryString ? `${reportPath}?${queryString}` : reportPath;
    const url = buildHeartlandUrl(this.baseUrl, path);
    console.log(`Getting report using url ${url}`);
    return httpGetJson<T>(url, this.token);
  }
}

/**
 * GroupMe client abstraction.
 * API documentation: https://groupme-js.github.io/GroupMeCommunityDocs/api/
 */
export interface GroupMeClient {
  sendMessage(text: string): Promise<void>;
}

/**
 * Default GroupMe client that posts via HTTPS to /v3/bots/post.
 */
export class DefaultGroupMeClient implements GroupMeClient {
  constructor(private readonly botId: string) {}

  sendMessage(text: string): Promise<void> {
    const payload = JSON.stringify({
      bot_id: this.botId,
      text,
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        'https://api.groupme.com/v3/bots/post',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload).toString(),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer | string) => {
            data += chunk.toString();
          });
          res.on('end', () => {
            const statusCode = res.statusCode ?? 0;
            if (statusCode >= 200 && statusCode < 300) {
              resolve();
            } else {
              reject(
                new Error(`GroupMe HTTP ${statusCode}: ${data}`)
              );
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.write(payload);
      req.end();
    });
  }
}

export interface BrickLinkItemResponse<T> {
  meta: {
    code: number;
    message?: string;
    description?: string;
  };
  data: T;
}

export interface BrickLinkItem {
  item: {
    no: string;
    type: string;
    name?: string;
    category_id?: number;
    image_url?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface BrickLinkClient {
  getItem(itemType: string, itemNo: string): Promise<BrickLinkItem>;
}

export class DefaultBrickLinkClient implements BrickLinkClient {
  private static readonly BASE_URL = 'https://api.bricklink.com/api/store/v1';

  constructor(
    private readonly consumerKey: string,
    private readonly consumerSecret: string,
    private readonly tokenValue: string,
    private readonly tokenSecret: string
  ) {}

  async getItem(itemType: string, itemNo: string): Promise<BrickLinkItem> {
    const path = `/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}`;
    const url = `${DefaultBrickLinkClient.BASE_URL}${path}`;
    return httpGetBrickLinkJson<BrickLinkItem>(url, this.authHeader('GET', url));
  }

  private authHeader(method: string, url: string): string {
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.consumerKey,
      oauth_nonce: crypto.randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: this.tokenValue,
      oauth_version: '1.0',
    };

    const signature = buildOauthSignature(
      method,
      url,
      oauthParams,
      this.consumerSecret,
      this.tokenSecret
    );

    const headerParams: Record<string, string> = {
      ...oauthParams,
      oauth_signature: signature,
    };

    const header = Object.keys(headerParams)
      .sort()
      .map((key) => `${encodeRfc3986(key)}="${encodeRfc3986(headerParams[key])}"`)
      .join(', ');

    return `OAuth ${header}`;
  }
}

export interface ToyhouseMasterDataItem {
  itemNumber: string;
  bricklinkId?: string;
  raw: Record<string, string>;
}

export interface ToyhouseMasterDataClient {
  getItemByNumber(itemNumber: string): Promise<ToyhouseMasterDataItem | null>;
}

const DEFAULT_TOYHOUSE_MASTER_DATA_FILE = 'toyhouse_master_data.csv';

export class DefaultToyhouseMasterDataClient implements ToyhouseMasterDataClient {
  private cachedItems: Map<string, ToyhouseMasterDataItem> | null = null;

  constructor(
    private readonly s3Path: string,
    private readonly s3Client: S3Client
  ) {}

  async getItemByNumber(itemNumber: string): Promise<ToyhouseMasterDataItem | null> {
    const normalizedItemNumber = itemNumber.trim();
    if (!normalizedItemNumber) {
      return null;
    }

    const items = await this.loadItems();
    return items.get(normalizedItemNumber) ?? null;
  }

  private async loadItems(): Promise<Map<string, ToyhouseMasterDataItem>> {
    if (this.cachedItems) {
      return this.cachedItems;
    }

    const { bucket, key } = parseS3Path(this.s3Path);
    const result = await this.s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    const csv = await streamToString(result.Body);
    const rows = parseCsv(csv);
    if (rows.length === 0) {
      this.cachedItems = new Map();
      return this.cachedItems;
    }

    const headers = rows[0].map((header) => header.trim());
    const itemNumberIndex = findHeaderIndex(headers, 'item #');
    const bricklinkIdIndex = findHeaderIndex(headers, 'bricklink id');

    if (itemNumberIndex === -1) {
      throw new Error(
        'toyhouse_master_data.csv is missing required "Item #" header'
      );
    }

    const items = new Map<string, ToyhouseMasterDataItem>();

    for (const row of rows.slice(1)) {
      if (row.length === 0) {
        continue;
      }

      const itemNumber = (row[itemNumberIndex] ?? '').trim();
      if (!itemNumber) {
        continue;
      }

      const raw: Record<string, string> = {};
      for (let i = 0; i < headers.length; i += 1) {
        raw[headers[i]] = row[i] ?? '';
      }

      const bricklinkId =
        bricklinkIdIndex !== -1 ? (row[bricklinkIdIndex] ?? '').trim() : '';

      items.set(itemNumber, {
        itemNumber,
        bricklinkId: bricklinkId || undefined,
        raw,
      });
    }

    this.cachedItems = items;
    return items;
  }
}

/**
 * Simple HTTPS GET helper that returns parsed JSON.
 */
export function httpGetJson<T>(url: string, token: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        if (!res) {
          reject(new Error('No response from Heartland API'));
          return;
        }

        let data = '';
        res.on('data', (chunk: Buffer | string) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          const statusCode = res.statusCode ?? 0;
          if (statusCode >= 200 && statusCode < 300) {
            try {
              const parsed = data ? JSON.parse(data) : {};
              resolve(parsed as T);
            } catch (err) {
              reject(err);
            }
          } else {
            reject(
              new Error(
                `HTTP ${statusCode} from Heartland API: ${data}`
              )
            );
          }
        });
      }
    );

    req.on('error', (err) => {
      reject(err);
    });
  });
}

export function httpPutJson<T>(
  url: string,
  token: string,
  payload: unknown
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const body = JSON.stringify(payload ?? {});
    const req = https.request(
      url,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        if (!res) {
          reject(new Error('No response from Heartland API'));
          return;
        }

        let data = '';
        res.on('data', (chunk: Buffer | string) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          const statusCode = res.statusCode ?? 0;
          if (statusCode >= 200 && statusCode < 300) {
            try {
              const parsed = data ? JSON.parse(data) : {};
              resolve(parsed as T);
            } catch (err) {
              reject(err);
            }
          } else {
            reject(
              new Error(`HTTP ${statusCode} from Heartland API: ${data}`)
            );
          }
        });
      }
    );

    req.on('error', (err) => {
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

export function httpPostJson<T>(
  url: string,
  token: string,
  payload: unknown
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const body = JSON.stringify(payload ?? {});
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        if (!res) {
          reject(new Error('No response from Heartland API'));
          return;
        }

        let data = '';
        res.on('data', (chunk: Buffer | string) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          const statusCode = res.statusCode ?? 0;
          if (statusCode >= 200 && statusCode < 300) {
            try {
              const parsed = data ? JSON.parse(data) : {};
              resolve(parsed as T);
            } catch (err) {
              reject(err);
            }
          } else {
            reject(
              new Error(`HTTP ${statusCode} from Heartland API: ${data}`)
            );
          }
        });
      }
    );

    req.on('error', (err) => {
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

export function httpGetBrickLinkJson<T>(
  url: string,
  authorizationHeader: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Authorization: authorizationHeader,
          Accept: 'application/json',
        },
      },
      (res) => {
        if (!res) {
          reject(new Error('No response from BrickLink API'));
          return;
        }

        let data = '';
        res.on('data', (chunk: Buffer | string) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          const statusCode = res.statusCode ?? 0;
          if (statusCode >= 200 && statusCode < 300) {
            try {
              const parsed = data ? JSON.parse(data) : {};
              const response = parsed as BrickLinkItemResponse<T>;
              if (response?.meta?.code !== 200) {
                reject(
                  new Error(
                    `BrickLink API error: meta.code=${response?.meta?.code}`
                  )
                );
                return;
              }
              resolve(response.data);
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error(`HTTP ${statusCode} from BrickLink API: ${data}`));
          }
        });
      }
    );

    req.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Build a full URL from base + path/query, being tolerant of slashes.
 */
export function buildHeartlandUrl(baseUrl: string, pathWithQuery: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const trimmedPath = pathWithQuery.startsWith('/')
    ? pathWithQuery
    : `/${pathWithQuery}`;
  return `${trimmedBase}${trimmedPath}`;
}

function buildQueryString(query: HeartlandReportQuery): string {
  const params: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const arrayValue of value) {
        params.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(String(arrayValue))}`
        );
      }
      continue;
    }
    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return params.join('&');
}

function parseS3Path(value: string): { bucket: string; key: string } {
  const trimmed = value.trim();
  const withoutScheme = trimmed.startsWith('s3://')
    ? trimmed.slice('s3://'.length)
    : trimmed;

  const slashIndex = withoutScheme.indexOf('/');
  const bucket =
    slashIndex === -1 ? withoutScheme : withoutScheme.slice(0, slashIndex);
  let key = slashIndex === -1 ? '' : withoutScheme.slice(slashIndex + 1);

  if (!bucket) {
    throw new Error(`Invalid S3 path "${value}"`);
  }

  if (!key || key.endsWith('/')) {
    const prefix = key.replace(/\/+$/u, '');
    key = prefix
      ? `${prefix}/${DEFAULT_TOYHOUSE_MASTER_DATA_FILE}`
      : DEFAULT_TOYHOUSE_MASTER_DATA_FILE;
  } else if (!key.toLowerCase().endsWith('.csv')) {
    key = `${key}/${DEFAULT_TOYHOUSE_MASTER_DATA_FILE}`;
  }

  return { bucket, key };
}

async function streamToString(body: unknown): Promise<string> {
  if (!body) {
    return '';
  }
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString('utf8');
  }
  if (body instanceof Readable) {
    return new Promise<string>((resolve, reject) => {
      let data = '';
      body.on('data', (chunk: Buffer | string) => {
        data += chunk.toString();
      });
      body.on('end', () => resolve(data));
      body.on('error', (err) => reject(err));
    });
  }

  const stream = body as { text?: () => Promise<string>; getReader?: () => unknown };
  if (typeof stream.text === 'function') {
    return stream.text();
  }
  if (typeof stream.getReader === 'function') {
    const reader = stream.getReader() as {
      read: () => Promise<{ done: boolean; value?: Uint8Array }>;
    };
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  return '';
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];

    if (char === '"') {
      const nextChar = csv[i + 1];
      if (inQuotes && nextChar === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && csv[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      field = '';
      if (!(row.length === 1 && row[0] === '')) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) {
      rows.push(row);
    }
  }

  return rows;
}

function findHeaderIndex(headers: string[], name: string): number {
  const normalizedName = normalizeHeader(name);
  return headers.findIndex(
    (header) => normalizeHeader(header) === normalizedName
  );
}

function normalizeHeader(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildOauthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string
): string {
  const normalizedUrl = normalizeUrl(url);
  const paramString = Object.keys(params)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(params[key])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    encodeRfc3986(normalizedUrl),
    encodeRfc3986(paramString),
  ].join('&');

  const signingKey = `${encodeRfc3986(consumerSecret)}&${encodeRfc3986(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  const port =
    parsed.port &&
    !(
      (parsed.protocol === 'https:' && parsed.port === '443') ||
      (parsed.protocol === 'http:' && parsed.port === '80')
    )
      ? `:${parsed.port}`
      : '';
  return `${parsed.protocol}//${parsed.hostname}${port}${parsed.pathname}`;
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
