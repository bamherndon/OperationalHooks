import {
  HeartlandTransaction,
  TransactionCompletionStrategy,
} from '../model';
import {
  GroupMeClient,
  HeartlandApiClient,
  TicketLinesResponse,
} from '../clients';

const HEARTLAND_TICKET_URL_BASE =
  'https://bamherndon.retail.heartland.us/#sales/tickets/edit';

/**
 * Strategy:
 * Detect whether any item line has an adjusted price.
 */
export class PriceAdjustedItemStrategy
  implements TransactionCompletionStrategy
{
  public readonly name = 'price-adjusted-item';

  constructor(
    private readonly apiClient: HeartlandApiClient,
    private readonly groupMeClient?: GroupMeClient
  ) {}

  supports(tx: HeartlandTransaction): boolean {
    if (typeof tx.id !== 'number') {
      console.warn(
        `[${this.name}] Transaction id is missing or invalid; skipping`
      );
      return false;
    }

    // Only care about Ticket transactions (sales).
    if (tx.type !== 'Ticket') {
      return false;
    }

    return true;
  }

  async checkTx(tx: HeartlandTransaction): Promise<boolean> {
    const ticketId = tx.id;

    console.log(
      `[${this.name}] Starting price adjustment check`,
      JSON.stringify({ ticketId }, null, 2)
    );

    let linesResponse: TicketLinesResponse;
    try {
      linesResponse = await this.apiClient.getTicketLines(ticketId);
    } catch (err) {
      console.error(
        `[${this.name}] Error retrieving ticket lines`,
        JSON.stringify({ ticketId, error: String(err) }, null, 2)
      );
      return false;
    }

    const itemLines = (linesResponse.results ?? []).filter(
      (line) => line.type === 'ItemLine'
    );

    if (itemLines.length === 0) {
      console.log(
        `[${this.name}] No ItemLine rows found for ticket; treating as pass`,
        JSON.stringify({ ticketId }, null, 2)
      );
      return true;
    }

    const adjustedItems = itemLines
      .map((line) => {
        const adjustedUnitPrice = line['adjusted_unit_price'];
        const originalUnitPrice = line['original_unit_price'];
        const priceAdjustments = line['price_adjustments'];

        const hasAdjustedUnitPrice =
          adjustedUnitPrice !== null && adjustedUnitPrice !== undefined;
        const hasAdjustments =
          Array.isArray(priceAdjustments) && priceAdjustments.length > 0;

        if (!hasAdjustedUnitPrice && !hasAdjustments) {
          return null;
        }

        const description =
          line.item_description ??
          line.description ??
          (typeof line.item_id === 'number'
            ? `Item ${line.item_id}`
            : `Line ${line.id}`);

        return {
          line_id: line.id,
          item_id: line.item_id,
          description,
          original_unit_price: originalUnitPrice,
          adjusted_unit_price: adjustedUnitPrice,
          price_adjustments: hasAdjustments ? priceAdjustments : undefined,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (adjustedItems.length > 0) {
      console.warn(
        `[${this.name}] Price-adjusted items detected`,
        JSON.stringify({ ticketId, items: adjustedItems }, null, 2)
      );

      if (!this.groupMeClient) {
        console.warn(
          `[${this.name}] No GroupMe client configured; skipping GroupMe alerts`
        );
      } else {
        const ticketUrl = `${HEARTLAND_TICKET_URL_BASE}/${ticketId}`;

        try {
          await Promise.all(
            adjustedItems.map((item) => {
              const delta = getDeltaPrice(item);
              const original = formatPrice(item.original_unit_price);
              const adjusted = formatPrice(item.adjusted_unit_price);
              const deltaText = formatPrice(delta);
              const text =
                `Item ${item.description} price was adjusted by ${deltaText}` +
                ` from ${original} to ${adjusted} in ticket ${ticketId}` +
                ` ( ${ticketUrl} )`;
              return this.groupMeClient!.sendMessage(text);
            })
          );
        } catch (err) {
          console.error(`[${this.name}] Error posting to GroupMe`, err);
        }
      }

      return false;
    }

    console.log(
      `[${this.name}] No price adjustments detected`,
      JSON.stringify({ ticketId }, null, 2)
    );
    return true;
  }
}

function getDeltaPrice(item: {
  price_adjustments?: unknown;
  original_unit_price?: unknown;
  adjusted_unit_price?: unknown;
}): number | undefined {
  if (Array.isArray(item.price_adjustments)) {
    const deltas = item.price_adjustments
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) =>
        typeof entry.delta_price === 'number' ? entry.delta_price : undefined
      )
      .filter((value): value is number => typeof value === 'number');

    if (deltas.length > 0) {
      return deltas.reduce((sum, value) => sum + value, 0);
    }
  }

  if (
    typeof item.original_unit_price === 'number' &&
    typeof item.adjusted_unit_price === 'number'
  ) {
    return item.adjusted_unit_price - item.original_unit_price;
  }

  return undefined;
}

function formatPrice(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}`;
  }
  return 'unknown';
}
