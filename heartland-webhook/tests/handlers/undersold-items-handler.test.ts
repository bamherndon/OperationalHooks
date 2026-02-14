import { ScheduledEvent } from 'aws-lambda';

const mockSecretsSend = jest.fn();
const mockS3Send = jest.fn();
const mockGetSignedUrl = jest.fn();
const mockFindItemsNotSold = jest.fn();
const mockGroupMeSendMessage = jest.fn();
const mockWorkbookWriteBuffer = jest.fn();
const mockWorksheetAddRow = jest.fn();

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSecretsSend })),
  GetSecretValueCommand: jest.fn((input) => input),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn((input) => input),
  GetObjectCommand: jest.fn((input) => input),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

jest.mock('exceljs', () => ({
  __esModule: true,
  default: {
    Workbook: jest.fn(() => ({
      addWorksheet: () => ({
        addRow: (...args: unknown[]) => mockWorksheetAddRow(...args),
        getRow: () => ({ font: {} }),
        columns: [],
      }),
      xlsx: {
        writeBuffer: (...args: unknown[]) => mockWorkbookWriteBuffer(...args),
      },
    })),
  },
}));

jest.mock('../../src/clients', () => ({
  DefaultHeartlandApiClient: jest.fn(),
  DefaultGroupMeClient: jest.fn(() => ({
    sendMessage: (...args: unknown[]) => mockGroupMeSendMessage(...args),
  })),
}));

jest.mock('../../src/heartland-report-runner', () => ({
  HeartlandReportRunner: jest.fn(() => ({
    findItemsNotSold: (...args: unknown[]) => mockFindItemsNotSold(...args),
  })),
}));

const baseEvent: ScheduledEvent = {
  version: '0',
  id: 'evt-123',
  'detail-type': 'Scheduled Event',
  source: 'aws.events',
  account: '123456789012',
  time: '2026-02-14T03:00:00Z',
  region: 'us-east-1',
  resources: [],
  detail: {},
};

async function loadHandler() {
  jest.resetModules();
  return (await import('../../src/handlers/undersold-items')).handler;
}

describe('undersold-items handler', () => {
  beforeEach(() => {
    mockSecretsSend.mockReset();
    mockS3Send.mockReset();
    mockGetSignedUrl.mockReset();
    mockFindItemsNotSold.mockReset();
    mockGroupMeSendMessage.mockReset();
    mockWorkbookWriteBuffer.mockReset();
    mockWorksheetAddRow.mockReset();

    process.env.HEARTLAND_API_BASE_URL = 'https://example.heartland.test';
    process.env.OPERATIONAL_SECRET_ARN = 'OperationalSecrets';
    process.env.UNDERSOLD_REPORTS_S3_BUCKET = 'report-bucket';
    process.env.GROUPME_BOT_ID = 'bot-123';
  });

  it('uploads report, generates presigned URL, and posts GroupMe message', async () => {
    const handler = await loadHandler();
    mockSecretsSend.mockResolvedValue({
      SecretString: JSON.stringify({ heartland: { token: 'token-abc' } }),
    });
    mockFindItemsNotSold.mockResolvedValue({
      total: 1,
      pages: 1,
      results: [
        {
          'location.name': 'Bricks & Minifigs Herndon',
          'item.public_id': '11006-1',
          'item.description': '11006 Creative Blue Bricks',
          'current_inventory.last_sold_date': '2024-09-29',
          'current_inventory.days_since_last_sold': 503,
          'ending_inventory.qty_owned': 1,
        },
      ],
    });
    mockWorkbookWriteBuffer.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockGetSignedUrl.mockResolvedValue('https://signed.example/report.xlsx');

    await handler(baseEvent);

    expect(mockFindItemsNotSold).toHaveBeenCalledTimes(2);
    expect(mockFindItemsNotSold).toHaveBeenNthCalledWith(1, 'Used Sets', 60);
    expect(mockFindItemsNotSold).toHaveBeenNthCalledWith(2, 'New Sets', 60);
    expect(mockS3Send).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'report-bucket',
        ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    );
    expect(mockGetSignedUrl).toHaveBeenCalled();
    expect(mockGroupMeSendMessage).toHaveBeenCalledWith(
      'Undersold Items report (Used Sets + New Sets, >60 days) is ready: https://signed.example/report.xlsx'
    );
  });

  it('skips GroupMe when bot id is not configured', async () => {
    delete process.env.GROUPME_BOT_ID;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = await loadHandler();

    mockSecretsSend.mockResolvedValue({
      SecretString: JSON.stringify({ heartland: { token: 'token-abc' } }),
    });
    mockFindItemsNotSold.mockResolvedValue({
      total: 0,
      pages: 1,
      results: [],
    });
    mockWorkbookWriteBuffer.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockGetSignedUrl.mockResolvedValue('https://signed.example/report.xlsx');

    await handler(baseEvent);

    expect(mockGroupMeSendMessage).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'GROUPME_BOT_ID not set; skipping GroupMe notification'
    );
    warnSpy.mockRestore();
  });
});
