// Branch `kampanye-kunci` hanya memuat KUNCI.json (tools/kunci-kampanye.mjs);
// setiap ambil/segarkan/lepas adalah push, dan tanpa ini tiap push memicu deployment Vercel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const src = readFileSync(new URL('../../tools/kunci-kampanye.mjs', import.meta.url), 'utf8');

test('vercel.json mematikan deployment untuk branch kunci kampanye', () => {
  const branch = /const BRANCH = '([^']+)'/.exec(src)?.[1];
  assert.ok(branch, 'konstanta BRANCH tidak ditemukan di tools/kunci-kampanye.mjs');
  assert.equal(cfg.git?.deploymentEnabled?.[branch], false, `git.deploymentEnabled["${branch}"] harus false`);
});

test('hanya branch kunci yang dimatikan — branch lain tetap ter-deploy', () => {
  const de = cfg.git?.deploymentEnabled;
  assert.equal(typeof de, 'object', 'deploymentEnabled harus peta per branch, bukan boolean global');
  assert.deepEqual(Object.keys(de), [/const BRANCH = '([^']+)'/.exec(src)?.[1]], 'tidak boleh ada branch lain (atau pola) yang dimatikan');
  assert.ok(!Object.keys(de).some((k) => k.includes('*')), 'tanpa pola glob');
});
