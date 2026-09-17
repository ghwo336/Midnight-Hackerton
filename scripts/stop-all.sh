#!/usr/bin/env bash
# 이 레포가 띄운 개발 프로세스를 전부 정리한다.
#
# 래퍼만 죽이면 실제 작업을 하는 자식 node가 살아남는다. 한 번 그래서
# 26분 동안 CPU 4코어를 물고 발열이 심했다. 부모·자식을 모두 잡는다.
#
# 자기 자신은 죽이지 않는다: 스크립트 경로에도 레포 이름이 들어 있어서
# 단순 패턴 매칭으로는 자기 셸까지 잡힌다.
set -u

SELF=$$
ME="stop-all.sh"

kill_matching() {
  ps -Ao pid,command \
    | grep "[m]idngiht-probability" \
    | grep -v "$ME" \
    | awk -v self="$SELF" '$1 != self {print $1}'
}

echo "정리 중..."
for pid in $(kill_matching); do kill "$pid" 2>/dev/null; done
docker stop once-proof-server >/dev/null 2>&1

sleep 2
left=$(kill_matching)
if [ -n "$left" ]; then
  echo "강제 종료: $(echo "$left" | tr '\n' ' ')"
  for pid in $left; do kill -9 "$pid" 2>/dev/null; done
  sleep 1
fi

n=$(kill_matching | wc -l | tr -d ' ')
echo "남은 프로세스: ${n}개"
echo "CPU 상위 3:"
ps -Ao pcpu,pid,comm -r | head -4 | sed 's/^/  /'
