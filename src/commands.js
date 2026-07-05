import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { WEEKLY_REQUIRED_DAYS, MAX_WARNINGS } from './config.js';
import { db } from './db.js';
import { kstParts, kstMondayOf, kstDateMinusDays } from './time.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('출석현황')
    .setDescription('내 출석/경고 현황을 확인합니다'),

  new SlashCommandBuilder()
    .setName('유예')
    .setDescription('운영진 전용: 사정 있는 멤버를 일정 기간 출석 점검에서 제외합니다')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('대상').setDescription('유예할 멤버').setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName('일수')
        .setDescription('오늘부터 며칠간 유예할지')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(90)
    ),

  new SlashCommandBuilder()
    .setName('유예해제')
    .setDescription('운영진 전용: 멤버의 출석 유예를 해제합니다')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('대상').setDescription('유예 해제할 멤버').setRequired(true)),
];

export async function registerCommands(guild) {
  await guild.commands.set(commands.map((c) => c.toJSON()));
}

export async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  const { date } = kstParts();

  if (interaction.commandName === '출석현황') {
    const userId = interaction.user.id;
    const weekStart = kstMondayOf(date); // 이번 주 월요일
    const count = db.countAttendanceSince(userId, weekStart);
    const warn = db.getWarnings(userId);
    const remaining = Math.max(0, WEEKLY_REQUIRED_DAYS - count);
    const name = interaction.member?.displayName ?? interaction.user.username;

    const lines = [
      `📊 ${name}님의 출석 현황`,
      `- 이번 주(월~일) 출석: ${count}회 (기준: ${WEEKLY_REQUIRED_DAYS}회 이상)`,
      `- ${remaining === 0 ? '이번 주 기준 충족 ✅' : `일요일까지 ${remaining}회 더 필요해요`}`,
      `- 경고: ${warn}/${MAX_WARNINGS}`,
    ];
    const until = db.getExemption(userId);
    if (until && until >= date) lines.push(`- 유예 중: ${until}까지 점검 제외 🛌`);
    else if (until && until >= weekStart) lines.push(`- 유예 종료 — 이번 주 점검은 면제 🛌 (다음 주부터 다시 적용)`);

    await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === '유예') {
    const target = interaction.options.getUser('대상', true);
    const days = interaction.options.getInteger('일수', true);
    const until = kstDateMinusDays(date, -days); // 오늘 + N일
    db.setExemption(target.id, until, interaction.user.id, new Date().toISOString());
    await interaction.reply(
      `🛌 **${target.displayName}**님을 **${until}**까지 출석 점검에서 제외합니다. 기간이 지나면 자동으로 복귀돼요.`
    );
    return;
  }

  if (interaction.commandName === '유예해제') {
    const target = interaction.options.getUser('대상', true);
    db.clearExemption(target.id);
    await interaction.reply(
      `✅ **${target.displayName}**님의 출석 유예를 해제했습니다. 다음 주간 점검부터 다시 포함돼요.`
    );
    return;
  }
}
