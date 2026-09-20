const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

class LicenseRequestError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'LicenseRequestError';
    this.status = options.status || 0;
    this.code = options.code || '';
    this.network = Boolean(options.network);
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === '1' || value === 'true';
}

function normalizeServerUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(String(value).trim());
    const isLocal =
      parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
    if (parsed.protocol !== 'https:' && !isLocal) return '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function publicStatus(status) {
  const {
    token: _token,
    pendingOrder: _pendingOrder,
    ...safe
  } = status || {};
  return safe;
}

class LicenseManager {
  constructor({ app, safeStorage, isDev }) {
    this.app = app;
    this.safeStorage = safeStorage;
    this.isDev = Boolean(isDev);
    this.config = this.loadConfig();
    this.memoryState = null;
    this.deviceHashPromise = null;
  }

  loadConfig() {
    const candidates = [
      process.env.MAGINE_LICENSE_CONFIG,
      this.app.isPackaged ? path.join(process.resourcesPath, 'license-config.json') : '',
      path.join(__dirname, '..', 'build', 'license-config.json'),
    ].filter(Boolean);
    let fileConfig = {};
    for (const candidate of candidates) {
      const parsed = readJsonFile(candidate);
      if (parsed && typeof parsed === 'object') {
        fileConfig = parsed;
        break;
      }
    }

    const packageId =
      process.env.MAGINE_LICENSE_PACKAGE_ID ||
      fileConfig.packageId ||
      'maginecanvas-full';
    const forceInDev = process.env.MAGINE_LICENSE_FORCE === '1';
    const required = parseBoolean(
      process.env.MAGINE_REQUIRE_LICENSE,
      Boolean(fileConfig.required),
    );
    return {
      required: this.isDev && !forceInDev ? false : required,
      serverUrl: normalizeServerUrl(
        process.env.MAGINE_LICENSE_SERVER_URL || fileConfig.serverUrl,
      ),
      packageId: String(packageId).slice(0, 80),
      product: String(fileConfig.product || this.app.getName() || 'Magine Canvas').slice(0, 120),
      requestTimeoutMs: Math.min(
        30_000,
        Math.max(3_000, Number(fileConfig.requestTimeoutMs) || 10_000),
      ),
      offlineGraceHours: Math.min(
        720,
        Math.max(0, Number(fileConfig.offlineGraceHours) || 72),
      ),
    };
  }

  get stateFile() {
    return path.join(
      this.app.getPath('userData'),
      `license-state-${this.config.packageId.replace(/[^a-z0-9._-]/gi, '_')}.json`,
    );
  }

  get installIdFile() {
    return path.join(this.app.getPath('userData'), 'magine-install-id');
  }

  async getInstallId() {
    try {
      const existing = (await fs.promises.readFile(this.installIdFile, 'utf8')).trim();
      if (/^[a-f0-9-]{30,60}$/i.test(existing)) return existing;
    } catch {
      // First launch.
    }
    const installId = crypto.randomUUID();
    await fs.promises.mkdir(path.dirname(this.installIdFile), { recursive: true });
    await fs.promises.writeFile(this.installIdFile, installId, {
      encoding: 'utf8',
      mode: 0o600,
    });
    return installId;
  }

