import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@aws-sdk/protocol-http';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { getHandlerUrls } from '../src/stack-outputs';

const stackName = process.env.STACK_NAME || 'OperationalHooksStack';

describe('UndersoldItems handler (deployed)', () => {
  test('runs successfully when invoked with a schedule event payload', async () => {
    const { undersoldItemsUrl } = await getHandlerUrls(stackName);

    const eventPayload = {
      version: '0',
      id: 'int-test-undersold-items',
      'detail-type': 'Scheduled Event',
      source: 'aws.events',
      account: '000000000000',
      time: '2026-02-14T03:00:00Z',
      region: process.env.AWS_REGION ?? 'us-east-1',
      resources: ['arn:aws:events:us-east-1:000000000000:rule/UndersoldItemsDailySchedule'],
      detail: {},
    };

    const signedRequest = await signLambdaUrlRequest({
      url: undersoldItemsUrl,
      method: 'POST',
      region: process.env.AWS_REGION,
      body: JSON.stringify(eventPayload),
      headers: {
        'content-type': 'application/json',
      },
    });

    const response = await fetch(undersoldItemsUrl, {
      method: 'POST',
      headers: signedRequest.headers,
      body: signedRequest.body,
    });

    expect(response.ok).toBe(true);
  }, 30000);
});

async function signLambdaUrlRequest(input: {
  url: string;
  method: string;
  region?: string;
  body?: string;
  headers?: Record<string, string>;
}): Promise<{ headers: Record<string, string>; body?: string }> {
  const parsedUrl = new URL(input.url);
  const request = new HttpRequest({
    protocol: parsedUrl.protocol,
    hostname: parsedUrl.hostname,
    method: input.method,
    path: `${parsedUrl.pathname}${parsedUrl.search}`,
    headers: {
      host: parsedUrl.hostname,
      ...(input.headers ?? {}),
    },
    body: input.body,
  });

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region: input.region ?? extractRegionFromLambdaUrlHostname(parsedUrl.hostname),
    service: 'lambda',
    sha256: Sha256,
  });

  const signed = await signer.sign(request);
  return {
    headers: Object.fromEntries(
      Object.entries(signed.headers).map(([key, value]) => [key, String(value)])
    ),
    body: input.body,
  };
}

function extractRegionFromLambdaUrlHostname(hostname: string): string {
  const match = hostname.match(/\.lambda-url\.([a-z0-9-]+)\.on\.aws$/);
  if (!match) {
    throw new Error(
      `Could not infer AWS region from Lambda URL hostname "${hostname}". Set AWS_REGION.`
    );
  }
  return match[1];
}
