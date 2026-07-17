import { RANK_TOP_N } from './config.js';
import { db } from './db.js';
import { kstParts, kstMondayOf, kstDateMinusDays, fmtDuration } from './time.js';
import { levelFor } from './levels.js';

const MEDALS = ['🥇', '🥈', '🥉'];

// 기간 내 출석 순위 줄들 (현재 서버 멤버만).
// 정렬: 출석일 → 누적 공부시간. 일수·시간이 모두 같으면 공동 순위 (다음 순위는 건너뜀: 1,1,3).
function rankingLines(ctx, from, to) {
  const rows = db.rankBetween(from, to).filter((r) => ctx.guild.members.cache.has(r.user_id));

  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.days === r.days && prev.mins === r.mins ? prev.rank : i + 1;
  });

  return rows.slice(0, RANK_TOP_N).map((r) => {
    const member = ctx.guild.members.cache.get(r.user_id);
    const lv = levelFor(db.countAttendanceTotal(r.user_id));
    const badge = lv ? `${lv.emoji} ` : '';
    const sym = MEDALS[r.rank - 1] ?? `${r.rank}위`;
    const tie = rows.filter((o) => o.rank === r.rank).length > 1 ? ' (공동)' : '';
    return `${sym} ${badge}**${member.displayName}** — ${r.days}일 · ${fmtDuration(r.mins)}${tie}`;
  });
}

// 주간 랭킹 — 일요일 밤 주간 점검(WEEKLY_CRON) 직전에 호출 (이번 주 월~일 집계).
export async function postWeeklyRanking(ctx) {
  await ctx.guild.members.fetch().catch(() => {});
  const { date } = kstParts(); // 일요일
  const from = kstMondayOf(date);
  const body = rankingLines(ctx, from, date);
  if (!body.length) return;
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  ctx.announceRank(
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
  ctx.announceRank(
    [`👑 **${y}년 ${Number(m)}월 출석 랭킹**`, ...body, '', '한 달 동안 정말 수고 많았어요! 🎊'].join('\n')
  );
}
