import { z } from 'zod';
import { collectionToday } from './collection-policy';
import { isCollectionBusinessDay } from './collection-calendar';
export const scheduleSchema = z.object({ enabled: z.boolean(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), saturday: z.boolean(), sunday: z.boolean(), holidays: z.boolean() });
export type CollectionScheduleConfig = z.infer<typeof scheduleSchema>;
export const DEFAULT_SCHEDULE: CollectionScheduleConfig = { enabled: false, time: '09:00', saturday: false, sunday: false, holidays: false };
export function scheduleDue(config: CollectionScheduleConfig, now = new Date()) {
  const today = collectionToday(now);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return config.enabled && time >= config.time && isCollectionBusinessDay(today, config);
}
