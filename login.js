require('dotenv').config();
const InstagramService = require('./instagramService');
const { logger } = require('./utils/logger');

async function manualLogin() {
  logger.info('🚀 Starting manual login process...');
  logger.info('📝 This will open a browser for you to login manually');
  
  const service = new InstagramService();
  
  try {
    await service.initializeBrowser();
    await service.ensureLoggedIn();
    
    logger.info('✅ Manual login completed successfully!');
    logger.info('💾 Session has been saved.');
    logger.info('🔄 You can now use the service for sending messages.');
    
    process.exit(0);
  } catch (error) {
    logger.error(`❌ Login failed: ${error.message}`);
    process.exit(1);
  }
}

manualLogin();