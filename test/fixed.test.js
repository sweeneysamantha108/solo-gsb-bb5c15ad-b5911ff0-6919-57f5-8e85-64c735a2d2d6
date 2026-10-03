import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createApp } from '../src/server.js';
import { solve, verify, computeHash } from '../src/solver.js';

// ---------- 求解器：固定孔位（纯函数） ----------

const base = (over = {}) => ({
  holes: 4,
  tolerance: 0.5,
  holeMaxMass: [100, 100, 100, 100],
  tubes: [],
  weights: [],
  exclusionPairs: [],
  fixedHoles: [],
  ...over,
});
const all4 = [0, 1, 2, 3];
const holeOf = (r, id) =>
  r.arrangement.findIndex((s) => s && s.kind === 'tube' && s.ref === id);

test('固定孔位：被绑定的管必须位于指定孔', () => {
  const data = base({
    tubes: [
      { id: 'A', mass: 50, usableHoles: all4 },
      { id: 'B', mass: 50, usableHoles: all4 },
    ],
    fixedHoles: [{ tubeId: 'A', hole: 1 }],
  });
  const r = solve(data);
  assert.equal(r.feasible, true);
  assert.equal(holeOf(r, 'A'), 1);
  // B 被推到与 A 对径的孔 3（0 配重、差和 0 下的字典序最优）
  assert.equal(holeOf(r, 'B'), 3);
  assert.equal(r.weightCount, 0);
  assert.equal(verify(data, r.arrangement).ok, true);
});

test('固定孔被其余管视为不可用：未绑定管不会占据固定孔', () => {
  // 6 孔：B 固定孔 5；A 只能取与 B 对径的孔 2（孔 5 对 A 不可用）
  const data = {
    holes: 6,
    tolerance: 0,
    holeMaxMass: Array(6).fill(100),
    tubes: [
      { id: 'A', mass: 50, usableHoles: [0, 1, 2, 3, 4] },
      { id: 'B', mass: 50, usableHoles: [0, 1, 2, 3, 4, 5] },
    ],
    weights: [],
    exclusionPairs: [],
    fixedHoles: [{ tubeId: 'B', hole: 5 }],
  };
  const r = solve(data);
  assert.equal(r.feasible, true);
  assert.equal(holeOf(r, 'A'), 2);
  assert.equal(holeOf(r, 'B'), 5);
});

test('固定孔位本身可与容差冲突：无解并在原因中给出固定信息', () => {
  // A 固定孔 0、B 固定孔 1（相邻侧）：对 (0,2) 为 50 vs 0，容差 0.5 → 无解
  const data = base({
    tubes: [
      { id: 'A', mass: 50, usableHoles: all4 },
      { id: 'B', mass: 50, usableHoles: all4 },
    ],
    fixedHoles: [
      { tubeId: 'A', hole: 0 },
      { tubeId: 'B', hole: 1 },
    ],
  });
  const r = solve(data);
  assert.equal(r.feasible, false);
  assert.ok(r.reasons.join('\n').includes('孔 0 固定为「A」'), r.reasons.join('\n'));
  // 放开固定绑定后可行（同质量对径放置）
  assert.equal(solve({ ...data, fixedHoles: [] }).feasible, true);
});

test('固定孔位可通过增加配重恢复可行（配重数仍最少）', () => {
  const data = base({
    tubes: [
      { id: 'A', mass: 50, usableHoles: all4 },
      { id: 'B', mass: 50, usableHoles: all4 },
    ],
    weights: [{ mass: 50, quantity: 2 }],
    fixedHoles: [
      { tubeId: 'A', hole: 0 },
      { tubeId: 'B', hole: 1 },
    ],
  });
  const r = solve(data);
  assert.equal(r.feasible, true);
  assert.equal(r.weightCount, 2);
  assert.equal(holeOf(r, 'A'), 0);
  assert.equal(holeOf(r, 'B'), 1);
  assert.equal(verify(data, r.arrangement).ok, true);
});

