import { Client, GatewayIntentBits, Events } from 'discord.js';
import { config, validateConfig, MEMBER_ROLE_NAME, NEW_MEMBER_GRACE_DAYS } from './config.js';
import { db } from './db.js';
import { kstParts, kstDateMinusDays, kstMondayOf } from './time.js';
import { syncLevelRole } from './levels.js';
import { handleVoiceStateUpdate, recoverOnStartup } from './attendance.js';
import { registerCommands, handleInteraction } from './commands.js';
import { registerSchedules } from './scheduler.js';

validateConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[ready] ${c.user.tag} 로그인 완료`);

  const guild = await client.guilds.fetch(config.guildId);
  await guild.channels.fetch();
  await guild.members.fetch();

  const announceChannel = await guild.channels.fetch(config.announceChannelId);
  if (!announceChannel?.isTextBased()) {
    throw new Error('ANNOUNCE_CHANNEL_ID가 텍스트 채널이 아닙니다.');
  }

  // 랭킹·레벨업 전용 채널 (미설정/조회 실패 시 출석 공지 채널로 폴백)
  const rankChannel = config.rankChannelId
    ? await guild.channels.fetch(config.rankChannelId).catch(() => null)
    : null;

  const ctx = {
    guild,
    announce: (text) =>
      announceChannel.send({ content: text }).catch((err) => console.error('[announce]', err)),
    announceRank: (text) =>
      (rankChannel ?? announceChannel)
        .send({ content: text })
        .catch((err) => console.error('[rank]', err)),
  };
  // 출석이 새로 인정될 때 레벨 역할 동기화 (attendance.js에서 호출)
  ctx.syncLevel = (userId) =>
    syncLevelRole(ctx, userId).catch((err) => console.error('[level]', err));

  await registerCommands(guild);
  console.log('[ready] 슬래시 명령어 등록 완료');

  recoverOnStartup(ctx);
  registerSchedules(ctx);

  client.on(Events.VoiceStateUpdate, (oldState, newState) =>
    handleVoiceStateUpdate(oldState, newState, ctx)
  );
  client.on(Events.InteractionCreate, (interaction) =>
    handleInteraction(interaction).catch((err) => console.error('[interaction]', err))
  );

  // 새 멤버 입장: 스터디원 역할 자동 부여 + 환영 인사 (점검 시작일 안내)
  client.on(Events.GuildMemberAdd, async (m) => {
    if (m.guild.id !== config.guildId || m.user.bot) return;

    if (MEMBER_ROLE_NAME) {
      const role = m.guild.roles.cache.find((r) => r.name === MEMBER_ROLE_NAME);
      if (!role) console.warn(`[join] '${MEMBER_ROLE_NAME}' 역할이 서버에 없음`);
      else {
        try {
          await m.roles.add(role, '신규 입장 자동 배정');
          console.log(`[join] ${m.displayName} → ${role.name} 부여`);
        } catch (err) {
          console.error('[join] 역할 부여 실패:', err.message);
        }
      }
    }

    if (config.welcomeChannelId) {
      try {
        const ch = await m.guild.channels.fetch(config.welcomeChannelId);
        // 적응 기간(가입+7일)이 걸친 주까지 점검 면제 → 그다음 주 월요일부터 적용
        const graceEnd = kstDateMinusDays(kstParts().date, -NEW_MEMBER_GRACE_DAYS);
        const resume = kstDateMinusDays(kstMondayOf(graceEnd), -7);
        const byName = (n) =>
          m.guild.channels.cache.find((c) => c.isTextBased?.() && c.name === n);
        const notice = byName('공지사항');
        const guide = byName('명령어-가이드');
        await ch.send(
          `👋 ${m}님, 미라클 알고리즘 스터디에 오신 것을 환영합니다!\n` +
            `적응 기간이 있어서 출석 점검은 **${resume}(월)부터** 적용돼요 🌱 그 전까지 편하게 둘러보세요.\n` +
            `스터디 규칙은 ${notice ?? '#공지사항'}, 봇 사용법은 ${guide ?? '#명령어-가이드'} 참고!`
        );
        console.log(`[join] ${m.displayName} 환영 인사 (점검 시작 ${resume})`);
      } catch (err) {
        console.error('[join] 환영 메시지 실패:', err.message);
      }
    }
  });

  // 서버를 떠나면(자진 퇴장·추방 모두 이 이벤트 발생) 경고 초기화 — 재입장 시 새 출발.
  // 출석 이력은 보존 (경고 카운트만 리셋).
  client.on(Events.GuildMemberRemove, (m) => {
    if (m.guild.id !== config.guildId || m.user?.bot) return;
    db.setWarnings(m.id, 0, new Date().toISOString());
    console.log(`[leave] ${m.displayName ?? m.id} 퇴장 — 경고 초기화`);
  });

  console.log('[ready] 봇 가동 중');
});

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

client.login(config.token);
