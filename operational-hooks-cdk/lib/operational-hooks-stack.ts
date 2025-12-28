// lib/operational-hooks-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as path from 'path';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';


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

    /**
     * 1) Webhook handler Lambda
     *    Code comes from ../heartland-webhook/dist (compiled TS).
     */
    const webhookFn = new lambda.Function(this, 'HeartlandWebhookFn', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler', // index.js in dist, exported "handler"
      code: lambda.Code.fromAsset(
        path.join(__dirname, '..', '..', 'heartland-webhook', 'dist')
      ),
      description: 'Receives Heartland Retail webhook events (e.g., sales_transaction_completed)',
      timeout: cdk.Duration.seconds(10),
      environment: {
        HEARTLAND_API_BASE_URL: 'https://bamherndon.retail.heartland.us',
        HEARTLAND_SECRET_ARN: heartlandSecretArn,
        GROUPME_BOT_ID: '89bc08a0ee7697547bd331852d',
      },

    });
    
    // allow webhook Lambda to read the token secret
    heartlandSecret.grantRead(webhookFn);

    // Lambda Function URL (public) so Heartland can POST directly
    const webhookFnUrl = webhookFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new cdk.CfnOutput(this, 'WebhookFunctionUrl', {
      value: webhookFnUrl.url,
      description: 'Public Lambda Function URL for Heartland webhook',
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

    // Expose Heartland Webhook ID returned by your custom-resource Lambda
    new cdk.CfnOutput(this, 'HeartlandWebhookId', {
      value: webhookRegistration.getAttString('WebhookId'),
      description:
        'Webhook ID returned by Heartland when registering the webhook',
    });
  }
}
