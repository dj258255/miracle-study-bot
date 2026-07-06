import { config, SESSIONS, REQUIRED_MINUTES, LEAVE_DEBOUNCE_MS } from './config.js';
import { db } from './db.js';
import { kstParts, sessionAt, sessionEnded, clippedMinutes, fmtDuration } from './time.js';

// 시간대 단위로 유지되는 휘발성 상태.
//  - timers: 퇴장 후 디바운스 타이머 (userId -> Timeout)
//  - notified: 이미 퇴근 공지가 나간 유저 (재입장/정산 시 중복 공지 방지)
// 봇 재시작 시 소실되며, 정산이 이를 보완한다.
const state = {
  timers: new Map(),
  notified: new Set(),
};

// 기준 시간 라벨 (예: 60분 → "1시간") — 기준값을 바꿔도 메시지가 자동으로 따라온다.
const REQ_LABEL =
  REQUIRED_MINUTES % 60 === 0 ? `${REQUIRED_MINUTES / 60}시간` : fmtDuration(REQUIRED_MINUTES);

export function resetSessionState() {
  for (const t of state.timers.values()) clearTimeout(t);
  state.timers.clear();
  state.notified.clear();
}

function isTracked(channel) {
  if (!channel) return false;
  const ids = config.voiceChannelIds;
  if (ids.length === 0) return channel.isVoiceBased?.() ?? false;
  return ids.includes(channel.id);
}

function trackedVoiceChannels(ctx) {
  const ids = config.voiceChannelIds;
  const chans = [];
  if (ids.length) {
    for (const id of ids) {
      const ch = ctx.guild.channels.cache.get(id);
      if (ch?.isVoiceBased()) chans.push(ch);
    }
  } else {
    for (const ch of ctx.guild.channels.cache.values()) {
      if (ch.isVoiceBased()) chans.push(ch);
    }
  }
  return chans;
}

function nameOf(userId, ctx) {
  const m = ctx.guild.members.cache.get(userId);
  return m ? m.displayName : `<@${userId}>`;
}

// (user, date, session)의 닫힌 구간 누적 인정 시간(분).
function cumulativeMinutes(userId, date, session) {
  let total = 0;
  for (const s of db.getUserSegments(userId, date, session.key)) {
    if (!s.left_hm) continue;
    total += clippedMinutes(s.joined_hm, s.left_hm, session);
  }
  return total;
}

// ── 실시간 음성 이벤트 ───────────────────────────────────────────────
export function handleVoiceStateUpdate(oldState, newState, ctx) {
  // 내 스터디 서버 이외(공개 봇을 초대한 남의 서버)의 이벤트는 완전히 무시 — 자원 소모 0.
  if ((newState.guild?.id ?? oldState.guild?.id) !== ctx.guild.id) return;

  const { date, hm } = kstParts();
  const session = sessionAt(hm);
  if (!session) return; // 시간대 밖은 무시

  const userId = newState.id;
  const wasIn = isTracked(oldState.channel);
  const nowIn = isTracked(newState.channel);

  if (!wasIn && nowIn) {
    onJoin(userId, date, session, hm, newState.member, ctx);
  } else if (wasIn && !nowIn) {
    onLeave(userId, date, session, hm, oldState.member ?? newState.member, ctx);
  }
  // 추적 채널 간 이동(wasIn && nowIn) / 무관한 상태변화 → 무시
}

function onJoin(userId, date, session, hm, member, ctx) {
  if (member?.user?.bot) return;

  // 디바운스 대기 중이었다면 취소 (10분 내 복귀)
  const pending = state.timers.get(userId);
  if (pending) {
    clearTimeout(pending);
    state.timers.delete(userId);
  }

  const priorCount = db.countUserSessionSegments(userId, date, session.key);
  db.openSegment(userId, date, session.key, hm);

  const name = member?.displayName ?? nameOf(userId, ctx);
  if (priorCount === 0) {
    ctx.announce(`${session.emoji} **${name}**님 ${session.label} 출근 (${hm})`);
  } else if (state.notified.has(userId)) {
    ctx.announce(`🔄 **${name}**님 ${session.label} 재입장 (${hm})`);
    state.notified.delete(userId);
  }
  // 그 외(10분 내 복귀, 타이머만 취소된 경우) → 공지 없음
}

