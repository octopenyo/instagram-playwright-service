require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const InstagramService = require('./instagramService');
const SessionManager = require('./sessionManager');
const { logger } = require('./utils/logger');

const app = express();
const port = process.env.PORT || 4000;

// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many requests, please try again later.'
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/', limiter);

// ============================================
// HEALTH CHECK ENDPOINT
// ============================================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'Instagram Playwright Automation',
    loginMode: process.env.AUTO_LOGIN === 'false' ? 'Manual' : 'Automatic',
    headlessMode: process.env.HEADLESS === 'true' ? 'Yes' : 'No'
  });
});

// ============================================
// SEND MESSAGE ENDPOINT
// ============================================
app.post('/api/send-message', async (req, res) => {
  const { username, message, sessionId } = req.body;
  
  if (!username || !message) {
    return res.status(400).json({
      success: false,
      error: 'Username and message are required'
    });
  }

  try {
    logger.info(`📨 Sending message to ${username}`);
    
    const instagram = new InstagramService();
    const result = await instagram.sendDirectMessage(username, message, sessionId);
    
    if (result.success) {
      logger.info(`✅ Successfully sent message to ${username}`);
      res.json({
        success: true,
        data: result.data,
        username: username
      });
    } else {
      logger.error(`❌ Failed to send message to ${username}: ${result.error}`);
      res.status(500).json({
        success: false,
        error: result.error,
        username: username
      });
    }
  } catch (error) {
    logger.error(`❌ Error sending message to ${username}: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      username: username
    });
  }
});

// ============================================
// CHECK PROFILE ENDPOINT
// ============================================
app.post('/api/check-profile', async (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Username is required'
    });
  }

  try {
    logger.info(`🔍 Checking profile: ${username}`);
    const instagram = new InstagramService();
    const result = await instagram.checkProfile(username);
    
    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(404).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// GET CONVERSATIONS ENDPOINT
// ============================================
app.post('/api/get-conversations', async (req, res) => {
  const { limit = 10 } = req.body;
  
  try {
    logger.info(`💬 Getting conversations (limit: ${limit})`);
    const instagram = new InstagramService();
    const result = await instagram.getConversations(limit);
    
    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// CLEAR SESSION ENDPOINT
// ============================================
app.post('/api/clear-session', async (req, res) => {
  const { username } = req.body;
  
  try {
    logger.info('🗑️ Clearing session...');
    const sessionManager = new SessionManager();
    const targetUsername = username || process.env.INSTAGRAM_USERNAME || 'instagram_user';
    const result = await sessionManager.deleteSession(targetUsername);
    
    if (result) {
      res.json({
        success: true,
        message: `Session cleared for ${targetUsername}. Next request will require manual login.`
      });
    } else {
      res.json({
        success: false,
        message: 'No session found to clear.'
      });
    }
  } catch (error) {
    logger.error(`❌ Error clearing session: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// SESSION STATUS ENDPOINT
// ============================================
app.get('/api/session-status', async (req, res) => {
  try {
    logger.info('📊 Checking session status...');
    const username = process.env.INSTAGRAM_USERNAME || 'instagram_user';
    const sessionManager = new SessionManager();
    const exists = await sessionManager.sessionExists(username);
    const sessions = await sessionManager.listSessions();
    
    res.json({
      success: true,
      data: {
        loggedIn: exists,
        sessions: sessions,
        manualLoginEnabled: process.env.AUTO_LOGIN === 'false',
        headlessMode: process.env.HEADLESS === 'true',
        username: username,
        sessionCount: sessions.length
      }
    });
  } catch (error) {
    logger.error(`❌ Error checking session status: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// LIST SESSIONS ENDPOINT
// ============================================
app.get('/api/list-sessions', async (req, res) => {
  try {
    logger.info('📂 Listing all sessions...');
    const sessionManager = new SessionManager();
    const sessions = await sessionManager.listSessions();
    
    res.json({
      success: true,
      data: {
        sessions: sessions,
        count: sessions.length
      }
    });
  } catch (error) {
    logger.error(`❌ Error listing sessions: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// FORCE MANUAL LOGIN ENDPOINT
// ============================================
app.post('/api/force-login', async (req, res) => {
  try {
    logger.info('🔄 Forcing manual login...');
    
    const username = process.env.INSTAGRAM_USERNAME || 'instagram_user';
    const sessionManager = new SessionManager();
    await sessionManager.deleteSession(username);
    
    const instagram = new InstagramService();
    await instagram.initializeBrowser();
    await instagram.ensureLoggedIn();
    
    res.json({
      success: true,
      message: 'Manual login process started. Please check the browser window.'
    });
  } catch (error) {
    logger.error(`❌ Force login failed: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// SERVICE INFO ENDPOINT
// ============================================
app.get('/api/info', (req, res) => {
  res.json({
    service: 'Instagram Playwright Automation Service',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: 'GET /health',
      sendMessage: 'POST /api/send-message',
      checkProfile: 'POST /api/check-profile',
      getConversations: 'POST /api/get-conversations',
      sessionStatus: 'GET /api/session-status',
      listSessions: 'GET /api/list-sessions',
      clearSession: 'POST /api/clear-session',
      forceLogin: 'POST /api/force-login',
      info: 'GET /api/info'
    },
    config: {
      manualLogin: process.env.AUTO_LOGIN === 'false',
      headless: process.env.HEADLESS === 'true',
      maxRetries: process.env.MAX_RETRIES || 3,
      retryDelay: process.env.RETRY_DELAY || 5000,
      loginTimeout: process.env.LOGIN_TIMEOUT || 120000
    }
  });
});

// ============================================
// ERROR HANDLING MIDDLEWARE
// ============================================
app.use((err, req, res, next) => {
  logger.error(`❌ Unhandled error: ${err.stack}`);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ============================================
// 404 HANDLER
// ============================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path
  });
});

// ============================================
// START SERVER
// ============================================
const server = app.listen(port, async () => {
  logger.info('========================================');
  logger.info('🚀 Instagram Playwright Service Started');
  logger.info('========================================');
  logger.info(`📡 Service running on port: ${port}`);
  logger.info(`🔗 Health check: http://localhost:${port}/health`);
  logger.info(`🔗 API info: http://localhost:${port}/api/info`);
  logger.info(`🔗 Session status: http://localhost:${port}/api/session-status`);
  logger.info('========================================');
  logger.info(`🔐 Login Mode: ${process.env.AUTO_LOGIN === 'false' ? 'MANUAL' : 'AUTOMATIC'}`);
  logger.info(`🖥️  Headless Mode: ${process.env.HEADLESS === 'true' ? 'ON' : 'OFF'}`);
  logger.info(`📁 Session Directory: ${process.env.SESSION_DIR || './sessions'}`);
  logger.info('========================================');
  
  if (process.env.AUTO_LOGIN === 'false') {
    logger.info('⚠️  MANUAL LOGIN MODE ENABLED');
    logger.info('📱 Browser will open for login on first request');
    logger.info('⏰ You have 2 minutes to complete login');
    logger.info('========================================');
    
    // Auto-open browser on startup
    logger.info('🔄 Pre-initializing browser for manual login...');
    try {
      const InstagramService = require('./instagramService');
      const instagram = new InstagramService();
      await instagram.initializeBrowser();
      await instagram.ensureLoggedIn();
      logger.info('✅ Browser opened for manual login');
    } catch (error) {
      logger.error(`❌ Failed to open browser: ${error.message}`);
    }
  }
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
process.on('SIGTERM', () => {
  logger.info('🛑 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    logger.info('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('🛑 SIGINT received, shutting down gracefully...');
  server.close(() => {
    logger.info('✅ Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('❌ Uncaught Exception:', error);
});

module.exports = app;