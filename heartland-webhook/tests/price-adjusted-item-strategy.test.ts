import { PriceAdjustedItemStrategy } from '../src/strategies/price-adjusted-item-strategy';
import { HeartlandApiClient, TicketLinesResponse } from '../src/clients';
import { HeartlandTransaction } from '../src/model';

describe('PriceAdjustedItemStrategy', () => {
  const baseTx: HeartlandTransaction = {
    id: 117060,
    type: 'Ticket',
    total: 15,
  };

  const makeMockClient = (lines: TicketLinesResponse): HeartlandApiClient => {
    return {
      getTicketLines: jest.fn().mockResolvedValue(lines),
      getInventoryValues: jest.fn(),
    };
  };

  it('supports only Ticket transactions with ids', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const strategy = new PriceAdjustedItemStrategy(
      makeMockClient({ total: 0, pages: 1, results: [] })
    );

    const missingId = { ...baseTx, id: undefined } as unknown as HeartlandTransaction;
    expect(strategy.supports(missingId)).toBe(false);
    expect(strategy.supports({ ...baseTx, type: 'Return' })).toBe(false);
    expect(strategy.supports(baseTx)).toBe(true);

    warnSpy.mockRestore();
  });

  it('passes when no ItemLine rows exist', async () => {
    const lines: TicketLinesResponse = {
      total: 1,
      pages: 1,
      results: [
        { id: 1, type: 'TaxLine' },
      ],
    };

    const strategy = new PriceAdjustedItemStrategy(makeMockClient(lines));
    const result = await strategy.checkTx(baseTx);

    expect(result).toBe(true);
  });

  it('passes when no price adjustments are present', async () => {
    const lines: TicketLinesResponse = {
      total: 1,
      pages: 1,
      results: [
        {
          id: 291087,
          type: 'ItemLine',
          item_id: 108028,
          adjusted_unit_price: null,
          price_adjustments: [],
        },
      ],
    };

    const strategy = new PriceAdjustedItemStrategy(makeMockClient(lines));
    const result = await strategy.checkTx(baseTx);

    expect(result).toBe(true);
  });

  it('fails when adjusted_unit_price is present', async () => {
    const lines: TicketLinesResponse = {
      total: 1,
      pages: 1,
      results: [
        {
          id: 291127,
          type: 'ItemLine',
          item_id: 105398,
          adjusted_unit_price: 15,
          price_adjustments: [],
        },
      ],
    };

    const strategy = new PriceAdjustedItemStrategy(makeMockClient(lines));
    const result = await strategy.checkTx(baseTx);

    expect(result).toBe(false);
  });

  it('fails when price_adjustments are present', async () => {
    const lines: TicketLinesResponse = {
      total: 1,
      pages: 1,
      results: [
        {
          id: 291127,
          type: 'ItemLine',
          item_id: 105398,
          adjusted_unit_price: null,
          price_adjustments: [
            { id: 60495, delta_price: -60 },
          ],
        },
      ],
    };

    const strategy = new PriceAdjustedItemStrategy(makeMockClient(lines));
    const result = await strategy.checkTx(baseTx);

    expect(result).toBe(false);
  });

  it('sends GroupMe message when price is adjusted', async () => {
    const lines: TicketLinesResponse = {
      total: 1,
      pages: 1,
      results: [
        {
          id: 291127,
          type: 'ItemLine',
          item_id: 105398,
          item_description: 'Batwing',
          adjusted_unit_price: 15,
          original_unit_price: 75,
          price_adjustments: [
            { id: 60495, delta_price: -60 },
          ],
        },
      ],
    };

    const mockGroupMeClient = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
    };

    const strategy = new PriceAdjustedItemStrategy(
      makeMockClient(lines),
      mockGroupMeClient
    );
    await strategy.checkTx(baseTx);

    expect(mockGroupMeClient.sendMessage).toHaveBeenCalledWith(
      'Item Batwing price was adjusted by -60 from 75 to 15 in ticket 117060 ( https://bamherndon.retail.heartland.us/#sales/tickets/edit/117060 )'
    );
  });

  it('uses unknown values when prices are missing', async () => {
    const lines: TicketLinesResponse = {
      total: 1,
      pages: 1,
      results: [
        {
          id: 291127,
          type: 'ItemLine',
          item_id: 105398,
          description: 'Batwing',
          adjusted_unit_price: 15,
        },
      ],
    };

    const mockGroupMeClient = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
    };

    const strategy = new PriceAdjustedItemStrategy(
      makeMockClient(lines),
      mockGroupMeClient
    );
    await strategy.checkTx(baseTx);

    expect(mockGroupMeClient.sendMessage).toHaveBeenCalledWith(
      'Item Batwing price was adjusted by unknown from unknown to 15 in ticket 117060 ( https://bamherndon.retail.heartland.us/#sales/tickets/edit/117060 )'
     );
  });

  it('fails when ticket lines cannot be retrieved', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const mockClient: HeartlandApiClient = {
      getTicketLines: jest.fn().mockRejectedValue(new Error('boom')),
      getInventoryValues: jest.fn(),
    };

    const strategy = new PriceAdjustedItemStrategy(mockClient);
    const result = await strategy.checkTx(baseTx);

    expect(result).toBe(false);

    errorSpy.mockRestore();
  });
});