test('固定孔位与避邻规则同时求解', () => {
  // 6 孔：D 固定孔 5，A/B 避邻；0 配重方案 A,∅,C,B,∅,D
  const data = {
    holes: 6,
    tolerance: 0,
    holeMaxMass: Array(6).fill(100),
    tubes: ['A', 'B', 'C', 'D'].map((id) => ({ id, mass: 50, usableHoles: [0, 1, 2, 3, 4, 5] })),
    weights: [],
    exclusionPairs: [{ a: 'A', b: 'B' }],
    fixedHoles: [{ tubeId: 'D', hole: 5 }],
  };
  const r = solve(data);
  assert.equal(r.feasible, true);
  assert.equal(holeOf(r, 'D'), 5);
  const ha = holeOf(r, 'A');
  const hb = holeOf(r, 'B');
  const dist = Math.abs(ha - hb);
  assert.ok(dist !== 1 && dist !== 5, `A/B adjacent: ${ha},${hb}`);
  assert.equal(verify(data, r.arrangement).ok, true);
});

test('固定绑定本身不合法（未知管/越界孔/孔不可用/重复）时纯函数判无解', () => {
  const tubes = [
    { id: 'A', mass: 50, usableHoles: [0] },
    { id: 'B', mass: 50, usableHoles: all4 },
  ];
  assert.equal(solve(base({ tubes, fixedHoles: [{ tubeId: 'X', hole: 0 }] })).feasible, false);
  assert.equal(solve(base({ tubes, fixedHoles: [{ tubeId: 'A', hole: 9 }] })).feasible, false);
  assert.equal(solve(base({ tubes, fixedHoles: [{ tubeId: 'A', hole: 2 }] })).feasible, false);
  assert.equal(
    solve(base({
      tubes,
      fixedHoles: [
        { tubeId: 'A', hole: 0 },
        { tubeId: 'B', hole: 0 },
      ],
    })).feasible,
    false,
  );
  assert.equal(
    solve(base({
      tubes,
      fixedHoles: [
        { tubeId: 'B', hole: 0 },
        { tubeId: 'B', hole: 1 },
      ],
    })).feasible,
    false,
  );
});

test('verify 独立复核：固定孔放置错误被识别', () => {
  const data = base({
    tubes: [
      { id: 'A', mass: 50, usableHoles: all4 },
      { id: 'B', mass: 50, usableHoles: all4 },
    ],
    fixedHoles: [{ tubeId: 'A', hole: 1 }],
  });
  // 求解图满足；手工把 A/B 对调（A 在 3、B 在 1）违反 A→孔1 的固定
  const good = solve(data).arrangement;
  assert.equal(verify(data, good).ok, true);
  const swapped = [
    null,
    { kind: 'tube', ref: 'B', mass: 50 },
    null,
    { kind: 'tube', ref: 'A', mass: 50 },
  ];
  const v = verify(data, swapped);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((x) => x.includes('固定孔位')), v.errors.join(';'));
});

test('数据指纹：无固定孔时与历史一致；绑定存在/变化/清空均改变指纹', () => {
  const data = base({
    tubes: [{ id: 'A', mass: 50, usableHoles: all4 }],
  });
  const legacy = { ...data };
  delete legacy.fixedHoles;
  assert.equal(computeHash(data), computeHash(legacy));
  const f1 = { ...data, fixedHoles: [{ tubeId: 'A', hole: 0 }] };
  assert.notEqual(computeHash(f1), computeHash(data));
  // 存储顺序不同但绑定集合相同 → 同一指纹
  const f1b = { ...data, fixedHoles: [{ hole: 0, tubeId: 'A' }] };
  assert.equal(computeHash(f1), computeHash(f1b));
  const f2 = { ...data, fixedHoles: [{ tubeId: 'A', hole: 1 }] };
  assert.notEqual(computeHash(f1), computeHash(f2));
});

// ---------- HTTP API：固定孔位维护 + 发布事务复核 + 失效不改写历史 ----------

let baseUrl;
let server;
let db;

