import { HeartlandApiClient } from '../../src/clients';
import {
  FindItemsNotSoldResult,
  HeartlandReportRunner,
} from '../../src/heartland-report-runner';

function makeMockClient(runReportResponse: unknown): HeartlandApiClient {
  return {
    getTicketLines: jest.fn(),
    getInventoryValues: jest.fn(),
    getInventoryItem: jest.fn(),
    updateInventoryItem: jest.fn(),
    updateInventoryItemImage: jest.fn(),
    runReport: jest.fn().mockResolvedValue(runReportResponse),
  };
}

describe('HeartlandReportRunner', () => {
  it('findItemsNotSold calls analyzer report with decoded query and provided endDate/page', async () => {
    const client = makeMockClient({ total: 0, pages: 1, results: [] });
    const runner = new HeartlandReportRunner(client);

    await runner.findItemsNotSold('Used Sets', 60, '2026-02-14', 3);

    expect(client.runReport).toHaveBeenCalledWith('analyzer', {
      subtotal: false,
      grand_total: false,
      exclude_zeroes: true,
      include_links: false,
      per_page: 1000,
      page: 3,
      end_date: '2026-02-14',
      'group[]': ['location.name', 'item.public_id', 'item.description'],
      'metrics[]': [
        'current_inventory.last_sold_date',
        'current_inventory.days_since_last_sold',
        'current_inventory.last_received_date',
        'current_inventory.days_since_last_received',
      ],
      'sort[]': 'item.public_id,desc',
      charts: '[]',
      'item.filters': '{"$and":[{"custom@department":{"$in":["Used Sets"]}}]}',
      'metric.filters':
        '{"$and":[{"ending_inventory.qty_owned":{"$gt":["0"]}},{"$or":[{"current_inventory.days_since_last_sold":{"$gt":["60"]}},{"current_inventory.days_since_last_sold":{"$eq":null}}]},{"$or":[{"current_inventory.days_since_last_received":{"$gt":["60"]}},{"current_inventory.days_since_last_received":{"$eq":null}}]}]}',
    });
  });

  it('findItemsNotSold defaults endDate to today and page to 1', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-02-14T12:00:00.000Z'));
    try {
      const client = makeMockClient({ total: 0, pages: 1, results: [] });
      const runner = new HeartlandReportRunner(client);

      await runner.findItemsNotSold('Used Sets', 60);

      expect(client.runReport).toHaveBeenCalledWith(
        'analyzer',
        expect.objectContaining({
          end_date: '2026-02-14',
          per_page: 1000,
          page: 1,
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('findItemsNotSold parses report response into typed object', async () => {
    const response = {
      total: '2',
      pages: 1,
      results: [
        {
          'location.name': 'Bricks & Minifigs Herndon',
          'item.public_id': '11006-1',
          'item.description': '11006 Creative Blue Bricks',
          'current_inventory.last_sold_date': '2024-09-29',
          'current_inventory.days_since_last_sold': 503,
          'current_inventory.last_received_date': '2025-09-26',
          'current_inventory.days_since_last_received': 141,
          'ending_inventory.qty_owned': 1,
        },
        {
          'location.name': 'Bricks & Minifigs Herndon',
          'item.public_id': '76912-1',
          'item.description': '76912 Fast & Furious 1970 Dodge Charger R/T',
          'current_inventory.last_sold_date': '2024-11-22',
          'current_inventory.days_since_last_sold': '449',
          'current_inventory.last_received_date': null,
          'current_inventory.days_since_last_received': null,
          'ending_inventory.qty_owned': '1',
        },
        {
          // Invalid row should be filtered out by parser.
          'location.name': 'Bricks & Minifigs Herndon',
        },
      ],
    };

    const client = makeMockClient(response);
    const runner = new HeartlandReportRunner(client);
    const result = await runner.findItemsNotSold('Used Sets', 60, '2026-02-14');

    const expected: FindItemsNotSoldResult = {
      total: 2,
      pages: 1,
      results: [
        {
          'location.name': 'Bricks & Minifigs Herndon',
          'item.public_id': '11006-1',
          'item.description': '11006 Creative Blue Bricks',
          'current_inventory.last_sold_date': '2024-09-29',
          'current_inventory.days_since_last_sold': 503,
          'current_inventory.last_received_date': '2025-09-26',
          'current_inventory.days_since_last_received': 141,
          'ending_inventory.qty_owned': 1,
        },
        {
          'location.name': 'Bricks & Minifigs Herndon',
          'item.public_id': '76912-1',
          'item.description': '76912 Fast & Furious 1970 Dodge Charger R/T',
          'current_inventory.last_sold_date': '2024-11-22',
          'current_inventory.days_since_last_sold': 449,
          'current_inventory.last_received_date': null,
          'current_inventory.days_since_last_received': null,
          'ending_inventory.qty_owned': 1,
        },
      ],
    };

    expect(result).toEqual(expected);
  });
});
