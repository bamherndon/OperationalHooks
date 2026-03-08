import { ScheduledEvent } from 'aws-lambda';

const mockSecretsSend = jest.fn();
const mockListPurchaseOrders = jest.fn();
const mockCreateReceiptFromPurchaseOrder = jest.fn();
const mockCompleteReceipt = jest.fn();
const mockGroupMeSendMessage = jest.fn();

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSecretsSend })),
  GetSecretValueCommand: jest.fn((input) => input),
}));

jest.mock('../../src/clients', () => ({
  DefaultHeartlandApiClient: jest.fn(() => ({
    listPurchaseOrders: (...args: unknown[]) => mockListPurchaseOrders(...args),
    createReceiptFromPurchaseOrder: (...args: unknown[]) =>
      mockCreateReceiptFromPurchaseOrder(...args),
    completeReceipt: (...args: unknown[]) => mockCompleteReceipt(...args),
  })),
  DefaultGroupMeClient: jest.fn(() => ({
    sendMessage: (...args: unknown[]) => mockGroupMeSendMessage(...args),
  })),
}));

const baseEvent: ScheduledEvent = {
  version: '0',
  id: 'evt-456',
  'detail-type': 'Scheduled Event',
  source: 'aws.events',
  account: '123456789012',
  time: '2026-03-02T03:00:00Z',
  region: 'us-east-1',
  resources: [],
  detail: {},
};

async function loadHandler() {
  jest.resetModules();
  return (await import('../../src/handlers/receive-open-orders')).handler;
}

