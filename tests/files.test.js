// sw.js의 FILES가 실제 파일과 맞는지 확인한다. 어긋나면 오프라인 실행이나 업데이트가 조용히 멈춘다.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const listed = [...readFileSync(new URL('sw.js', root), 'utf8').matchAll(/^ {2}'\.\/(.*)',$/gm)].map((m) => m[1]).filter(Boolean);

const walk = (dir) =>
  readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`]));

test('FILES에 있는 파일은 모두 존재한다', () => {
  for (const file of listed) assert.doesNotThrow(() => readFileSync(new URL(file, root)), file);
});

test('앱이 쓰는 파일은 모두 FILES에 있다', () => {
  const used = [...walk('js/'), ...walk('css/'), ...walk('icons/')];
  assert.deepEqual(used.filter((f) => !listed.includes(f)), []);
});

test('기록 형식을 바꾸면 sw.js도 바뀐다', () => {
  // sw.js가 그대로면 새 워커가 설치되지 않아, 옛 코드가 떠 있는 창이 새 형식의 기록을 줄여 덮어쓴다
  const version = readFileSync(new URL('js/store.js', root), 'utf8').match(/^export const VERSION = (\d+);$/m)?.[1];
  const marked = readFileSync(new URL('sw.js', root), 'utf8').match(/기록 형식 (\d+)/)?.[1];
  assert.ok(version);
  assert.equal(marked, version);
});
