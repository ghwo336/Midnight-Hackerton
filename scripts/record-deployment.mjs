#!/usr/bin/env node
/**
 * 배포 결과를 README와 TEST_REPORT에 반영한다.
 *
 * 손으로 옮기면 주소 한 글자가 틀려도 심사위원이 확인할 수 없게 된다.
 * deployment.json / scenario-result.json을 읽어 기계적으로 채운다.
 *
 *   node scripts/record-deployment.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployPath = resolve(root, 'apps/deploy/deployment.json');
const scenarioPath = resolve(root, 'apps/deploy/scenario-result.json');
const readmePath = resolve(root, 'README.md');

if (!existsSync(deployPath)) {
  console.error('deployment.json이 없다. 아직 배포되지 않았다.');
  process.exit(1);
}

const d = JSON.parse(readFileSync(deployPath, 'utf8'));
const s = existsSync(scenarioPath) ? JSON.parse(readFileSync(scenarioPath, 'utf8')) : null;

const indexer = `https://indexer.${d.network}.midnight.network/api/v3/graphql`;
const txOf = (label) => d.transactions?.find((t) => t.label === label);

const financeSettled = s?.steps?.find((x) => x.outcome === 'settled' && x.step.startsWith('A5'));
const financeRejected = s?.steps?.find((x) => x.outcome === 'rejected' && x.step.startsWith('A5'));
const a6Rejected = s?.steps?.find((x) => x.step.includes('A6 지연'));

const rows = [
  ['네트워크', `Midnight ${d.network}`],
  ['컨트랙트 주소', `\`${d.contractAddress}\``],
  ['배포 tx', txOf('deploy') ? `\`${txOf('deploy').txId}\` (블록 ${txOf('deploy').block})` : '—'],
  ['`finance` 성공 tx', financeSettled?.txId ? `\`${financeSettled.txId}\`` : '—'],
  ['`finance` 중복 거부', financeRejected ? `거부됨 — ${financeRejected.detail.slice(0, 80)}` : '—'],
  ['A6 지연 제출', a6Rejected ? `${a6Rejected.outcome === 'rejected' ? '거부됨' : '⚠️ 확정됨'}` : '—'],
  ['배포 시각', d.deployedAt ?? '—'],
];

const block = [
  '',
  '| 항목 | 값 |',
  '|---|---|',
  ...rows.map(([k, v]) => `| ${k} | ${v} |`),
  '',
  `인덱서에서 직접 확인: \`${indexer}\``,
  '',
  '```graphql',
  `query { contractActions(address: "${d.contractAddress}") { ... } }`,
  '```',
  '',
  s ? `A5 동시 신청 결과: 확정 **${s.a5SettledCount}건** (기대: 1건)` : '',
  '',
].join('\n');

let readme = readFileSync(readmePath, 'utf8');
const begin = '<!-- DEPLOYMENT:BEGIN -->';
const end = '<!-- DEPLOYMENT:END -->';
const i = readme.indexOf(begin);
const j = readme.indexOf(end);
if (i === -1 || j === -1) {
  console.error('README에 DEPLOYMENT 블록이 없다.');
  process.exit(1);
}
readme = readme.slice(0, i + begin.length) + block + readme.slice(j);
writeFileSync(readmePath, readme);

console.log('README §5를 채웠다:');
for (const [k, v] of rows) console.log(`  ${k.padEnd(20)} ${v}`);
if (s && s.a5SettledCount !== 1) {
  console.error(`\n⚠️ A5 확정 건수가 ${s.a5SettledCount}건이다. 1건이어야 한다.`);
  process.exit(2);
}
