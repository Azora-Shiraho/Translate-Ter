import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import {
  bumpStable,
  classifyScale,
  compareVersions,
  highestImpact,
  nextPrerelease,
  parseVersion
} from './version-policy.mjs';

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...options }).trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function versionsFromTags() {
  return git(['tag', '--list', 'v*'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((tag) => tag.slice(1))
    .filter((tag) => {
      try {
        parseVersion(tag);
        return true;
      } catch {
        return false;
      }
    });
}

function latestStableVersion(versions) {
  const stable = versions.filter((version) => {
    if (parseVersion(version).channel) return false;
    const result = spawnSync('git', ['merge-base', '--is-ancestor', `v${version}`, 'HEAD']);
    return result.status === 0;
  });
  if (stable.length === 0) throw new Error('当前分支历史中没有可用的稳定版 tag');
  return stable.sort(compareVersions).at(-1);
}

function commitsSince(tag) {
  const output = git(['log', `${tag}..HEAD`, '--no-merges', '--format=%H%x1f%s%x1f%b%x1e']);
  if (!output) return [];
  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body = ''] = record.split('\x1f');
      return { hash, subject, body };
    });
}

function diffScale(tag) {
  const numstat = git(['diff', '--numstat', `${tag}..HEAD`]);
  const rows = numstat ? numstat.split(/\r?\n/) : [];
  let insertions = 0;
  let deletions = 0;
  const areas = new Set();
  for (const row of rows) {
    const [added, removed, path] = row.split('\t');
    insertions += Number.isNaN(Number(added)) ? 0 : Number(added);
    deletions += Number.isNaN(Number(removed)) ? 0 : Number(removed);
    areas.add(path.includes('/') ? path.split('/')[0] : '(root)');
  }
  return {
    files: rows.length,
    insertions,
    deletions,
    areas: areas.size,
    level: classifyScale({ files: rows.length, insertions, deletions, areas: areas.size })
  };
}

function recommend(channel = 'beta') {
  if (!['alpha', 'beta', 'rc', 'stable'].includes(channel)) {
    throw new Error(`未知发布通道：${channel}`);
  }
  const versions = versionsFromTags();
  const baseline = latestStableVersion(versions);
  const tag = `v${baseline}`;
  const commits = commitsSince(tag);
  let impact = highestImpact(commits);
  const scale = diffScale(tag);
  const changedProductCode = git(['diff', '--name-only', `${tag}..HEAD`])
    .split(/\r?\n/)
    .some((path) => /^(apps|backend|contracts|resources|scripts)\//.test(path));
  const inferred = impact === 'none' && changedProductCode;
  if (inferred) impact = 'patch';

  const stableTarget = bumpStable(baseline, impact);
  const target = impact === 'none' || channel === 'stable'
    ? stableTarget
    : nextPrerelease(stableTarget, channel, versions);

  console.log(`基准 tag: ${tag}`);
  console.log(`提交数量: ${commits.length}`);
  console.log(`修改规模: ${scale.level}（${scale.files} 个文件，+${scale.insertions}/-${scale.deletions}，${scale.areas} 个顶层区域）`);
  console.log(`版本影响: ${impact}${inferred ? '（提交信息不足，按产品代码变更保守推断）' : ''}`);
  console.log(`建议版本: ${target}`);
  if (scale.level === 'large' && !['major', 'minor'].includes(impact)) {
    console.log('复核提示: 修改规模较大但版本影响较低，请人工确认是否存在未标记的 feat 或 BREAKING CHANGE。');
  }
  if (impact === 'none') console.log('无需发布: 仅检测到不影响产品的变更。');
}

function check(explicitTag) {
  const packageVersion = readJson('package.json').version;
  const lock = readJson('package-lock.json');
  parseVersion(packageVersion);
  if (lock.version !== packageVersion || lock.packages?.['']?.version !== packageVersion) {
    throw new Error(`版本源不一致：package.json=${packageVersion}，package-lock.json=${lock.version}，lock root=${lock.packages?.['']?.version}`);
  }

  const tag = explicitTag || process.env.GITHUB_REF_NAME;
  if (tag && tag.startsWith('v')) {
    const tagVersion = parseVersion(tag).raw;
    if (tagVersion !== packageVersion) {
      throw new Error(`tag 与包版本不一致：${tag} != v${packageVersion}`);
    }
  }
  console.log(`版本校验通过：${packageVersion}${tag ? `（tag: ${tag}）` : ''}`);
}

function setVersion(version) {
  if (!version) throw new Error('缺少版本号，例如：npm run version:set -- 2.3.0-beta.1');
  const parsed = parseVersion(version);
  const npmArguments = ['version', parsed.raw, '--no-git-tag-version', '--allow-same-version'];
  const executable = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const argumentsForPlatform = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm ${npmArguments.join(' ')}`]
    : npmArguments;
  const result = spawnSync(executable, argumentsForPlatform, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (result.status !== 0) throw new Error('npm 未能更新版本文件');
  check();
  console.log(`已更新到 ${parsed.raw}；确认变更后再创建 tag v${parsed.raw}。`);
}

function usage() {
  console.log(`用法：
  npm run version:recommend -- [alpha|beta|rc|stable]
  npm run version:check -- [vX.Y.Z[-通道.N]]
  npm run version:set -- X.Y.Z[-通道.N]`);
}

try {
  const [command, argument] = process.argv.slice(2);
  if (command === 'recommend') recommend(argument);
  else if (command === 'check') check(argument);
  else if (command === 'set') setVersion(argument);
  else usage();
} catch (error) {
  console.error(`版本管理失败：${error.message}`);
  process.exitCode = 1;
}
