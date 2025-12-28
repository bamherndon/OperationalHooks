import { CloudFormationCustomResourceEvent, Context } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import * as https from 'https';

interface WebhookResourceProps {
  WebhookUrl: string;
  Events: string[];
}

interface WebhookRegistrationResponse {
  id: string;
  [key: string]: unknown;
}

export const handler = async (
  event: CloudFormationCustomResourceEvent,
  _context: Context
) => {
  console.log('Custom resource event:', JSON.stringify(event, null, 2));

  const secretArn = process.env.HEARTLAND_SECRET_ARN;
  if (!secretArn) {
    throw new Error('HEARTLAND_SECRET_ARN environment variable is not set');
  }

  // v3 client (runtime-included in Node.js 18+ Lambda)
  const secretsClient = new SecretsManagerClient({});

  try {
    const secretResult = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretArn })
    );

    if (!secretResult.SecretString) {
      throw new Error('SecretString is empty in Secrets Manager response');
    }

    const parsedSecret = JSON.parse(secretResult.SecretString) as { token?: string };
    const token = parsedSecret.token;
    if (!token) {
      throw new Error('Secret JSON does not contain a "token" field');
    }
    console.log(`Using Bearer token ${token}`)

    const { WebhookUrl, Events } = event.ResourceProperties as unknown as WebhookResourceProps;

    if (event.RequestType === 'Create') {
      // Register webhook with Heartland
      const data = JSON.stringify({
        url: WebhookUrl,
        events: Events,
      });


    
      const options: https.RequestOptions = {
        hostname: 'bamherndon.retail.heartland.us', // Heartland API hostname
        path: '/api/webhooks',               // Webhook registration endpoint
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      };

      console.log(`Making request options ${options} data ${data}`);
      const responseJson = await makeRequest(options, data);
      console.log('Webhook registration response Json:', responseJson);
      const response = (responseJson) as WebhookRegistrationResponse;
      console.log('Webhook registration response:', response);

      return {
        PhysicalResourceId: `${response.id}`,
        Data: { WebhookId: response.id },
      };
    }

    if (event.RequestType === 'Update') {
      // For now, no special update logic; just keep the same PhysicalResourceId
      return {
        PhysicalResourceId: event.PhysicalResourceId,
      };
    }

    if (event.RequestType === 'Delete') {
      const webhookId = event.PhysicalResourceId;

      const options: https.RequestOptions = {
        hostname: 'bamherndon.retail.heartland.us',
        path: `/api/webhooks/${webhookId}`,
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };

      await makeRequest(options);
      return {};
    }

    // Fallback (should never hit)
    return {
      PhysicalResourceId: `webhook-${Date.now()}`,
    };
  } catch (error) {
    console.error('Error in custom resource:', error);
    throw error;
  }
};

function makeRequest(options: https.RequestOptions, data?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        const statusCode = res.statusCode ?? 0;

        if (statusCode >= 200 && statusCode < 300) {
          if (!body) {
            resolve({});
            return;
          }

          try {
            const parsed = JSON.parse(body);
            resolve(parsed);
          } catch (err) {
            reject(err);
          }
        } else {
          reject(
            new Error(
              `HTTP ${statusCode}: ${res.statusMessage ?? ''} - ${body}`
            )
          );
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(data);
    }

    req.end();
  });
}
