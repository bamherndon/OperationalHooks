import * as https from 'https';

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

export interface HeartlandApiClient {
  getTicketLines(ticketId: number): Promise<TicketLinesResponse>;
  getInventoryValues(itemId: number): Promise<InventoryValuesResponse>;
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
