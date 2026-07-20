import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bumpStable,
  classifyCommit,
  classifyScale,
  compareVersions,
  nextPrerelease,
  parseVersion
} from './version-policy.mjs';

test('只接受项目约定的 SemVer 与预发布通道', () => {
  assert.equal(parseVersion('v2.3.0-beta.2').channel, 'beta');
  assert.throws(() => parseVersion('2.3'));
  assert.throws(() => parseVersion('2.3.0-preview.1'));
  assert.throws(() => parseVersion('2.3.0-beta.0'));
});

test('正式版优先级高于同版本预发布版', () => {
  assert.ok(compareVersions('2.3.0', '2.3.0-rc.1') > 0);
  assert.ok(compareVersions('2.3.0-beta.2', '2.3.0-beta.1') > 0);
});

test('按 Conventional Commits 判定版本影响', () => {
  assert.equal(classifyCommit('feat!: 删除旧接口'), 'major');
  assert.equal(classifyCommit('fix(ui): 修正提示'), 'patch');
  assert.equal(classifyCommit('feat: 添加导出选项'), 'minor');
  assert.equal(classifyCommit('docs: 更新说明'), 'none');
  assert.equal(classifyCommit('refactor: 整理模块', 'BREAKING CHANGE: 配置格式已更改'), 'major');
});

test('递增稳定版本并延续预发布序号', () => {
  assert.equal(bumpStable('2.2.0', 'minor'), '2.3.0');
  assert.equal(bumpStable('2.2.0', 'major'), '3.0.0');
  assert.equal(nextPrerelease('2.3.0', 'beta', ['2.3.0-beta.1', '2.3.0-beta.3']), '2.3.0-beta.4');
});

test('修改规模只用于风险分级', () => {
  assert.equal(classifyScale({ files: 5, insertions: 50, deletions: 20, areas: 1 }), 'small');
  assert.equal(classifyScale({ files: 20, insertions: 900, deletions: 200, areas: 3 }), 'medium');
  assert.equal(classifyScale({ files: 40, insertions: 100, deletions: 20, areas: 5 }), 'large');
});
