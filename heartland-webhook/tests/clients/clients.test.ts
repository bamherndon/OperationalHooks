import { EventEmitter } from 'events';
import * as https from 'https';
import {
  DefaultGroupMeClient,
  DefaultHeartlandApiClient,
  buildHeartlandUrl,
  httpGetJson,
} from '../../src/clients';

jest.mock('https');

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
});
