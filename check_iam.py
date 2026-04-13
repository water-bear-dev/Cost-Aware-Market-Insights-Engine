import boto3
import json

iam = boto3.client('iam', region_name='us-east-1')
cfn = boto3.client('cloudformation', region_name='us-east-1')

# Find the task role name from the CloudFormation stack
try:
    resources = cfn.list_stack_resources(StackName='market-insights-stack')
    task_role_resource = next(
        r for r in resources['StackResourceSummaries']
        if r['ResourceType'] == 'AWS::IAM::Role' and 'TaskRole' in r['LogicalResourceId']
    )
    role_name = task_role_resource['PhysicalResourceId']
    print(f"ECS Task Role: {role_name}\n")

    # Get all inline policies
    policies = iam.list_role_policies(RoleName=role_name)['PolicyNames']
    for policy_name in policies:
        policy = iam.get_role_policy(RoleName=role_name, PolicyName=policy_name)
        doc = policy['PolicyDocument']
        actions = []
        for statement in doc['Statement']:
            actions += statement.get('Action', [])
        print(f"Policy: {policy_name}")
        for action in sorted(actions):
            print(f"  ✓ {action}")

except Exception as e:
    print(f"Error: {e}")
