// lib/operational-hooks-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as path from 'path';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';


export class OperationalHooksStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

     const heartlandSecretArn =
      'arn:aws:secretsmanager:us-east-1:445473841172:secret:heartland-api-token-PgcltJ';

    // Represent the existing secret in this stack
    const heartlandSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'HeartlandApiTokenSecret',
      heartlandSecretArn
    );

    const natEip = new ec2.CfnEIP(this, 'LambdaNatEip', {
      domain: 'vpc',
    });

    const vpc = new ec2.Vpc(this, 'OperationalHooksVpc', {
      maxAzs: 2,
      natGatewayProvider: ec2.NatProvider.gateway({
        eipAllocationIds: [natEip.attrAllocationId],
      }),
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: 'private-egress',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    /**
     * 1) Webhook handler Lambda
     *    Code comes from ../heartland-webhook/dist (compiled TS).
     */
    const transactionWebhookFn = new lambda.Function(this, 'HeartlandTransactionWebhookFn', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handlers/transaction/index.handler', // dist/handlers/transaction/index.js
      code: lambda.Code.fromAsset(
        path.join(__dirname, '..', '..', 'heartland-webhook', 'dist')
      ),
      description: 'Receives Heartland Retail sales_transaction_completed webhook events',
      timeout: cdk.Duration.seconds(10),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: {
        HEARTLAND_API_BASE_URL: 'https://bamherndon.retail.heartland.us',
        HEARTLAND_SECRET_ARN: heartlandSecretArn,
        GROUPME_BOT_ID: '89bc08a0ee7697547bd331852d',
      },

    });
    
    // allow webhook Lambda to read the token secret
    heartlandSecret.grantRead(transactionWebhookFn);

    // Lambda Function URL (public) so Heartland can POST directly
    const webhookFnUrl = transactionWebhookFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new cdk.CfnOutput(this, 'WebhookFunctionUrl', {
      value: webhookFnUrl.url,
      description: 'Public Lambda Function URL for Heartland webhook',
    });

    /**
     * 1b) Item-created handler Lambda
     */
    const itemCreatedFn = new lambda.Function(this, 'HeartlandItemCreatedFn', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handlers/item/index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '..', '..', 'heartland-webhook', 'dist')
      ),
      description: 'Receives Heartland Retail item_created webhook events',
      timeout: cdk.Duration.seconds(10),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    const itemCreatedFnUrl = itemCreatedFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new cdk.CfnOutput(this, 'ItemCreatedFunctionUrl', {
      value: itemCreatedFnUrl.url,
      description: 'Public Lambda Function URL for Heartland item_created webhook',
    });
    /**
     * 2) Custom resource Lambda that registers/deregisters the webhook.
     *    Uses the compiled JS from ../heartland-webhook-custom-resource/dist.
     */

   

    const registerWebhookFn = new lambda.Function(
      this,
      'RegisterHeartlandWebhookFn',
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(
          path.join(
            __dirname,
            '..',
            '..',
            'heartland-webhook-custom-resource',
            'dist'
          )
        ),
        description:
          'Custom resource Lambda that registers/deregisters webhook with Heartland',
        timeout: cdk.Duration.seconds(30),
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        environment: {
          HEARTLAND_SECRET_ARN: heartlandSecretArn,
        },
      }
    );
    
    // 👇 Grant the Lambda permission to read the secret
    heartlandSecret.grantRead(registerWebhookFn);

    /**
     * 3) Custom Resource Provider wiring
     *    Your TS custom-resource code already expects CloudFormation-style events.
     */
    const provider = new cr.Provider(this, 'HeartlandWebhookProvider', {
      onEventHandler: registerWebhookFn,
      // Optionally: add isCompleteHandler, logRetention, etc.
    });

    /**
     * 4) CustomResource: registers webhook on stack Create/Update,
     *    and deregisters on Delete.
     */

    const events = ['sales_transaction_completed'];

    const webhookRegistration = new cdk.CustomResource(
      this,
      'HeartlandWebhookRegistration',
      {
        serviceToken: provider.serviceToken,
        properties: {
          WebhookUrl: webhookFnUrl.url, // passed to your Lambda as event.ResourceProperties.WebhookUrl
          Events: events,               // passed as event.ResourceProperties.Events
        },
      }
    );

    const itemCreatedEvents = ['item_created'];

    const itemCreatedWebhookRegistration = new cdk.CustomResource(
      this,
      'HeartlandItemCreatedWebhookRegistration',
      {
        serviceToken: provider.serviceToken,
        properties: {
          WebhookUrl: itemCreatedFnUrl.url,
          Events: itemCreatedEvents,
        },
      }
    );

    // Expose Heartland Webhook ID returned by your custom-resource Lambda
    new cdk.CfnOutput(this, 'HeartlandWebhookId', {
      value: webhookRegistration.getAttString('WebhookId'),
      description:
        'Webhook ID returned by Heartland when registering the webhook',
    });

    new cdk.CfnOutput(this, 'HeartlandItemCreatedWebhookId', {
      value: itemCreatedWebhookRegistration.getAttString('WebhookId'),
      description:
        'Webhook ID returned by Heartland when registering the item_created webhook',
    });
  }
}
