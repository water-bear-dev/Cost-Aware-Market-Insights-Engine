import boto3

logs = boto3.client('logs', region_name='us-east-1')
log_group_name = '/ecs/market-insights-dev'

try:
    streams = logs.describe_log_streams(
        logGroupName=log_group_name,
        orderBy='LastEventTime',
        descending=True,
        limit=2
    )['logStreams']
    
    for s in streams:
        print(f"--- Log Stream: {s['logStreamName']} ---")
        events = logs.get_log_events(
            logGroupName=log_group_name,
            logStreamName=s['logStreamName'],
            limit=50
        )['events']
        
        for e in events:
            print(e['message'])
except Exception as e:
    print(e)
