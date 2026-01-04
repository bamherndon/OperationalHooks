import {
  HeartlandTransaction,
  TransactionCompletionStrategy,
} from '../model';
import {
  GroupMeClient,
  HeartlandApiClient,
  InventoryValuesResponse,
  TicketLinesResponse,
} from '../clients';

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
  private static readonly EXCLUDED_ITEM_IDS = new Set<number>([
    101996,
    106379,
    102112
  ]);

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
        if (InventoryNonNegativeStrategy.EXCLUDED_ITEM_IDS.has(line.item_id)) {
          continue;
        }

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
              line.type === 'ItemLine' &&
              typeof line.item_id === 'number' &&
              !InventoryNonNegativeStrategy.EXCLUDED_ITEM_IDS.has(line.item_id)
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
      try {
        const invResponse = await this.apiClient.getInventoryValues(itemId);

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
      } catch (err) {
        console.error(
          `[${this.name}] Error retrieving inventory values`,
          JSON.stringify({ itemId, error: String(err) }, null, 2)
        );
        // Fail the check if we can't validate inventory
        return false;
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
              const url = `${base}/#items/edit/${neg.item_id}`;
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
