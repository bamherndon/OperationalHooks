import { HighDiscountTicketStrategy } from '../src/strategies/high-discount-ticket-strategy';
import { HeartlandTransaction } from '../src/model';

describe('HighDiscountTicketStrategy', () => {
  const baseTx: HeartlandTransaction = {
    id: 117060,
    type: 'Ticket',
    total: 133.98,
  };

  it('supports only Ticket transactions with ids', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const strategy = new HighDiscountTicketStrategy();

    const missingId = { ...baseTx, id: undefined } as unknown as HeartlandTransaction;
    expect(strategy.supports(missingId)).toBe(false);
    expect(strategy.supports({ ...baseTx, type: 'Return' })).toBe(false);
    expect(strategy.supports(baseTx)).toBe(true);

    warnSpy.mockRestore();
  });

  it('passes when discount data is missing', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const strategy = new HighDiscountTicketStrategy();

    const result = await strategy.checkTx(baseTx);
    expect(result).toBe(true);

    warnSpy.mockRestore();
  });

  it('passes when discounts are within 5%', async () => {
    const strategy = new HighDiscountTicketStrategy();
    const tx = {
      ...baseTx,
      original_subtotal: 200,
      total_discounts: 10,
    } as HeartlandTransaction;

    const result = await strategy.checkTx(tx);
    expect(result).toBe(true);
  });

  it('fails and sends GroupMe message when discounts exceed 5%', async () => {
    const mockGroupMeClient = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
    };
    const strategy = new HighDiscountTicketStrategy(mockGroupMeClient);
    const tx = {
      ...baseTx,
      original_subtotal: 200,
      total_discounts: 20,
    } as HeartlandTransaction;

    const result = await strategy.checkTx(tx);

    expect(result).toBe(false);
    expect(mockGroupMeClient.sendMessage).toHaveBeenCalledWith(
      'Ticket 117060 (  https://bamherndon.retail.heartland.us/#sales/tickets/edit/117060  )  -  200 was discounted by 10.00%'
    );
  });

  it('skips GroupMe when discount is $5 or less', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mockGroupMeClient = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
    };
    const strategy = new HighDiscountTicketStrategy(mockGroupMeClient);
    const tx = {
      ...baseTx,
      original_subtotal: 50,
      total_discounts: 5,
    } as HeartlandTransaction;

    const result = await strategy.checkTx(tx);

    expect(result).toBe(false);
    expect(mockGroupMeClient.sendMessage).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('handles GroupMe send failures', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const mockGroupMeClient = {
      sendMessage: jest.fn().mockRejectedValue(new Error('groupme down')),
    };
    const strategy = new HighDiscountTicketStrategy(mockGroupMeClient);
    const tx = {
      ...baseTx,
      original_subtotal: 100,
      total_discounts: 10,
    } as HeartlandTransaction;

    const result = await strategy.checkTx(tx);

    expect(result).toBe(false);

    errorSpy.mockRestore();
  });
});
