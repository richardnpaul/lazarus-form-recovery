import { describe, it, expect, vi } from 'vitest';
import { ServiceContainer, container } from '../../../src/core/container';

describe('ServiceContainer', () => {
  it('instantiates the container with default adapters and initializes use cases', () => {
    const sc = new ServiceContainer();
    expect(sc.repository).toBeDefined();
    expect(sc.vault).toBeDefined();
    expect(sc.sessionCache).toBeDefined();
    expect(sc.broadcaster).toBeDefined();
    expect(sc.scheduler).toBeDefined();

    expect(sc.saveFormDraftUseCase).toBeDefined();
    expect(sc.submitFormUseCase).toBeDefined();
    expect(sc.restoreFormUseCase).toBeDefined();
    expect(sc.historyQueryUseCase).toBeDefined();
    expect(sc.vaultSecurityUseCase).toBeDefined();
    expect(sc.domainPolicyUseCase).toBeDefined();
    expect(sc.retentionCleanupUseCase).toBeDefined();
  });

  it('exports container as a singleton instance of ServiceContainer', () => {
    expect(container).toBeInstanceOf(ServiceContainer);
  });

  it('registers onLockCallback on vault that invokes broadcaster.broadcastRefresh() when triggered', () => {
    let capturedCallback: (() => void) | undefined;
    const mockVault: any = {
      setOnLockCallback: vi.fn().mockImplementation((cb: () => void) => {
        capturedCallback = cb;
      }),
    };
    const mockBroadcaster: any = {
      broadcastRefresh: vi.fn(),
    };

    const sc = new ServiceContainer(undefined, mockVault, undefined, mockBroadcaster, undefined);

    expect(mockVault.setOnLockCallback).toHaveBeenCalledTimes(1);
    expect(capturedCallback).toBeTypeOf('function');

    expect(mockBroadcaster.broadcastRefresh).not.toHaveBeenCalled();
    capturedCallback!();
    expect(mockBroadcaster.broadcastRefresh).toHaveBeenCalledTimes(1);
  });
});
