# 아키텍처

## 전체 그림

```
디스코드 서버                          봇 프로세스 (Node.js)                SQLite (data/bot.db)
┌──────────────┐   voiceStateUpdate   ┌────────────────────┐
│ 음성채널 입장/퇴장 │ ──────────────────→ │ attendance.js       │ ──기록──→  voice_segments
│              │                      │  구간 열기/닫기       │
│ 공지 채널      │ ←──출근/퇴근 메시지──── │                    │
└──────────────┘                      ├────────────────────┤
                                      │ scheduler.js (cron) │
                    09:00, 19:00 ──→  │  접속중 멤버 구간 열기  │
                    12:00, 22:00 ──→  │  정산: 합산→출석 판정  │ ──기록──→  attendance
                    일 22:05     ──→  │  주간 점검→경고→추방   │ ──기록──→  warnings
                                      └────────────────────┘
```

핵심 아이디어: **실시간 이벤트는 "기록"만 하고, 판정은 정해진 시각에 "정산"한다.**
들락날락, 시간대 경계 걸침, 재입장 같은 복잡함이 전부 정산 시점의 단순한 합산 문제로 바뀐다.

## 이벤트 흐름

### voiceStateUpdate (실시간)

discord.js가 멤버의 음성 상태 변화마다 호출. `oldState`(이전) / `newState`(이후) 비교로 판별:

| oldState.channel | newState.channel | 의미 | 처리 |
|---|---|---|---|
| null | 스터디 채널 | 입장 | 구간 열기 + 공지 판단¹ + 디바운스 취소 |
| 스터디 채널 | null | 퇴장 | 구간 닫기 + 퇴근 디바운스 예약 (10분) |
| 스터디 채널 | 다른 채널 | 이동(나감) | 구간 닫기 + 퇴근 디바운스 예약 (10분) |
| 다른 채널 | 스터디 채널 | 이동(들어옴) | 구간 열기 + 공지 판단¹ + 디바운스 취소 |
| 그 외 (음소거 토글 등) | | 상태 변화 | 무시 |

¹ 공지 판단: 이 시간대 최초 입장 → `🌅 출근` / 퇴근 공지가 이미 나간 상태 → `재입장` / 그 외(10분 내 복귀) → 공지 없음

현재 시각이 시간대(오전/저녁) 밖이면 전부 무시한다.

### 퇴근 공지 디바운스

- 퇴장 시 `setTimeout(10분)` 예약. 만료 시점까지 재입장이 없으면 퇴근 공지 (퇴장 시각·누적 시간 표기, 문구는 SPEC §6)
- 타이머와 "퇴근 공지 나감" 상태는 **메모리로만** 관리한다 (`Map<userId, timer>`, `Set<userId>` — 시간대 단위로 리셋)
  - 봇이 시간대 중간에 재시작하면 소실 → 정산 때 보완 공지로 수습 (드문 중복/지연 감수, DB로 관리할 만큼의 가치가 없음)
- 디바운스 만료가 시간대 종료를 넘기는 경우(예: 11:55 퇴장) → 타이머 대신 정산이 공지를 담당
- **공지만 실시간이고, 출석 기록/판정은 여전히 정산에서만 한다** — 디바운스 공지의 ✅/⚠️는 그 시점 누적 기준 안내

### cron 스케줄 (Asia/Seoul 고정)

