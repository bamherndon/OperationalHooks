// tests/inventory-non-negative-strategy.test.ts
import { InventoryNonNegativeStrategy } from '../../src/strategies/inventory-non-negative-strategy';
import {
  HeartlandApiClient,
  TicketLinesResponse,
  InventoryValuesResponse,
} from '../../src/clients';
import { HeartlandTransaction } from '../../src/model';

describe('InventoryNonNegativeStrategy', () => {
  const baseTx: HeartlandTransaction = {
    id: 117041,
    type: 'Ticket',
    total: 13.36,
    source_location_id: 100005,
  };

  const makeMockClient = (options: {
    lines: TicketLinesResponse;
    inventoryByItem: Record<number, InventoryValuesResponse>;
  }): HeartlandApiClient => {
    return {
      getTicketLines: jest.fn().mockResolvedValue(options.lines),
      getInventoryValues: jest
        .fn()
        .mockImplementation((itemId: number) => {
          const resp = options.inventoryByItem[itemId];
          if (!resp) {
            return Promise.resolve({
              total: 0,
              pages: 1,
              results: [],
            } as InventoryValuesResponse);
          }
          return Promise.resolve(resp);
        }),
    };
  };

  it('passes when all inventory quantities are non-negative', async () => {
    const lines: TicketLinesResponse = {
      total: 1,
      pages: 1,
      results: [
        { id: 1, type: 'ItemLine', item_id: 2001 },
      ],
    };

    const inventoryForItem2001: InventoryValuesResponse = {
      total: 1,
      pages: 1,
      results: [
        {
          item_id: 2001,
          location_id: 100005,
          qty_on_hand: 10,
          qty_available: 8,
        },
      ],
    };

    const mockClient = makeMockClient({
      lines,
      inventoryByItem: {
        2001: inventoryForItem2001,
      },
    });

    const mockGroupMeClient = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
    };
    
    const strategy = new InventoryNonNegativeStrategy(
      mockClient,
      'https://example.heartland.test',
      mockGroupMeClient
    );


    expect(strategy.supports(baseTx)).toBe(true);
    const result = await strategy.checkTx(baseTx);
    expect(result).toBe(true);
  });

  it('fails when any inventory quantity is negative for the ticket location', async () => {
    const lines: TicketLinesResponse = {
      total: 2,
      pages: 1,
      results: [
        { id: 1, type: 'ItemLine', item_id: 2001 },
        { id: 2, type: 'ItemLine', item_id: 2002 },
      ],
    };

    const inventoryForItem2001: InventoryValuesResponse = {
      total: 1,
      pages: 1,
      results: [
        {
          item_id: 2001,
          location_id: 100005,
          qty_on_hand: 5,
          qty_available: 5,
        },
      ],
    };

    const inventoryForItem2002: InventoryValuesResponse = {
      total: 1,
      pages: 1,
      results: [
        {
          item_id: 2002,
          location_id: 100005,
          qty_on_hand: -1,
          qty_available: -1,
        },
      ],
    };

    const mockClient = makeMockClient({
      lines,
      inventoryByItem: {
        2001: inventoryForItem2001,
        2002: inventoryForItem2002,
      },
    });

    const mockGroupMeClient = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
    };
    
    const strategy = new InventoryNonNegativeStrategy(
      mockClient,
      'https://example.heartland.test',
      mockGroupMeClient
    );


    expect(strategy.supports(baseTx)).toBe(true);
    const result = await strategy.checkTx(baseTx);
    expect(mockGroupMeClient.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockGroupMeClient.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Item 2002') // or the description you set
    );

    expect(result).toBe(false);
  });

  it('treats non-matching locations as irrelevant', async () => {
    const lines: TicketLinesResponse = {
      total: 1,
      pages: 1,
      results: [
        { id: 1, type: 'ItemLine', item_id: 2001 },
      ],
    };

    const inventoryForItem2001: InventoryValuesResponse = {
      total: 2,
      pages: 1,
      results: [
        {
          item_id: 2001,
          location_id: 999999, // other location, negative
          qty_on_hand: -5,
        },
        {
          item_id: 2001,
          location_id: 100005, // ticket location, fine
          qty_on_hand: 3,
        },
      ],
    };

    const mockClient = makeMockClient({
      lines,
      inventoryByItem: {
        2001: inventoryForItem2001,
      },
    });

    const mockGroupMeClient = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
    };
    
    const strategy = new InventoryNonNegativeStrategy(
      mockClient,
      'https://example.heartland.test',
      mockGroupMeClient
    );


    expect(strategy.supports(baseTx)).toBe(true);
    const result = await strategy.checkTx(baseTx);

    expect(result).toBe(true);
  });

  it('returns false when transaction id is missing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const strategy = new InventoryNonNegativeStrategy(
      makeMockClient({
        lines: { total: 0, pages: 1, results: [] },
        inventoryByItem: {},
      }),
      'https://example.heartland.test'
    );

    const badTx = { ...baseTx, id: undefined } as unknown as HeartlandTransaction;
    expect(strategy.supports(badTx)).toBe(false);

    warnSpy.mockRestore();
  });

  it('returns false when source_location_id is missing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const strategy = new InventoryNonNegativeStrategy(
      makeMockClient({
        lines: { total: 0, pages: 1, results: [] },
        inventoryByItem: {},
      }),
      'https://example.heartland.test'
    );

    const badTx = {
      ...baseTx,
      source_location_id: undefined,
    } as unknown as HeartlandTransaction;
    expect(strategy.supports(badTx)).toBe(false);

    warnSpy.mockRestore();
  });

  it('returns false when transaction type is not Ticket or Return', () => {
    const strategy = new InventoryNonNegativeStrategy(
      makeMockClient({
        lines: { total: 0, pages: 1, results: [] },
        inventoryByItem: {},
      }),
      'https://example.heartland.test'
    );

    const badTx = { ...baseTx, type: 'Quote' } as HeartlandTransaction;
    expect(strategy.supports(badTx)).toBe(false);
  });

  it('passes when no ItemLine rows exist', async () => {
    const lines: TicketLinesResponse = {
      total: 1,
      pages: 1,
      results: [
        { id: 1, type: 'TaxLine' },
      ],
    };

    const mockClient = makeMockClient({
      lines,
      inventoryByItem: {},
    });

    const strategy = new InventoryNonNegativeStrategy(
      mockClient,
      'https://example.heartland.test'
    );

    const result = await strategy.checkTx(baseTx);
    expect(result).toBe(true);
    expect(mockClient.getInventoryValues).not.toHaveBeenCalled();
  });

  it('fails when ticket lines cannot be retrieved', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const mockClient: HeartlandApiClient = {
      getTicketLines: jest.fn().mockRejectedValue(new Error('boom')),
      getInventoryValues: jest.fn(),
    };

    const strategy = new InventoryNonNegativeStrategy(
      mockClient,
      'https://example.heartland.test'
    );

    const result = await strategy.checkTx(baseTx);
    expect(result).toBe(false);

    errorSpy.mockRestore();
  });

  it('fails when inventory values cannot be retrieved', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const lines: TicketLinesResponse = {
      total: 1,
      pages: 1,
      results: [
        { id: 1, type: 'ItemLine', item_id: 2001 },
      ],
    };

    const mockClient: HeartlandApiClient = {
      getTicketLines: jest.fn().mockResolvedValue(lines),
      getInventoryValues: jest.fn().mockRejectedValue(new Error('boom')),
    };

    const strategy = new InventoryNonNegativeStrategy(
      mockClient,
      'https://example.heartland.test'
    );

    const result = await strategy.checkTx(baseTx);
    expect(result).toBe(false);

    errorSpy.mockRestore();
  });

  it('fails and warns when negatives exist without a GroupMe client', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const lines: TicketLinesResponse = {
      total: 1,
      pages: 1,
      results: [
        { id: 1, type: 'ItemLine', item_id: 2001 },
      ],
    };

    const inventoryForItem2001: InventoryValuesResponse = {
      total: 1,
      pages: 1,
      results: [
        {
          item_id: 2001,
          location_id: 100005,
          qty_on_hand: -1,
        },
      ],
    };

    const mockClient = makeMockClient({
      lines,
      inventoryByItem: {
        2001: inventoryForItem2001,
      },
    });

    const strategy = new InventoryNonNegativeStrategy(
      mockClient,
      'https://example.heartland.test'
    );

    const result = await strategy.checkTx(baseTx);
    expect(result).toBe(false);

    warnSpy.mockRestore();
  });

  it('uses item description for GroupMe alerts', async () => {
    const lines: TicketLinesResponse = {
      total: 1,
      pages: 1,
      results: [
        {
          id: 1,
          type: 'ItemLine',
          item_id: 2001,
          item_description: 'Fancy widget',
        },
      ],
    };

    const inventoryForItem2001: InventoryValuesResponse = {
      total: 1,
      pages: 1,
      results: [
        {
          item_id: 2001,
          location_id: 100005,
          qty_on_hand: -2,
        },
      ],
    };

    const mockClient = makeMockClient({
      lines,
      inventoryByItem: {
        2001: inventoryForItem2001,
      },
    });

    const mockGroupMeClient = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
    };

    const strategy = new InventoryNonNegativeStrategy(
      mockClient,
      'https://example.heartland.test',
      mockGroupMeClient
    );

    await strategy.checkTx(baseTx);
    expect(mockGroupMeClient.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Fancy widget')
    );
  });

  it('swallows GroupMe errors and still fails the check', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const lines: TicketLinesResponse = {
      total: 1,
      pages: 1,
      results: [
        { id: 1, type: 'ItemLine', item_id: 2001 },
      ],
    };

    const inventoryForItem2001: InventoryValuesResponse = {
      total: 1,
      pages: 1,
      results: [
        {
          item_id: 2001,
          location_id: 100005,
          qty_on_hand: -2,
        },
      ],
    };

    const mockClient = makeMockClient({
      lines,
      inventoryByItem: {
        2001: inventoryForItem2001,
      },
    });

    const mockGroupMeClient = {
      sendMessage: jest.fn().mockRejectedValue(new Error('groupme down')),
    };

    const strategy = new InventoryNonNegativeStrategy(
      mockClient,
      'https://example.heartland.test',
      mockGroupMeClient
    );

    const result = await strategy.checkTx(baseTx);
    expect(result).toBe(false);

    errorSpy.mockRestore();
  });

  it('ignores excluded item ids', async () => {
    const lines: TicketLinesResponse = {
      total: 2,
      pages: 1,
      results: [
        { id: 1, type: 'ItemLine', item_id: 101996 },
        { id: 2, type: 'ItemLine', item_id: 2001 },
      ],
    };

    const inventoryForExcluded: InventoryValuesResponse = {
      total: 1,
      pages: 1,
      results: [
        {
          item_id: 101996,
          location_id: 100005,
          qty_on_hand: -10,
        },
      ],
    };

    const inventoryForItem2001: InventoryValuesResponse = {
      total: 1,
      pages: 1,
      results: [
        {
          item_id: 2001,
          location_id: 100005,
          qty_on_hand: 5,
        },
      ],
    };

    const mockClient = makeMockClient({
      lines,
      inventoryByItem: {
        101996: inventoryForExcluded,
        2001: inventoryForItem2001,
      },
    });

    const strategy = new InventoryNonNegativeStrategy(
      mockClient,
      'https://example.heartland.test'
    );

    const result = await strategy.checkTx(baseTx);

    expect(result).toBe(true);
    expect(mockClient.getInventoryValues).toHaveBeenCalledTimes(1);
    expect(mockClient.getInventoryValues).toHaveBeenCalledWith(2001);
  });
});
