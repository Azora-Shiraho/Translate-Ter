const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.([1-9]\d*))?$/;

export function parseVersion(input) {
  const value = input.startsWith('v') ? input.slice(1) : input;
  const match = VERSION_PATTERN.exec(value);
  if (!match) {
    throw new Error(`无效版本号：${input}。应使用 X.Y.Z 或 X.Y.Z-(alpha|beta|rc).N`);
  }

  return {
    raw: value,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    channel: match[4] ?? null,
    sequence: match[5] ? Number(match[5]) : null
  };
}

export function compareVersions(leftInput, rightInput) {
  const left = typeof leftInput === 'string' ? parseVersion(leftInput) : leftInput;
  const right = typeof rightInput === 'string' ? parseVersion(rightInput) : rightInput;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (!left.channel && !right.channel) return 0;
  if (!left.channel) return 1;
  if (!right.channel) return -1;
  const channelOrder = { alpha: 0, beta: 1, rc: 2 };
  if (left.channel !== right.channel) return channelOrder[left.channel] - channelOrder[right.channel];
  return left.sequence - right.sequence;
}

export function classifyCommit(subject, body = '') {
  const header = /^(\w+)(?:\([^)]+\))?(!)?:\s+/.exec(subject);
  const breaking = Boolean(header?.[2]) || /(^|\n)BREAKING[ -]CHANGE:\s+/i.test(body);
  if (breaking) return 'major';
  if (header?.[1] === 'feat') return 'minor';
  if (['fix', 'perf', 'revert'].includes(header?.[1])) return 'patch';
  return 'none';
}

export function highestImpact(commits) {
  const rank = { none: 0, patch: 1, minor: 2, major: 3 };
  return commits.reduce((highest, commit) => {
    const impact = classifyCommit(commit.subject, commit.body);
    return rank[impact] > rank[highest] ? impact : highest;
  }, 'none');
}

export function bumpStable(versionInput, impact) {
  const version = typeof versionInput === 'string' ? parseVersion(versionInput) : versionInput;
  if (impact === 'major') return `${version.major + 1}.0.0`;
  if (impact === 'minor') return `${version.major}.${version.minor + 1}.0`;
  if (impact === 'patch') return `${version.major}.${version.minor}.${version.patch + 1}`;
  return version.raw;
}

export function classifyScale({ files, insertions, deletions, areas }) {
  const changedLines = insertions + deletions;
  if (files <= 10 && changedLines <= 200 && areas <= 2) return 'small';
  if (files <= 30 && changedLines <= 1500 && areas <= 4) return 'medium';
  return 'large';
}

export function nextPrerelease(stableVersion, channel, existingVersions) {
  const prefix = `${stableVersion}-${channel}.`;
  const sequences = existingVersions
    .filter((version) => version.startsWith(prefix))
    .map((version) => parseVersion(version).sequence);
  return `${prefix}${sequences.length > 0 ? Math.max(...sequences) + 1 : 1}`;
}
