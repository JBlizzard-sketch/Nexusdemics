const axios = require('axios');

class ApiMonitor {
  constructor() {
    this.calls = {
      groq: 0,
      zotero: 0,
      eden: 0,
      telegram: 0
    };
    this.errors = [];
    this.startTime = Date.now();
  }

  logCall(api, success = true) {
    if (this.calls[api] !== undefined) {
      this.calls[api]++;
    }
    
    if (!success) {
      this.errors.push({
        api,
        timestamp: new Date().toISOString(),
        message: 'API call failed'
      });
    }
  }

  logError(api, error) {
    this.errors.push({
      api,
      timestamp: new Date().toISOString(),
      message: error.message || error
    });
  }

  getStats() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    return {
      uptime,
      calls: this.calls,
      errors: this.errors.slice(-10), // Last 10 errors
      errorCount: this.errors.length
    };
  }

  async sendAdminAlert(message, adminChatId, telegramToken) {
    try {
      await axios.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        chat_id: adminChatId,
        text: `🚨 ${message}`
      });
    } catch (error) {
      console.error('Failed to send admin alert:', error.message);
    }
  }
}

// Global monitor instance
const monitor = new ApiMonitor();

module.exports = monitor;