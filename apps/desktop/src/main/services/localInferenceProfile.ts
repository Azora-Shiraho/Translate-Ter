import { spawnSync } from 'node:child_process';
import { availableParallelism, cpus } from 'node:os';
import type { LocalAsrCpuMode } from '@shared/models';

type CoreInfo = {
  physical: number;
  logical: number;
};

let cachedCoreInfo: CoreInfo | undefined;

export function resolveLocalInferenceThreadCount(mode: LocalAsrCpuMode): number {
  return calculateLocalInferenceThreadCount(mode, detectCoreInfo());
}

export function calculateLocalInferenceThreadCount(mode: LocalAsrCpuMode, info: CoreInfo): number {
  const physical = clampPositiveInteger(info.physical, fallbackPhysicalCoreCount(info.logical));
  const logical = clampPositiveInteger(info.logical, physical);
  switch (mode) {
    case 'low':
      return clampThreadCount(Math.floor(physical / 4), logical);
    case 'high':
      return clampThreadCount(physical - 2, logical);
    case 'balanced':
    default:
      return clampThreadCount(Math.ceil(logical / 2), logical, 16);
  }
}

function detectCoreInfo(): CoreInfo {
  if (cachedCoreInfo) {
    return cachedCoreInfo;
  }

  const logical = detectLogicalCoreCount();
  const physical = process.platform === 'win32' ? detectWindowsPhysicalCoreCount(logical) : fallbackPhysicalCoreCount(logical);
  cachedCoreInfo = {
    physical: clampPositiveInteger(physical, fallbackPhysicalCoreCount(logical)),
    logical: clampPositiveInteger(logical, Math.max(physical, 1))
  };
  return cachedCoreInfo;
}

function detectLogicalCoreCount(): number {
  try {
    return typeof availableParallelism === 'function' ? availableParallelism() : cpus().length || 4;
  } catch {
    return cpus().length || 4;
  }
}

function detectWindowsPhysicalCoreCount(logicalFallback: number): number {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      '(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum'
    ],
    {
      windowsHide: true,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 5000
    }
  );
  if (result.status !== 0) {
    return fallbackPhysicalCoreCount(logicalFallback);
  }

  const parsed = Number.parseInt(String(result.stdout ?? '').trim(), 10);
  return clampPositiveInteger(parsed, fallbackPhysicalCoreCount(logicalFallback));
}

function fallbackPhysicalCoreCount(logical: number): number {
  return Math.max(1, Math.floor(clampPositiveInteger(logical, 4) / 2));
}

function clampThreadCount(requested: number, logical: number, maxCap = logical): number {
  const normalizedLogical = clampPositiveInteger(logical, 1);
  const upper = Math.max(1, Math.min(normalizedLogical, maxCap));
  return Math.max(1, Math.min(upper, Math.floor(requested)));
}

function clampPositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.round(value));
}
