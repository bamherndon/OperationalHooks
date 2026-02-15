import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';

export type HandlerUrls = {
  transactionWebhookUrl: string;
  itemCreatedUrl: string;
  undersoldItemsUrl: string;
};

const DEFAULT_STACK_NAME = 'OperationalHooksStack';

export const getHandlerUrls = async (
  stackName = DEFAULT_STACK_NAME
): Promise<HandlerUrls> => {
  const client = new CloudFormationClient({});
  const response = await client.send(
    new DescribeStacksCommand({ StackName: stackName })
  );
  const stack = response.Stacks?.[0];
  if (!stack?.Outputs) {
    throw new Error(`No outputs found for stack ${stackName}`);
  }

  const outputs = Object.fromEntries(
    stack.Outputs.map((output) => [output.OutputKey, output.OutputValue])
  );

  const transactionWebhookUrl = outputs.WebhookFunctionUrl;
  const itemCreatedUrl = outputs.ItemCreatedFunctionUrl;
  const undersoldItemsUrl = outputs.UndersoldItemsFunctionUrl;

  if (!transactionWebhookUrl || !itemCreatedUrl || !undersoldItemsUrl) {
    throw new Error(
      `Missing handler URLs in stack outputs for ${stackName}`
    );
  }

  return { transactionWebhookUrl, itemCreatedUrl, undersoldItemsUrl };
};
