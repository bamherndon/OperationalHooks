import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

const mockSecretsSend = jest.fn();
const mockHeartlandClient = {
  updateInventoryItemImage: jest.fn(),
  updateInventoryItem: jest.fn(),
};
const mockBricklinkClient = {
  getItem: jest.fn(),
};

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSecretsSend })),
  GetSecretValueCommand: jest.fn((input) => input),
}));

jest.mock('../../src/clients', () => ({
  DefaultHeartlandApiClient: jest.fn(() => mockHeartlandClient),
  DefaultBrickLinkClient: jest.fn(() => mockBricklinkClient),
}));

const baseEvent: Partial<APIGatewayProxyEventV2> = {
  headers: {},
  requestContext: {
    http: {
      method: 'POST',
      path: '/item',
      protocol: 'HTTP/1.1',
      sourceIp: '127.0.0.1',
      userAgent: 'jest',
    },
    timeEpoch: Date.now(),
  } as APIGatewayProxyEventV2['requestContext'],
};

function asStructuredResult(
  result: APIGatewayProxyResultV2
): APIGatewayProxyStructuredResultV2 {
  if (typeof result === 'string') {
    throw new Error('Expected structured result, received string');
  }
  return result;
}

async function loadHandler() {
  jest.resetModules();
  return (await import('../../src/handlers/item')).handler;
}

