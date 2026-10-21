'use strict';

const MAX_LINES = 5000;

function splitLines(text) {
  if (typeof text !== 'string' || text === '') return [];
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/**
 * Myers diff (O(ND)) over lines. Returns one op per line:
 * { type: 'context' | 'add' | 'del', text, oldLine, newLine }
 */
function diffLines(oldText, newText) {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  if (oldLines.length > MAX_LINES || newLines.length > MAX_LINES) {
    const ops = [];
    let oldLine = 1;
    let newLine = 1;
    for (const text of oldLines) ops.push({ type: 'del', text, oldLine: oldLine++, newLine: null });
    for (const text of newLines) ops.push({ type: 'add', text, oldLine: null, newLine: newLine++ });
    return ops;
  }

  const n = oldLines.length;
  const m = newLines.length;
  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  v.fill(-1);

  const trace = [];
  let found = -1;

  for (let d = 0; d <= max && found < 0; d += 1) {
    trace.push(v.slice());

    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }

      let y = x - k;

      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x += 1;
        y += 1;
      }

      v[offset + k] = x;

      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }

  const reversed = [];
  let x = n;
  let y = m;

  for (let d = found; d > 0; d -= 1) {
    const previous = trace[d];
    const k = x - y;

    let prevK;
    if (k === -d || (k !== d && previous[offset + k - 1] < previous[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = previous[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      reversed.push({ type: 'context', text: oldLines[x - 1] });
      x -= 1;
      y -= 1;
    }

    if (x === prevX) {
      reversed.push({ type: 'add', text: newLines[y - 1] });
      y -= 1;
    } else {
      reversed.push({ type: 'del', text: oldLines[x - 1] });
      x -= 1;
    }
  }

  while (x > 0 && y > 0) {
    reversed.push({ type: 'context', text: oldLines[x - 1] });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    reversed.push({ type: 'del', text: oldLines[x - 1] });
    x -= 1;
  }
  while (y > 0) {
    reversed.push({ type: 'add', text: newLines[y - 1] });
    y -= 1;
  }

  const ops = reversed.reverse();

  let oldLine = 1;
  let newLine = 1;
  for (const op of ops) {
    if (op.type === 'del') {
      op.oldLine = oldLine;
      op.newLine = null;
      oldLine += 1;
    } else if (op.type === 'add') {
      op.oldLine = null;
      op.newLine = newLine;
      newLine += 1;
    } else {
      op.oldLine = oldLine;
      op.newLine = newLine;
      oldLine += 1;
      newLine += 1;
    }
  }

  return ops;
}

function diffStats(ops) {
  let added = 0;
  let removed = 0;

  for (const op of ops) {
    if (op.type === 'add') added += 1;
    if (op.type === 'del') removed += 1;
  }

  return { added, removed, changed: added + removed > 0 };
}

function createDiff(oldText, newText) {
  const ops = diffLines(oldText, newText);
  return { diff: ops, stats: diffStats(ops) };
}

module.exports = { diffLines, diffStats, createDiff };
