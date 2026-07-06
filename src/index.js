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
        // 새 멤버는 위로 스크롤하지 않으므로, 환영 멘션이 전체 안내글 역할까지 한다.
        const link = (n) => {
          const c = m.guild.channels.cache.find((c) => c.name === n);
          return c ? `<#${c.id}>` : `#${n}`;
        };
        await ch.send(
          `# 👋 ${m}님, 미라클 알고리즘 스터디에 오신 것을 환영합니다!\n\n` +
            `꾸준한 코딩테스트 학습 습관을 만드는 스터디예요. 아래 순서로 둘러보세요! 🙌\n\n` +
            `1️⃣ ${link('공지사항')} — 스터디 규칙과 출석 방식 (필독!)\n` +
            `2️⃣ ${link('명령어-가이드')} — 봇 명령어와 레벨 시스템 안내\n` +
            `3️⃣ ${link('모각코')} — 스터디 음성채널. 화면 공유를 켜고 각자 문제를 풀어요 💻\n` +
            `4️⃣ ${link('출석-알림')} — 출근/퇴근/출석이 자동으로 기록되는 곳\n` +
            `5️⃣ ${link('명예의-전당')} — 주간·월간 출석 랭킹과 레벨업 소식 🏆\n` +
            `6️⃣ ${link('스터디-대화방')} — 문제 질문·풀이 토론·오늘 푼 문제 공유는 여기서!\n\n` +
            `🌱 ${m}님의 출석 점검은 **${resume}(월)부터** 적용돼요. 그 전까지는 편하게 적응하시면 됩니다.\n` +
            `궁금한 점은 운영진에게 편하게 물어봐 주세요! 😊`
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
