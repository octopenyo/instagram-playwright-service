require('dotenv').config();
const SessionManager = require('./sessionManager');
const { logger } = require('./utils/logger');

async function clearSession() {
  const username = process.env.INSTAGRAM_USERNAME || 'instagram_user';
  const sessionManager = new SessionManager();
  
  const result = await sessionManager.deleteSession(username);
  
  if (result) {
    logger.info(`🗑️ Session cleared for ${username}`);
    logger.info('🔄 Next login will require manual authentication');
  } else {
    logger.info('ℹ️ No session found to clear');
  }
  
  process.exit(0);
}

clearSession();