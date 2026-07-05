# 미라클 알고리즘 스터디 봇

디스코드 음성채널 기반 **자동 출석 관리 봇**.
스터디원이 음성채널에 들어오면 자동으로 출근을 기록하고, 시간대가 끝나면 누적 시간을 정산해 출석을 인정한다. 주간 출석 기준 미달 시 경고를 부여하고, 경고 3회 누적 시 자동 추방한다.

## 핵심 기능

| 기능 | 설명 |
|---|---|
| 자동 출근/퇴근 | 음성채널 입장/퇴장을 감지해 `🌅 홍길동님 오전 출근 (09:02)` 형식으로 공지 |
| 출석 정산 | 오전(09~12) / 저녁(19~22) 시간대 내 **누적 2시간 이상** 참여 시 출석 인정 (하루 1회) |
| 주간 점검 | 최근 7일 출석 **3회 미만** 시 경고 +1 |
| 자동 추방 | 경고 **3회 누적** 시 서버에서 Kick — 처벌이 아닌 자리 정리로, **재입장 가능**하며 경고는 초기화됨. (문제 행동으로 인한 영구 차단은 운영진이 디스코드 기본 Ban 기능으로 직접 처리) |
| 출석 조회 | `/출석현황` 명령어로 본인 출석/경고 상태 확인 |

상세 규칙은 [docs/SPEC.md](docs/SPEC.md) 참고.

## 기술 스택

- **Node.js 22+** / **discord.js v14** — 봇 본체
- **better-sqlite3** — 출석 기록 저장 (파일 DB, 별도 DB 서버 불필요)
- **node-cron** — 시간대 정산(12:00, 22:00) 및 주간 점검 스케줄러
- **운영**: Oracle Cloud Always Free VM + systemd (24시간 무료 운영)

## 프로젝트 구조 (예정)

```
discord-bot/
├── src/
│   ├── index.js        # 진입점: 클라이언트 생성, 이벤트 연결
│   ├── config.js       # 환경변수, 시간대/기준값 상수
│   ├── db.js           # SQLite 스키마 및 쿼리
│   ├── time.js         # KST 시간 유틸
│   ├── attendance.js   # 음성 감지 → 구간 기록 → 출석 정산
│   ├── warnings.js     # 주간 점검, 경고, 추방
│   ├── scheduler.js    # cron 등록
│   └── commands.js     # /출석현황 등 슬래시 명령어
├── data/               # SQLite DB 파일 (gitignore)
├── docs/               # 문서
├── .env                # 토큰 등 비밀값 (gitignore)
└── package.json
```

## 빠른 시작 (로컬 개발)

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.example .env   # 토큰/채널 ID 채워넣기

# 3. 실행
npm start
```

봇 생성(토큰 발급)부터 처음 하는 경우 [docs/ROADMAP.md](docs/ROADMAP.md)의 Phase 0부터 따라가면 된다.

## 문서

- [ROADMAP.md](docs/ROADMAP.md) — 개발~배포 단계별 로드맵
- [SPEC.md](docs/SPEC.md) — 출석/경고 규칙 상세 명세와 엣지 케이스
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — 동작 원리, DB 스키마, 스케줄러 설계
- [DEPLOY-OCI.md](docs/DEPLOY-OCI.md) — Oracle Cloud 무료 VM 배포 가이드
- [ANNOUNCEMENT.md](docs/ANNOUNCEMENT.md) — 디스코드에 올릴 스터디 안내문 (개정판)
- [COMMANDS.md](docs/COMMANDS.md) — 슬래시 명령어 사용법과 권한 (`/출석현황`, `/유예`, `/유예해제`)
