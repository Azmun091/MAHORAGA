const path = require('path');
const fs = require('fs');

// Load environment variables from .dev.vars (wrangler format)
// Note: wrangler dev reads from .dev.vars automatically, but we need env vars for health monitor
const env = { ...process.env };

// Try to load .dev.vars if it exists
const devVarsPath = path.resolve(__dirname, '.dev.vars');
if (fs.existsSync(devVarsPath)) {
  const devVarsContent = fs.readFileSync(devVarsPath, 'utf-8');
  devVarsContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=').trim();
      if (key && value) {
        env[key.trim()] = value;
      }
    }
  });
}

// Common resilience settings for all Node.js services
const nodeServiceDefaults = {
  interpreter: 'node',
  watch: false,
  autorestart: true,
  max_restarts: 50,
  restart_delay: 5000,
  exp_backoff_restart_delay: 100,
  max_memory_restart: '2G',
  kill_timeout: 5000,
  listen_timeout: 30000,
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  merge_logs: true,
};

module.exports = {
  apps: [
    {
      name: 'mahoraga-worker',
      cwd: path.resolve(__dirname),
      script: 'npx',
      args: 'wrangler dev --port 8787',
      interpreter: 'none',
      watch: false,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '2G',
      kill_timeout: 10000, // Wrangler needs more time to shutdown
      listen_timeout: 60000, // Wrangler can take a while to start
      env: env,
      error_file: path.resolve(__dirname, 'logs/mahoraga-worker-error.log'),
      out_file: path.resolve(__dirname, 'logs/mahoraga-worker-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'mahoraga-dashboard',
      cwd: path.resolve(__dirname, 'dashboard'),
      script: 'npx',
      args: 'vite preview --host 0.0.0.0 --port 4173',
      interpreter: 'none',
      watch: false,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 10000, // Increased delay for vite preview startup
      exp_backoff_restart_delay: 200,
      max_memory_restart: '1G',
      kill_timeout: 10000, // Increased timeout for graceful shutdown
      listen_timeout: 60000, // Increased timeout for vite preview to start (can be slow)
      env: env,
      error_file: path.resolve(__dirname, 'logs/mahoraga-dashboard-error.log'),
      out_file: path.resolve(__dirname, 'logs/mahoraga-dashboard-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Ignore exit codes that might indicate normal shutdown
      ignore_watch: ['node_modules', '.git', 'dist'],
    },
    {
      name: 'mahoraga-health-monitor',
      cwd: path.resolve(__dirname),
      script: 'scripts/health-monitor.js',
      ...nodeServiceDefaults,
      restart_delay: 10000, // Longer delay for health monitor
      max_memory_restart: '512M', // Health monitor uses minimal memory
      env: {
        ...env,
        WORKER_URL: 'http://localhost:8787',
        HEALTH_CHECK_INTERVAL_MS: '60000', // Check every 60 seconds
        MAX_FAILURES: '3', // Restart after 3 consecutive failures
      },
      error_file: path.resolve(__dirname, 'logs/health-monitor-error.log'),
      out_file: path.resolve(__dirname, 'logs/health-monitor-out.log'),
    },
    {
      name: 'twitter-autonomous-agent',
      cwd: path.resolve(__dirname, 'twitter-agent'),
      script: path.resolve(__dirname, 'twitter-agent', 'dist', 'index.js'),
      interpreter: 'node',
      ...nodeServiceDefaults,
      restart_delay: 10000,
      max_memory_restart: '1G',
      env: {
        ...env,
        PORT: '8788',
        CHROME_DEBUG_PORT: env.TWITTER_AGENT_CHROME_PORT || '9222',
        NODE_ENV: 'production',
      },
      error_file: path.resolve(__dirname, 'logs/twitter-agent-error.log'),
      out_file: path.resolve(__dirname, 'logs/twitter-agent-out.log'),
    },
  ],
};
