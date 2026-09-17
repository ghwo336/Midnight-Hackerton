#!/usr/bin/env bash
# 동기화가 끝날 때까지 감독한다.
#
# Preprod 첫 동기화는 진행에 비례해 메모리를 먹고 결국 OOM으로 죽는다
# (실측: 69%에서 힙 6.65GB). 힙을 더 키우면 16GB 머신에서 스왑이 걸린다.
#
# 대신 이렇게 한다: 2분마다 체크포인트를 저장하고, 죽으면 재시작한다.
# **재시작하면 힙이 초기화되므로** 매 회차가 직전 지점부터 이어가며
# 조금씩 전진한다. deployment.json이 생기면 끝난 것이다.
set -u
cd "$(dirname "$0")/.." || exit 1

LOG=/tmp/sync.log
MAX=40
i=0

while [ $i -lt $MAX ]; do
  i=$((i+1))
  if [ -f apps/deploy/deployment.json ]; then
    echo "[감독] 배포 완료됨. 종료."
    exit 0
  fi

  off=$(node -pe 'try{JSON.parse(JSON.parse(require("fs").readFileSync(".data/wallet-sync.json","utf8")).state).offset}catch(e){0}' 2>/dev/null)
  echo "[감독] 회차 $i 시작 (저장된 offset ${off:-0})" | tee -a "$LOG"

  (cd apps/deploy && pnpm run deploy) >> "$LOG" 2>&1
  code=$?

  if [ $code -eq 0 ]; then
    echo "[감독] 회차 $i 정상 종료. 배포 완료." | tee -a "$LOG"

    # 배포가 끝나면 나머지 파이프라인을 이어서 돌린다.
    # 사람이 붙어 있지 않아도 A5/A6 재현과 문서 반영까지 끝나야 한다.
    echo "[감독] 테스트넷 A5/A6 재현 시작" | tee -a "$LOG"
    (cd apps/deploy && pnpm run scenario) >> "$LOG" 2>&1
    scode=$?
    echo "[감독] 시나리오 종료 (code $scode)" | tee -a "$LOG"

    echo "[감독] 문서 반영" | tee -a "$LOG"
    node scripts/record-deployment.mjs >> "$LOG" 2>&1
    rcode=$?
    echo "[감독] 문서 반영 종료 (code $rcode)" | tee -a "$LOG"
    if [ $rcode -eq 2 ]; then
      echo "[감독] 경고: A5 확정 건수가 1건이 아니다. 사람이 확인할 것." | tee -a "$LOG"
    fi

    echo "[감독] 파이프라인 완료." | tee -a "$LOG"
    exit 0
  fi

  echo "[감독] 회차 $i 비정상 종료 (code $code). 체크포인트에서 재개." | tee -a "$LOG"
  sleep 5
done

echo "[감독] $MAX회 시도 후 중단." | tee -a "$LOG"
exit 1
