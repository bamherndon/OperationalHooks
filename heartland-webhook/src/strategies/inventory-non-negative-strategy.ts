import * as https from 'https';
import {
  HeartlandTransaction,
  TransactionCompletionStrategy,
} from '../model';

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
 * Strategy:
 * Inventory non-negative check.
 *
 * If any item at the ticket's location has negative inventory, the check fails
 * and we log + optionally send GroupMe alerts.
 */
export class InventoryNonNegativeStrategy
  implements TransactionCompletionStrategy
{
  public readonly name = 'inventory-non-negative';

  constructor(
    private readonly apiClient: HeartlandApiClient,
    private readonly heartlandBaseUrl: string,
    private readonly groupMeClient?: GroupMeClient
  ) {}

  supports(tx: HeartlandTransaction): boolean {
    if (typeof tx.id !== 'number') {
      console.warn(`[${this.name}] Transaction id is missing or invalid; skipping`);
      return false;
    }

    if (typeof tx.source_location_id !== 'number') {
      console.warn(
        `[${this.name}] source_location_id is missing or invalid; skipping`
      );
      return false;
    }

    // Only care about Ticket / Return transactions
    if (tx.type !== 'Ticket' && tx.type !== 'Return') {
      return false;
    }

    return true;
  }

  async checkTx(tx: HeartlandTransaction): Promise<boolean> {
    const ticketId = tx.id;
    const locationId = tx.source_location_id as number;

    console.log(
      `[${this.name}] Starting inventory check`,
      JSON.stringify({ ticketId, locationId }, null, 2)
    );

    // 1. Retrieve ticket lines
    let linesResponse: TicketLinesResponse;
    try {
      linesResponse = await this.apiClient.getTicketLines(ticketId);
    } catch (err) {
      console.error(
        `[${this.name}] Error retrieving ticket lines`,
        JSON.stringify({ ticketId, error: String(err) }, null, 2)
      );
      // Fail the check if we can't validate inventory
      return false;
    }

    const itemDescriptionById = new Map<number, string>();

    for (const line of linesResponse.results ?? []) {
      if (line.type === 'ItemLine' && typeof line.item_id === 'number') {
        const desc =
          line.item_description ??
          line.description ??
          '';

        if (desc && !itemDescriptionById.has(line.item_id)) {
          itemDescriptionById.set(line.item_id, desc);
        }
      }
    }

    const itemIds = Array.from(
      new Set(
        (linesResponse.results ?? [])
          .filter(
            (line) =>
              line.type === 'ItemLine' && typeof line.item_id === 'number'
          )
          .map((line) => line.item_id as number)
      )
    );

    if (itemIds.length === 0) {
      console.log(
        `[${this.name}] No ItemLine rows found for ticket; treating as pass`,
        JSON.stringify({ ticketId }, null, 2)
      );
      return true;
    }

    console.log(
      `[${this.name}] Checking inventory for items`,
      JSON.stringify(
        { ticketId, locationId, itemIdsCount: itemIds.length },
        null,
        2
      )
    );

    const negatives: Array<{
      item_id: number;
      location_id?: number;
      qty_on_hand?: number;
      qty_available?: number;
      description: string;
    }> = [];

    // 2. For each item, retrieve inventory values grouped by item+location
    for (const itemId of itemIds) {
      let invResponse: InventoryValuesResponse;
      try {
        invResponse = await this.apiClient.getInventoryValues(itemId);
      } catch (err) {
        console.error(
          `[${this.name}] Error retrieving inventory values`,
          JSON.stringify({ itemId, error: String(err) }, null, 2)
        );
        // Fail the check if we can't validate inventory
        return false;
      }

      for (const row of invResponse.results ?? []) {
        // If a location_id is present, restrict to the ticket's location
        if (
          typeof row.location_id === 'number' &&
          row.location_id !== locationId
        ) {
          continue;
        }

        const qtyAvailable =
          typeof row.qty_available === 'number' ? row.qty_available : undefined;
        const qtyOnHand =
          typeof row.qty_on_hand === 'number' ? row.qty_on_hand : undefined;

        const qtyForCheck =
          typeof qtyAvailable === 'number'
            ? qtyAvailable
            : typeof qtyOnHand === 'number'
              ? qtyOnHand
              : 0;

        if (qtyForCheck < 0) {
          const description =
            itemDescriptionById.get(row.item_id) ??
            `Item ${row.item_id}`;

          negatives.push({
            item_id: row.item_id,
            location_id: row.location_id,
            qty_on_hand: qtyOnHand,
            qty_available: qtyAvailable,
            description,
          });
        }
      }
    }

    if (negatives.length > 0) {
      console.warn(
        `[${this.name}] Negative inventory detected`,
        JSON.stringify(
          {
            ticketId,
            locationId,
            negativeCount: negatives.length,
            items: negatives,
          },
          null,
          2
        )
      );

      // Best-effort GroupMe notifications (if a client was provided).
      if (!this.groupMeClient) {
        console.warn(
          `[${this.name}] No GroupMe client configured; skipping GroupMe alerts`
        );
      } else {
        const base = this.heartlandBaseUrl.replace(/\/+$/, '');

        try {
          await Promise.all(
            negatives.map((neg) => {
              const url = `${base}#items/edit/${neg.item_id}`;
              const text = `${neg.description} (${url}) has negative inventory balance`;
              return this.groupMeClient!.sendMessage(text);
            })
          );
        } catch (err) {
          console.error(
            `[${this.name}] Error posting to GroupMe`,
            err
          );
          // swallow error; we still want to signal negative inventory
        }
      }

      return false;
    }

    console.log(
      `[${this.name}] All inventory quantities non-negative`,
      JSON.stringify({ ticketId, locationId }, null, 2)
    );
    return true;
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
