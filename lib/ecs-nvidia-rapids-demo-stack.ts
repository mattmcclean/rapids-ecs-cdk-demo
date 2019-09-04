import cdk = require('@aws-cdk/core');
import ec2 = require('@aws-cdk/aws-ec2');
import ecs = require('@aws-cdk/aws-ecs');
import autoscaling = require('@aws-cdk/aws-autoscaling');

export class EcsNvidiaRapidsDemoStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a new VPC
    const vpc = new ec2.Vpc(this, 'EcsVpc', { maxAzs: 2 });

    // Create a new SG
    const mySecurityGroup = new ec2.SecurityGroup(this, 'NewSecurityGroup', {
      description: 'Allow ssh access to ec2 instances',
      securityGroupName: 'ec2-ssh-access',
      vpc: vpc
    });    
    mySecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22));

    // Create an Autoscaling group
    const asg = new autoscaling.AutoScalingGroup(this, 'EcsFleet', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.P3, ec2.InstanceSize.XLARGE2),
      machineImage: new ecs.EcsOptimizedAmi({ hardwareType: ecs.AmiHardwareType.GPU }),
      desiredCapacity: 1,
      vpc,
      keyName: "awskey",
      associatePublicIpAddress: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }
    });    
    asg.addSecurityGroup(mySecurityGroup);

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

    // Instantiate ECS Service with just cluster and image
    new ecs.Ec2Service(this, "RapidsService", {
      cluster,
      taskDefinition: taskDef,
    });    
  }
}