describe('receive-open-orders handler', () => {
  beforeEach(() => {
    mockSecretsSend.mockReset();
    mockListPurchaseOrders.mockReset();
    mockCreateReceiptFromPurchaseOrder.mockReset();
    mockCompleteReceipt.mockReset();
    mockGroupMeSendMessage.mockReset();

    process.env.HEARTLAND_API_BASE_URL = 'https://example.heartland.test';
    process.env.OPERATIONAL_SECRET_ARN = 'OperationalSecrets';
    process.env.GROUPME_BOT_ID = 'bot-123';

    mockSecretsSend.mockResolvedValue({
      SecretString: JSON.stringify({ heartland: { token: 'token-abc' } }),
    });
  });

  it('processes all open POs on a single page', async () => {
    mockListPurchaseOrders.mockResolvedValueOnce({
      total: 2,
      pages: 1,
      results: [
        { id: 1, receive_at_location_id: 10 },
        { id: 2, receive_at_location_id: 10 },
      ],
    });
    mockCreateReceiptFromPurchaseOrder
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 });
    mockCompleteReceipt.mockResolvedValue({ id: 101, status: 'accepted' });

    const handler = await loadHandler();
    await handler(baseEvent);

    expect(mockListPurchaseOrders).toHaveBeenCalledTimes(1);
    expect(mockListPurchaseOrders).toHaveBeenCalledWith('open', 1);

    expect(mockCreateReceiptFromPurchaseOrder).toHaveBeenCalledTimes(2);
    expect(mockCreateReceiptFromPurchaseOrder).toHaveBeenCalledWith(1, 10);
    expect(mockCreateReceiptFromPurchaseOrder).toHaveBeenCalledWith(2, 10);

    expect(mockCompleteReceipt).toHaveBeenCalledTimes(2);
    expect(mockCompleteReceipt).toHaveBeenCalledWith(101);
    expect(mockCompleteReceipt).toHaveBeenCalledWith(102);

    expect(mockGroupMeSendMessage).not.toHaveBeenCalled();
  });

  it('pages through multiple pages of open POs', async () => {
    mockListPurchaseOrders
      .mockResolvedValueOnce({
        total: 2,
        pages: 2,
        results: [{ id: 1, receive_at_location_id: 10 }],
      })
      .mockResolvedValueOnce({
        total: 2,
        pages: 2,
        results: [{ id: 2, receive_at_location_id: 20 }],
      });
    mockCreateReceiptFromPurchaseOrder
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 });
    mockCompleteReceipt.mockResolvedValue({ status: 'accepted' });

    const handler = await loadHandler();
    await handler(baseEvent);

    expect(mockListPurchaseOrders).toHaveBeenCalledTimes(2);
    expect(mockListPurchaseOrders).toHaveBeenCalledWith('open', 1);
    expect(mockListPurchaseOrders).toHaveBeenCalledWith('open', 2);

    expect(mockCreateReceiptFromPurchaseOrder).toHaveBeenCalledTimes(2);
    expect(mockCompleteReceipt).toHaveBeenCalledTimes(2);
    expect(mockGroupMeSendMessage).not.toHaveBeenCalled();
  });

  it('skips POs with no receive_at_location_id', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockListPurchaseOrders.mockResolvedValueOnce({
      total: 2,
      pages: 1,
      results: [
        { id: 1, receive_at_location_id: null },
        { id: 2, receive_at_location_id: 10 },
      ],
    });
    mockCreateReceiptFromPurchaseOrder.mockResolvedValueOnce({ id: 102 });
    mockCompleteReceipt.mockResolvedValue({ status: 'accepted' });

    const handler = await loadHandler();
    await handler(baseEvent);

    expect(mockCreateReceiptFromPurchaseOrder).toHaveBeenCalledTimes(1);
    expect(mockCreateReceiptFromPurchaseOrder).toHaveBeenCalledWith(2, 10);
    expect(warnSpy).toHaveBeenCalledWith(
      'Skipping PO 1: missing receive_at_location_id'
    );
    expect(mockGroupMeSendMessage).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does nothing when there are no open POs', async () => {
    mockListPurchaseOrders.mockResolvedValueOnce({
      total: 0,
      pages: 0,
      results: [],
    });

    const handler = await loadHandler();
    await handler(baseEvent);

    expect(mockListPurchaseOrders).toHaveBeenCalledTimes(1);
    expect(mockCreateReceiptFromPurchaseOrder).not.toHaveBeenCalled();
    expect(mockCompleteReceipt).not.toHaveBeenCalled();
    expect(mockGroupMeSendMessage).not.toHaveBeenCalled();
  });

  it('sends a GroupMe alert and continues when a single PO fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockListPurchaseOrders.mockResolvedValueOnce({
      total: 2,
      pages: 1,
      results: [
        { id: 1, receive_at_location_id: 10 },
        { id: 2, receive_at_location_id: 10 },
      ],
    });
    mockCreateReceiptFromPurchaseOrder
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockResolvedValueOnce({ id: 102 });
    mockCompleteReceipt.mockResolvedValue({ status: 'accepted' });
    mockGroupMeSendMessage.mockResolvedValue(undefined);

    const handler = await loadHandler();
    await handler(baseEvent);

    expect(mockGroupMeSendMessage).toHaveBeenCalledTimes(1);
    expect(mockGroupMeSendMessage).toHaveBeenCalledWith(
      'ReceiveOpenOrders: failed to process PO 1 — Error: API timeout'
    );
    // PO 2 still processed despite PO 1 failing
    expect(mockCreateReceiptFromPurchaseOrder).toHaveBeenCalledTimes(2);
    expect(mockCompleteReceipt).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('sends a GroupMe alert and re-throws when listPurchaseOrders fails', async () => {
    mockListPurchaseOrders.mockRejectedValueOnce(new Error('network failure'));
    mockGroupMeSendMessage.mockResolvedValue(undefined);

    const handler = await loadHandler();
    await expect(handler(baseEvent)).rejects.toThrow('network failure');

    expect(mockGroupMeSendMessage).toHaveBeenCalledTimes(1);
    expect(mockGroupMeSendMessage).toHaveBeenCalledWith(
      expect.stringContaining('failed listing purchase orders on page 1')
    );
  });

  it('warns and skips GroupMe when GROUPME_BOT_ID is not set', async () => {
    delete process.env.GROUPME_BOT_ID;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockListPurchaseOrders.mockResolvedValueOnce({
      total: 1,
      pages: 1,
      results: [{ id: 1, receive_at_location_id: 10 }],
    });
    mockCreateReceiptFromPurchaseOrder.mockRejectedValueOnce(new Error('boom'));

    const handler = await loadHandler();
    await handler(baseEvent);

    expect(mockGroupMeSendMessage).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'GROUPME_BOT_ID not set; skipping GroupMe alert'
    );
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('throws when HEARTLAND_API_BASE_URL is missing', async () => {
    delete process.env.HEARTLAND_API_BASE_URL;
    const handler = await loadHandler();

    await expect(handler(baseEvent)).rejects.toThrow(
      'Missing HEARTLAND_API_BASE_URL or OPERATIONAL_SECRET_ARN environment variable'
    );
  });

  it('throws when OPERATIONAL_SECRET_ARN is missing', async () => {
    delete process.env.OPERATIONAL_SECRET_ARN;
    const handler = await loadHandler();

    await expect(handler(baseEvent)).rejects.toThrow(
      'Missing HEARTLAND_API_BASE_URL or OPERATIONAL_SECRET_ARN environment variable'
    );
  });
});
