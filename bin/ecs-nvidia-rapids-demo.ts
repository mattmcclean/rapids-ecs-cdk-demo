#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/core');
import { EcsNvidiaRapidsDemoStack } from '../lib/ecs-nvidia-rapids-demo-stack';

const app = new cdk.App();
new EcsNvidiaRapidsDemoStack(app, 'EcsNvidiaRapidsDemoStack');
