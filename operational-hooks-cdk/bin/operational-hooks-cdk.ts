#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { OperationalHooksStack } from '../lib/operational-hooks-stack';

const app = new cdk.App();

// You can also read secret ARN and events from context if you prefer.
new OperationalHooksStack(app, 'OperationalHooksStack', {
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
