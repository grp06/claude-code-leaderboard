import { hostname } from 'os';
import { randomBytes } from 'crypto';
import { loadConfig, saveConfig } from './config.js';

/**
 * Generate a unique device identifier
 * Combines hostname with a random component for uniqueness
 */
function generateDeviceId() {
  const host = hostname().replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 20);
  const random = randomBytes(4).toString('hex');
  return `${host}-${random}`;
}

/**
 * Get or create a persistent device ID
 */
export async function getDeviceId() {
  const config = await loadConfig();
  
  if (!config.deviceId) {
    config.deviceId = generateDeviceId();
    await saveConfig(config);
  }
  
  return config.deviceId;
}

/**
 * Get device metadata for API requests
 */
export async function getDeviceMetadata() {
  const deviceId = await getDeviceId();
  
  return {
    device_id: deviceId,
    hostname: hostname(),
    platform: process.platform,
    node_version: process.version
  };
}