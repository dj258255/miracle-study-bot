import cron from 'node-cron';
import { SESSIONS, WEEKLY_CRON, TIMEZONE } from './config.js';
import { startSession, finalizeSession } from './attendance.js';
import { runWeeklyCheck } from './warnings.js';
import { kstParts } from './time.js';

// 'HH:MM' → 크론식 'M H * * *'. SESSIONS 시각을 바꾸면 크론도 자동으로 따라간다(테스트 편의).
function cronFromHm(hm) {
  const [h, m] = hm.split(':').map(Number);
  return `${m} ${h} * * *`;
}

export function registerSchedules(ctx) {
  const opt = { timezone: TIMEZONE };

  for (const session of Object.values(SESSIONS)) {
    cron.schedule(cronFromHm(session.start), () => startSession(ctx, session), opt);
    cron.schedule(
      cronFromHm(session.end),
      () => finalizeSession(ctx, kstParts().date, session, { notify: true }),
      opt
    );
  }

  cron.schedule(WEEKLY_CRON, () => runWeeklyCheck(ctx), opt);

  console.log('[scheduler] 크론 등록 완료');
}
