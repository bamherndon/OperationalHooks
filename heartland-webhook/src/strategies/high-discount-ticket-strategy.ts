import {
  HeartlandTransaction,
  TransactionCompletionStrategy,
} from '../model';
import { GroupMeClient } from '../clients';

const HEARTLAND_TICKET_URL_BASE =
  'https://bamherndon.retail.heartland.us/#sales/tickets/edit';

/**
 * Strategy:
 * Fail if total_discounts exceeds 5% of original_subtotal.
 */
export class HighDiscountTicketStrategy
  implements TransactionCompletionStrategy
{
  public readonly name = 'high-discount-ticket';

  constructor(private readonly groupMeClient?: GroupMeClient) {}

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
    const totalDiscounts =
      typeof tx.total_discounts === 'number' ? tx.total_discounts : undefined;
    const originalSubtotal =
      typeof tx.original_subtotal === 'number' ? tx.original_subtotal : undefined;

    if (
      typeof totalDiscounts !== 'number' ||
      typeof originalSubtotal !== 'number' ||
      originalSubtotal <= 0
    ) {
      console.warn(
        `[${this.name}] Missing or invalid discount data; treating as pass`,
        JSON.stringify({ ticketId }, null, 2)
      );
      return true;
    }

    const discountPercent = (totalDiscounts / originalSubtotal) * 100;
    const thresholdPercent = 5;

    if (discountPercent > thresholdPercent) {
      const ticketUrl = `${HEARTLAND_TICKET_URL_BASE}/${ticketId}`;
      console.warn(
        `[${this.name}] High discount detected`,
        JSON.stringify(
          {
            ticketId,
            totalDiscounts,
            originalSubtotal,
            discountPercent,
          },
          null,
          2
        )
      );

      if (!this.groupMeClient) {
        console.warn(
          `[${this.name}] No GroupMe client configured; skipping GroupMe alerts`
        );
      } else {
        const message =
          `Ticket ${ticketId} (  ${ticketUrl}  )  -  ${originalSubtotal}` +
          ` was discounted by ${discountPercent.toFixed(2)}%`;
        try {
          await this.groupMeClient.sendMessage(message);
        } catch (err) {
          console.error(`[${this.name}] Error posting to GroupMe`, err);
        }
      }

      return false;
    }

    return true;
  }
}
