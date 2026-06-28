export const nativeLocalCapabilityPolicy = Object.freeze({
  native: Object.freeze([
    'srt.parse',
    'srt.serialize',
    'media.probe',
    'audio.extract',
    'asr.transcribe'
  ] as const),
  typescript: Object.freeze([
    'provider.http',
    'secrets',
    'settings',
    'ui',
    'ass.serialize',
    'workflow.orchestration'
  ] as const)
});

export type NativeManagedLocalCapability = (typeof nativeLocalCapabilityPolicy.native)[number];
export type TypeScriptManagedLocalCapability = (typeof nativeLocalCapabilityPolicy.typescript)[number];
export type LocalCapabilityExecutionTarget = 'native' | 'typescript';

export function capabilityExecutionTarget(capability: string): LocalCapabilityExecutionTarget {
  if ((nativeLocalCapabilityPolicy.native as readonly string[]).includes(capability)) {
    return 'native';
  }
  return 'typescript';
}

export function shouldUseNativeSrtSerialization(format: 'srt' | 'ass'): boolean {
  return format === 'srt' && capabilityExecutionTarget('srt.serialize') === 'native';
}

export function shouldUseTypeScriptAssSerialization(format: 'srt' | 'ass'): boolean {
  return format === 'ass' && capabilityExecutionTarget('ass.serialize') === 'typescript';
}
