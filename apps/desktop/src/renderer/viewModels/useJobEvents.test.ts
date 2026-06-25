import { beforeEach, describe, expect, it, vi } from 'vitest';

const { onEventMock, useEffectMock } = vi.hoisted(() => ({
  onEventMock: vi.fn(),
  useEffectMock: vi.fn()
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useEffect: useEffectMock
  };
});

vi.mock('../api/translateTerGateway', () => ({
  translateTerGateway: {
    jobs: {
      onEvent: onEventMock
    }
  }
}));

import { subscribeToJobEvents, useJobEvents } from './useJobEvents';

describe('useJobEvents', () => {
  beforeEach(() => {
    useEffectMock.mockReset();
    onEventMock.mockReset();
  });

  it('subscribes through the gateway helper', () => {
    const unsubscribe = vi.fn();
    const listener = vi.fn();
    onEventMock.mockReturnValue(unsubscribe);

    expect(subscribeToJobEvents(listener)).toBe(unsubscribe);
    expect(onEventMock).toHaveBeenCalledWith(listener);
  });

  it('cleans up the job subscription on unmount', () => {
    const unsubscribe = vi.fn();
    const listener = vi.fn();
    let cleanup: (() => void) | undefined;

    onEventMock.mockReturnValue(unsubscribe);
    useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
      const nextCleanup = effect();
      cleanup = typeof nextCleanup === 'function' ? nextCleanup : undefined;
    });

    useJobEvents(listener);

    expect(onEventMock).toHaveBeenCalledWith(listener);
    expect(cleanup).toBeTypeOf('function');

    cleanup?.();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
