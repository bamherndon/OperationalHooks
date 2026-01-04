import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';

/**
 * Lambda handler for item_created webhook events.
 */
export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  console.log(
    'Received Heartland item_created webhook event (envelope):',
    JSON.stringify(
      {
        headers: event.headers,
        requestContext: {
          http: event.requestContext?.http,
          timeEpoch: event.requestContext?.timeEpoch,
        },
      },
      null,
      2
    )
  );

  if (!event.body) {
    console.warn('Received item_created webhook with no body');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok' }),
    };
  }

  try {
    const payload = JSON.parse(event.body) as unknown;
    console.log(
      'Received Heartland item_created payload:',
      JSON.stringify(payload, null, 2)
    );
  } catch (err) {
    console.error('Failed to parse item_created body as JSON:', err);
    console.error('Raw body:', event.body);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ok' }),
  };
};
