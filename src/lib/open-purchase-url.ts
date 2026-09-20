'use client';

export async function openPurchaseUrl(url: string): Promise<void> {
  if (!url) return;

  const desktop = typeof window !== 'undefined' ? window.magineDesktop : undefined;
  if (desktop?.openPurchaseUrl) {
    await desktop.openPurchaseUrl(url);
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}
