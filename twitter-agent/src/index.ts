import express from 'express';
import { TwitterAutonomousAgent } from './agent.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .dev.vars (same format as MAHORAGA)
function loadEnvVars(): Record<string, string> {
  const env: Record<string, string> = {};
  
  // Copy process.env, filtering out undefined values
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  
  // Try to load .dev.vars from project root (two levels up)
  const projectRoot = join(__dirname, '../..');
  const devVarsPath = join(projectRoot, '.dev.vars');
  
  try {
    const content = readFileSync(devVarsPath, 'utf-8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').trim();
        if (key && value) {
          env[key.trim()] = value;
        }
      }
    });
  } catch (error) {
    console.warn('[TwitterAgent] Could not load .dev.vars, using environment variables only');
  }
  
  return env;
}

const env = loadEnvVars();

const PORT = parseInt(env.PORT || env.TWITTER_AGENT_URL?.split(':').pop() || '8788', 10);
const CHROME_DEBUG_PORT = parseInt(env.CHROME_DEBUG_PORT || env.TWITTER_AGENT_CHROME_PORT || '9222', 10);
const OPENAI_API_KEY = env.OPENAI_API_KEY || '';
// Remove 'openai/' prefix if present - createOpenAI expects just model name
const rawModel = env.TWITTER_AGENT_LLM_MODEL || env.LLM_MODEL || 'gpt-4o-mini';
const LLM_MODEL = rawModel.replace(/^openai\//, '');

if (!OPENAI_API_KEY) {
  console.error('[TwitterAgent] ERROR: OPENAI_API_KEY is required');
  process.exit(1);
}

const app = express();
app.use(express.json());

// Initialize agent
const agent = new TwitterAutonomousAgent(CHROME_DEBUG_PORT, OPENAI_API_KEY, LLM_MODEL);

// Initialize on startup
agent.init().catch(error => {
  console.error('[TwitterAgent] Failed to initialize:', error);
  console.error('[TwitterAgent] Make sure Chrome is running with remote debugging enabled');
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const health = await agent.healthCheck();
    res.status(health.healthy ? 200 : 503).json(health);
  } catch (error) {
    res.status(503).json({
      healthy: false,
      message: String(error),
    });
  }
});

// Search tweets endpoint
app.post('/twitter/search', async (req, res) => {
  try {
    const { query, maxResults = 10 } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Query is required and must be a string',
      });
    }

    if (maxResults && (typeof maxResults !== 'number' || maxResults < 1 || maxResults > 50)) {
      return res.status(400).json({
        success: false,
        error: 'maxResults must be a number between 1 and 50',
      });
    }

    console.log(`[TwitterAgent] Searching for: ${query} (max: ${maxResults})`);
    const tweets = await agent.searchTwitter(query, maxResults);

    res.json({
      success: true,
      tweets,
      count: tweets.length,
    });
  } catch (error) {
    console.error('[TwitterAgent] Search error:', error);
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

// Breaking news endpoint
app.post('/twitter/breaking-news', async (req, res) => {
  try {
    const { symbols } = req.body;

    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'symbols must be a non-empty array',
      });
    }

    console.log(`[TwitterAgent] Checking breaking news for: ${symbols.join(', ')}`);
    const news = await agent.checkBreakingNews(symbols);

    res.json({
      success: true,
      news,
      count: news.length,
    });
  } catch (error) {
    console.error('[TwitterAgent] Breaking news error:', error);
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`[TwitterAgent] Server running on http://localhost:${PORT}`);
  console.log(`[TwitterAgent] Chrome debug port: ${CHROME_DEBUG_PORT}`);
  console.log(`[TwitterAgent] LLM Model: ${LLM_MODEL}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[TwitterAgent] SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[TwitterAgent] SIGINT received, shutting down gracefully');
  process.exit(0);
});
