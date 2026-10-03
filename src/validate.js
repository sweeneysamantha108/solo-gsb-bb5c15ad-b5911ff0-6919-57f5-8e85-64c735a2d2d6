// 输入校验。任何一条不合法即抛出 ValidationError（HTTP 400），
// 调用方据此整体回滚，绝不写入部分数据。

export class ValidationError extends Error {
  constructor(errors, detail = null) {
    super(Array.isArray(errors) ? errors.join('；') : errors);
    this.errors = Array.isArray(errors) ? errors : [errors];
    this.status = 400;
    this.detail = detail;
  }
}

// 409：状态冲突（核验草稿已存在 / 版本过期 / 记录已冻结等）
export class ConflictError extends Error {
  constructor(errors, extra = {}) {
    super(Array.isArray(errors) ? errors.join('；') : errors);
    this.errors = Array.isArray(errors) ? errors : [errors];
    this.status = 409;
    Object.assign(this, extra);
  }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

const WEIGHT_REF_RE = /^配重#\d+-\d+$/;

function assert(cond, errors, msg) {
  if (!cond) errors.push(msg);
}

export function validateConfig(input, currentData) {
  const errors = [];
  assert(input !== null && typeof input === 'object', errors, '请求体必须是对象');
  if (errors.length) throw new ValidationError(errors);

  const { holes, tolerance, holeMaxMass } = input;

  assert(
    isInt(holes) && holes >= 4 && holes <= 12 && holes % 2 === 0,
    errors,
    '孔位数必须是 4 至 12 之间的偶数',
  );

  assert(isNum(tolerance) && tolerance >= 0, errors, '允许对径差必须是非负数');

  assert(Array.isArray(holeMaxMass), errors, '各孔最大质量必须是数组');
  if (Array.isArray(holeMaxMass)) {
    if (isInt(holes) && holes >= 4 && holes <= 12) {
      assert(
        holeMaxMass.length === holes,
        errors,
        `各孔最大质量数组长度必须为 ${holes}`,
      );
    }
    holeMaxMass.forEach((m, i) => {
      assert(isNum(m) && m > 0, errors, `孔 ${i} 的最大质量必须为正数（当前：${m}）`);
    });
  }

  // 缩小孔位范围前，现有离心管的可用孔位与固定孔位绑定均不得越界；
  // 两类问题各自收集、一并报告（整次拒绝，保留原配置）。
  if (errors.length === 0 && currentData) {
    for (const t of currentData.tubes) {
      const bad = t.usableHoles.filter((h) => h >= holes);
      if (bad.length > 0) {
        errors.push(
          `缩小孔位至 ${holes} 会使离心管「${t.id}」的可用孔位 ${bad.join(', ')} 越界，请先修改该离心管`,
        );
      }
    }
    for (const b of currentData.fixedHoles || []) {
      if (b.hole >= holes) {
        errors.push(
          `缩小孔位至 ${holes} 会使离心管「${b.tubeId}」的固定孔位 ${b.hole} 越界，请先清空或修改固定孔位绑定`,
        );
      }
    }
  }

  if (errors.length) throw new ValidationError(errors);
  return { holes, tolerance, holeMaxMass: holeMaxMass.map(Number) };
}

export function validateTubes(input, N) {
  const errors = [];
  assert(Array.isArray(input), errors, '离心管列表必须是数组');
  if (!Array.isArray(input)) throw new ValidationError(errors);
  if (N === null) throw new ValidationError(['请先配置转子孔位数']);

  const seen = new Set();
  const normalized = input.map((row, i) => {
    const where = `第 ${i + 1} 行离心管`;
    assert(row !== null && typeof row === 'object', errors, `${where}格式不正确`);
    if (!row || typeof row !== 'object') return null;

    const id = typeof row.id === 'string' ? row.id.trim() : '';
    assert(id.length > 0, errors, `${where}编号不能为空`);
    assert(!WEIGHT_REF_RE.test(id), errors, `${where}编号「${id}」为系统保留格式（配重#x-y）`);
    if (id) {
      assert(!seen.has(id), errors, `离心管编号「${id}」重复`);
      seen.add(id);
    }

    assert(isNum(row.mass) && row.mass > 0, errors, `${where}「${id || i}」质量必须为正数（当前：${row.mass}）`);

    assert(Array.isArray(row.usableHoles), errors, `${where}「${id || i}」的可用孔位必须是数组`);
    let usable = [];
    if (Array.isArray(row.usableHoles)) {
      const hset = new Set();
      for (const h of row.usableHoles) {
        assert(isInt(h) && h >= 0 && h < N, errors, `${where}「${id || i}」存在越界孔位 ${h}（允许 0..${N - 1}）`);
        if (isInt(h) && h >= 0 && h < N) {
          assert(!hset.has(h), errors, `${where}「${id}」的可用孔位 ${h} 重复`);
          hset.add(h);
        }
      }
      usable = [...hset].sort((a, b) => a - b);
      assert(usable.length > 0, errors, `${where}「${id || i}」至少要有一个可用孔位`);
    }

    return { id, mass: isNum(row.mass) ? row.mass : NaN, usableHoles: usable };
  });

  if (errors.length) throw new ValidationError(errors);
  return normalized;
}

export function validateWeights(input, N) {
  const errors = [];
  assert(Array.isArray(input), errors, '配重块列表必须是数组');
  if (!Array.isArray(input)) throw new ValidationError(errors);
  if (N === null) throw new ValidationError(['请先配置转子孔位数']);

  const seenMass = new Set();
  const normalized = input.map((row, i) => {
    const where = `第 ${i + 1} 行配重块`;
    assert(row !== null && typeof row === 'object', errors, `${where}格式不正确`);
    if (!row || typeof row !== 'object') return null;

    assert(isNum(row.mass) && row.mass > 0, errors, `${where}质量必须为正数（当前：${row.mass}）`);
    if (isNum(row.mass) && row.mass > 0) {
      const key = row.mass;
      assert(!seenMass.has(key), errors, `配重块质量 ${row.mass} 重复`);
      seenMass.add(key);
    }
    assert(
      isInt(row.quantity) && row.quantity >= 1,
      errors,
      `${where}数量必须为正整数（当前：${row.quantity}）`,
    );

    return { mass: row.mass, quantity: row.quantity };
  });

  if (errors.length) throw new ValidationError(errors);
  return normalized;
}

// 避邻对（整体替换）：未知编号、自配对、重复配对（含颠倒）任一出现即整次拒绝。
// 规则为无序集合：每对内部按编号字典序规范化，整体再排序，保证数据指纹稳定。
export function validateExclusions(input, currentData) {
  const errors = [];
  assert(Array.isArray(input), errors, '避邻对列表必须是数组');
  if (!Array.isArray(input)) throw new ValidationError(errors);

  const tubeIds = new Set(currentData ? currentData.tubes.map((t) => t.id) : []);
  const seen = new Set();
  const normalized = [];
  input.forEach((row, i) => {
    const where = `第 ${i + 1} 对避邻规则`;
    assert(row !== null && typeof row === 'object', errors, `${where}格式不正确`);
    if (!row || typeof row !== 'object') return;

    const a = typeof row.a === 'string' ? row.a.trim() : '';
    const b = typeof row.b === 'string' ? row.b.trim() : '';
    assert(a.length > 0, errors, `${where}：离心管编号不能为空`);
    assert(b.length > 0, errors, `${where}：离心管编号不能为空`);
    if (!a || !b) return;

    if (a === b) {
      errors.push(`${where}：离心管「${a}」不能与自身配对（自配对无效）`);
      return;
    }
    for (const id of [a, b]) {
      if (!tubeIds.has(id)) {
        errors.push(`${where}：离心管编号「${id}」不存在于当前录入（未知编号）`);
      }
    }
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = JSON.stringify([lo, hi]);
    if (seen.has(key)) {
      errors.push(`避邻对「${lo} ↔ ${hi}」与第 ${i + 1} 对重复（含颠倒顺序的重复）`);
    }
    seen.add(key);
    normalized.push({ a: lo, b: hi });
  });

  if (errors.length) throw new ValidationError(errors);
  normalized.sort((x, y) =>
    x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0,
  );
  return normalized;
}

// 固定孔位绑定（整体替换）：实验人员预先摆好的离心管按「管编号 ↔ 孔位」整组保存。
// 未知管、越界孔、孔不在该管可用孔位内、该孔承重不足，或一支管/一个孔重复绑定，
// 任一出现即整次拒绝（不留下部分数据）。空数组表示清空（回到无固定孔位流程）。
// 返回规范化结果 [{tubeId, hole}]，按孔位升序排列。
export function validateFixedHoles(input, currentData) {
  const errors = [];
  assert(Array.isArray(input), errors, '固定孔位绑定列表必须是数组');
  if (!Array.isArray(input)) throw new ValidationError(errors);
  if (!currentData) throw new ValidationError(['请先配置转子（孔位数、各孔最大质量、容差）']);

  const N = currentData.holes;
  const tubeMap = new Map(currentData.tubes.map((t) => [t.id, t]));
  const seenTube = new Set();
  const seenHole = new Set();
  const normalized = [];

  input.forEach((row, i) => {
    const where = `第 ${i + 1} 条固定孔位绑定`;
    assert(row !== null && typeof row === 'object', errors, `${where}格式不正确`);
    if (!row || typeof row !== 'object') return;

    const rawId = row.tubeId !== undefined ? row.tubeId : row.tube;
    const tubeId = typeof rawId === 'string' ? rawId.trim() : '';
    const hole = row.hole;
    assert(tubeId.length > 0, errors, `${where}：离心管编号不能为空`);
    if (!tubeId) return;

    const t = tubeMap.get(tubeId);
    if (!t) {
      errors.push(`${where}：离心管编号「${tubeId}」不存在于当前录入（未知管不能绑定固定孔位）`);
      return;
    }
    if (!isInt(hole) || hole < 0 || hole >= N) {
      errors.push(`${where}：离心管「${tubeId}」的孔位 ${hole} 越界（允许 0..${N - 1}）`);
      return;
    }
    if (!t.usableHoles.includes(hole)) {
      errors.push(
        `${where}：离心管「${tubeId}」不能绑定孔 ${hole}，该孔不在其可用孔位（${t.usableHoles.join(', ')}）内`,
      );
      return;
    }
    if (t.mass > currentData.holeMaxMass[hole]) {
      errors.push(
        `${where}：离心管「${tubeId}」质量 ${t.mass} 超过孔 ${hole} 的最大承重 ${currentData.holeMaxMass[hole]}，不能固定在该孔`,
      );
      return;
    }
    if (seenTube.has(tubeId)) {
      errors.push(`${where}：离心管「${tubeId}」被重复绑定到多个孔位（一支管只能固定一个孔位）`);
      return;
    }
    if (seenHole.has(hole)) {
      // 找到先前占用该孔的管，便于定位
      const prev = normalized.find((b) => b.hole === hole);
      errors.push(
        `${where}：孔 ${hole} 被重复绑定给多支离心管（「${prev ? prev.tubeId : '?'}」与「${tubeId}」），一个孔位只能固定一支管`,
      );
      return;
    }
    seenTube.add(tubeId);
    seenHole.add(hole);
    normalized.push({ tubeId, hole });
  });

  if (errors.length) throw new ValidationError(errors);
  normalized.sort((a, b) => a.hole - b.hole);
  return normalized;
}