before(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const { SCHEMA } = await import('../src/db.js');
  db.exec(SCHEMA);
  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function call(method, p, body) {
  const res = await fetch(`${baseUrl}/${p.replace(/^\/+/, '')}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, json };
}

const cfg = { holes: 4, tolerance: 0.5, holeMaxMass: [100, 100, 100, 100] };
const allTubes = [
  { id: 'A', mass: 50, usableHoles: [0, 1, 2, 3] },
  { id: 'B', mass: 50, usableHoles: [0, 1, 2, 3] },
];

test('HTTP 准备：配置转子与离心管', async () => {
  assert.equal((await call('PUT', 'api/config', cfg)).status, 200);
  assert.equal((await call('PUT', 'api/tubes', allTubes)).status, 200);
  const g = await call('GET', 'api/fixed-holes');
  assert.deepEqual(g.json, []);
});

test('保存固定绑定并查看（按孔位升序）', async () => {
  const r = await call('PUT', 'api/fixed-holes', [{ tubeId: 'A', hole: 1 }]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const g = await call('GET', 'api/fixed-holes');
  assert.deepEqual(g.json, [{ tubeId: 'A', hole: 1 }]);
  const s = await call('GET', 'api/state');
  assert.deepEqual(s.json.data.fixedHoles, [{ tubeId: 'A', hole: 1 }]);
});

test('草稿满足固定绑定；发布冻结绑定且独立复核通过', async () => {
  const sv = await call('POST', 'api/solve');
  assert.equal(sv.status, 200);
  assert.equal(sv.json.feasible, true);
  const arr = sv.json.result.arrangement;
  assert.equal(arr[1].ref, 'A');
  const pub = await call('POST', 'api/publish');
  assert.equal(pub.status, 201, JSON.stringify(pub.json));
  assert.deepEqual(pub.json.config.fixedHoles, [{ tubeId: 'A', hole: 1 }]);
  assert.equal(pub.json.result.arrangement[1].ref, 'A');
});

test('未知管、重复管、重复孔、越界孔、孔不在可用孔位内 → 400 整组拒绝且保留原数据', async () => {
  // 先在无固定绑定的前提下准备一支可用孔位仅为 [0] 的管 C
  await call('PUT', 'api/tubes', [
    ...allTubes,
    { id: 'C', mass: 50, usableHoles: [0] },
  ]);
  const put = (rows) => call('PUT', 'api/fixed-holes', rows);
  let r = await put([{ tubeId: 'ZZZ', hole: 0 }]);
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.join(';').includes('未知管'));
  r = await put([
    { tubeId: 'A', hole: 0 },
    { tubeId: 'A', hole: 1 },
  ]);
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.join(';').includes('重复绑定'));
  r = await put([
    { tubeId: 'A', hole: 0 },
    { tubeId: 'B', hole: 0 },
  ]);
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.join(';').includes('重复绑定'));
  r = await put([{ tubeId: 'A', hole: 4 }]);
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.join(';').includes('越界'));
  // C 的可用孔位只有 [0]：绑定孔 2 → 拒绝（孔不在可用孔位内）
  r = await put([{ tubeId: 'C', hole: 2 }]);
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.join(';').includes('可用孔位'));
  // 恢复管表；原绑定（A→1）始终保持不变（整组拒绝不留部分数据）
  await call('PUT', 'api/tubes', allTubes);
  const g = await call('GET', 'api/fixed-holes');
  assert.deepEqual(g.json, [{ tubeId: 'A', hole: 1 }]);
});

test('固定在超重孔位的绑定被拒绝', async () => {
  // 把孔 3 承重降到 10：A=50 固定孔 3 → 拒绝
  const cfgLow = { holes: 4, tolerance: 0.5, holeMaxMass: [100, 100, 100, 10] };
  assert.equal((await call('PUT', 'api/config', cfgLow)).status, 200);
  const r = await call('PUT', 'api/fixed-holes', [
    { tubeId: 'A', hole: 1 },
    { tubeId: 'B', hole: 3 },
  ]);
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.join(';').includes('承重'));
  const g = await call('GET', 'api/fixed-holes');
  assert.deepEqual(g.json, [{ tubeId: 'A', hole: 1 }]);
  assert.equal((await call('PUT', 'api/config', cfg)).status, 200);
});

test('修改管可用孔位使现有绑定失效 → PUT tubes 整次拒绝并保留原数据', async () => {
  // 当前绑定 A→1：把 A 的可用孔位限制为 [0] → 失效，拒绝
  const r = await call('PUT', 'api/tubes', [
    { id: 'A', mass: 50, usableHoles: [0] },
    { id: 'B', mass: 50, usableHoles: [0, 1, 2, 3] },
  ]);
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.join(';').includes('固定孔位'));
  const s = await call('GET', 'api/state');
  assert.deepEqual(s.json.data.tubes.find((t) => t.id === 'A').usableHoles, [0, 1, 2, 3]);
  assert.deepEqual(s.json.data.fixedHoles, [{ tubeId: 'A', hole: 1 }]);
});

test('删除被绑定管使绑定失效 → 拒绝；先清空绑定后允许', async () => {
  let r = await call('PUT', 'api/tubes', [{ id: 'B', mass: 50, usableHoles: [0, 1, 2, 3] }]);
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.join(';').includes('固定孔位'));
  // 清空绑定
  r = await call('PUT', 'api/fixed-holes', []);
  assert.equal(r.status, 200);
  r = await call('PUT', 'api/tubes', [{ id: 'B', mass: 50, usableHoles: [0, 1, 2, 3] }]);
  assert.equal(r.status, 200);
  // 恢复
  assert.equal((await call('PUT', 'api/tubes', allTubes)).status, 200);
});

test('缩小转子孔数使固定孔越界 → PUT config 整次拒绝', async () => {
  const cfg6 = { holes: 6, tolerance: 0.5, holeMaxMass: Array(6).fill(100) };
  assert.equal((await call('PUT', 'api/config', cfg6)).status, 200);
  // 6 孔下把 A 的可用孔位放开并固定到孔 5
  assert.equal(
    (
      await call('PUT', 'api/tubes', [
        { id: 'A', mass: 50, usableHoles: [0, 1, 2, 3, 4, 5] },
        { id: 'B', mass: 50, usableHoles: [0, 1, 2, 3, 4, 5] },
      ])
    ).status,
    200,
  );
  assert.equal(
    (await call('PUT', 'api/fixed-holes', [{ tubeId: 'A', hole: 5 }])).status,
    200,
  );
  // 缩回 4 孔：固定孔 5（与可用孔 4、5）越界 → 整次拒绝
  const shrink = await call('PUT', 'api/config', cfg);
  assert.equal(shrink.status, 400);
  assert.ok(shrink.json.errors.join(';').includes('固定孔位'));
  const s = await call('GET', 'api/state');
  assert.equal(s.json.data.holes, 6);
  // 先清空绑定，再恢复管可用孔位（4 孔），最后缩回 4
  assert.equal((await call('PUT', 'api/fixed-holes', [])).status, 200);
  assert.equal((await call('PUT', 'api/tubes', allTubes)).status, 200);
  assert.equal((await call('PUT', 'api/config', cfg)).status, 200);
});

test('固定绑定与避邻规则同时冲突无解时不得发布', async () => {
  // A 固定孔 0、B 固定孔 1 且 A/B 避邻，无配重 → 无解
  await call('PUT', 'api/fixed-holes', [
    { tubeId: 'A', hole: 0 },
    { tubeId: 'B', hole: 1 },
  ]);
  await call('PUT', 'api/exclusions', [{ a: 'A', b: 'B' }]);
  const pub = await call('POST', 'api/publish');
  assert.equal(pub.status, 400);
  assert.ok(pub.json.errors.join('\n').includes('不存在可行装载图'));
  // 原因包含固定绑定信息
  assert.ok(pub.json.errors.join('\n').includes('固定'));
  await call('PUT', 'api/exclusions', []);
});

test('绑定变化使旧发布图不可用于当前装载，但历史图不改写', async () => {
  // 当前 A→0、B→1 无解：给两枚 50g 配重即可发布
  await call('PUT', 'api/weights', [{ mass: 50, quantity: 2 }]);
  const pub = await call('POST', 'api/publish');
  assert.equal(pub.status, 201, JSON.stringify(pub.json));
  const pubId = pub.json.id;
  const frozen = JSON.stringify(pub.json.result);

  // 修改绑定（A→1）→ 旧图不可用，但内容冻结不变
  await call('PUT', 'api/weights', []);
  await call('PUT', 'api/fixed-holes', [{ tubeId: 'A', hole: 1 }]);
  let p = await call('GET', `api/publications/${pubId}`);
  assert.equal(p.json.usable, false);
  assert.equal(JSON.stringify(p.json.result), frozen);
  assert.deepEqual(p.json.config.fixedHoles, [
    { tubeId: 'A', hole: 0 },
    { tubeId: 'B', hole: 1 },
  ]);

  // 清空绑定 → 指纹再变，旧图仍不可用；当前数据可独立发布
  await call('PUT', 'api/fixed-holes', []);
  p = await call('GET', `api/publications/${pubId}`);
  assert.equal(p.json.usable, false);

  // 改回完全相同的绑定与配重 → 指纹恢复，旧图重新可用
  await call('PUT', 'api/weights', [{ mass: 50, quantity: 2 }]);
  await call('PUT', 'api/fixed-holes', [
    { tubeId: 'A', hole: 0 },
    { tubeId: 'B', hole: 1 },
  ]);
  p = await call('GET', `api/publications/${pubId}`);
  assert.equal(p.json.usable, true, JSON.stringify(p.json));
});
