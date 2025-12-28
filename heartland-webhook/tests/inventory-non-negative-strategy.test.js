"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// tests/inventory-non-negative-strategy.test.ts
const inventory_non_negative_strategy_1 = require("../src/strategies/inventory-non-negative-strategy");
describe('InventoryNonNegativeStrategy', () => {
    const baseTx = {
        id: 117041,
        type: 'Ticket',
        total: 13.36,
        source_location_id: 100005,
    };
    const makeMockClient = (options) => {
        return {
            getTicketLines: jest.fn().mockResolvedValue(options.lines),
            getInventoryValues: jest
                .fn()
                .mockImplementation((itemId) => {
                const resp = options.inventoryByItem[itemId];
                if (!resp) {
                    return Promise.resolve({
                        total: 0,
                        pages: 1,
                        results: [],
                    });
                }
                return Promise.resolve(resp);
            }),
        };
    };
    it('passes when all inventory quantities are non-negative', async () => {
        const lines = {
            total: 1,
            pages: 1,
            results: [
                { id: 1, type: 'ItemLine', item_id: 2001 },
            ],
        };
        const inventoryForItem2001 = {
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
        const strategy = new inventory_non_negative_strategy_1.InventoryNonNegativeStrategy(mockClient);
        expect(strategy.supports(baseTx)).toBe(true);
        const result = await strategy.checkTx(baseTx);
        expect(result).toBe(true);
    });
    it('fails when any inventory quantity is negative for the ticket location', async () => {
        const lines = {
            total: 2,
            pages: 1,
            results: [
                { id: 1, type: 'ItemLine', item_id: 2001 },
                { id: 2, type: 'ItemLine', item_id: 2002 },
            ],
        };
        const inventoryForItem2001 = {
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
        const inventoryForItem2002 = {
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
        const strategy = new inventory_non_negative_strategy_1.InventoryNonNegativeStrategy(mockClient);
        expect(strategy.supports(baseTx)).toBe(true);
        const result = await strategy.checkTx(baseTx);
        expect(result).toBe(false);
    });
    it('treats non-matching locations as irrelevant', async () => {
        const lines = {
            total: 1,
            pages: 1,
            results: [
                { id: 1, type: 'ItemLine', item_id: 2001 },
            ],
        };
        const inventoryForItem2001 = {
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
        const strategy = new inventory_non_negative_strategy_1.InventoryNonNegativeStrategy(mockClient);
        expect(strategy.supports(baseTx)).toBe(true);
        const result = await strategy.checkTx(baseTx);
        expect(result).toBe(true);
    });
});
