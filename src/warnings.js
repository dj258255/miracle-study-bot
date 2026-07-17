import { PermissionFlagsBits } from 'discord.js';
import {
  WEEKLY_REQUIRED_DAYS,
  MAX_WARNINGS,
  NEW_MEMBER_GRACE_DAYS,
  EXEMPT_ROLE_NAME,
} from './config.js';
import { db } from './db.js';
import { kstParts, kstMondayOf, kstDateMinusDays } from './time.js';
import { postWeeklyRanking } from './ranking.js';

function isStaff(member) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.KickMembers)
  );
}

// 유예·신입 공통 원칙: 면제 기간이 점검 주(월~일)에 하루라도 걸쳐 있으면 그 주는 점검 면제.
// → 토요일에 유예가 끝나도 다음날 일요일 점검에 바로 걸리지 않고,
//   "복귀(가입) 후 첫 온전한 주"부터 점검 대상이 된다.

function isNewMember(member, weekStart) {
  if (!member.joinedTimestamp) return false;
  const joinDate = kstParts(new Date(member.joinedTimestamp)).date;
  const graceEnd = kstDateMinusDays(joinDate, -NEW_MEMBER_GRACE_DAYS); // 가입일 + 7일
  return graceEnd >= weekStart;
}

// 사정 있는 사람 유예: '출석유예' 역할 보유(무기한) 또는 /유예 명령어 등록(기간, 자동 만료).
function isExempt(member, weekStart) {
  if (member.roles.cache.some((r) => r.name === EXEMPT_ROLE_NAME)) return true;
  const until = db.getExemption(member.id);
  return !!until && until >= weekStart;
}

// 주간 점검 (매주 일요일, 마지막 정산 직후 — WEEKLY_CRON): 이번 주(월~일) 출석 3회 미만이면 경고 +1,
// 경고 3회 도달 시 Kick(+경고 0 초기화).
export async function runWeeklyCheck(ctx) {
  const { date } = kstParts();
  // 일요일 밤 실행 기준: 이번 주 월요일 ~ 오늘(일) = 정확히 이번 주 월~일.
  const since = kstMondayOf(date);
  const nowIso = new Date().toISOString();

  await ctx.guild.members.fetch(); // 전체 멤버 캐시 확보

  // 점검(경고)에 앞서 이번 주 랭킹부터 공지 — 긍정적인 소식 먼저
  await postWeeklyRanking(ctx).catch((e) => console.error('[rank]', e));

  for (const [userId, member] of ctx.guild.members.cache) {
    if (member.user.bot) continue;
    if (isStaff(member)) continue;
    if (isNewMember(member, since)) continue;
    if (isExempt(member, since)) continue;

    const count = db.countAttendanceSince(userId, since);
    if (count >= WEEKLY_REQUIRED_DAYS) continue;

    const newCount = db.bumpWarning(userId, nowIso);
    const name = member.displayName;

    if (newCount >= MAX_WARNINGS) {
      try {
        await member.kick(`출석 미달 경고 ${MAX_WARNINGS}회 누적`);
        db.setWarnings(userId, 0, nowIso); // 재입장 시 새 출발
        ctx.announce(
          `👋 **${name}**님이 경고 ${MAX_WARNINGS}회 누적으로 자리 정리되었습니다. 여유가 생기면 언제든 다시 돌아오세요!`
        );
      } catch (err) {
        console.error(`[weekly] kick 실패: ${userId}`, err);
        ctx.announce(
          `⚠️ ${name}님이 추방 대상(경고 ${newCount}회)이나 봇 권한/역할 위계 문제로 실패했습니다. 운영진 확인이 필요합니다.`
        );
      }
    } else {
      // 경고는 본인이 꼭 봐야 하므로 멘션(핑)으로 보낸다.
      ctx.announce(
        `⚠️ <@${userId}> 경고 ${newCount}/${MAX_WARNINGS} — 이번 주 출석 ${count}회 (기준: ${WEEKLY_REQUIRED_DAYS}회 이상)`
      );
    }
  }
}
