#!/usr/bin/env node

/**
 * MAHORAGA Health Monitor
 * 
 * Monitors the health of the MAHORAGA Worker by polling /health endpoint.
 * Restarts the service via PM2 if it fails N times consecutively.
 * Sends Discord notifications if configured.
 */

const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const { promisify } = require('util');
const { URL } = require('url');

const execAsync = promisify(exec);

// Configuration from environment variables
const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '60000', 10);
const MAX_FAILURES = parseInt(process.env.MAX_FAILURES || '3', 10);
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// State
let consecutiveFailures = 0;
let lastHealthCheck = null;
let isRestarting = false;

/**
 * Check health endpoint
 */
async function checkHealth() {
  return new Promise((resolve) => {
    const url = new URL('/health', WORKER_URL);
    
    const req = http.get(url.toString(), (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            resolve({ healthy: true, status: res.statusCode, data: json });
          } catch (e) {
            resolve({ healthy: false, error: 'Invalid JSON response' });
          }
        } else {
          resolve({ healthy: false, status: res.statusCode, error: `HTTP ${res.statusCode}` });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({ healthy: false, error: err.message });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ healthy: false, error: 'Request timeout' });
    });
  });
}

/**
 * Check agent status
 */
async function checkAgentStatus() {
  return new Promise((resolve) => {
    const token = process.env.MAHORAGA_API_TOKEN;
    if (!token) {
      resolve({ enabled: false, error: 'No API token configured' });
      return;
    }

    const url = new URL('/agent/status', WORKER_URL);
    
    const req = http.get(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            resolve({ enabled: json.data?.enabled === true, status: res.statusCode, data: json });
          } catch (e) {
            resolve({ enabled: false, error: 'Invalid JSON response' });
          }
        } else {
          resolve({ enabled: false, status: res.statusCode, error: `HTTP ${res.statusCode}` });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({ enabled: false, error: err.message });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ enabled: false, error: 'Request timeout' });
    });
  });
}

/**
 * Enable agent
 */
async function enableAgent() {
  return new Promise((resolve) => {
    const token = process.env.MAHORAGA_API_TOKEN;
    if (!token) {
      resolve({ success: false, error: 'No API token configured' });
      return;
    }

    const url = new URL('/agent/enable', WORKER_URL);
    const postData = '';
    
    const req = http.request(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            resolve({ success: json.ok === true && json.enabled === true, data: json });
          } catch (e) {
            resolve({ success: false, error: 'Invalid JSON response' });
          }
        } else {
          resolve({ success: false, status: res.statusCode, error: `HTTP ${res.statusCode}` });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ success: false, error: 'Request timeout' });
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * Restart service via PM2
 */
async function restartService() {
  if (isRestarting) {
    console.log('[HealthMonitor] Already restarting, skipping...');
    return;
  }
  
  isRestarting = true;
  console.log('[HealthMonitor] Restarting mahoraga-worker via PM2...');
  
  try {
    const { stdout, stderr } = await execAsync('pm2 restart mahoraga-worker');
    console.log('[HealthMonitor] Restart command executed');
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    
    // Reset failure counter after restart
    consecutiveFailures = 0;
    
    // Send Discord notification
    if (DISCORD_WEBHOOK_URL) {
      await sendDiscordNotification({
        title: '🔄 MAHORAGA Worker Restarted',
        description: 'The health monitor detected failures and restarted the service.',
        color: 0xfbbf24,
      });
    }
  } catch (error) {
    console.error('[HealthMonitor] Failed to restart service:', error.message);
    
    if (DISCORD_WEBHOOK_URL) {
      await sendDiscordNotification({
        title: '❌ MAHORAGA Worker Restart Failed',
        description: `Failed to restart the service: ${error.message}`,
        color: 0xef4444,
      });
    }
  } finally {
    isRestarting = false;
  }
}

/**
 * Send Discord notification
 */
async function sendDiscordNotification(embed) {
  if (!DISCORD_WEBHOOK_URL) return;
  
  return new Promise((resolve) => {
    try {
      const url = new URL(DISCORD_WEBHOOK_URL);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;
      
      const payload = JSON.stringify({
        embeds: [{
          ...embed,
          timestamp: new Date().toISOString(),
          footer: { text: 'MAHORAGA Health Monitor' },
        }],
      });
      
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      };
      
      const req = httpModule.request(options, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[HealthMonitor] Discord notification sent');
        } else {
          console.error('[HealthMonitor] Discord notification failed:', res.statusCode);
        }
        resolve();
      });
      
      req.on('error', (error) => {
        console.error('[HealthMonitor] Discord notification error:', error.message);
        resolve();
      });
      
      req.setTimeout(10000, () => {
        req.destroy();
        console.error('[HealthMonitor] Discord notification timeout');
        resolve();
      });
      
      req.write(payload);
      req.end();
    } catch (error) {
      console.error('[HealthMonitor] Discord notification error:', error.message);
      resolve();
    }
  });
}

