import { HeartlandApiClient } from './clients';

export interface HeartlandItemsNotSoldRow {
  'location.name': string;
  'item.public_id': string;
  'item.description': string;
  'current_inventory.last_sold_date': string | null;
  'current_inventory.days_since_last_sold': number | null;
  'current_inventory.last_received_date': string | null;
  'current_inventory.days_since_last_received': number | null;
  'ending_inventory.qty_owned': number;
}

export interface FindItemsNotSoldResult {
  results: HeartlandItemsNotSoldRow[];
  total: number;
  pages: number;
}

type UnknownRecord = Record<string, unknown>;

export class HeartlandReportRunner {
  constructor(private readonly heartlandApiClient: HeartlandApiClient) {}

  async findItemsNotSold(
    department: string,
    daysSinceLastSold: number,
    endDate: string = formatDate(new Date()),
    page: number = 1
  ): Promise<FindItemsNotSoldResult> {
    const itemFilters = {
      $and: [
        {
          'custom@department': {
            $in: [department],
          },
        },
      ],
    };

    const metricFilters = {
      $and: [
        {
          'ending_inventory.qty_owned': {
            $gt: ['0'],
          },
        },
        {
          $or: [
            {
              'current_inventory.days_since_last_sold': {
                $gt: [String(daysSinceLastSold)],
              },
            },
            {
              'current_inventory.days_since_last_sold': {
                $eq: null,
              },
            },
          ],
        },
        {
          $or: [
            {
              'current_inventory.days_since_last_received': {
                $gt: [String(daysSinceLastSold)],
              },
            },
            {
              'current_inventory.days_since_last_received': {
                $eq: null,
              },
            },
          ],
        },
      ],
    };

    const response = await this.heartlandApiClient.runReport<unknown>('analyzer', {
      subtotal: false,
      grand_total: false,
      exclude_zeroes: true,
      include_links: false,
      per_page: 1000,
      page,
      end_date: endDate,
      'group[]': ['location.name', 'item.public_id', 'item.description'],
      'metrics[]': [
        'current_inventory.last_sold_date',
        'current_inventory.days_since_last_sold',
        'current_inventory.last_received_date',
        'current_inventory.days_since_last_received',
      ],
      'sort[]': 'item.public_id,desc',
      charts: '[]',
      'item.filters': JSON.stringify(itemFilters),
      'metric.filters': JSON.stringify(metricFilters),
    });

    return parseFindItemsNotSoldResponse(response);
  }
}

function parseFindItemsNotSoldResponse(value: unknown): FindItemsNotSoldResult {
  const response = asRecord(value);
  const rawRows = Array.isArray(response.results) ? response.results : [];
  console.log(`${rawRows.length} rawRows`);
  const results = rawRows
    .map(parseItemsNotSoldRow)
    .filter((row): row is HeartlandItemsNotSoldRow => row !== null);
  console.log(`Got ${results.length} results`)
  return {
    results,
    total: toNumber(response.total) ?? results.length,
    pages: toNumber(response.pages) ?? 1,
  };
}

function parseItemsNotSoldRow(value: unknown): HeartlandItemsNotSoldRow | null {
  const row = asRecord(value);
  const locationName = asString(row['location.name']);
  const publicId = asString(row['item.public_id']);
  const description = asString(row['item.description']);
  const lastSoldDate = asNullableString(row['current_inventory.last_sold_date']);
  const daysSinceLastSold = toNullableNumber(row['current_inventory.days_since_last_sold']);
  const lastReceivedDate = asNullableString(row['current_inventory.last_received_date']);
  const daysSinceLastReceived = toNullableNumber(
    row['current_inventory.days_since_last_received']
  );
  const qtyOwned = toNumber(row['ending_inventory.qty_owned']);

  if (
    locationName === null ||
    publicId === null ||
    description === null ||
    qtyOwned === null
  ) {
    return null;
  }

  return {
    'location.name': locationName,
    'item.public_id': publicId,
    'item.description': description,
    'current_inventory.last_sold_date': lastSoldDate,
    'current_inventory.days_since_last_sold': daysSinceLastSold,
    'current_inventory.last_received_date': lastReceivedDate,
    'current_inventory.days_since_last_received': daysSinceLastReceived,
    'ending_inventory.qty_owned': qtyOwned,
  };
}

function asRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as UnknownRecord;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toNumber(value);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
