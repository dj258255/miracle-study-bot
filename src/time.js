import { SESSIONS, TIMEZONE, sessionByKey } from './config.js';

// 서버 OS 시간대와 무관하게 항상 Asia/Seoul 기준으로 계산한다.
const dtf = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// 현재(또는 주어진 Date)의 KST 날짜/시각을 구조화해 반환.
export function kstParts(date = new Date()) {
  const map = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return {
    date: `${map.year}-${map.month}-${map.day}`, // YYYY-MM-DD
    hm: `${map.hour}:${map.minute}`, // HH:MM
  };
}

export function hmToMin(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

// 주어진 HH:MM이 속한 시간대(SESSIONS 중 하나)를 반환, 없으면 null.
export function sessionAt(hm) {
  const min = hmToMin(hm);
  for (const s of Object.values(SESSIONS)) {
    if (min >= hmToMin(s.start) && min < hmToMin(s.end)) return s;
  }
  return null;
}

// 한 구간의 인정 시간(분). 시간대 경계 밖은 잘라낸다.
export function clippedMinutes(joinedHm, leftHm, session) {
  const start = hmToMin(session.start);
  const end = hmToMin(session.end);
  const j = Math.max(hmToMin(joinedHm), start);
  const l = Math.min(hmToMin(leftHm), end);
  return Math.max(0, l - j);
}

// 특정 (date, session)이 지금 기준으로 이미 종료됐는지. 옛 세션 키(morning/evening)도 해석한다.
export function sessionEnded(date, sessionKey, today, nowHm) {
  if (date < today) return true;
  if (date > today) return false;
  const session = sessionByKey(sessionKey);
  if (!session) return true; // 알 수 없는 키는 종료된 것으로 간주 (늦은 정산 대상)
  return hmToMin(nowHm) >= hmToMin(session.end);
}

// YYYY-MM-DD 문자열에서 days일 뺀 날짜 문자열.
export function kstDateMinusDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// 해당 날짜가 속한 주의 월요일 (YYYY-MM-DD).
export function kstMondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일요일
  return kstDateMinusDays(dateStr, (dow + 6) % 7);
}

export function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}시간 ${m}분`;
}
