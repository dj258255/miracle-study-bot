import { LEVELS } from './config.js';
import { db } from './db.js';

// 누적 출석 횟수로 현재 레벨을 구한다 (0회면 null).
export function levelFor(count) {
  let cur = null;
  for (const l of LEVELS) if (count >= l.min) cur = l;
  return cur;
}

// 다음 레벨 (최고 레벨이면 null).
export function nextLevel(count) {
  return LEVELS.find((l) => count < l.min) ?? null;
}

export const roleNameOf = (l) => `Lv.${l.lv} ${l.emoji} ${l.name}`;
const LEVEL_ROLE_RE = /^Lv\.\d+ /;

async function ensureLevelRole(guild, level) {
  const name = roleNameOf(level);
  let role = guild.roles.cache.find((r) => r.name === name);
  if (!role) {
    role = await guild.roles.create({ name, color: level.color, reason: '레벨 역할 자동 생성' });
    // 멤버 목록에서 레벨 색이 보이도록 스터디원 역할보다 위로 (실패해도 기능엔 지장 없음)
    const memberRole = guild.roles.cache.find((r) => r.name === '스터디원');
    if (memberRole) await role.setPosition(memberRole.position + 1).catch(() => {});
  }
  return role;
}

// 출석이 새로 인정될 때 호출: 레벨 역할 동기화 + 레벨업 공지.
export async function syncLevelRole(ctx, userId) {
  const member = ctx.guild.members.cache.get(userId);
  if (!member || member.user.bot) return;

  const total = db.countAttendanceTotal(userId);
  const level = levelFor(total);
  if (!level) return;

  const target = await ensureLevelRole(ctx.guild, level);
  if (member.roles.cache.has(target.id)) return; // 레벨 변화 없음

  // 이전 레벨 역할 제거 후 새 레벨 부여
  const stale = member.roles.cache.filter((r) => LEVEL_ROLE_RE.test(r.name) && r.id !== target.id);
  for (const [, r] of stale) await member.roles.remove(r, '레벨 갱신').catch(() => {});
  await member.roles.add(target, '레벨 달성');

  ctx.announceRank(`🎉 **${member.displayName}**님 레벨 업! → ${roleNameOf(level)} (누적 출석 ${total}회)`);
}
