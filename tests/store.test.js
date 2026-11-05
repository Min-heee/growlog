// node --test 로 실행한다. 저장소가 잠깐 막혔다가 돌아오는 경우를 흉내 낸다.
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

test('이미 닫은 표시는 다시 닫아도 날짜가 바뀌지 않고, 되돌리면 방금 닫은 것만 열린다', async () => {
  const base = seeded();
  base.marks = [
    { id: 'a', date: '2026-10-01', sev: 3, fuzz: 0, closedOn: '2026-10-03', createdAt: 1 },
    { id: 'b', date: '2026-10-05', sev: 2, fuzz: 0, createdAt: 2 },
  ];
  const { store, disk } = await boot(base);
  store.closeMarks(['a', 'b'], '2026-10-09');
  assert.deepEqual(disk().marks.map((m) => m.closedOn), ['2026-10-03', '2026-10-09']);
  store.reopenMarks(['b']);
  assert.deepEqual(disk().marks.map((m) => m.closedOn), ['2026-10-03', undefined]);
});

test('저장 실패 중에 남긴 표시는 다시 적용해도 하나다', async () => {
  const { store, gate, disk } = await boot(seeded());
  gate.writes = false;
  store.addMark({ date: '2026-10-05', sev: 2, fuzz: 0 });
  store.addRebase('2026-10-06');
  const ids = store.getState().marks.map((m) => m.id);
  gate.writes = true;
  store.retrySave();
  assert.deepEqual(disk().marks.map((m) => m.id), ids);
});

test('다른 탭이 영역을 채우면 추가에 실패했다고 알려준다', async () => {
  const base = seeded();
  base.areas = [1, 2, 3, 4, 5, 6, 7, 8].map((color) => ({ id: `a${color}`, label: `영역${color}`, emoji: '✨', goal: 0, kind: 'load', color }));
  const { store } = await boot(base);
  assert.equal(store.addArea({ label: '하나 더', emoji: '✨', goal: 0, kind: 'load' }), null);
});

test('기록만 비울 때는 고른 테마를 남기고, 모두 지우면 기본값으로 돌아간다', async () => {
  const { store } = await boot({ ...seeded(), theme: 'light' });
  store.resetState({ keepTheme: true });
  assert.equal(store.getState().theme, 'light');
  assert.deepEqual(store.getState().entries, []);
  store.resetState();
  assert.equal(store.getState().theme, 'dark');
});

test('저장 실패 중에 닫은 도움 안내는 다시 적용해도 닫은 시각이 그대로라, 그 뒤에 남긴 심한 표시를 가리지 않는다', async () => {
  const { store, gate, disk } = await boot(seeded());
  gate.writes = false;
  store.setSupportSeen();
  const seen = store.getState().supportSeen;
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.addMark({ date: '2026-10-05', sev: 3, fuzz: 0 });
  assert.equal(store.getState().supportSeen, seen);
  gate.writes = true;
  store.retrySave();
  assert.equal(disk().supportSeen, seen);
  assert.ok(disk().marks[0].createdAt > seen);
});

test('아이폰 앱 안에서는 저장한 내용을 앱에도 그대로 보낸다', async () => {
  const sent = [];
  globalThis.webkit = { messageHandlers: { growlog: { postMessage: (message) => sent.push(message) } } };
  const { store, disk } = await boot(seeded());
  add(store, 15);
  delete globalThis.webkit;
  assert.deepEqual(JSON.parse(sent.at(-1).save), disk());
});

test('브라우저에서는 앱으로 보내는 일 없이 저장한다', async () => {
  const { store, disk } = await boot(seeded());
  add(store, 15);
  assert.equal(disk().entries.length, 2);
});

test('새 영역은 고른 색으로 만들고, 다른 영역이 쓰는 색으로는 바꾸지 않는다', async () => {
  const { store, disk } = await boot(seeded());
  const id = store.addArea({ label: '독서', kind: 'varies', color: 5 });
  assert.equal(disk().areas.find((a) => a.id === id).color, 5);
  assert.equal(store.addArea({ label: '같은 색', color: 5 }) !== null, true);
  assert.notEqual(disk().areas.at(-1).color, 5);
  store.updateArea(id, { color: 1 }); // 1번은 seeded의 '일'이 쓰고 있다
  assert.equal(disk().areas.find((a) => a.id === id).color, 5);
  store.updateArea(id, { color: 9, label: '책' });
  assert.deepEqual([disk().areas.find((a) => a.id === id).color, disk().areas.find((a) => a.id === id).label], [9, '책']);
});

test('처음 시작하면 영역이 비어 있다', async () => {
  const { store } = await boot(null);
  assert.deepEqual(store.getState().areas, []);
});

