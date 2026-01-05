import * as https from 'https';
import * as crypto from 'crypto';
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

export interface HeartlandApiClient {
  getTicketLines(ticketId: number): Promise<TicketLinesResponse>;
  getInventoryValues(itemId: number): Promise<InventoryValuesResponse>;
  getInventoryItem(itemId: number): Promise<InventoryItem>;
  updateInventoryItem(
    itemId: number,
    updates: Partial<InventoryItem>
  ): Promise<InventoryItem>;
  updateInventoryItemImage(itemId: number, imageUrl: string): Promise<unknown>;
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
    const path = `/api/inventory/items/${encodeURIComponent(String(itemId))}`;
    const url = buildHeartlandUrl(this.baseUrl, path);
    return httpGetJson<InventoryItem>(url, this.token);
  }

  async updateInventoryItem(
    itemId: number,
    updates: Partial<InventoryItem>
  ): Promise<InventoryItem> {
    const path = `/api/inventory/items/${encodeURIComponent(String(itemId))}`;
    const url = buildHeartlandUrl(this.baseUrl, path);
    return httpPutJson<InventoryItem>(url, this.token, updates);
  }

  async updateInventoryItemImage(
    itemId: number,
    imageUrl: string
  ): Promise<unknown> {
    const path = `/api/inventory/items/${encodeURIComponent(String(itemId))}/images`;
    const url = buildHeartlandUrl(this.baseUrl, path);
    const payload = { source: 'url', url: imageUrl };
    return httpPostJson<unknown>(url, this.token, payload);
  }
}

/**
 * GroupMe client abstraction.
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
