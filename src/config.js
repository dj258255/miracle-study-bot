import 'dotenv/config';

export const config = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  // 출석 인정 대상 음성채널 ID (쉼표 구분, 비워두면 모든 음성채널 인정)
  voiceChannelIds: (process.env.VOICE_CHANNEL_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // 출근/퇴근/경고 메시지를 올릴 텍스트 채널 ID
  announceChannelId: process.env.ANNOUNCE_CHANNEL_ID,
  // 새 멤버 환영 인사를 올릴 텍스트 채널 ID (비워두면 환영 메시지 비활성화)
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID ?? '',
  // 랭킹·레벨업 공지 채널 ID (비워두면 출석 공지 채널로 전송)
  rankChannelId: process.env.RANK_CHANNEL_ID ?? '',
};

// 스터디 시간대 정의 (KST). 테스트 시 start/end만 가까운 시각으로 바꾸면 전체 흐름을 짧게 검증할 수 있다.
export const SESSIONS = {
  morning: { key: 'morning', label: '오전', emoji: '🌅', start: '09:00', end: '12:00' },
  evening: { key: 'evening', label: '저녁', emoji: '🌙', start: '19:00', end: '22:00' },
};

// 출석 인정 최소 누적 시간 (분) — 테스트 시 REQUIRED_MINUTES로 오버라이드
// (2026-07-06 기준 완화: 120 → 60. 진입장벽은 낮추고, 경쟁은 랭킹의 누적 시간이 담당)
export const REQUIRED_MINUTES = Number(process.env.REQUIRED_MINUTES ?? 60);
// 최근 7일 기준 최소 출석 일수
export const WEEKLY_REQUIRED_DAYS = 3;
// 추방 기준 경고 횟수
export const MAX_WARNINGS = 3;
// 신규 멤버 유예 기간 (일) — 가입한 지 이 기간이 안 된 멤버는 주간 점검에서 제외
export const NEW_MEMBER_GRACE_DAYS = 7;
// 이 이름의 역할을 가진 멤버는 주간 점검에서 제외 (사정 있는 사람 수동 유예). 운영진이 역할을 만들어 부여.
export const EXEMPT_ROLE_NAME = process.env.EXEMPT_ROLE_NAME ?? '출석유예';
// 새 멤버 입장 시 자동 부여할 역할 (빈 문자열이면 비활성화)
export const MEMBER_ROLE_NAME = process.env.MEMBER_ROLE_NAME ?? '스터디원';
// 퇴장 후 이 시간(ms) 안에 재입장이 없으면 퇴근으로 공지 (테스트 시 DEBOUNCE_MS로 짧게 오버라이드)
export const LEAVE_DEBOUNCE_MS = Number(process.env.DEBOUNCE_MS ?? 10 * 60 * 1000);
// 주간 점검 크론 — 매주 일요일 22:05 KST (저녁 정산 직후). 이번 주(월~일) 출석을 집계한다.
export const WEEKLY_CRON = '5 22 * * 0';

export const TIMEZONE = 'Asia/Seoul';

// 레벨 정의 — 누적 출석 횟수(min) 이상이면 해당 레벨. 역할 자동 부여 + 칭호 표시에 사용.
export const LEVELS = [
  { lv: 1, name: '새싹', emoji: '🌱', min: 1, color: 0x2ecc71 },
  { lv: 2, name: '뿌리내림', emoji: '🌿', min: 10, color: 0x1abc9c },
  { lv: 3, name: '꾸준나무', emoji: '🌳', min: 25, color: 0x3498db },
  { lv: 4, name: '불꽃', emoji: '🔥', min: 50, color: 0xe67e22 },
  { lv: 5, name: '고인물', emoji: '💎', min: 100, color: 0x9b59b6 },
];

// 랭킹 공지에 표시할 최대 인원
export const RANK_TOP_N = 10;
// 월간 랭킹 크론 — 매월 1일 00:05 KST (지난달 집계)
export const MONTHLY_RANK_CRON = '5 0 1 * *';

export function validateConfig() {
  const missing = [];
  if (!config.token) missing.push('DISCORD_TOKEN');
  if (!config.guildId) missing.push('GUILD_ID');
  if (!config.announceChannelId) missing.push('ANNOUNCE_CHANNEL_ID');
  if (missing.length) {
    throw new Error(
      `필수 환경변수가 없습니다: ${missing.join(', ')}\n` +
        `.env.example을 참고해 .env를 채워주세요.`
    );
  }
}