describe('item_created handler', () => {
  beforeEach(() => {
    mockSecretsSend.mockReset();
    mockHeartlandClient.updateInventoryItemImage.mockReset();
    mockHeartlandClient.updateInventoryItem.mockReset();
    mockBricklinkClient.getItem.mockReset();
    delete process.env.HEARTLAND_API_BASE_URL;
    delete process.env.OPERATIONAL_SECRET_ARN;
  });

  it('returns ok when body is missing', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = await loadHandler();

    const result = asStructuredResult(
      await handler({
      ...(baseEvent as APIGatewayProxyEventV2),
      body: undefined,
      })
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ status: 'ok' });
    expect(warnSpy).toHaveBeenCalledWith(
      'Received item_created webhook with no body'
    );

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('parses and logs a valid payload', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const handler = await loadHandler();

    const body = JSON.stringify({
      id: 109531,
      description: '31119 Ferris Wheel',
      cost: 21.67,
      price: 72,
      'allow_fractional_qty?': false,
      public_id: '31119-1',
      long_description: '31119 Ferris Wheel',
      'active?': true,
      created_at: '2026-01-04T20:24:15+00:00',
      updated_at: '2026-01-04T20:24:15+00:00',
      'track_inventory?': true,
      custom: {
        category: 'Creator',
        bam_category: 'Pre-Built Set',
        bricklink_id: '31119-1',
      },
    });

    const result = asStructuredResult(
      await handler({
      ...(baseEvent as APIGatewayProxyEventV2),
      body,
      })
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ status: 'ok' });
    expect(errorSpy).not.toHaveBeenCalled();

    const payloadLog = logSpy.mock.calls.find((call) =>
      String(call[0]).includes('Parsed Heartland item_created payload')
    );
    expect(payloadLog).toBeTruthy();

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('logs errors when payload is invalid JSON', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const handler = await loadHandler();

    const result = asStructuredResult(
      await handler({
      ...(baseEvent as APIGatewayProxyEventV2),
      body: '{not-json}',
      })
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ status: 'ok' });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('skips enrichment when secrets/env are missing', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = await loadHandler();

    const body = JSON.stringify({
      id: 1,
      custom: { bricklink_id: '31119-1' },
    });

    const result = asStructuredResult(
      await handler({
        ...(baseEvent as APIGatewayProxyEventV2),
        body,
      })
    );

    expect(result.statusCode).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      'Skipping item enrichment: missing HEARTLAND_API_BASE_URL or OPERATIONAL_SECRET_ARN'
    );
    expect(mockBricklinkClient.getItem).not.toHaveBeenCalled();
    expect(mockHeartlandClient.updateInventoryItem).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('skips enrichment when bricklinkId is missing', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.HEARTLAND_API_BASE_URL = 'https://example.heartland.test';
    process.env.OPERATIONAL_SECRET_ARN = 'arn:test:operational';
    const handler = await loadHandler();

    const body = JSON.stringify({ id: 1, custom: { category: 'Creator' } });

    const result = asStructuredResult(
      await handler({
        ...(baseEvent as APIGatewayProxyEventV2),
        body,
      })
    );

    expect(result.statusCode).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      'Skipping item enrichment: missing bricklinkId'
    );
    expect(mockBricklinkClient.getItem).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('skips enrichment when payload id is missing', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.HEARTLAND_API_BASE_URL = 'https://example.heartland.test';
    process.env.OPERATIONAL_SECRET_ARN = 'arn:test:operational';
    const handler = await loadHandler();

    const body = JSON.stringify({
      custom: { bricklink_id: '31119-1' },
    });

    const result = asStructuredResult(
      await handler({
        ...(baseEvent as APIGatewayProxyEventV2),
        body,
      })
    );

    expect(result.statusCode).toBe(200);
    expect(errorSpy).toHaveBeenCalled();
    expect(mockBricklinkClient.getItem).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('updates image and tags when BrickLink item has image_url', async () => {
    process.env.HEARTLAND_API_BASE_URL = 'https://example.heartland.test';
    process.env.OPERATIONAL_SECRET_ARN = 'arn:test:operational';
    const handler = await loadHandler();

    mockSecretsSend.mockResolvedValue({
      SecretString: JSON.stringify({
        heartland: { token: 'heartland-token' },
        bricklink: {
          consumerKey: 'ck',
          consumerSecret: 'cs',
          tokenValue: 'tv',
          tokenSecret: 'ts',
        },
      }),
    });
    mockBricklinkClient.getItem.mockResolvedValue({
      item: { no: '31119-1', type: 'SET' },
      image_url: 'https://img.example/31119.jpg',
    });

    const body = JSON.stringify({
      id: 109531,
      custom: {
        bricklink_id: '31119-1',
        bam_category: 'Pre-Built Set',
        category: 'Creator',
      },
    });

    const result = asStructuredResult(
      await handler({
        ...(baseEvent as APIGatewayProxyEventV2),
        body,
      })
    );

    expect(result.statusCode).toBe(200);
    expect(mockBricklinkClient.getItem).toHaveBeenCalledWith(
      'SET',
      '31119-1'
    );
    expect(mockHeartlandClient.updateInventoryItemImage).toHaveBeenCalledWith(
      109531,
      'https://img.example/31119.jpg'
    );
    expect(mockHeartlandClient.updateInventoryItem).toHaveBeenCalledWith(
      109531,
      { custom: { tags: 'add, Pre-Built Set, Creator' } }
    );
  });

  it('uses item.image_url when top-level image_url is missing', async () => {
    process.env.HEARTLAND_API_BASE_URL = 'https://example.heartland.test';
    process.env.OPERATIONAL_SECRET_ARN = 'arn:test:operational';
    const handler = await loadHandler();

    mockSecretsSend.mockResolvedValue({
      SecretString: JSON.stringify({
        heartland: { token: 'heartland-token' },
        bricklink: {
          consumerKey: 'ck',
          consumerSecret: 'cs',
          tokenValue: 'tv',
          tokenSecret: 'ts',
        },
      }),
    });
    mockBricklinkClient.getItem.mockResolvedValue({
      item: { no: '31119-1', type: 'SET', image_url: 'https://img.example/alt.jpg' },
    });

    const body = JSON.stringify({
      id: 109531,
      custom: {
        bricklink_id: '31119-1',
        bam_category: 'Pre-Built Set',
        category: 'Creator',
      },
    });

    const result = asStructuredResult(
      await handler({
        ...(baseEvent as APIGatewayProxyEventV2),
        body,
      })
    );

    expect(result.statusCode).toBe(200);
    expect(mockHeartlandClient.updateInventoryItemImage).toHaveBeenCalledWith(
      109531,
      'https://img.example/alt.jpg'
    );
  });

  it('skips image update when BrickLink item has no image_url', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.HEARTLAND_API_BASE_URL = 'https://example.heartland.test';
    process.env.OPERATIONAL_SECRET_ARN = 'arn:test:operational';
    const handler = await loadHandler();

    mockSecretsSend.mockResolvedValue({
      SecretString: JSON.stringify({
        heartland: { token: 'heartland-token' },
        bricklink: {
          consumerKey: 'ck',
          consumerSecret: 'cs',
          tokenValue: 'tv',
          tokenSecret: 'ts',
        },
      }),
    });
    mockBricklinkClient.getItem.mockResolvedValue({
      item: { no: '31119-1', type: 'SET' },
    });

    const body = JSON.stringify({
      id: 109531,
      custom: {
        bricklink_id: '31119-1',
        bam_category: 'Pre-Built Set',
        category: 'Creator',
      },
    });

    const result = asStructuredResult(
      await handler({
        ...(baseEvent as APIGatewayProxyEventV2),
        body,
      })
    );

    expect(result.statusCode).toBe(200);
    expect(mockHeartlandClient.updateInventoryItemImage).not.toHaveBeenCalled();
    expect(mockHeartlandClient.updateInventoryItem).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'BrickLink item did not include image_url; skipping image update'
    );

    warnSpy.mockRestore();
  });

  it('logs errors when secrets are missing fields', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.HEARTLAND_API_BASE_URL = 'https://example.heartland.test';
    process.env.OPERATIONAL_SECRET_ARN = 'arn:test:operational';
    const handler = await loadHandler();

    mockSecretsSend.mockResolvedValue({
      SecretString: JSON.stringify({
        heartland: { token: 'heartland-token' },
        bricklink: {},
      }),
    });

    const body = JSON.stringify({
      id: 109531,
      custom: { bricklink_id: '31119-1' },
    });

    const result = asStructuredResult(
      await handler({
        ...(baseEvent as APIGatewayProxyEventV2),
        body,
      })
    );

    expect(result.statusCode).toBe(200);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
