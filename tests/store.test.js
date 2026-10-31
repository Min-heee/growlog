// node --test tests/ 로 실행한다. 저장소가 잠깐 막혔다가 돌아오는 경우를 흉내 낸다.
import assert from 'node:assert/strict';
import test from 'node:test';

const KEY = 'growlog:v1';

/** 가짜 localStorage를 깔고 store.js를 새로 불러온다 */
async function boot(saved, { reads = true, writes = true } = {}) {
  const box = new Map(saved ? [[KEY, JSON.stringify(saved)]] : []);
  const gate = { reads, writes };
  const handlers = [];
  globalThis.addEventListener = (type, fn) => handlers.push([type, fn]);
  globalThis.localStorage = {
    getItem(key) {
      if (!gate.reads) throw new Error('read blocked');
      return box.get(key) ?? null;
    },
    setItem(key, value) {
      if (!gate.writes) throw new Error('write blocked');
      box.set(key, value);
    },
    removeItem(key) {
      box.delete(key);
    },
  };
  const store = await import(`../js/store.js?${Math.random()}`);
  const disk = () => JSON.parse(box.get(KEY));
  const otherTab = (edit) => {
    const s = disk();
    edit(s);
    box.set(KEY, JSON.stringify(s));
    handlers.filter(([type]) => type === 'storage').forEach(([, fn]) => fn({ key: KEY }));
  };
  return { store, gate, disk, otherTab };
}

const seeded = () => ({
  version: 1,
  areas: [{ id: 'a', label: '일', emoji: '✨', goal: 60, kind: 'load', color: 1 }],
  entries: [{ id: 'e1', date: '2026-10-01', areaId: 'a', minutes: 30 }],
  sleep: {},
  checkins: {},
  sleepGoal: 9,
  theme: 'dark',
});
const add = (store, minutes) => store.addEntry({ date: '2026-10-02', areaId: 'a', minutes });

test('시작할 때 읽지 못해도 돌아오면 기록을 덮어쓰지 않고 변경만 얹는다', async () => {
  const { store, gate, disk } = await boot(seeded(), { reads: false, writes: false });
  assert.equal(store.hasSaveFailed(), true);
  assert.equal(store.getState().entries.length, 0);
  store.setCheckin('2026-10-02', { mood: 5 });
  Object.assign(gate, { reads: true, writes: true });
  store.retrySave();
  assert.equal(store.hasSaveFailed(), false);
  assert.equal(disk().entries.length, 1);
  assert.equal(disk().sleepGoal, 9);
  assert.equal(disk().checkins['2026-10-02'].mood, 5);
  assert.equal(store.getState().entries.length, 1);
});

test('읽기만 막혀도 기본값으로 덮어쓰지 않는다', async () => {
  const { store, gate, disk } = await boot(seeded(), { reads: false });
  store.setCheckin('2026-10-02', { mood: 5 });
  assert.equal(store.hasSaveFailed(), true);
  assert.equal(disk().entries.length, 1);
  gate.reads = true;
  store.retrySave();
  assert.equal(disk().entries.length, 1);
  assert.equal(disk().checkins['2026-10-02'].mood, 5);
});

test('변경 없이 저장소가 돌아오면 기록을 다시 불러오고 경고를 내린다', async () => {
  const { store, gate } = await boot(seeded(), { reads: false, writes: false });
  Object.assign(gate, { reads: true, writes: true });
  store.retrySave();
  assert.equal(store.hasSaveFailed(), false);
  assert.equal(store.getState().sleepGoal, 9);
});

test('저장이 막힌 동안 다른 탭이 저장한 것을 지우지 않는다', async () => {
  const { store, gate, disk, otherTab } = await boot(seeded());
  gate.writes = false;
  add(store, 10);
  assert.equal(store.hasSaveFailed(), true);
  otherTab((s) => s.entries.push({ id: 'b', date: '2026-10-03', areaId: 'a', minutes: 20 }));
  assert.equal(store.getState().entries.length, 3); // 내 변경도 다른 탭 저장도 보인다
  gate.writes = true;
  store.retrySave();
  assert.deepEqual(disk().entries.map((e) => e.minutes).sort((a, b) => a - b), [10, 20, 30]);
});

test('저장 실패 중에 추가한 기록은 여러 번 다시 적용해도 하나이고 지울 수 있다', async () => {
  const { store, gate, disk } = await boot(seeded());
  gate.writes = false;
  add(store, 10);
  add(store, 11);
  assert.equal(store.getState().entries.length, 3);
  const { id } = store.getState().entries.find((e) => e.minutes === 10);
  store.deleteEntry(id);
  assert.equal(store.getState().entries.length, 2);
  gate.writes = true;
  store.retrySave();
  assert.deepEqual(disk().entries.map((e) => e.minutes), [30, 11]);
});

test('기록이 알림 없이 사라져도 메모리의 기록을 버리지 않는다', async () => {
  const { store, gate, disk } = await boot(seeded());
  void gate;
  globalThis.localStorage.removeItem(KEY);
  store.setCheckin('2026-10-02', { mood: 5 });
  assert.equal(disk().entries.length, 1);
  assert.equal(disk().sleepGoal, 9);
});

test('저장 실패 중 복원한 백업은 다시 적용해도 같은 id를 쓴다', async () => {
  const { store, gate } = await boot(seeded());
  gate.writes = false;
  const backup = seeded();
  backup.entries = [{ date: '2026-10-05', areaId: 'a', minutes: 5 }, { date: '2026-10-06', areaId: 'a', minutes: 7 }];
  store.replaceState(backup);
  const { id } = store.getState().entries.find((e) => e.minutes === 5);
  store.deleteEntry(id);
  assert.deepEqual(store.getState().entries.map((e) => e.minutes), [7]);
});

test('읽지 못하는 동안에는 되돌릴 수 없는 일을 막을 수 있다', async () => {
  const { store, gate } = await boot(seeded(), { reads: false });
  assert.equal(store.canRead(), false);
  gate.reads = true;
  assert.equal(store.canRead(), true);
});

test('읽을 수 있게 되면 판단하기 전에 진짜 기록을 다시 불러온다', async () => {
  const { store, gate } = await boot(seeded(), { reads: false, writes: false });
  assert.equal(store.getState().entries.length, 0);
  Object.assign(gate, { reads: true, writes: true });
  assert.equal(store.canRead(), true);
  assert.equal(store.getState().entries.length, 1);
});

test('되돌리기를 두 번 눌러도 기록이 둘이 되지 않는다', async () => {
  const { store, disk } = await boot(seeded());
  const [entry] = store.getState().entries;
  store.deleteEntry(entry.id);
  store.restoreEntry(entry);
  store.restoreEntry(entry);
  assert.equal(disk().entries.length, 1);
});

test('다른 탭이 영역을 채우면 추가에 실패했다고 알려준다', async () => {
  const base = seeded();
  base.areas = [1, 2, 3, 4, 5, 6].map((color) => ({ id: `a${color}`, label: `영역${color}`, emoji: '✨', goal: 0, kind: 'load', color }));
  const { store } = await boot(base);
  assert.equal(store.addArea({ label: '하나 더', emoji: '✨', goal: 0, kind: 'load' }), false);
});
