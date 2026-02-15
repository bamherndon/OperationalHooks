import { ScheduledEvent } from 'aws-lambda';

export const handler = async (event: ScheduledEvent): Promise<void> => {
  console.log(
    'Received UndersellingItems schedule event',
    JSON.stringify(
      {
        id: event.id,
        time: event.time,
        source: event.source,
        resources: event.resources,
      },
      null,
      2
    )
  );

  console.log('UndersellingItems handler currently has no checks configured.');
};
