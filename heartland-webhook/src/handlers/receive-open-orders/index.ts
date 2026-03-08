import { ScheduledEvent } from 'aws-lambda';
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { DefaultGroupMeClient, DefaultHeartlandApiClient } from '../../clients';

const secretsClient = new SecretsManagerClient({});
let cachedHeartlandToken: string | null = null;

type OperationalSecret = {
  heartland?: {
    token?: string;
  };
};

export const handler = async (event: ScheduledEvent): Promise<void> => {
  console.log(
    'Received ReceiveOpenOrders schedule event',
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
  const groupMeBotId = process.env.GROUPME_BOT_ID;

  if (!baseUrl || !secretId) {
    throw new Error(
      'Missing HEARTLAND_API_BASE_URL or OPERATIONAL_SECRET_ARN environment variable'
    );
  }

  const groupMeClient = groupMeBotId ? new DefaultGroupMeClient(groupMeBotId) : null;

  const sendAlert = async (message: string): Promise<void> => {
    if (!groupMeClient) {
      console.warn('GROUPME_BOT_ID not set; skipping GroupMe alert');
      return;
    }
    try {
      await groupMeClient.sendMessage(message);
    } catch (err) {
      console.error('Failed to send GroupMe alert:', err);
    }
  };

  let token: string;
  try {
    token = await getHeartlandApiTokenFromSecret(secretId);
  } catch (err) {
    await sendAlert(`ReceiveOpenOrders failed: could not load Heartland token — ${String(err)}`);
    throw err;
  }

  const heartlandClient = new DefaultHeartlandApiClient(baseUrl, token);

  let page = 1;
  let totalPages = 1;
  let totalProcessed = 0;

  while (page <= totalPages) {
    let response;
    try {
      response = await heartlandClient.listPurchaseOrders('open', page);
    } catch (err) {
      await sendAlert(
        `ReceiveOpenOrders failed listing purchase orders on page ${page} — ${String(err)}`
      );
      throw err;
    }

    totalPages = response.pages;
    console.log(
      `Page ${page}/${totalPages}: ${response.results.length} open purchase order(s)`
    );

    for (const po of response.results) {
      const locationId = po.receive_at_location_id;
      if (locationId == null) {
        console.warn(`Skipping PO ${po.id}: missing receive_at_location_id`);
        continue;
      }

      try {
        console.log(`Creating receipt for PO ${po.id} at location ${locationId}`);
        const receipt = await heartlandClient.createReceiptFromPurchaseOrder(
          po.id,
          locationId
        );
        console.log(`Created receipt ${receipt.id} for PO ${po.id}; completing...`);

        await heartlandClient.completeReceipt(receipt.id);
        console.log(`Completed receipt ${receipt.id}`);

        totalProcessed++;
      } catch (err) {
        console.error(`Failed to process PO ${po.id}:`, err);
        await sendAlert(
          `ReceiveOpenOrders: failed to process PO ${po.id} — ${String(err)}`
        );
      }
    }

    page++;
  }

  console.log(
    `ReceiveOpenOrders complete: processed ${totalProcessed} purchase order(s)`
  );
};

async function getHeartlandApiTokenFromSecret(secretId: string): Promise<string> {
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