function onLeave(userId, date, session, hm, member, ctx) {
  if (member?.user?.bot) return;

  db.closeUserOpenSegments(userId, date, session.key, hm);

  const existing = state.timers.get(userId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    state.timers.delete(userId);
    const mins = cumulativeMinutes(userId, date, session);
    const name = member?.displayName ?? nameOf(userId, ctx);
    const mark =
      mins >= REQUIRED_MINUTES
        ? '✅ 출석 인정'
        : `⚠️ 아직 ${REQ_LABEL} 미만 (재입장하면 이어서 누적돼요)`;
    ctx.announce(`🏁 **${name}**님 ${session.label} 퇴근 (${hm}) — 누적 ${fmtDuration(mins)} ${mark}`);
    state.notified.add(userId);
  }, LEAVE_DEBOUNCE_MS);

  state.timers.set(userId, timer);
}

// ── 시간대 시작: 이미 접속 중인 멤버 구간 열기 ──────────────────────────
export function openSegmentsForPresentMembers(ctx, session, joinedHm) {
  const { date } = kstParts();
  for (const ch of trackedVoiceChannels(ctx)) {
    for (const [userId, member] of ch.members) {
      if (member.user.bot) continue;
      if (db.hasOpenSegment(userId, date, session.key)) continue;
      const priorCount = db.countUserSessionSegments(userId, date, session.key);
      db.openSegment(userId, date, session.key, joinedHm);
      if (priorCount === 0) {
        ctx.announce(`${session.emoji} **${member.displayName}**님 ${session.label} 출근 (${joinedHm})`);
      }
    }
  }
}

export function startSession(ctx, session) {
  resetSessionState();
  openSegmentsForPresentMembers(ctx, session, session.start);
}

// ── 정산 (12:00 / 22:00) ───────────────────────────────────────────
// notify=false: 재시작 시 늦은 정산 — 기록만 하고 채널 공지는 생략.
export function finalizeSession(ctx, date, session, { notify = true } = {}) {
  const key = session.key;
  if (db.isFinalized(date, key)) return;

  // 보류 중이던 디바운스 타이머 정지 — 정산이 공지를 대신한다.
  for (const t of state.timers.values()) clearTimeout(t);
  state.timers.clear();

  db.closeAllOpenSegments(date, key, session.end);

  for (const userId of db.getSessionUsers(date, key)) {
    const preExisting = db.hasAttendanceOnDate(userId, date); // 다른 시간대에서 이미 인정?
    const mins = cumulativeMinutes(userId, date, session);
    const recognized = mins >= REQUIRED_MINUTES;
    if (recognized) {
      const inserted = db.insertAttendance(userId, date, key, mins); // 하루 1회 (PK가 강제)
      if (inserted.changes > 0) ctx.syncLevel?.(userId); // 새 출석 → 레벨 갱신 (비동기, 실패 무해)
    }

    if (notify && !state.notified.has(userId)) {
      const name = nameOf(userId, ctx);
      const leftHm = db.getLastLeftHm(userId, date, key) ?? session.end;
      let mark;
      if (recognized && preExisting) mark = '✅ 출석 인정 (오늘 이미 인정됨)';
      else if (recognized) mark = '✅ 출석 인정';
      else mark = `⚠️ ${REQ_LABEL} 미만`;
      ctx.announce(`🏁 **${name}**님 ${session.label} 퇴근 (${leftHm}) — 누적 ${fmtDuration(mins)} ${mark}`);
    }
  }

  db.markFinalized(date, key);
  state.notified.clear();
}

// ── 재시작 복구 ────────────────────────────────────────────────────
export function recoverOnStartup(ctx) {
  const { date, hm } = kstParts();
  const current = sessionAt(hm);

  // 1) 미종료 구간 닫기: 현재 진행 중인 시간대면 지금 시각, 아니면 그 시간대 종료 시각으로.
  for (const seg of db.getAllOpenSegments()) {
    const isCurrent = seg.date === date && current?.key === seg.session;
    const leftHm = isCurrent ? hm : SESSIONS[seg.session].end;
    db.closeSegmentById(seg.id, leftHm);
  }

  // 2) 정산 누락 보완: 종료됐는데 finalized 안 된 시간대를 늦게라도 정산(무공지).
  for (const c of db.unfinalizedWithSegments()) {
    if (sessionEnded(c.date, c.session, date, hm)) {
      finalizeSession(ctx, c.date, SESSIONS[c.session], { notify: false });
      console.log(`[recover] 늦은 정산: ${c.date} ${c.session}`);
    }
  }

  // 3) 지금이 시간대 안이면 접속 중인 멤버 구간을 새로 연다.
  if (current) {
    resetSessionState();
    openSegmentsForPresentMembers(ctx, current, hm);
    console.log(`[recover] ${current.label} 진행 중 — 접속 멤버 구간 재개`);
  }
}
