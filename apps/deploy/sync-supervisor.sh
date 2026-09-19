#!/bin/zsh
# 동기화 감시자.
#
# DUST 동기화는 힙을 계속 키워서 한 프로세스로는 끝까지 가지 못한다
# (실측: 12분에 6.8GB). src/sync.ts 가 임계치에서 저장하고 17 로 나가면
# 여기서 새 프로세스로 이어받는다. 진행 지점은 .data/wallet-sync.json 에
# 남으므로 매 회차가 앞으로 나아간다.
#
# 사용: apps/deploy/sync-supervisor.sh [로그파일]
set -u
HERE="${0:A:h}"
LOG="${1:-$HERE/../../.data/sync.log}"
mkdir -p "${LOG:h}"

round=0
while true; do
  round=$((round + 1))
  print -r -- "" >> "$LOG"
  print -r -- "=== 회차 $round · $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG"
  ( cd "$HERE" && pnpm run sync >> "$LOG" 2>&1 )
  code=$?
  print -r -- "=== 회차 $round 종료 code=$code ===" >> "$LOG"

  case $code in
    0)   print -r -- "동기화 완료" >> "$LOG"; break ;;
    17)  print -r -- "힙 임계치 — 저장하고 이어받는다" >> "$LOG" ;;
    134|135|139) print -r -- "OOM/크래시 — 마지막 체크포인트에서 이어받는다" >> "$LOG" ;;
    *)   print -r -- "예상치 못한 종료. 30초 뒤 재시도" >> "$LOG"; sleep 30 ;;
  esac
  sleep 5
done