  async getMachineId() {
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execFileAsync(
          path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'),
          ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
          { windowsHide: true, timeout: 5_000 },
        );
        const match = stdout.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
        if (match?.[1]) return match[1].trim();
      } catch {
        // Use the installation id below.
      }
    }
    return this.getInstallId();
  }

  async getDeviceHash() {
    if (!this.deviceHashPromise) {
      this.deviceHashPromise = (async () => {
        const machineId = await this.getMachineId();
        return crypto
          .createHash('sha256')
          .update([
            'magine-canvas-v1',
            this.config.packageId,
            process.platform,
            process.arch,
            machineId,
          ].join('|'))
          .digest('hex');
      })();
    }
    return this.deviceHashPromise;
  }

  canEncrypt() {
    return Boolean(
      this.safeStorage &&
      typeof this.safeStorage.isEncryptionAvailable === 'function' &&
      this.safeStorage.isEncryptionAvailable(),
    );
  }

  async loadState() {
    if (this.memoryState) return this.memoryState;
    try {
      const envelope = JSON.parse(await fs.promises.readFile(this.stateFile, 'utf8'));
      if (!envelope || envelope.version !== 1 || typeof envelope.encrypted !== 'string') return null;
      if (!this.canEncrypt()) return null;
      const decrypted = this.safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64'));
      const state = JSON.parse(decrypted);
      if (state?.packageId !== this.config.packageId) return null;
      this.memoryState = state;
      return state;
    } catch {
      return null;
    }
  }

  async saveState(state) {
    const nextState = {
      ...state,
      packageId: this.config.packageId,
    };
    this.memoryState = nextState;
    if (!this.canEncrypt()) return false;
    const encrypted = this.safeStorage.encryptString(JSON.stringify(nextState));
    await fs.promises.mkdir(path.dirname(this.stateFile), { recursive: true });
    await fs.promises.writeFile(
      this.stateFile,
      JSON.stringify({ version: 1, encrypted: encrypted.toString('base64') }),
      { encoding: 'utf8', mode: 0o600 },
    );
    return true;
  }

  async clearState() {
    this.memoryState = null;
    await fs.promises.rm(this.stateFile, { force: true }).catch(() => {});
  }

  async request(pathname, body, options = {}) {
    if (!this.config.serverUrl) {
      throw new LicenseRequestError('授权服务器地址未配置', {
        code: 'SERVER_NOT_CONFIGURED',
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await fetch(`${this.config.serverUrl}${pathname}`, {
        method: options.method || 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': `MagineCanvas/${this.app.getVersion()} Electron`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new LicenseRequestError(
          payload?.error || `授权服务器返回 HTTP ${response.status}`,
          {
            status: response.status,
            code: payload?.code || '',
          },
        );
      }
      return payload?.data ?? payload;
    } catch (error) {
      if (error instanceof LicenseRequestError) throw error;
      throw new LicenseRequestError(
        error?.name === 'AbortError' ? '授权服务器连接超时' : '无法连接授权服务器',
        { code: 'NETWORK_ERROR', network: true },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async getPublicConfig() {
    if (!this.config.serverUrl) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const url = new URL('/api/v1/public/config', `${this.config.serverUrl}/`);
      url.searchParams.set('packageId', this.config.packageId);
      const response = await fetch(url, { signal: controller.signal });
      const payload = await response.json().catch(() => null);
      return response.ok && payload?.ok ? payload.data : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async getStatus(options = {}) {
    const deviceHash = await this.getDeviceHash();
    if (!this.config.required) {
      return {
        state: 'not-required',
        active: true,
        required: false,
        packageId: this.config.packageId,
        deviceHash,
      };
    }
    if (!this.config.serverUrl) {
      return {
        state: 'misconfigured',
        active: false,
        required: true,
        packageId: this.config.packageId,
        deviceHash,
        message: '安全安装包尚未配置授权服务器地址。',
      };
    }

    const state = await this.loadState();
    if (!state?.token) {
      const publicConfig = options.includePublicConfig === false
        ? null
        : await this.getPublicConfig();
      return {
        state: state?.pendingOrder ? 'payment-pending' : 'locked',
        active: false,
        required: true,
        packageId: this.config.packageId,
        product: publicConfig?.product || this.config.product,
        deviceHash,
        pendingOrder: state?.pendingOrder
          ? {
              orderId: state.pendingOrder.orderId,
              checkoutUrl: state.pendingOrder.checkoutUrl || null,
              qrCodeUrl: state.pendingOrder.qrCodeUrl || null,
            }
          : null,
        payment: publicConfig,
      };
    }

    try {
      const verified = await this.request('/api/v1/verify', {
        token: state.token,
        deviceHash,
        packageId: this.config.packageId,
        packageVersion: this.app.getVersion(),
      });
      const nextState = {
        ...state,
        product: verified.product,
        codeMask: verified.codeMask,
        leaseExpiresAt: verified.leaseExpiresAt,
        lastVerifiedAt: new Date().toISOString(),
        offlineGraceHours: Number(verified.offlineGraceHours) || this.config.offlineGraceHours,
      };
      await this.saveState(nextState);
      return publicStatus({
        state: 'active',
        active: true,
        required: true,
        offline: false,
        packageId: this.config.packageId,
        product: nextState.product,
        codeMask: nextState.codeMask,
        leaseExpiresAt: nextState.leaseExpiresAt,
        deviceHash,
      });
    } catch (error) {
      if (!error.network) {
        await this.clearState();
        return {
          state: 'locked',
          active: false,
          required: true,
          packageId: this.config.packageId,
          deviceHash,
          message: error.message,
          code: error.code,
        };
      }

      const lastVerifiedAt = new Date(state.lastVerifiedAt || 0).getTime();
      const leaseExpiresAt = new Date(state.leaseExpiresAt || 0).getTime();
      const graceHours = Number(state.offlineGraceHours) || this.config.offlineGraceHours;
      const offlineDeadline = lastVerifiedAt + graceHours * 3_600_000;
      if (
        Number.isFinite(lastVerifiedAt) &&
        Date.now() <= offlineDeadline &&
        Date.now() <= leaseExpiresAt
      ) {
        return {
          state: 'offline-grace',
          active: true,
          required: true,
          offline: true,
          packageId: this.config.packageId,
          product: state.product,
          codeMask: state.codeMask,
          leaseExpiresAt: state.leaseExpiresAt,
          offlineUntil: new Date(Math.min(offlineDeadline, leaseExpiresAt)).toISOString(),
          deviceHash,
          message: '授权服务器暂时不可用，当前处于离线宽限期。',
        };
      }
      return {
        state: 'locked',
        active: false,
        required: true,
        packageId: this.config.packageId,
        deviceHash,
        message: '无法连接授权服务器，且离线宽限期已结束。',
        code: 'OFFLINE_GRACE_EXPIRED',
      };
    }
  }

  async activate(licenseCode) {
    const code = String(licenseCode || '').trim().toUpperCase();
    if (code.length < 19 || code.length > 30) {
      return { active: false, state: 'locked', message: '请输入有效的授权码。' };
    }
    const deviceHash = await this.getDeviceHash();
    try {
      const activated = await this.request('/api/v1/activate', {
        licenseCode: code,
        deviceHash,
        deviceLabel: `${os.hostname()} (${process.platform} ${process.arch})`,
        packageId: this.config.packageId,
        packageVersion: this.app.getVersion(),
      });
      const persisted = await this.saveState({
        token: activated.token,
        product: activated.product,
        codeMask: activated.codeMask,
        leaseExpiresAt: activated.leaseExpiresAt,
        lastVerifiedAt: new Date().toISOString(),
        offlineGraceHours: Number(activated.offlineGraceHours) || this.config.offlineGraceHours,
        pendingOrder: null,
      });
      return {
        active: true,
        state: 'active',
        packageId: this.config.packageId,
        product: activated.product,
        codeMask: activated.codeMask,
        leaseExpiresAt: activated.leaseExpiresAt,
        persisted,
        message: persisted
          ? '授权成功。'
          : '授权成功，但系统安全存储不可用；重启后需要重新激活。',
      };
    } catch (error) {
      return {
        active: false,
        state: 'locked',
        message: error.message,
        code: error.code,
      };
    }
  }

  async createOrder() {
    const deviceHash = await this.getDeviceHash();
    try {
      const order = await this.request('/api/v1/orders', {
        packageId: this.config.packageId,
        packageVersion: this.app.getVersion(),
        deviceHash,
        deviceLabel: `${os.hostname()} (${process.platform} ${process.arch})`,
      });
      const state = (await this.loadState()) || {};
      await this.saveState({
        ...state,
        pendingOrder: {
          orderId: order.orderId,
          claimSecret: order.claimSecret,
          checkoutUrl: order.checkoutUrl || null,
          qrCodeUrl: order.qrCodeUrl || null,
        },
      });
      return {
        ok: true,
        orderId: order.orderId,
        status: order.status,
        product: order.product,
        amountCents: order.amountCents,
        currency: order.currency,
        checkoutUrl: order.checkoutUrl || null,
        qrCodeUrl: order.qrCodeUrl || null,
        manualReview: Boolean(order.manualReview),
      };
    } catch (error) {
      return { ok: false, message: error.message, code: error.code };
    }
  }

  async checkOrder() {
    const state = await this.loadState();
    const pending = state?.pendingOrder;
    if (!pending?.orderId || !pending?.claimSecret) {
      return { ok: false, message: '没有待查询的支付订单。' };
    }
    const deviceHash = await this.getDeviceHash();
    try {
      const result = await this.request(
        `/api/v1/orders/${encodeURIComponent(pending.orderId)}/status`,
        {
          claimSecret: pending.claimSecret,
          deviceHash,
        },
      );
      if (result.status !== 'fulfilled') {
        return {
          ok: true,
          status: result.status,
          orderId: pending.orderId,
          checkoutUrl: result.checkoutUrl || pending.checkoutUrl || null,
          qrCodeUrl: result.qrCodeUrl || pending.qrCodeUrl || null,
        };
      }
      const persisted = await this.saveState({
        token: result.token,
        product: result.product,
        codeMask: result.codeMask,
        licenseCode: result.licenseCode,
        leaseExpiresAt: result.leaseExpiresAt,
        lastVerifiedAt: new Date().toISOString(),
        offlineGraceHours: Number(result.offlineGraceHours) || this.config.offlineGraceHours,
        pendingOrder: null,
      });
      return {
        ok: true,
        active: true,
        status: 'fulfilled',
        product: result.product,
        licenseCode: result.licenseCode,
        codeMask: result.codeMask,
        persisted,
      };
    } catch (error) {
      return { ok: false, message: error.message, code: error.code };
    }
  }
}

module.exports = {
  LicenseManager,
};
