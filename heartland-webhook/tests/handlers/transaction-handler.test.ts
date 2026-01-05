import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

const mockSecretsSend = jest.fn();

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSecretsSend })),
  GetSecretValueCommand: jest.fn((input) => input),
}));

const baseEvent: Partial<APIGatewayProxyEventV2> = {
  headers: {},
  requestContext: {
    http: {
      method: 'POST',
      path: '/transaction',
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
  const module = await import('../../src/handlers/transaction');
  return module.handler;
}

describe('transaction webhook handler', () => {
  beforeEach(() => {
    mockSecretsSend.mockReset();
    delete process.env.HEARTLAND_API_BASE_URL;
    delete process.env.OPERATIONAL_SECRET_ARN;
    delete process.env.GROUPME_BOT_ID;
  });

  it('returns ok with check false when body is missing', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const handler = await loadHandler();
    const result = asStructuredResult(
      await handler({
      ...(baseEvent as APIGatewayProxyEventV2),
      body: undefined,
      })
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toMatchObject({
      status: 'ok',
      transactionKind: 'other',
      check: false,
      checks: [],
    });
    expect(warnSpy).toHaveBeenCalledWith('Received webhook with no body');

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('returns ok with check false when body is invalid JSON', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const handler = await loadHandler();
    const result = asStructuredResult(
      await handler({
      ...(baseEvent as APIGatewayProxyEventV2),
      body: '{not-json}',
      })
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toMatchObject({
      status: 'ok',
      transactionKind: 'other',
      check: false,
      checks: [],
    });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('returns ok with check true when all strategies pass', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const handler = await loadHandler();
    const body = JSON.stringify({
      id: 1001,
      type: 'Ticket',
      total: 10,
      balance: 0,
      status: 'Complete',
      'completed?': true,
      completed_at: '2025-01-01T00:00:00Z',
    });

    const result = asStructuredResult(
      await handler({
      ...(baseEvent as APIGatewayProxyEventV2),
      body,
      })
    );

    const parsed = JSON.parse(result.body as string);
    expect(result.statusCode).toBe(200);
    expect(parsed.status).toBe('ok');
    expect(parsed.transactionKind).toBe('sale');
    expect(parsed.check).toBe(true);
    expect(parsed.completionStrategy).toBe('type-and-status');
    expect(parsed.checks).toHaveLength(3);

    logSpy.mockRestore();
  });

  it('returns ok with check false when balance strategy fails', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const handler = await loadHandler();
    const body = JSON.stringify({
      id: 1002,
      type: 'Other',
      total: -5,
      balance: 5,
      status: 'Complete',
      'completed?': true,
    });

    const result = asStructuredResult(
      await handler({
      ...(baseEvent as APIGatewayProxyEventV2),
      body,
      })
    );

    const parsed = JSON.parse(result.body as string);
    expect(result.statusCode).toBe(200);
    expect(parsed.transactionKind).toBe('return');
    expect(parsed.check).toBe(false);
    expect(parsed.checks).toHaveLength(3);

    logSpy.mockRestore();
  });

  it('logs when inventory strategies are skipped due to missing env', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = await loadHandler();

    const body = JSON.stringify({
      id: 4001,
      type: 'Ticket',
      total: 10,
      balance: 0,
    });

    const result = asStructuredResult(
      await handler({
        ...(baseEvent as APIGatewayProxyEventV2),
        body,
      })
    );

    const parsed = JSON.parse(result.body as string);
    expect(parsed.checks).toHaveLength(3);
    expect(warnSpy).toHaveBeenCalledWith(
      '[inventory-non-negative] Not added: missing HEARTLAND_API_BASE_URL or OPERATIONAL_SECRET_ARN'
    );

    warnSpy.mockRestore();
  });

  it('adds inventory strategies when secrets are available', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env.HEARTLAND_API_BASE_URL = 'https://example.heartland.test';
    process.env.OPERATIONAL_SECRET_ARN = 'arn:test:operational';
    delete process.env.GROUPME_BOT_ID;

    mockSecretsSend.mockResolvedValue({
      SecretString: JSON.stringify({ heartland: { token: 'token-123' } }),
    });

    const handler = await loadHandler();
    const body = JSON.stringify({
      id: 2001,
      type: 'Other',
      total: 0,
    });

    const result = asStructuredResult(
      await handler({
        ...(baseEvent as APIGatewayProxyEventV2),
        body,
      })
    );

    const parsed = JSON.parse(result.body as string);
    expect(result.statusCode).toBe(200);
    expect(parsed.checks.length).toBeGreaterThan(3);
    expect(warnSpy).toHaveBeenCalledWith(
      '[inventory-non-negative] GROUPME_BOT_ID not set; inventory strategy will not send GroupMe alerts'
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('falls back to base strategies when secret is invalid', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.HEARTLAND_API_BASE_URL = 'https://example.heartland.test';
    process.env.OPERATIONAL_SECRET_ARN = 'arn:test:operational';

    mockSecretsSend.mockResolvedValue({
      SecretString: JSON.stringify({ heartland: {} }),
    });

    const handler = await loadHandler();
    const body = JSON.stringify({
      id: 3001,
      type: 'Ticket',
      total: 5,
      balance: 0,
      status: 'Complete',
    });

    const result = asStructuredResult(
      await handler({
        ...(baseEvent as APIGatewayProxyEventV2),
        body,
      })
    );

    const parsed = JSON.parse(result.body as string);
    expect(parsed.checks).toHaveLength(3);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('falls back to base strategies when secret string is missing', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.HEARTLAND_API_BASE_URL = 'https://example.heartland.test';
    process.env.OPERATIONAL_SECRET_ARN = 'arn:test:operational';

    mockSecretsSend.mockResolvedValue({
      SecretString: undefined,
    });

    const handler = await loadHandler();
    const body = JSON.stringify({
      id: 5001,
      type: 'Ticket',
      total: 10,
      balance: 0,
    });

    const result = asStructuredResult(
      await handler({
        ...(baseEvent as APIGatewayProxyEventV2),
        body,
      })
    );

    const parsed = JSON.parse(result.body as string);
    expect(parsed.checks).toHaveLength(3);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