test('예전의 에너지를 채워요 영역은 그때그때 다른 일이 되고, 그동안의 기록은 채워졌어요로 친다', async () => {
  const base = seeded();
  base.areas.push({ id: 'run', label: '러닝', emoji: '🏃', goal: 0, kind: 'recovery', color: 2 });
  base.entries.push({ id: 'r1', date: '2026-10-01', areaId: 'run', minutes: 30 }, { id: 'r2', date: '2026-10-02', areaId: 'run', minutes: 20, feel: 'drain' });
  const { store, disk } = await boot(base);
  const state = store.getState();
  assert.equal(store.areaById('run').kind, 'varies');
  assert.equal(store.areaById('a').kind, 'load');
  assert.deepEqual(state.entries.map((e) => e.feel), [undefined, 'fill', 'drain']);
  add(store, 10); // 저장하면 옮긴 값이 그대로 남는다
  assert.equal(disk().areas.find((a) => a.id === 'run').kind, 'varies');
  assert.equal(disk().entries.find((e) => e.id === 'r1').feel, 'fill');
});

test('모르는 영역 종류는 해야 하는 일로, 모르는 끝나고 나니는 버린다', () => {
  return boot(null).then(({ store }) => {
    const state = store.normalize({
      areas: [{ id: 'x', label: 'x', kind: 'weird' }, { id: 'y', label: 'y', kind: 'varies' }],
      entries: [{ id: 'e', date: '2026-10-01', areaId: 'y', minutes: 5, feel: 'great' }, { id: 'f', date: '2026-10-01', areaId: 'y', minutes: 5, feel: 'same' }],
    });
    assert.deepEqual(state.areas.map((a) => a.kind), ['load', 'varies']);
    assert.deepEqual(state.entries.map((e) => e.feel), [undefined, 'same']);
    assert.equal('feel' in state.entries[0], false);
  });
});

test('기록에 끝나고 나니를 남기고 고칠 수 있고, 다음 기록은 지난번 값에서 시작한다', async () => {
  const { store, disk } = await boot(seeded());
  const area = store.addArea({ label: '게임', kind: 'varies' });
  assert.equal(store.lastFeel(area), 'same'); // 처음에는 계산에 넣지 않는 값
  const first = store.addEntry({ date: '2026-10-02', areaId: area, minutes: 60, feel: 'fill', createdAt: 1 });
  assert.equal(disk().entries.find((e) => e.id === first).feel, 'fill');
  store.addEntry({ date: '2026-10-03', areaId: area, minutes: 240, feel: 'drain', createdAt: 2 });
  assert.equal(store.lastFeel(area), 'drain');
  store.setEntryFeel(first, 'same');
  store.setEntryFeel(first, 'nope');
  assert.equal(disk().entries.find((e) => e.id === first).feel, 'same');
  assert.equal(store.lastFeel(area), 'drain'); // 고친 기록이 아니라 가장 최근 기록을 따른다
  const plain = store.addEntry({ date: '2026-10-03', areaId: 'a', minutes: 10, feel: 'bogus' });
  assert.equal('feel' in disk().entries.find((e) => e.id === plain), false);
  store.updateArea(area, { kind: 'recovery' }); // 예전 값으로는 바꾸지 않는다
  assert.equal(store.areaById(area).kind, 'varies');
});

test('예전 채워요 영역은 기록이 없어도 처음 값이 채워졌어요다', async () => {
  const base = seeded();
  base.areas.push({ id: 'walk', label: '산책', emoji: '🚶', goal: 0, kind: 'recovery', color: 3 });
  const { store } = await boot(base);
  assert.equal(store.lastFeel('walk'), 'fill');
  const id = store.addArea({ label: '게임', kind: 'varies' });
  assert.equal(store.lastFeel(id), 'same');
});

test('더 새 버전 앱이 남긴 기록은 읽지 않고 덮어쓰지도 않는다', async () => {
  const newer = { ...seeded(), version: 99, areas: [{ id: 'a', label: '일', kind: 'future', color: 1 }] };
  const { store, disk } = await boot(newer);
  assert.equal(store.hasSaveFailed(), true);
  add(store, 15);
  assert.equal(disk().version, 99);
  assert.equal(disk().areas[0].kind, 'future');
  assert.equal(store.hasNewerData(), true);
  assert.equal(JSON.parse(store.storedText()).version, 99); // 백업은 이 내용을 그대로 남긴다
  assert.equal(store.isNewer(newer), true);
  assert.equal(store.isBackup(newer), false);
  assert.equal(store.isNewer(seeded()), false);
  assert.equal(store.normalize(seeded()).version, store.VERSION);
  const { store: fresh } = await boot(seeded());
  assert.equal(fresh.hasNewerData(), false);
});
