import fetch from 'node-fetch';
import { getValidAccessToken } from '../auth/tokens.js';
import { loadConfig } from './config.js';
import { API_BASE_URL } from './constants.js';
import { getDeviceId } from './device.js';

/**
 * Make an authenticated API request
 * @param {string} path - API path (e.g., '/api/user/stats')
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function authenticatedFetch(path, options = {}) {
  const config = await loadConfig();
  // Prioritize environment variable (for dev) over saved config
  const endpoint = API_BASE_URL || config.endpoint;
  
  // Get valid tokens
  const tokens = await getValidAccessToken();
  
  // Get device ID
  const deviceId = await getDeviceId();
  
  // Build full URL
  const url = `${endpoint}${path}`;
  
  // Pass OAuth tokens in headers for backend to handle authentication
  const headers = {
    ...options.headers,
    'Content-Type': 'application/json',
    'X-OAuth-Token': tokens.oauth_token,
    'X-OAuth-Token-Secret': tokens.oauth_token_secret,
    'X-Device-ID': deviceId
  };
  
  // Make the request
  const response = await fetch(url, {
    ...options,
    headers
  });
  
  // If we get a 401, authentication failed
  if (response.status === 401) {
    throw new Error('Authentication failed. Please run "claudecount auth" to re-authenticate.');
  }
  
  return response;
}

/**
 * Make an API request without authentication
 * @param {string} path - API path
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function apiFetch(path, options = {}) {
  const config = await loadConfig();
  // Prioritize environment variable (for dev) over saved config  
  const endpoint = API_BASE_URL || config.endpoint;
  
  const url = `${endpoint}${path}`;
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  return fetch(url, {
    ...options,
    headers
  });
}