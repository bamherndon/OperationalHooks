import { ScheduledEvent } from 'aws-lambda';
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DefaultGroupMeClient,
  DefaultHeartlandApiClient,
} from '../../clients';
import ExcelJS from 'exceljs';
import {
  FindItemsNotSoldResult,
  HeartlandItemsNotSoldRow,
  HeartlandReportRunner,
} from '../../heartland-report-runner';

const secretsClient = new SecretsManagerClient({});
const s3Client = new S3Client({});
let cachedHeartlandToken: string | null = null;

type OperationalSecret = {
  heartland?: {
    token?: string;
  };
};

export const handler = async (event: ScheduledEvent): Promise<void> => {
  /**
   * Business logic:
   * 1) Query Heartland for stale inventory in both Used Sets and New Sets
   * 2) Build a single workbook with one tab per department.
   * 3) Upload the workbook to S3 and create a temporary read-only link.
   * 4) Send the link to GroupMe so staff can review and act on slow-moving items.
   * 
   * THe rule for getting stale inventory is sets that 
   *      a) we have in stock (qty_owned > 0)
   *      b) AND have been received 60 days ago,
   *      c) AND have been sold more than 60 days ago, or have never been sold
   * NOTE: that this means that items that were received 60 days ago, but sold recently will be excluded 
   * This is fine for now. We got some movement, and we can wait for 60 more days to see if it doesn't sell again
   * It also means that items that are haven't sold in 60 days, but we keep getting new ones will also be excluded
   * This is a bigger problem. This is harder to solve, because we will need to look at Investory history of each item
   * which can be potentially costly
   * Instead of trying to solve the problem here, we will solve it by looking for overstocked items
   */
  // Scheduled Lambda entrypoint: run undersold inventory reports and share output.
  console.log(
    'Received UndersoldItems schedule event',
    JSON.stringify(
      {
        id: event.id,
        time: event.time,
        source: event.source,
        resources: event.resources,
      },
      null,
      2
    )
  );

  const baseUrl = process.env.HEARTLAND_API_BASE_URL;
  const secretId = process.env.OPERATIONAL_SECRET_ARN;
  const reportsBucket = process.env.UNDERSOLD_REPORTS_S3_BUCKET;
  const groupMeBotId = process.env.GROUPME_BOT_ID;
  if (!baseUrl || !secretId || !reportsBucket) {
    throw new Error(
      'Missing HEARTLAND_API_BASE_URL, OPERATIONAL_SECRET_ARN, or UNDERSOLD_REPORTS_S3_BUCKET environment variable'
    );
  }

  const token = await getHeartlandApiTokenFromSecret(secretId);
  const heartlandClient = new DefaultHeartlandApiClient(baseUrl, token);
  const reportRunner = new HeartlandReportRunner(heartlandClient);

  // Run both department reports concurrently to keep runtime down.
  const [usedSetsResult, newSetsResult] = await Promise.all([
    reportRunner.findItemsNotSold('Used Sets', 60),
    reportRunner.findItemsNotSold('New Sets', 60),
  ]);

  console.log(
    'UndersoldItems report results',
    JSON.stringify(
      {
        usedSets: {
          total: usedSetsResult.total,
          pages: usedSetsResult.pages,
          length: usedSetsResult.results.length,
          results: usedSetsResult.results,
        },
        newSets: {
          total: newSetsResult.total,
          pages: newSetsResult.pages,
          length: newSetsResult.results.length,
          results: newSetsResult.results,
        },
      },
      null,
      2
    )
  );

  // Build one workbook with two tabs (Used Sets + New Sets).
  const reportBuffer = await buildXlsxReport([
    { name: 'Used Sets', data: usedSetsResult },
    { name: 'New Sets', data: newSetsResult },
  ]);
  const key = buildReportKey();

  // Persist the generated workbook to S3 for sharing.
  await s3Client.send(
    new PutObjectCommand({
      Bucket: reportsBucket,
      Key: key,
      Body: reportBuffer,
      ContentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  );

  // Create a temporary read-only URL so GroupMe recipients can download it.
  const presignedUrl = await getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: reportsBucket, Key: key }),
    { expiresIn: 60 * 60 * 24 * 7 }
  );

  console.log(
    'Generated undersold items report URL',
    JSON.stringify({ bucket: reportsBucket, key, presignedUrl }, null, 2)
  );

  if (!groupMeBotId) {
    console.warn('GROUPME_BOT_ID not set; skipping GroupMe notification');
    return;
  }

  // Send report link to GroupMe channel.
  const groupMeClient = new DefaultGroupMeClient(groupMeBotId);
  await groupMeClient.sendMessage(
    `Undersold Items report (Used Sets + New Sets, >60 days) is ready: ${presignedUrl}`
  );
};

async function getHeartlandApiTokenFromSecret(secretId: string): Promise<string> {
  // Reuse the token across warm invocations to avoid repeated Secrets Manager calls.
  if (cachedHeartlandToken) {
    return cachedHeartlandToken;
  }

  const secretValue = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretId })
  );

  if (!secretValue.SecretString) {
    throw new Error('SecretString is empty in Secrets Manager response');
  }

  const parsed = JSON.parse(secretValue.SecretString) as OperationalSecret;
  const token = parsed.heartland?.token;

  if (!token) {
    throw new Error('Operational secret JSON does not contain heartland.token');
  }

  cachedHeartlandToken = token;
  return token;
}

function buildReportKey(): string {
  // Time-based key keeps report files unique and grouped by day.
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10);
  const timestampPart = now.toISOString().replace(/[:.]/g, '-');
  return `undersold-items/reports/${datePart}/undersold-items-${timestampPart}.xlsx`;
}

async function buildXlsxReport(
  reports: Array<{ name: string; data: FindItemsNotSoldResult }>
): Promise<Buffer> {
  // Columns are shared across both tabs so exports stay consistent.
  const columns: Array<keyof HeartlandItemsNotSoldRow> = [
    'location.name',
    'item.public_id',
    'item.description',
    'current_inventory.last_sold_date',
    'current_inventory.days_since_last_sold',
    'current_inventory.last_received_date',
    'current_inventory.days_since_last_received',
    'ending_inventory.qty_owned',
  ];

  const workbook = new ExcelJS.Workbook();
  for (const report of reports) {
    // Each department report gets its own worksheet.
    const sheet = workbook.addWorksheet(report.name);
    sheet.addRow(columns);
    for (const row of report.data.results) {
      sheet.addRow(columns.map((column) => row[column]));
    }

    sheet.getRow(1).font = { bold: true };
    sheet.columns = columns.map((column) => ({
      key: column,
      width: Math.max(18, column.length + 2),
    }));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
