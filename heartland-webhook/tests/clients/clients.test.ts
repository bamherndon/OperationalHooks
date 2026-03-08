import { EventEmitter } from 'events';
import * as https from 'https';
import { Readable } from 'stream';
import {
  DefaultGroupMeClient,
  DefaultHeartlandApiClient,
  DefaultBrickLinkClient,
  DefaultToyhouseMasterDataClient,
  buildHeartlandUrl,
  httpGetJson,
  httpPutJson,
  httpPostJson,
  httpGetBrickLinkJson,
} from '../../src/clients';

jest.mock('https');

const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((input) => input),
}));

const mockedHttps = https as unknown as {
  get: jest.Mock;
  request: jest.Mock;
};

const makeMockResponse = (statusCode: number, body: string) => {
  const res = new EventEmitter() as EventEmitter & { statusCode?: number };
  res.statusCode = statusCode;

  return {
    res,
    emitBody: () => {
      if (body) {
        res.emit('data', body);
      }
      res.emit('end');
    },
  };
};

describe('clients', () => {
  beforeEach(() => {
    mockedHttps.get.mockReset();
    mockedHttps.request.mockReset();
    mockS3Send.mockReset();
  });

  it('buildHeartlandUrl trims slashes and joins path', () => {
    expect(buildHeartlandUrl('https://example.test/', '/api/test')).toBe(
      'https://example.test/api/test'
    );
    expect(buildHeartlandUrl('https://example.test', 'api/test')).toBe(
      'https://example.test/api/test'
    );
  });

  it('httpGetJson includes auth header and parses JSON', async () => {
    const { res, emitBody } = makeMockResponse(200, JSON.stringify({ ok: true }));
    mockedHttps.get.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
      callback(res);
      process.nextTick(emitBody);
      return { on: jest.fn() } as unknown;
      }
    );

    const result = await httpGetJson<{ ok: boolean }>(
      'https://example.test/api/ok',
      'token-123'
    );

    expect(result).toEqual({ ok: true });
    expect(mockedHttps.get).toHaveBeenCalledTimes(1);
    expect(mockedHttps.get.mock.calls[0][0]).toBe('https://example.test/api/ok');
    expect(mockedHttps.get.mock.calls[0][1]).toEqual({
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json',
      },
    });
  });

  it('httpGetJson rejects on non-2xx responses', async () => {
    const { res, emitBody } = makeMockResponse(500, 'nope');
    mockedHttps.get.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
      callback(res);
      process.nextTick(emitBody);
      return { on: jest.fn() } as unknown;
      }
    );

    await expect(
      httpGetJson('https://example.test/api/fail', 'token-123')
    ).rejects.toThrow('HTTP 500 from Heartland API: nope');
  });

  it('httpGetJson rejects when no response is provided', async () => {
    mockedHttps.get.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter | undefined) => void
      ) => {
        callback(undefined);
        return { on: jest.fn() } as unknown;
      }
    );

    await expect(
      httpGetJson('https://example.test/api/empty', 'token-123')
    ).rejects.toThrow('No response from Heartland API');
  });

  it('httpGetJson rejects when JSON parsing fails', async () => {
    const { res, emitBody } = makeMockResponse(200, '{not-json}');
    mockedHttps.get.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        process.nextTick(emitBody);
        return { on: jest.fn() } as unknown;
      }
    );

    await expect(
      httpGetJson('https://example.test/api/bad-json', 'token-123')
    ).rejects.toBeInstanceOf(Error);
  });

  it('httpGetJson rejects on request error event', async () => {
    mockedHttps.get.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        _callback: (res: EventEmitter) => void
      ) => {
        return {
          on: (event: string, cb: (err: Error) => void) => {
            if (event === 'error') {
              process.nextTick(() => cb(new Error('boom')));
            }
          },
        } as unknown;
      }
    );

    await expect(
      httpGetJson('https://example.test/api/error', 'token-123')
    ).rejects.toThrow('boom');
  });

  it('httpPutJson sends payload and resolves on success', async () => {
    const { res, emitBody } = makeMockResponse(200, JSON.stringify({ ok: true }));

    let writtenPayload = '';
    mockedHttps.request.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        return {
          on: jest.fn(),
          write: (payload: string) => {
            writtenPayload += payload;
          },
          end: () => {
            process.nextTick(emitBody);
          },
        } as unknown;
      }
    );

    const result = await httpPutJson<{ ok: boolean }>(
      'https://example.test/api/items/1',
      'token-123',
      { name: 'Widget' }
    );

    expect(result).toEqual({ ok: true });
    expect(mockedHttps.request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writtenPayload)).toEqual({ name: 'Widget' });
  });

  it('httpPutJson rejects on non-2xx responses', async () => {
    const { res, emitBody } = makeMockResponse(500, 'nope');
    mockedHttps.request.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        return {
          on: jest.fn(),
          write: () => {},
          end: () => {
            process.nextTick(emitBody);
          },
        } as unknown;
      }
    );

    await expect(
      httpPutJson('https://example.test/api/items/1', 'token-123', {})
    ).rejects.toThrow('HTTP 500 from Heartland API: nope');
  });

  it('httpPutJson rejects when no response is provided', async () => {
    mockedHttps.request.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter | undefined) => void
      ) => {
        callback(undefined);
        return { on: jest.fn(), write: () => {}, end: () => {} } as unknown;
      }
    );

    await expect(
      httpPutJson('https://example.test/api/items/1', 'token-123', {})
    ).rejects.toThrow('No response from Heartland API');
  });

  it('httpPutJson rejects when JSON parsing fails', async () => {
    const { res, emitBody } = makeMockResponse(200, '{not-json}');
    mockedHttps.request.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        return {
          on: jest.fn(),
          write: () => {},
          end: () => {
            process.nextTick(emitBody);
          },
        } as unknown;
      }
    );

    await expect(
      httpPutJson('https://example.test/api/items/1', 'token-123', {})
    ).rejects.toBeInstanceOf(Error);
  });

  it('httpPutJson rejects on request error event', async () => {
    mockedHttps.request.mockImplementation(
      (_url: string, _options: Record<string, unknown>, _callback: () => void) => {
        return {
          on: (event: string, cb: (err: Error) => void) => {
            if (event === 'error') {
              process.nextTick(() => cb(new Error('put boom')));
            }
          },
          write: () => {},
          end: () => {},
        } as unknown;
      }
    );

    await expect(
      httpPutJson('https://example.test/api/items/1', 'token-123', {})
    ).rejects.toThrow('put boom');
  });

  it('httpPostJson resolves on success', async () => {
    const { res, emitBody } = makeMockResponse(201, JSON.stringify({ ok: true }));
    mockedHttps.request.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        return {
          on: jest.fn(),
          write: () => {},
          end: () => {
            process.nextTick(emitBody);
          },
        } as unknown;
      }
    );

    const result = await httpPostJson<{ ok: boolean }>(
      'https://example.test/api/items/1/images',
      'token-123',
      { source: 'url', url: 'https://img.test/1.jpg' }
    );

    expect(result).toEqual({ ok: true });
  });

  it('httpPostJson rejects on non-2xx responses', async () => {
    const { res, emitBody } = makeMockResponse(400, 'bad');
    mockedHttps.request.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        return {
          on: jest.fn(),
          write: () => {},
          end: () => {
            process.nextTick(emitBody);
          },
        } as unknown;
      }
    );

    await expect(
      httpPostJson('https://example.test/api/items/1/images', 'token-123', {
        source: 'url',
        url: 'https://img.test/1.jpg',
      })
    ).rejects.toThrow('HTTP 400 from Heartland API: bad');
  });

  it('httpPostJson rejects when JSON parsing fails', async () => {
    const { res, emitBody } = makeMockResponse(200, '{not-json}');
    mockedHttps.request.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        return {
          on: jest.fn(),
          write: () => {},
          end: () => {
            process.nextTick(emitBody);
          },
        } as unknown;
      }
    );

    await expect(
      httpPostJson('https://example.test/api/items/1/images', 'token-123', {
        source: 'url',
        url: 'https://img.test/1.jpg',
      })
    ).rejects.toBeInstanceOf(Error);
  });

  it('httpPostJson rejects on request error event', async () => {
    mockedHttps.request.mockImplementation(
      (_url: string, _options: Record<string, unknown>, _callback: () => void) => {
        return {
          on: (event: string, cb: (err: Error) => void) => {
            if (event === 'error') {
              process.nextTick(() => cb(new Error('post boom')));
            }
          },
          write: () => {},
          end: () => {},
        } as unknown;
      }
    );

    await expect(
      httpPostJson('https://example.test/api/items/1/images', 'token-123', {
        source: 'url',
        url: 'https://img.test/1.jpg',
      })
    ).rejects.toThrow('post boom');
  });

  it('httpGetBrickLinkJson rejects when no response is provided', async () => {
    mockedHttps.get.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter | undefined) => void
      ) => {
        callback(undefined);
        return { on: jest.fn() } as unknown;
      }
    );

    await expect(
      httpGetBrickLinkJson('https://api.bricklink.test/items/SET/1', 'OAuth test')
    ).rejects.toThrow('No response from BrickLink API');
  });

  it('DefaultHeartlandApiClient builds ticket lines URL', async () => {
    const { res, emitBody } = makeMockResponse(
      200,
      JSON.stringify({ total: 0, pages: 1, results: [] })
    );
    mockedHttps.get.mockImplementation(
      (
        url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        process.nextTick(emitBody);
        return { on: jest.fn() } as unknown;
      }
    );

    const client = new DefaultHeartlandApiClient(
      'https://heartland.example',
      'token-abc'
    );

    await client.getTicketLines(999);

    const calledUrl = mockedHttps.get.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      'https://heartland.example/api/sales/tickets/999/lines?per_page=500'
    );
  });

  it('DefaultHeartlandApiClient builds inventory values URL', async () => {
    const { res, emitBody } = makeMockResponse(
      200,
      JSON.stringify({ total: 0, pages: 1, results: [] })
    );
    mockedHttps.get.mockImplementation(
      (
        url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
      callback(res);
      process.nextTick(emitBody);
      return { on: jest.fn() } as unknown;
      }
    );

    const client = new DefaultHeartlandApiClient(
      'https://heartland.example',
      'token-abc'
    );

    await client.getInventoryValues(12345);

    const calledUrl = mockedHttps.get.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      'https://heartland.example/api/inventory/values?group[]=item_id&group[]=location_id&item_id=12345&exclude_empty_locations=true&per_page=50'
    );
  });

  it('DefaultHeartlandApiClient runReport builds reporting URL with query params', async () => {
    const { res, emitBody } = makeMockResponse(
      200,
      JSON.stringify({ total: 0, pages: 1, results: [] })
    );
    mockedHttps.get.mockImplementation(
      (
        url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        process.nextTick(emitBody);
        return { on: jest.fn() } as unknown;
      }
    );

    const client = new DefaultHeartlandApiClient(
      'https://heartland.example',
      'token-abc'
    );

    await client.runReport('analyzer', {
      'metrics[]': ['sum(total)', 'sum(cost)'],
      'group[]': 'category',
      per_page: 25,
    });

    const calledUrl = mockedHttps.get.mock.calls[0][0] as string;
    const parsed = new URL(calledUrl);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://heartland.example/api/reporting/analyzer'
    );
    expect(parsed.searchParams.getAll('metrics[]')).toEqual([
      'sum(total)',
      'sum(cost)',
    ]);
    expect(parsed.searchParams.get('group[]')).toBe('category');
    expect(parsed.searchParams.get('per_page')).toBe('25');
    expect(parsed.searchParams.get('request_client_uuid')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('DefaultGroupMeClient posts and resolves on success', async () => {
    const { res, emitBody } = makeMockResponse(202, '');

    let writtenPayload = '';
    mockedHttps.request.mockImplementation(
      (
        url: string,
        options: { method?: string; headers?: Record<string, string> },
        callback: (res: EventEmitter) => void
      ) => {
      callback(res);
      return {
        on: jest.fn(),
        write: (payload: string) => {
          writtenPayload += payload;
        },
        end: () => {
          process.nextTick(emitBody);
        },
      } as unknown;
      }
    );

    const client = new DefaultGroupMeClient('bot-123');

    await client.sendMessage('Hello team');

    expect(mockedHttps.request).toHaveBeenCalledTimes(1);
    expect(mockedHttps.request.mock.calls[0][0]).toBe(
      'https://api.groupme.com/v3/bots/post'
    );
    expect(mockedHttps.request.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(writtenPayload).toString(),
      },
    });
    expect(JSON.parse(writtenPayload)).toEqual({
      bot_id: 'bot-123',
      text: 'Hello team',
    });
  });

  it('DefaultGroupMeClient rejects on non-2xx responses', async () => {
    const { res, emitBody } = makeMockResponse(400, 'bad');

    mockedHttps.request.mockImplementation(
      (
        _url: string,
        _options: { method?: string; headers?: Record<string, string> },
        callback: (res: EventEmitter) => void
      ) => {
      callback(res);
      return {
        on: jest.fn(),
        write: () => {},
        end: () => {
          process.nextTick(emitBody);
        },
      } as unknown;
      }
    );

    const client = new DefaultGroupMeClient('bot-123');

    await expect(client.sendMessage('Hello team')).rejects.toThrow(
      'GroupMe HTTP 400: bad'
    );
  });

  it('DefaultGroupMeClient rejects on request error', async () => {
    mockedHttps.request.mockImplementation((_url, _options, _callback) => {
      return {
        on: (event: string, cb: (err: Error) => void) => {
          if (event === 'error') {
            process.nextTick(() => cb(new Error('socket fail')));
          }
        },
        write: () => {},
        end: () => {},
      } as unknown;
    });

    const client = new DefaultGroupMeClient('bot-123');

    await expect(client.sendMessage('Hello team')).rejects.toThrow(
      'socket fail'
    );
  });

  it('DefaultHeartlandApiClient updateInventoryItemImage posts image payload', async () => {
    const { res, emitBody } = makeMockResponse(
      200,
      JSON.stringify({ ok: true })
    );

    let writtenPayload = '';
    mockedHttps.request.mockImplementation(
      (
        url: string,
        options: { method?: string; headers?: Record<string, string> },
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        return {
          on: jest.fn(),
          write: (payload: string) => {
            writtenPayload += payload;
          },
          end: () => {
            process.nextTick(emitBody);
          },
        } as unknown;
      }
    );

    const client = new DefaultHeartlandApiClient(
      'https://heartland.example',
      'token-abc'
    );

    await client.updateInventoryItemImage(123, 'https://images.example/item.jpg');

    expect(mockedHttps.request).toHaveBeenCalledTimes(1);
    expect(mockedHttps.request.mock.calls[0][0]).toBe(
      'https://heartland.example/api/items/123/images'
    );
    expect(mockedHttps.request.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-abc',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(writtenPayload).toString(),
      },
    });
    expect(JSON.parse(writtenPayload)).toEqual({
      source: 'url',
      url: 'https://images.example/item.jpg',
    });
  });

  it('DefaultBrickLinkClient getItem returns item data on success', async () => {
    const body = JSON.stringify({
      meta: { code: 200 },
      data: {
        item: { no: '31119-1', type: 'SET', name: 'Ferris Wheel' },
        image_url: 'https://img.example/31119.jpg',
      },
    });
    const { res, emitBody } = makeMockResponse(200, body);

    mockedHttps.get.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        process.nextTick(emitBody);
        return { on: jest.fn() } as unknown;
      }
    );

    const client = new DefaultBrickLinkClient(
      'ck-123',
      'cs-456',
      'tv-789',
      'ts-abc'
    );

    const item = await client.getItem('SET', '31119-1');

    expect(item).toEqual({
      item: { no: '31119-1', type: 'SET', name: 'Ferris Wheel' },
      image_url: 'https://img.example/31119.jpg',
    });

    expect(mockedHttps.get).toHaveBeenCalledTimes(1);
    expect(mockedHttps.get.mock.calls[0][0]).toBe(
      'https://api.bricklink.com/api/store/v1/items/SET/31119-1'
    );

    const options = mockedHttps.get.mock.calls[0][1] as {
      headers?: Record<string, string>;
    };
    expect(options.headers?.Authorization).toContain('OAuth ');
    expect(options.headers?.Authorization).toContain('oauth_consumer_key="ck-123"');
    expect(options.headers?.Authorization).toContain('oauth_token="tv-789"');
    expect(options.headers?.Authorization).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(options.headers?.Authorization).toContain('oauth_version="1.0"');
    expect(options.headers?.Authorization).toContain('oauth_signature=');
  });

  it('DefaultBrickLinkClient getItem rejects when meta.code is not 200', async () => {
    const body = JSON.stringify({
      meta: { code: 401, message: 'Unauthorized' },
      data: {},
    });
    const { res, emitBody } = makeMockResponse(200, body);

    mockedHttps.get.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        process.nextTick(emitBody);
        return { on: jest.fn() } as unknown;
      }
    );

    const client = new DefaultBrickLinkClient(
      'ck-123',
      'cs-456',
      'tv-789',
      'ts-abc'
    );

    await expect(client.getItem('SET', '31119-1')).rejects.toThrow(
      'BrickLink API error: meta.code=401'
    );
  });

  it('DefaultBrickLinkClient getItem rejects on non-2xx HTTP responses', async () => {
    const { res, emitBody } = makeMockResponse(500, 'server down');
    mockedHttps.get.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        process.nextTick(emitBody);
        return { on: jest.fn() } as unknown;
      }
    );

    const client = new DefaultBrickLinkClient(
      'ck-123',
      'cs-456',
      'tv-789',
      'ts-abc'
    );

    await expect(client.getItem('SET', '31119-1')).rejects.toThrow(
      'HTTP 500 from BrickLink API: server down'
    );
  });

  it('DefaultToyhouseMasterDataClient loads items from S3 and returns matches', async () => {
    const csv = [
      'Item #,Bricklink Id,Image 1',
      '31119,31119-1,https://img.example/31119.jpg',
      '',
    ].join('\n');

    mockS3Send.mockResolvedValue({
      Body: Readable.from([csv]),
    });

    const client = new DefaultToyhouseMasterDataClient(
      's3://toyhouse-bucket/exports/toyhouse_master_data.csv',
      { send: mockS3Send } as unknown as import('@aws-sdk/client-s3').S3Client
    );

    const item = await client.getItemByNumber('31119');

    expect(mockS3Send).toHaveBeenCalledTimes(1);
    expect(mockS3Send.mock.calls[0][0]).toEqual({
      Bucket: 'toyhouse-bucket',
      Key: 'exports/toyhouse_master_data.csv',
    });
    expect(item).toEqual({
      itemNumber: '31119',
      bricklinkId: '31119-1',
      raw: {
        'Item #': '31119',
        'Bricklink Id': '31119-1',
        'Image 1': 'https://img.example/31119.jpg',
      },
    });
  });

  it('DefaultHeartlandApiClient getPurchaseOrderLines builds correct URL', async () => {
    const { res, emitBody } = makeMockResponse(
      200,
      JSON.stringify({ total: 1, pages: 1, results: [{ id: 1, item_id: 10, qty: 3, unit_cost: 5.0 }] })
    );
    mockedHttps.get.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        process.nextTick(emitBody);
        return { on: jest.fn() } as unknown;
      }
    );

    const client = new DefaultHeartlandApiClient('https://heartland.example', 'token-abc');
    const result = await client.getPurchaseOrderLines(42);

    expect(mockedHttps.get.mock.calls[0][0]).toBe(
      'https://heartland.example/api/purchasing/orders/42/lines?per_page=500'
    );
    expect(result).toEqual({ total: 1, pages: 1, results: [{ id: 1, item_id: 10, qty: 3, unit_cost: 5.0 }] });
  });

  it('DefaultHeartlandApiClient createReceipt posts to correct URL with payload', async () => {
    const { res, emitBody } = makeMockResponse(201, '');
    let writtenPayload = '';
    mockedHttps.request.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        return {
          on: jest.fn(),
          write: (payload: string) => { writtenPayload += payload; },
          end: () => { process.nextTick(emitBody); },
        } as unknown;
      }
    );

    const client = new DefaultHeartlandApiClient('https://heartland.example', 'token-abc');
    await client.createReceipt(5, 2);

    expect(mockedHttps.request.mock.calls[0][0]).toBe(
      'https://heartland.example/api/purchasing/receipts'
    );
    expect(JSON.parse(writtenPayload)).toEqual({ order_id: 5, receive_at_location_id: 2 });
  });

  it('DefaultHeartlandApiClient getReceiptByOrderId fetches pending receipt by order_id', async () => {
    const receiptListBody = JSON.stringify({
      total: 1,
      pages: 1,
      results: [{ id: 99, order_id: 5, status: 'pending' }],
    });
    const { res, emitBody } = makeMockResponse(200, receiptListBody);
    mockedHttps.get.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        process.nextTick(emitBody);
        return { on: jest.fn() } as unknown;
      }
    );

    const client = new DefaultHeartlandApiClient('https://heartland.example', 'token-abc');
    const result = await client.getReceiptByOrderId(5);

    expect(mockedHttps.get.mock.calls[0][0]).toBe(
      'https://heartland.example/api/purchasing/receipts?order_id=5&status=pending'
    );
    expect(result).toEqual({ id: 99, order_id: 5, status: 'pending' });
  });

  it('DefaultHeartlandApiClient addReceiptLine posts to correct URL with payload', async () => {
    const { res, emitBody } = makeMockResponse(201, JSON.stringify({ id: 1 }));
    let writtenPayload = '';
    mockedHttps.request.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        return {
          on: jest.fn(),
          write: (payload: string) => { writtenPayload += payload; },
          end: () => { process.nextTick(emitBody); },
        } as unknown;
      }
    );

    const client = new DefaultHeartlandApiClient('https://heartland.example', 'token-abc');
    await client.addReceiptLine(99, { item_id: 10, qty: 3, unit_cost: 5.0 });

    expect(mockedHttps.request.mock.calls[0][0]).toBe(
      'https://heartland.example/api/purchasing/receipts/99/lines'
    );
    expect(JSON.parse(writtenPayload)).toEqual({ item_id: 10, qty: 3, unit_cost: 5.0 });
  });

  it('DefaultHeartlandApiClient createReceiptFromPurchaseOrder fetches PO lines, creates receipt, and adds a line per item', async () => {
    const poLinesBody = JSON.stringify({
      total: 2,
      pages: 1,
      results: [
        { id: 1, item_id: 10, qty: 3, unit_cost: 5.0 },
        { id: 2, item_id: 20, qty: 1, unit_cost: 12.5 },
      ],
    });
    const receiptListBody = JSON.stringify({
      total: 1,
      pages: 1,
      results: [{ id: 99, order_id: 5, status: 'pending' }],
    });
    const lineBody = JSON.stringify({ id: 1 });

    // GET calls: first PO lines, then receipt lookup
    const getBodies = [poLinesBody, receiptListBody];
    let getCallIndex = 0;
    const capturedGetUrls: string[] = [];
    mockedHttps.get.mockImplementation(
      (
        url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        capturedGetUrls.push(url as string);
        const body = getBodies[getCallIndex++];
        const { res: getRes, emitBody: emitGetBody } = makeMockResponse(200, body);
        callback(getRes);
        process.nextTick(emitGetBody);
        return { on: jest.fn() } as unknown;
      }
    );

    // POST calls: createReceipt (empty response), then two addReceiptLine
    const postBodies = ['', lineBody, lineBody];
    let postCallIndex = 0;
    const capturedPostUrls: string[] = [];
    const capturedPayloads: string[] = [];
    mockedHttps.request.mockImplementation(
      (
        url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        capturedPostUrls.push(url as string);
        const body = postBodies[postCallIndex++];
        const { res: postRes, emitBody: emitPostBody } = makeMockResponse(201, body);
        let payload = '';
        callback(postRes);
        return {
          on: jest.fn(),
          write: (data: string) => { payload += data; },
          end: () => {
            capturedPayloads.push(payload);
            process.nextTick(emitPostBody);
          },
        } as unknown;
      }
    );

    const client = new DefaultHeartlandApiClient('https://heartland.example', 'token-abc');
    const result = await client.createReceiptFromPurchaseOrder(5, 2);

    expect(capturedGetUrls[0]).toBe('https://heartland.example/api/purchasing/orders/5/lines?per_page=500');
    expect(capturedGetUrls[1]).toBe('https://heartland.example/api/purchasing/receipts?order_id=5&status=pending');
    expect(capturedPostUrls[0]).toBe('https://heartland.example/api/purchasing/receipts');
    expect(JSON.parse(capturedPayloads[0])).toEqual({ order_id: 5, receive_at_location_id: 2 });
    expect(capturedPostUrls[1]).toBe('https://heartland.example/api/purchasing/receipts/99/lines');
    expect(JSON.parse(capturedPayloads[1])).toEqual({ item_id: 10, qty: 3, receipt_id: 99, unit_cost: 5.0 });
    expect(capturedPostUrls[2]).toBe('https://heartland.example/api/purchasing/receipts/99/lines');
    expect(JSON.parse(capturedPayloads[2])).toEqual({ item_id: 20, qty: 1, receipt_id: 99, unit_cost: 12.5 });
    expect(result).toEqual({ id: 99, order_id: 5, status: 'pending' });
  });

  it('DefaultHeartlandApiClient createReceiptFromPurchaseOrder skips lines without item_id', async () => {
    const poLinesBody = JSON.stringify({
      total: 2,
      pages: 1,
      results: [
        { id: 1, item_id: 10, qty: 2, unit_cost: 8.0 },
        { id: 2, qty: 1, unit_cost: 3.0 }, // no item_id
      ],
    });
    const receiptListBody = JSON.stringify({
      total: 1,
      pages: 1,
      results: [{ id: 55, order_id: 7, status: 'pending' }],
    });

    const getBodies = [poLinesBody, receiptListBody];
    let getCallIndex = 0;
    mockedHttps.get.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        const body = getBodies[getCallIndex++];
        const { res: getRes, emitBody: emitGetBody } = makeMockResponse(200, body);
        callback(getRes);
        process.nextTick(emitGetBody);
        return { on: jest.fn() } as unknown;
      }
    );

    let postCallIndex = 0;
    const postBodies = ['', JSON.stringify({ id: 1 })];
    mockedHttps.request.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        const body = postBodies[postCallIndex++];
        const { res: postRes, emitBody: emitPostBody } = makeMockResponse(201, body);
        callback(postRes);
        return {
          on: jest.fn(),
          write: () => {},
          end: () => { process.nextTick(emitPostBody); },
        } as unknown;
      }
    );

    const client = new DefaultHeartlandApiClient('https://heartland.example', 'token-abc');
    await client.createReceiptFromPurchaseOrder(7, 3);

    // Only 1 addReceiptLine call (the line without item_id is skipped), plus 1 createReceipt = 2 total POSTs
    expect(mockedHttps.request).toHaveBeenCalledTimes(2);
  });

  it('DefaultHeartlandApiClient completeReceipt PUTs status accepted', async () => {
    const { res, emitBody } = makeMockResponse(
      200,
      JSON.stringify({ id: 99, status: 'accepted' })
    );
    let writtenPayload = '';
    mockedHttps.request.mockImplementation(
      (
        _url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        return {
          on: jest.fn(),
          write: (payload: string) => { writtenPayload += payload; },
          end: () => { process.nextTick(emitBody); },
        } as unknown;
      }
    );

    const client = new DefaultHeartlandApiClient('https://heartland.example', 'token-abc');
    const result = await client.completeReceipt(99);

    expect(mockedHttps.request.mock.calls[0][0]).toBe(
      'https://heartland.example/api/purchasing/receipts/99'
    );
    expect(mockedHttps.request.mock.calls[0][1]).toMatchObject({ method: 'PUT' });
    expect(JSON.parse(writtenPayload)).toEqual({ status: 'accepted' });
    expect(result).toEqual({ id: 99, status: 'accepted' });
  });

  it('DefaultHeartlandApiClient listPurchaseOrders builds correct URL with status and page', async () => {
    const { res, emitBody } = makeMockResponse(
      200,
      JSON.stringify({ total: 2, pages: 1, results: [{ id: 1 }, { id: 2 }] })
    );
    mockedHttps.get.mockImplementation(
      (
        url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        process.nextTick(emitBody);
        return { on: jest.fn() } as unknown;
      }
    );

    const client = new DefaultHeartlandApiClient(
      'https://heartland.example',
      'token-abc'
    );

    const result = await client.listPurchaseOrders('open', 2);

    const calledUrl = mockedHttps.get.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      'https://heartland.example/api/purchasing/orders?status=open&page=2'
    );
    expect(result).toEqual({ total: 2, pages: 1, results: [{ id: 1 }, { id: 2 }] });
  });

  it('DefaultHeartlandApiClient listPurchaseOrders defaults to page 1', async () => {
    const { res, emitBody } = makeMockResponse(
      200,
      JSON.stringify({ total: 0, pages: 0, results: [] })
    );
    mockedHttps.get.mockImplementation(
      (
        url: string,
        _options: Record<string, unknown>,
        callback: (res: EventEmitter) => void
      ) => {
        callback(res);
        process.nextTick(emitBody);
        return { on: jest.fn() } as unknown;
      }
    );

    const client = new DefaultHeartlandApiClient(
      'https://heartland.example',
      'token-abc'
    );

    await client.listPurchaseOrders('pending');

    const calledUrl = mockedHttps.get.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      'https://heartland.example/api/purchasing/orders?status=pending&page=1'
    );
  });

  it('DefaultToyhouseMasterDataClient returns null for missing item numbers', async () => {
    const csv = ['Item #,Bricklink Id', ''].join('\n');
    mockS3Send.mockResolvedValue({ Body: Readable.from([csv]) });

    const client = new DefaultToyhouseMasterDataClient(
      's3://toyhouse-bucket/exports/',
      { send: mockS3Send } as unknown as import('@aws-sdk/client-s3').S3Client
    );

    const item = await client.getItemByNumber('99999');

    expect(item).toBeNull();
    expect(mockS3Send).toHaveBeenCalledWith({
      Bucket: 'toyhouse-bucket',
      Key: 'exports/toyhouse_master_data.csv',
    });
  });
});
