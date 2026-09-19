/** Every BullMQ queue name, in one place. Add here before registering a queue. */
export const QUEUES = {
  NOTIFICATIONS: 'notifications',
  ONBOARDING: 'onboarding',
  LEAVE: 'leave',
  ATTENDANCE: 'attendance',
  PERFORMANCE: 'performance',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
