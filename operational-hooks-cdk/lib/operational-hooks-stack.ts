// lib/operational-hooks-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as path from 'path';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';


export class OperationalHooksStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

     const operationalSecretsNameParam = new cdk.CfnParameter(
      this,
      'OperationalSecretsName',
      {
        type: 'String',
        description: 'Secrets Manager name for the OperationalSecrets JSON',
        default: 'OperationalSecrets',
      }
    );

    // Represent the existing secret in this stack
    const operationalSecrets = secretsmanager.Secret.fromSecretNameV2(
      this,
      'OperationalSecrets',
      operationalSecretsNameParam.valueAsString
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
     * 1) Upload Toyhouse master data CSV to S3.
     */
    const toyhouseDataBucket = new s3.Bucket(this, 'ToyhouseMasterDataBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new s3deploy.BucketDeployment(this, 'ToyhouseMasterDataDeployment', {
      destinationBucket: toyhouseDataBucket,
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', 'data'))],
    });

    new cdk.CfnOutput(this, 'ToyhouseMasterDataBucketName', {
      value: toyhouseDataBucket.bucketName,
      description: 'S3 bucket containing toyhouse_master_data.csv',
    });

    /**
     * 2) Webhook handler Lambda
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
        OPERATIONAL_SECRET_ARN: operationalSecretsNameParam.valueAsString,
        GROUPME_BOT_ID: '89bc08a0ee7697547bd331852d',
        TOYHOUSE_MASTER_DATA_S3_URI: `s3://${toyhouseDataBucket.bucketName}/toyhouse_master_data.csv`,
      },

    });
    
    // allow webhook Lambda to read the token secret
    operationalSecrets.grantRead(transactionWebhookFn);
    toyhouseDataBucket.grantRead(transactionWebhookFn);

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
      environment: {
        HEARTLAND_API_BASE_URL: 'https://bamherndon.retail.heartland.us',
        OPERATIONAL_SECRET_ARN: operationalSecretsNameParam.valueAsString,
        TOYHOUSE_MASTER_DATA_S3_URI: `s3://${toyhouseDataBucket.bucketName}/toyhouse_master_data.csv`,
        GROUPME_BOT_ID: '89bc08a0ee7697547bd331852d',
      },
    });
    operationalSecrets.grantRead(itemCreatedFn);
    toyhouseDataBucket.grantRead(itemCreatedFn);

    const itemCreatedFnUrl = itemCreatedFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new cdk.CfnOutput(this, 'ItemCreatedFunctionUrl', {
      value: itemCreatedFnUrl.url,
      description: 'Public Lambda Function URL for Heartland item_created webhook',
    });

    const undersoldItemsFn = new lambda.Function(this, 'UndersoldItemsFn', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'dist/handlers/undersold-items/index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '..', '..', 'heartland-webhook')
      ),
      description: 'Runs daily undersold-items Heartland report and logs results',
      timeout: cdk.Duration.seconds(30),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: {
        HEARTLAND_API_BASE_URL: 'https://bamherndon.retail.heartland.us',
        OPERATIONAL_SECRET_ARN: operationalSecretsNameParam.valueAsString,
        GROUPME_BOT_ID: '89bc08a0ee7697547bd331852d',
        UNDERSOLD_REPORTS_S3_BUCKET: toyhouseDataBucket.bucketName,
      },
    });
    operationalSecrets.grantRead(undersoldItemsFn);
    toyhouseDataBucket.grantReadWrite(undersoldItemsFn);

    const undersoldItemsFnUrl = undersoldItemsFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    new events.Rule(this, 'UndersoldItemsDailySchedule', {
      description: 'Trigger UndersoldItems Lambda daily at 03:00 UTC',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '3',
      }),
      targets: [new targets.LambdaFunction(undersoldItemsFn)],
    });

    new cdk.CfnOutput(this, 'UndersoldItemsFunctionUrl', {
      value: undersoldItemsFnUrl.url,
      description: 'Public Lambda Function URL for UndersoldItems scheduled handler',
    });

    new cdk.CfnOutput(this, 'LambdaNatEipAddress', {
      value: natEip.ref,
      description: 'Elastic IP address used by the NAT Gateway for Lambda egress',
    });
    /**
     * 3) Custom resource Lambda that registers/deregisters the webhook.
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
          OPERATIONAL_SECRET_ARN: operationalSecretsNameParam.valueAsString,
        },
      }
    );
    
    // 👇 Grant the Lambda permission to read the secret
    operationalSecrets.grantRead(registerWebhookFn);

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

    const transactionEvents = ['sales_transaction_completed'];

    const webhookRegistration = new cdk.CustomResource(
      this,
      'HeartlandWebhookRegistration',
      {
        serviceToken: provider.serviceToken,
        properties: {
          WebhookUrl: webhookFnUrl.url, // passed to your Lambda as event.ResourceProperties.WebhookUrl
          Events: transactionEvents,    // passed as event.ResourceProperties.Events
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
