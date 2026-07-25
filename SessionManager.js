const fs = require('fs').promises;
const path = require('path');
const { logger } = require('./utils/logger');

class SessionManager {
  constructor() {
    this.sessionDir = process.env.SESSION_DIR || path.join(__dirname, 'sessions');
    this.ensureSessionDirectory();
  }

  async ensureSessionDirectory() {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
      logger.info(`📁 Session directory: ${this.sessionDir}`);
    } catch (error) {
      logger.error(`Failed to create session directory: ${error.message}`);
    }
  }

  async saveSession(username, sessionData) {
    try {
      const filename = `${username}-session.json`;
      const filepath = path.join(this.sessionDir, filename);
      await fs.writeFile(filepath, JSON.stringify(sessionData, null, 2));
      logger.info(`💾 Session saved for ${username} at ${filepath}`);
      return filename;
    } catch (error) {
      logger.error(`Failed to save session: ${error.message}`);
      throw error;
    }
  }

  async loadSession(sessionId) {
    try {
      const filepath = path.join(this.sessionDir, sessionId);
      const data = await fs.readFile(filepath, 'utf8');
      logger.info(`📂 Session loaded: ${sessionId}`);
      return JSON.parse(data);
    } catch (error) {
      logger.error(`Failed to load session: ${error.message}`);
      return null;
    }
  }

  async getLatestSession(username) {
    try {
      const files = await fs.readdir(this.sessionDir);
      const sessionFiles = files
        .filter(file => file.startsWith(username) && file.endsWith('.json'))
        .sort()
        .reverse();
      
      if (sessionFiles.length === 0) {
        logger.info('ℹ️ No existing session found');
        return null;
      }
      
      const latest = sessionFiles[0];
      logger.info(`📂 Found existing session: ${latest}`);
      return latest;
    } catch (error) {
      logger.error(`Failed to get latest session: ${error.message}`);
      return null;
    }
  }

  async sessionExists(username) {
    try {
      const latest = await this.getLatestSession(username);
      return latest !== null;
    } catch (error) {
      return false;
    }
  }

  async deleteSession(username) {
    try {
      const latest = await this.getLatestSession(username);
      if (latest) {
        const filepath = path.join(this.sessionDir, latest);
        await fs.unlink(filepath);
        logger.info(`🗑️ Session deleted: ${latest}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Failed to delete session: ${error.message}`);
      return false;
    }
  }

  async cleanupOldSessions(maxAge = 7 * 24 * 60 * 60 * 1000) {
    try {
      const files = await fs.readdir(this.sessionDir);
      const now = Date.now();
      let deleted = 0;
      
      for (const file of files) {
        const filepath = path.join(this.sessionDir, file);
        const stats = await fs.stat(filepath);
        const age = now - stats.mtime.getTime();
        
        if (age > maxAge) {
          await fs.unlink(filepath);
          deleted++;
          logger.info(`🗑️ Removed old session: ${file}`);
        }
      }
      
      if (deleted > 0) {
        logger.info(`🧹 Cleaned up ${deleted} old session(s)`);
      }
    } catch (error) {
      logger.error(`Failed to cleanup sessions: ${error.message}`);
    }
  }

  async listSessions() {
    try {
      const files = await fs.readdir(this.sessionDir);
      const sessions = files.filter(file => file.endsWith('.json'));
      return sessions;
    } catch (error) {
      logger.error(`Failed to list sessions: ${error.message}`);
      return [];
    }
  }
}

module.exports = SessionManager;