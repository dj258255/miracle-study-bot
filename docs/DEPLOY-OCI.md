# Oracle Cloud (OCI) 무료 VM 배포 가이드

목표: 봇을 Always Free VM에서 24시간 운영. 부팅 시 자동 시작, 죽으면 자동 재시작.

## ✅ 배포 완료 상태 (2026-07-06)

운영 중. 서버 주소·계정·키 경로 등 **실제 값은 `docs/DEPLOY-RECORD.local.md`에 있다** (보안상 git 제외 — 공개 저장소에 서버 IP를 남기지 않는다).

| 항목 | 값 |
|---|---|
| 서버 | OCI Always Free VM (1 OCPU / 1GB, **Rocky Linux 9.6**, x86_64) |
| 코드 위치 | `~/discord-bot` (GitHub 저장소 checkout) |
| 서비스 | `discord-bot.service` (systemd, 자동 재시작) |
| 배포 방법 | **`main`에 push하면 GitHub Actions가 자동 배포** (`.github/workflows/deploy.yml`) |
| DB 백업 | 매일 04:00 크론 → `~/backups/bot-날짜.db`, 30일 보관 |
| 비밀값 | 서버 `~/discord-bot/.env` (git 밖) + GitHub Secrets(`OCI_HOST/USER/SSH_KEY`, Actions 접속용) |

### 코드 수정 후 배포하기 (이게 전부)

```bash
git add -A && git commit -m "변경 내용" && git push
# → GitHub Actions가 알아서: 서버 git pull → npm ci → systemd 재시작
```

### 서버 직접 확인이 필요할 때

```bash
ssh -i <SSH키 경로> <계정>@<서버IP>      # 실제 값: DEPLOY-RECORD.local.md
systemctl status discord-bot          # 상태
journalctl -u discord-bot -f          # 실시간 로그
sudo systemctl restart discord-bot    # 수동 재시작
```

> Rocky Linux는 아래 Ubuntu 가이드와 명령이 조금 다르다: `apt` → `dnf`, 기본 계정 `ubuntu` → `rocky`. 아래는 새 VM을 처음부터 만들 때의 일반 가이드.

---

## 1. 가입

1. https://signup.cloud.oracle.com 에서 가입
2. **홈 리전은 South Korea Central (Seoul)** 선택 — ⚠️ 홈 리전은 나중에 변경 불가
3. 본인 확인용 신용/체크카드 등록 (Always Free만 쓰면 청구 0원)
4. 가입 거절되는 경우가 종종 있음 — 정보 불일치 없이 재시도, 안 되면 며칠 후 다시

## 2. VM 생성

Compute → Instances → **Create Instance**:

| 항목 | 값 |
|---|---|
| Image | **Ubuntu 24.04** (Canonical) |
| Shape | **VM.Standard.A1.Flex** (ARM, 무료로 최대 4 OCPU/24GB) — 봇에는 1 OCPU/6GB면 충분 |
| | A1이 "Out of capacity"면 **VM.Standard.E2.1.Micro** (x86, 1GB)로 — 봇 하나엔 이것도 충분 |
| SSH Key | 키 페어 생성 → **프라이빗 키 다운로드** (분실 시 접속 불가) |

> A1.Flex는 인기가 많아 용량 부족이 잦다. E2.1.Micro 2대는 거의 항상 바로 생성된다.

생성 후 인스턴스의 **Public IP** 확인.

## 3. 접속 및 환경 구성

```bash
# 로컬에서 접속
chmod 600 ~/Downloads/ssh-key.key
ssh -i ~/Downloads/ssh-key.key ubuntu@<PUBLIC_IP>
```

VM 안에서:

```bash
# 패키지 업데이트
sudo apt update && sudo apt upgrade -y

# Node.js 22 LTS 설치
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git build-essential
node -v   # v22.x 확인
```

> `build-essential`은 better-sqlite3의 네이티브 모듈 컴파일에 필요하다.

E2.1.Micro(RAM 1GB)를 쓰는 경우 스왑을 잡아둔다 — `npm install` 시 네이티브 컴파일 메모리 스파이크 대비:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab   # 재부팅 후에도 유지
```

## 4. 코드 배포

```bash
# GitHub에 올려뒀다면
git clone https://github.com/<계정>/discord-bot.git
cd discord-bot
npm install

# .env 작성 (토큰은 절대 git에 올리지 않는다)
nano .env
```

GitHub를 안 쓰면 로컬에서 `scp -i <키> -r ./discord-bot ubuntu@<IP>:~/`로 복사해도 된다.

동작 확인:

```bash
npm start   # 봇 온라인 확인 후 Ctrl+C
```

## 5. systemd 서비스 등록 (핵심)

터미널을 꺼도 돌고, 크래시/재부팅에도 스스로 살아나게 만드는 단계.

```bash
sudo nano /etc/systemd/system/discord-bot.service
```

```ini
[Unit]
Description=Miracle Algorithm Study Discord Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/discord-bot
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now discord-bot   # 부팅 자동시작 + 즉시 시작

# 상태/로그 확인
systemctl status discord-bot
journalctl -u discord-bot -f              # 실시간 로그
```

## 6. DB 백업

SQLite 파일 하나만 지키면 된다. 매일 새벽 백업 cron:

```bash
crontab -e
# 매일 04:00에 날짜 붙여 복사, 30일 지난 백업 삭제
0 4 * * * cp /home/ubuntu/discord-bot/data/bot.db /home/ubuntu/backups/bot-$(date +\%Y\%m\%d).db && find /home/ubuntu/backups -name "bot-*.db" -mtime +30 -delete
```

```bash
mkdir -p ~/backups
```

## 7. 코드 업데이트 방법

```bash
cd ~/discord-bot
git pull
npm install            # 의존성 바뀐 경우만
sudo systemctl restart discord-bot
```

## 8. 주의사항

- **유휴 회수 정책**: 무료 계정의 놀고 있는 인스턴스는 회수될 수 있다. 봇이 상시 접속을 유지하므로 보통 문제없지만, 걱정되면 계정을 PAYG(종량제)로 업그레이드하면 회수 대상에서 제외된다 (Always Free 한도 내면 여전히 0원).
- **VM 시간대는 건드릴 필요 없음**: 봇 코드가 모든 시간 계산을 Asia/Seoul로 직접 하므로 서버가 UTC여도 무관.
- **방화벽**: 봇은 밖에서 들어오는 연결을 받지 않으므로(아웃바운드만 사용) 포트를 열 필요가 없다. 기본 설정 그대로 두면 된다.
- **토큰 유출 시**: Developer Portal에서 즉시 Regenerate → `.env` 교체 → 재시작.