| 시각 | 작업 |
|---|---|
| `0 9 * * *` | 오전 시작 — 이미 접속 중인 멤버의 구간 열기 |
| `0 12 * * *` | 오전 정산 — 구간 닫기 → 합산 → 출석 판정 → 퇴근 공지 |
| `0 19 * * *` | 저녁 시작 (위와 동일) |
| `0 22 * * *` | 저녁 정산 (위와 동일) |
| `5 22 * * 0` | 주간 점검 (일요일 22:05, 저녁 정산 직후) — ① 주간 랭킹 공지(#명예의-전당) → ② 이번 주(월~일) 출석 < 3 → 경고, 경고 3회 → Kick + 경고 0 초기화. 봇/운영진/신규 7일/유예 멤버는 제외 |
| `5 0 1 * *` | 월간 랭킹 (매월 1일 00:05) — 지난달 출석 순위 공지 (#명예의-전당) |

## DB 스키마

```sql
-- 음성채널 참여 구간 (들락날락 1회 = 1행)
CREATE TABLE voice_segments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  date       TEXT NOT NULL,              -- 'YYYY-MM-DD' (KST)
  session    TEXT NOT NULL,              -- 'morning' | 'evening'
  joined_hm  TEXT NOT NULL,              -- 'HH:MM' (KST)
  left_hm    TEXT                        -- NULL = 아직 접속 중
);

-- 확정된 출석 (하루 1회)
CREATE TABLE attendance (
  user_id    TEXT NOT NULL,
  date       TEXT NOT NULL,
  session    TEXT NOT NULL,              -- 어느 시간대로 인정됐는지
  minutes    INTEGER NOT NULL,           -- 인정 당시 누적 분
  PRIMARY KEY (user_id, date)            -- 같은 날 중복 인정 차단
);

-- 경고 누적 (Kick 시 count를 0으로 초기화 — SPEC.md 재입장 정책)
CREATE TABLE warnings (
  user_id    TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- 정산 완료 이력 (정산 누락 복구의 판별 기준)
CREATE TABLE finalized_sessions (
  date       TEXT NOT NULL,
  session    TEXT NOT NULL,
  PRIMARY KEY (date, session)
);

-- 사정 있는 멤버 유예 (/유예 명령어로 등록, until_date 지나면 자동 무효)
CREATE TABLE exemptions (
  user_id    TEXT PRIMARY KEY,
  until_date TEXT NOT NULL,   -- 이 날짜(포함)까지 주간 점검 제외
  granted_by TEXT,
  created_at TEXT
);
```

설계 포인트:

- **`attendance`의 PK가 `(user_id, date)`** — "같은 날 오전·저녁 모두 참여해도 1회" 규칙이 스키마 수준에서 강제된다. 저녁 정산 때 `INSERT OR IGNORE`가 조용히 무시됨.
- 시간은 KST의 `HH:MM` 문자열로 저장 — 시간대가 자정을 넘지 않으므로 분 단위 계산이 단순해진다.
- SQLite 파일 하나(`data/bot.db`)가 전부 — 백업은 파일 복사면 충분.

## 정산 로직 (12:00 / 22:00)

```
1. 해당 (날짜, 시간대)의 열린 구간(left_hm IS NULL)을 종료 시각으로 닫는다
2. 유저별로 구간을 모아 합산:
     구간별 인정 시간 = max(0, min(퇴장, 시간대끝) - max(입장, 시간대시작))
3. 합계 ≥ 60분 → attendance에 INSERT OR IGNORE (이미 오전 인정이면 무시됨)
4. 공지 — **아직 퇴근 공지가 안 나간 참여자만** (종료까지 접속 중이던 사람 + 디바운스 대기 중이던 사람). 문구는 SPEC.md §6
5. finalized_sessions에 (날짜, 시간대) 기록 — 완료 표시
```

## 장애 복구

- **재시작 시**: `left_hm IS NULL`인 과거 구간 → 해당 시간대 종료 시각으로 닫기. 현재 시간대 진행 중이면 접속 중인 멤버의 구간을 새로 연다.
- **정산 누락**(정산 시각에 봇이 꺼져 있던 경우): 시작 시 `voice_segments`에 기록이 있는데 `finalized_sessions`에 없는 과거 (날짜, 시간대)를 찾아 늦은 정산 수행. 정산 성공 시 `finalized_sessions`에 기록하므로 멱등하다.
  - 주의: `attendance` 존재 여부로 정산 완료를 판별하면 안 된다 — 아무도 기준 시간을 못 채운 시간대는 attendance 기록이 없어도 정산은 끝난 상태이기 때문. 그래서 별도 테이블을 둔다.

## 필요한 디스코드 설정

| 항목 | 값 | 이유 |
|---|---|---|
| Gateway Intents | `Guilds`, `GuildVoiceStates`, `GuildMembers` | 음성 이벤트 수신, 멤버 조회/추방 |
| Privileged Intent (포털에서 켜기) | `SERVER MEMBERS INTENT` | GuildMembers는 특권 인텐트 |
| 봇 권한 | View Channels, Send Messages, **Kick Members** | 공지 + 추방 |
| 역할 위계 | 봇 역할이 일반 멤버 역할보다 **위** | 디스코드는 자기보다 높은 역할을 킥 못 함 |
