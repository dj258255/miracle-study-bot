import { PermissionFlagsBits } from 'discord.js';
import {
  WEEKLY_REQUIRED_DAYS,
  MAX_WARNINGS,
  NEW_MEMBER_GRACE_DAYS,
  EXEMPT_ROLE_NAME,
} from './config.js';
import { db } from './db.js';
import { kstParts, kstMondayOf } from './time.js';

function isStaff(member) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.KickMembers)
  );
}

function isNewMember(member) {
  if (!member.joinedTimestamp) return false;
  const ageMs = Date.now() - member.joinedTimestamp;
  return ageMs < NEW_MEMBER_GRACE_DAYS * 24 * 60 * 60 * 1000;
}

// 사정 있는 사람 유예: '출석유예' 역할 보유(무기한) 또는 /유예 명령어 등록(기간, 자동 만료).
function isExempt(member, today) {
  if (member.roles.cache.some((r) => r.name === EXEMPT_ROLE_NAME)) return true;
  const until = db.getExemption(member.id);
  return !!until && until >= today;
}

// 주간 점검 (매주 일요일 22:05, 저녁 정산 직후): 이번 주(월~일) 출석 3회 미만이면 경고 +1,
// 경고 3회 도달 시 Kick(+경고 0 초기화).
export async function runWeeklyCheck(ctx) {
  const { date } = kstParts();
  // 일요일 22:05 실행 기준: 이번 주 월요일 ~ 오늘(일) = 정확히 이번 주 월~일.
  const since = kstMondayOf(date);
  const nowIso = new Date().toISOString();

  await ctx.guild.members.fetch(); // 전체 멤버 캐시 확보

  for (const [userId, member] of ctx.guild.members.cache) {
    if (member.user.bot) continue;
    if (isStaff(member)) continue;
    if (isNewMember(member)) continue;
    if (isExempt(member, date)) continue;

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
