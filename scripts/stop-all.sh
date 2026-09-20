#!/usr/bin/env bash
# 이 레포가 띄운 개발 프로세스를 전부 정리한다.
#
# 래퍼만 죽이면 실제 작업을 하는 자식 node가 살아남는다. 한 번 그래서
# 26분 동안 CPU 4코어를 물고 발열이 심했다. 부모·자식을 모두 잡는다.
#
# 레포 이름은 스크립트 위치에서 유도한다. 예전에는 체크아웃 이름을 그대로
# 박아 놨는데, 레포가 옮겨지자 아무것도 못 죽이면서 "남은 프로세스: 0개"를
# 찍었다. 조용히 성공한 척하는 것이 안 도는 것보다 나쁘다.
#
# 자기 자신은 죽이지 않는다: ps 출력에는 아래 grep 의 argv 도 들어 있어서
# 이름을 그대로 찾으면 자기 셸까지 잡힌다. 첫 글자를 문자 클래스로 감싸면
# 패턴 문자열과 대상 문자열이 달라져 grep 이 자기를 못 찾는다.
# 주의: 레포 이름에 정규식 메타문자(. + [ 등)가 들어가면 이 패턴이 깨진다.
set -u

SELF=$$
ME="stop-all.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="$(basename "$ROOT")"
PATTERN="[${NAME:0:1}]${NAME:1}"

kill_matching() {
  ps -Ao pid,command \
    | grep "$PATTERN" \
    | grep -v "$ME" \
    | awk -v self="$SELF" '$1 != self {print $1}'
}

echo "정리 중... ($NAME)"
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
# 정렬을 ps 에 맡기지 않는다. -r 은 BSD 에서 "CPU 내림차순", GNU procps 에서는
# "실행 중인 것만" 으로 뜻이 다르고, --sort 는 GNU 전용이라 그것도 못 쓴다.
# tail -n +2 로 헤더를 떼야 헤더가 정렬에 섞이지 않는다.
ps -Ao pcpu,pid,comm | tail -n +2 | sort -k1 -rn | head -3 | sed 's/^/  /'
