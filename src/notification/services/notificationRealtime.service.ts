import type { NotificationPayload } from "../types/notification.types";

const DELIVERY_SEC = parseInt(process.env.NOTIFICATION_DELIVERY_INTERVAL_SEC || "15", 10);

const isRedisConfigured = () =>
  Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);

export type NotificationRealtimeMeta = {
  enabled: true;
  transport: "socket";
  polling: false;
  schedulerIntervalSec: number;
  redis: boolean;
  events: string[];
};

export function getNotificationRealtimeMeta(): NotificationRealtimeMeta {
  return {
    enabled: true,
    transport: "socket",
    polling: false,
    schedulerIntervalSec: Math.max(15, DELIVERY_SEC),
    redis: isRedisConfigured(),
    events: ["notification:new", "notification:updated", "notifications:realtime"],
  };
}

export type NotificationSocketDelivery = {
  via: "socket";
  deliveredAt: string;
  realtime: true;
  redis: boolean;
};

export type NotificationSocketPayload = NotificationPayload & {
  delivery: NotificationSocketDelivery;
};

export function wrapNotificationSocketPayload(
  payload: NotificationPayload
): NotificationSocketPayload {
  return {
    ...payload,
    delivery: {
      via: "socket",
      deliveredAt: new Date().toISOString(),
      realtime: true,
      redis: isRedisConfigured(),
    },
  };
}