/**
 * Main health check loop
 */
async function runHealthCheck() {
  const timestamp = new Date().toISOString();
  const result = await checkHealth();
  lastHealthCheck = timestamp;
  
  if (result.healthy) {
    if (consecutiveFailures > 0) {
      console.log(`[HealthMonitor] [${timestamp}] Service recovered after ${consecutiveFailures} failures`);
      consecutiveFailures = 0;
    } else {
      console.log(`[HealthMonitor] [${timestamp}] ✓ Health check passed`);
    }
    
    // Check if agent is enabled, and enable it if not
    const agentStatus = await checkAgentStatus();
    if (!agentStatus.enabled && !agentStatus.error) {
      console.log(`[HealthMonitor] [${timestamp}] Agent is disabled, attempting to enable...`);
      const enableResult = await enableAgent();
      if (enableResult.success) {
        console.log(`[HealthMonitor] [${timestamp}] ✓ Agent enabled successfully`);
      } else {
        console.error(`[HealthMonitor] [${timestamp}] ✗ Failed to enable agent:`, enableResult.error);
      }
    }
  } else {
    consecutiveFailures++;
    console.error(`[HealthMonitor] [${timestamp}] ✗ Health check failed (${consecutiveFailures}/${MAX_FAILURES}):`, result.error || result.status);
    
    if (consecutiveFailures >= MAX_FAILURES) {
      console.error(`[HealthMonitor] [${timestamp}] ⚠️ Max failures reached (${MAX_FAILURES}), restarting service...`);
      
      if (DISCORD_WEBHOOK_URL) {
        await sendDiscordNotification({
          title: '⚠️ MAHORAGA Worker Health Check Failed',
          description: `Service failed ${MAX_FAILURES} consecutive health checks. Restarting...`,
          color: 0xf59e0b,
          fields: [
            { name: 'Last Error', value: result.error || `HTTP ${result.status}`, inline: false },
          ],
        });
      }
      
      await restartService();
    }
  }
}

/**
 * Startup
 */
console.log('========================================');
console.log('  MAHORAGA Health Monitor');
console.log('========================================');
console.log('');
console.log(`Worker URL: ${WORKER_URL}`);
console.log(`Check Interval: ${HEALTH_CHECK_INTERVAL_MS}ms`);
console.log(`Max Failures: ${MAX_FAILURES}`);
console.log(`Discord Notifications: ${DISCORD_WEBHOOK_URL ? 'Enabled' : 'Disabled'}`);
console.log('');
console.log('Starting health checks...');
console.log('');

// Run initial health check
runHealthCheck();

// Schedule periodic health checks
setInterval(runHealthCheck, HEALTH_CHECK_INTERVAL_MS);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[HealthMonitor] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[HealthMonitor] Shutting down...');
  process.exit(0);
});
