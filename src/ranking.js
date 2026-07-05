import { RANK_TOP_N } from './config.js';
import { db } from './db.js';
import { kstParts, kstMondayOf, kstDateMinusDays, fmtDuration } from './time.js';
import { levelFor } from './levels.js';

const MEDALS = ['🥇', '🥈', '🥉'];

// 기간 내 출석 순위 줄들 (현재 서버 멤버만, 출석일 → 누적시간 순).
function rankingLines(ctx, from, to) {
  return db
    .rankBetween(from, to)
    .filter((r) => ctx.guild.members.cache.has(r.user_id))
    .slice(0, RANK_TOP_N)
    .map((r, i) => {
      const member = ctx.guild.members.cache.get(r.user_id);
      const lv = levelFor(db.countAttendanceTotal(r.user_id));
      const badge = lv ? `${lv.emoji} ` : '';
      const rank = MEDALS[i] ?? `${i + 1}위`;
      return `${rank} ${badge}**${member.displayName}** — ${r.days}일 · ${fmtDuration(r.mins)}`;
    });
}

// 주간 랭킹 — 일요일 22:05 주간 점검 직전에 호출 (이번 주 월~일 집계).
export async function postWeeklyRanking(ctx) {
  await ctx.guild.members.fetch().catch(() => {});
  const { date } = kstParts(); // 일요일
  const from = kstMondayOf(date);
  const body = rankingLines(ctx, from, date);
  if (!body.length) return;
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  ctx.announce(
    [`🏆 **이번 주 출석 랭킹** (${md(from)} ~ ${md(date)})`, ...body, '', '이번 주도 다들 수고했어요! 🔥'].join('\n')
  );
}

// 월간 랭킹 — 매월 1일 00:05에 지난달(1일~말일) 집계.
export async function postMonthlyRanking(ctx) {
  await ctx.guild.members.fetch().catch(() => {});
  const { date } = kstParts(); // 매월 1일
  const lastDayPrev = kstDateMinusDays(date, 1);
  const from = lastDayPrev.slice(0, 8) + '01';
  const body = rankingLines(ctx, from, lastDayPrev);
  if (!body.length) return;
  const [y, m] = from.split('-');
  ctx.announce(
    [`👑 **${y}년 ${Number(m)}월 출석 랭킹**`, ...body, '', '한 달 동안 정말 수고 많았어요! 🎊'].join('\n')
  );
}
