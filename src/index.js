import { Client, GatewayIntentBits, Events } from 'discord.js';
import { config, validateConfig, MEMBER_ROLE_NAME } from './config.js';
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

  const ctx = {
    guild,
    announce: (text) =>
      announceChannel.send({ content: text }).catch((err) => console.error('[announce]', err)),
  };

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

  // 새 멤버 입장 시 스터디원 역할 자동 부여 (봇에 '역할 관리' 권한 + 역할 위계 필요)
  client.on(Events.GuildMemberAdd, async (m) => {
    if (m.guild.id !== config.guildId || m.user.bot || !MEMBER_ROLE_NAME) return;
    const role = m.guild.roles.cache.find((r) => r.name === MEMBER_ROLE_NAME);
    if (!role) return console.warn(`[join] '${MEMBER_ROLE_NAME}' 역할이 서버에 없음`);
    try {
      await m.roles.add(role, '신규 입장 자동 배정');
      console.log(`[join] ${m.displayName} → ${role.name} 부여`);
    } catch (err) {
      console.error('[join] 역할 부여 실패:', err.message);
    }
  });

  console.log('[ready] 봇 가동 중');
});

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

client.login(config.token);
