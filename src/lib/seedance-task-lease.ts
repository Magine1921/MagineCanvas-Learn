type GlobalWithSeedanceTaskLeases = typeof globalThis & {
  __magineSeedanceTaskLeases?: Set<string>;
};

function getSeedanceTaskLeases(): Set<string> {
  const target = globalThis as GlobalWithSeedanceTaskLeases;
  if (!target.__magineSeedanceTaskLeases) {
    target.__magineSeedanceTaskLeases = new Set<string>();
  }
  return target.__magineSeedanceTaskLeases!;
}

export function claimSeedanceTaskLease(taskId: string): boolean {
  const leases = getSeedanceTaskLeases();
  if (!taskId || leases.has(taskId)) return false;
  leases.add(taskId);
  return true;
}

export function releaseSeedanceTaskLease(taskId: string): void {
  if (!taskId) return;
  getSeedanceTaskLeases().delete(taskId);
}

export function hasSeedanceTaskLease(taskId: string): boolean {
  return Boolean(taskId) && getSeedanceTaskLeases().has(taskId);
}
