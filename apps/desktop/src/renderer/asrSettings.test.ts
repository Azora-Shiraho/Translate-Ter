import { describe, expect, it } from 'vitest';
import {
  buildIgnoreCudaMismatchPatch,
  buildLocalAsrSettingsPatch,
  deriveFasterWhisperWorkspaceMode,
  deriveRuntimeVariantSelection,
  inferRuntimePlatformFamily,
  isExperimentalWhisperRuntimeVariant,
  isCudaFlowRelevant,
  isVerifiedWhisperGpuRuntimeVariant,
  listRuntimeVariantSelections,
  resolveSupportedRuntimeVariantSelection,
  resolveAccelerationForVariantSelection,
  resolveVariantSelectionForAcceleration
} from './asrSettings';

describe('buildLocalAsrSettingsPatch', () => {
  it('writes auto acceleration without forcing legacy cuda fields', () => {
    const patch = buildLocalAsrSettingsPatch('auto', 'auto');

    expect(patch.localAsrAcceleration).toBe('auto');
    expect(patch.preferredRuntimeVariant).toBeUndefined();
    expect(patch.localWhisperUseCuda).toBeUndefined();
  });

  it('writes cpu acceleration with cpu runtime variant and mirrors legacy fields', () => {
    const patch = buildLocalAsrSettingsPatch('cpu', 'cpu');

    expect(patch.localAsrAcceleration).toBe('cpu');
    expect(patch.preferredRuntimeVariant).toBe('cpu');
    expect(patch.localWhisperUseCuda).toBe(false);
  });

  it('writes gpu acceleration with cuda runtime variant and mirrors legacy fields', () => {
    const patch = buildLocalAsrSettingsPatch('gpu', 'cuda');

    expect(patch.localAsrAcceleration).toBe('gpu');
    expect(patch.preferredRuntimeVariant).toBe('cuda');
    expect(patch.localWhisperUseCuda).toBe(true);
  });
});

describe('buildIgnoreCudaMismatchPatch', () => {
  it('writes compatibility overrides and legacy fallback together', () => {
    const patch = buildIgnoreCudaMismatchPatch(true);

    expect(patch.localAsrCompatibilityOverrides).toEqual({ ignoreCudaMismatch: true });
    expect(patch.localWhisperIgnoreCudaMismatch).toBe(true);
  });
});

describe('runtime variant helpers', () => {
  it('derives cpu as the selected runtime variant when cpu acceleration is forced', () => {
    expect(deriveRuntimeVariantSelection('cpu', undefined)).toBe('cpu');
  });

  it('infers macOS from whisper runtime platform keys', () => {
    expect(
      inferRuntimePlatformFamily({
        runtimeStatus: {
          platformKey: 'darwin-arm64-metal'
        }
      })
    ).toBe('mac');
  });

  it('treats vulkan as experimental instead of a verified gpu runtime', () => {
    expect(isExperimentalWhisperRuntimeVariant('vulkan')).toBe(true);
    expect(isVerifiedWhisperGpuRuntimeVariant('vulkan')).toBe(false);
    expect(isVerifiedWhisperGpuRuntimeVariant('cuda')).toBe(true);
    expect(isVerifiedWhisperGpuRuntimeVariant('metal')).toBe(true);
  });

  it('falls back to explicit host platform when native accelerators are unavailable', () => {
    expect(
      inferRuntimePlatformFamily({
        hostPlatform: 'win32',
        nativeHealth: {
          accelerators: []
        }
      })
    ).toBe('windows-linux');
  });

  it('lists whisper.cpp variants conservatively by platform', () => {
    expect(
      listRuntimeVariantSelections({
        providerId: 'local.whisper.cpp',
        platformFamily: 'windows-linux'
      })
    ).toEqual(['auto', 'cpu', 'cuda', 'vulkan']);
    expect(
      listRuntimeVariantSelections({
        providerId: 'local.whisper.cpp',
        platformFamily: 'mac'
      })
    ).toEqual(['auto', 'cpu', 'metal']);
  });

  it('does not re-add unsupported runtime variants from older provider settings', () => {
    expect(
      listRuntimeVariantSelections({
        providerId: 'local.faster-whisper',
        platformFamily: 'windows-linux',
        currentVariant: 'metal'
      })
    ).toEqual(['auto', 'cpu', 'cuda']);
  });

  it('hides local runtime variant selections for cloud recognition', () => {
    expect(
      listRuntimeVariantSelections({
        providerId: 'cloud.openai',
        platformFamily: 'windows-linux'
      })
    ).toEqual([]);
  });

  it('keeps a valid gpu runtime variant when acceleration changes to gpu', () => {
    expect(resolveVariantSelectionForAcceleration('gpu', 'cuda', ['auto', 'cpu', 'cuda'])).toBe('cuda');
    expect(resolveVariantSelectionForAcceleration('gpu', 'cpu', ['auto', 'cpu', 'metal'])).toBe('metal');
  });

  it('falls back to auto when a provider switch preserves an unsupported gpu variant', () => {
    expect(resolveSupportedRuntimeVariantSelection('gpu', 'metal', ['auto', 'cpu', 'cuda'])).toBe('auto');
    expect(resolveSupportedRuntimeVariantSelection('gpu', 'metal', ['auto', 'cpu'])).toBe('auto');
  });

  it('maps runtime variant selections back to coherent acceleration states', () => {
    expect(resolveAccelerationForVariantSelection('auto', 'auto')).toBe('auto');
    expect(resolveAccelerationForVariantSelection('auto', 'gpu')).toBe('gpu');
    expect(resolveAccelerationForVariantSelection('cpu', 'gpu')).toBe('cpu');
    expect(resolveAccelerationForVariantSelection('cuda', 'auto')).toBe('gpu');
  });

  it('keeps gpu acceleration when users choose runtime variant auto under gpu mode', () => {
    const patch = buildLocalAsrSettingsPatch(resolveAccelerationForVariantSelection('auto', 'gpu'), 'auto');

    expect(patch.localAsrAcceleration).toBe('gpu');
    expect(patch.preferredRuntimeVariant).toBeUndefined();
  });

  it('shows cuda-only flows only when the current selection can actually use cuda', () => {
    expect(isCudaFlowRelevant('local.whisper.cpp', 'windows-linux', 'auto')).toBe(true);
    expect(isCudaFlowRelevant('local.whisper.cpp', 'windows-linux', 'vulkan')).toBe(false);
    expect(isCudaFlowRelevant('local.faster-whisper', 'windows-linux', 'cuda')).toBe(true);
    expect(isCudaFlowRelevant('local.faster-whisper', 'mac', 'cuda')).toBe(false);
  });

  it('derives faster-whisper workspace mode from actual acceleration status instead of UI selection', () => {
    expect(
      deriveFasterWhisperWorkspaceMode({
        ok: true,
        status: 'healthy',
        acceleration: {
          requested: 'auto',
          selected: 'gpu',
          runtimeVariant: 'cuda',
          hardwareDetected: true,
          runtimeDetected: true,
          supported: true
        }
      })
    ).toBe('cuda-ready');

    expect(
      deriveFasterWhisperWorkspaceMode({
        ok: false,
        status: 'degraded',
        acceleration: {
          requested: 'gpu',
          selected: 'cpu',
          runtimeVariant: 'cpu',
          hardwareDetected: true,
          runtimeDetected: false,
          supported: true,
          fallbackReason: 'gpu-runtime-missing'
        }
      })
    ).toBe('cuda-fallback');
  });
});
