import cdk = require('@aws-cdk/core');
import ec2 = require('@aws-cdk/aws-ec2');
import ecs = require('@aws-cdk/aws-ecs');
import autoscaling = require('@aws-cdk/aws-autoscaling');
import elbv2 = require('@aws-cdk/aws-elasticloadbalancingv2');
import ssm = require('@aws-cdk/aws-ssm');
import route53 = require('@aws-cdk/aws-route53');
import route53_targets = require('@aws-cdk/aws-route53-targets');

export class EcsNvidiaRapidsDemoStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a new VPC
    const vpc = new ec2.Vpc(this, 'EcsVpc', { maxAzs: 2 });

    // Create an Autoscaling group
    const asg = new autoscaling.AutoScalingGroup(this, 'EcsFleet', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.P3, ec2.InstanceSize.XLARGE2),
      machineImage: new ecs.EcsOptimizedAmi({ hardwareType: ecs.AmiHardwareType.GPU }),
      desiredCapacity: 1,
      vpc
    });

    // Create the ECS Cluster
    const cluster = new ecs.Cluster(this, 'RapidsCluster', { vpc });
    cluster.addAutoScalingGroup(asg);
    
    // create a task definition with CloudWatch Logs
    const logging = new ecs.AwsLogDriver({ streamPrefix: "rapids" })

    const taskDef = new ecs.Ec2TaskDefinition(this, "RapidsTaskDefinition");
    const container = taskDef.addContainer("RapidsContainer", {
      image: ecs.ContainerImage.fromRegistry("rapidsai/rapidsai:cuda10.0-runtime-ubuntu16.04"),
      command: [ "bash", "utils/start-jupyter.sh" ],
      memoryLimitMiB: 10240,
      logging,
      gpuCount: 1,
    })

    // set the port mappings of the container
    container.addPortMappings(
      { 
        containerPort: 8888,
        hostPort: 8888,
        protocol: ecs.Protocol.TCP        
      },
      {
        containerPort: 8787,
        hostPort: 8787,
        protocol: ecs.Protocol.TCP
      },
      {
        containerPort: 8786,
        hostPort: 8786,
        protocol: ecs.Protocol.TCP             
      }
    );

    const siteUrl = ssm.StringParameter.fromStringParameterAttributes(this, 'SiteUrlParam', {
      parameterName: "rapdisai-url",
    }).stringValue;

    const hostedZoneId = ssm.StringParameter.fromStringParameterAttributes(this, 'HostedZoneIdParam', {
      parameterName: "rapdisai-hosted-zone",
    }).stringValue;    

    const certArn = ssm.StringParameter.fromStringParameterAttributes(this, 'CertArnParam', {
      parameterName: "rapidsai-cert-arn-param",
    }).stringValue;

    const cognitoUserpoolArn = ssm.StringParameter.fromStringParameterAttributes(this, 'CognitoUserpoolArnParam', {
      parameterName: "rapidsai-cognito-userpool-arn",
    }).stringValue;    

    const cognitoUserpoolClientid = ssm.StringParameter.fromStringParameterAttributes(this, 'CognitoUserpoolClientIdParam', {
      parameterName: "rapidsai-cognito-userpool-clientid",
    }).stringValue;    

    const cognitoUserpoolDomain = ssm.StringParameter.fromStringParameterAttributes(this, 'CognitoUserpoolDomainParam', {
      parameterName: "rapidsai-cognito-userpool-domain",
    }).stringValue;    

    // create the load balancer
    const lb = new elbv2.ApplicationLoadBalancer(this, 'LB', {
      vpc,
      internetFacing: true,
    });

    // create the listener
    const listener = lb.addListener('Listener', {
      port: 443,
      certificateArns: [ certArn ],
    });

    const target = listener.addTargets('Target', {
      port: 8888,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [asg],
      healthCheck: {
        healthyHttpCodes: "200-399",
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 3,
        interval: cdk.Duration.seconds(30),
      },
    });

    const rule = new elbv2.ApplicationListenerRule(this, 'AuthRule', {
      pathPattern: "/",
      listener,
      priority: 1,
    })
    rule.addTargetGroup(target);

    const cfnRule = rule.node.defaultChild as elbv2.CfnListenerRule;
    cfnRule.actions = [
      {
        type: "authenticate-cognito",
        authenticateCognitoConfig: {
          userPoolArn: cognitoUserpoolArn,
          userPoolClientId: cognitoUserpoolClientid,
          userPoolDomain: cognitoUserpoolDomain,
          sessionCookieName: "AWSELBAuthSessionCookie",
          scope: "openid",
          sessionTimeout: 604800,
          onUnauthenticatedRequest: "authenticate"
        },
        order: 1
      },      
      {
        type: "forward",
        targetGroupArn: target.targetGroupArn,
        order: 2
      },
    ];

    listener.connections.allowDefaultPortFromAnyIpv4('Open to the world');
    listener.connections.allowToAnyIpv4(ec2.Port.allTcp(), 'Allow to any IP range');    

    const elb_target =  new route53_targets.LoadBalancerTarget(lb);

    // update the Route53 record set
    new route53.RecordSet(this, 'RapidsRecordSet', {
      recordType: route53.RecordType.A,
      zone: route53.HostedZone.fromHostedZoneId(this, 'HostedZone', hostedZoneId),
      target: {
        aliasTarget: elb_target,
      },
      recordName: siteUrl + ".",
    });

    // Instantiate ECS Service with just cluster and image
    new ecs.Ec2Service(this, "RapidsService", {
      cluster,
      taskDefinition: taskDef,
    });    

    // Output the DNS where you can access your service
    new cdk.CfnOutput(this, 'RapidsURL', { value: 'https://' + siteUrl + '/' });
  }
}