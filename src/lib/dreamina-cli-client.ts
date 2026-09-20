/** 即梦 CLI 请求：桌面版走 Electron 主进程（官方 OAuth Device Flow） */

export type DreaminaUserCreditResponse = {
  ok?: boolean;
  loggedIn?: boolean;
  loginName?: string;
  error?: string;
  note?: string;
  needsLogin?: boolean;
  needsRepair?: boolean;
  data?: { total_credit?: number; vip_level?: string; user_id?: number | string };
  usedPath?: string;
};

export type DreaminaLoginProgress = {
  phase?: 'headless' | 'authorize' | 'polling';
  message?: string;
  verificationUri?: string;
  userCode?: string;
  deviceCode?: string;
};

export type DreaminaLoginBrowserConfig = {
  type?: 'system' | 'chrome' | 'edge' | 'firefox' | 'custom';
  path?: string;
};

export type DreaminaLoginResponse = {
  ok?: boolean;
  alreadyLoggedIn?: boolean;
  loginUrl?: string;
  verificationUri?: string;
  userCode?: string;
  message?: string;
  error?: string;
  loginName?: string;
  data?: { total_credit?: number; vip_level?: string; user_id?: number | string };
  repairedMetadata?: boolean;
  usedPath?: string;
  raw?: string;
};

type MagineDesktop = {
  dreaminaUserCredit?: (cliPath: string) => Promise<DreaminaUserCreditResponse>;
  dreaminaLogin?: (
    cliPath: string,
    forceRelogin?: boolean,
    browser?: DreaminaLoginBrowserConfig,
  ) => Promise<DreaminaLoginResponse>;
  dreaminaOpenLoginUrl?: (url: string, browser?: DreaminaLoginBrowserConfig) => Promise<boolean>;
  onDreaminaLoginProgress?: (cb: (info: DreaminaLoginProgress) => void) => () => void;
  openExternal?: (url: string) => Promise<boolean>;
};

function getDesktop(): MagineDesktop | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { magineDesktop?: MagineDesktop }).magineDesktop;
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs = 35000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return (await res.json().catch(() => ({}))) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function requestDreaminaUserCredit(cliPath: string): Promise<DreaminaUserCreditResponse> {
  const desktop = getDesktop();
  if (desktop?.dreaminaUserCredit) {
    return desktop.dreaminaUserCredit(cliPath);
  }
  return fetchJsonWithTimeout<DreaminaUserCreditResponse>(
    '/api/dreamina/user-credit',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliPath }),
    },
    35000,
  );
}

export async function requestDreaminaLogin(
  cliPath: string,
  onProgress?: (info: DreaminaLoginProgress) => void,
  forceRelogin = false,
  browser?: DreaminaLoginBrowserConfig,
): Promise<DreaminaLoginResponse> {
  const desktop = getDesktop();
  if (desktop?.dreaminaLogin) {
    const unsub = desktop.onDreaminaLoginProgress?.((info) => onProgress?.(info));
    try {
      return await desktop.dreaminaLogin(cliPath, forceRelogin, browser);
    } finally {
      unsub?.();
    }
  }
  return fetchJsonWithTimeout<DreaminaLoginResponse>(
    '/api/dreamina/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliPath, forceRelogin }),
    },
    390000,
  );
}

export async function openDreaminaLoginUrl(
  url: string,
  browser?: DreaminaLoginBrowserConfig,
): Promise<void> {
  const desktop = getDesktop();
  if (desktop?.dreaminaOpenLoginUrl) {
    await desktop.dreaminaOpenLoginUrl(url, browser);
    return;
  }
  if (desktop?.openExternal) {
    await desktop.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function isDreaminaDesktopIpcAvailable(): boolean {
  return Boolean(getDesktop()?.dreaminaUserCredit);
}
