import type { SphereBotConfig } from './types.js';

type WalletApiConfig = SphereBotConfig['walletApi'];

/**
 * Resolve the wallet-api composition from `WALLET_API_URL` /
 * `WALLET_API_DEVICE_ID`. Required even though these bots move no money:
 * since sphere-sdk 0.14.1 `Sphere.init` refuses to start without a wallet-api
 * composition (INVALID_CONFIG) — there is no messaging-only mode. Fails fast at
 * config load rather than inside Sphere.init.
 */
export function resolveWalletApiConfig(): WalletApiConfig {
  const baseUrl = process.env.WALLET_API_URL?.trim();
  if (!baseUrl) {
    throw new Error(
      'WALLET_API_URL is required: sphere-sdk refuses to init without a wallet-api composition',
    );
  }
  const deviceId = process.env.WALLET_API_DEVICE_ID?.trim() || undefined;
  return { baseUrl, ...(deviceId ? { deviceId } : {}) };
}
