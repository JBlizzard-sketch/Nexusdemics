require('dotenv').config();
const axios = require('axios');
const { google } = require('googleapis');

// Env vars
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_KEY = process.env.GROQ_KEY;
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// Utility: Log API usage for monitoring
async function logApiUsage(apiName, success = true, responseTime = 0) {
  try {
    const logData = {
      timestamp: new Date().toISOString(),
      api: apiName,
      success: success,
      responseTime: responseTime,
      date: new Date().toDateString()
    };

    console.log(`API Usage: ${apiName} - ${success ? 'Success' : 'Failed'} (${responseTime}ms)`);
    
    // In a real implementation, this would log to Google Sheets
    return true;
  } catch (error) {
    console.error('Logging error:', error.message);
    return false;
  }
}

// Utility: Save user feedback to Sheets
async function saveFeedback(chatId, rating, comment = '') {
  try {
    const feedbackData = {
      timestamp: new Date().toISOString(),
      chatId: chatId.toString(),
      rating: rating,
      comment: comment
    };

    console.log(`Feedback saved: ${rating}⭐ from ${chatId}${comment ? ` - "${comment}"` : ''}`);
    
    // In a real implementation, this would save to Google Sheets
    return true;
  } catch (error) {
    console.error('Feedback save error:', error.message);
    return false;
  }
}

// Utility: Send files via Telegram (requires bot instance from caller)
async function deliverFiles(chatId, files) {
  try {
    const fileMessages = files.map(file => 
      `📁 **${file.name}**\n[Download](${file.url})`
    ).join('\n\n');
    
    console.log(`Files delivered to ${chatId}: ${files.length} files`);
    
    // Return formatted message for bot to send
    return {
      text: `📁 **Your Files:**\n\n${fileMessages}`,
      parse_mode: 'Markdown'
    };
  } catch (error) {
    console.error('File delivery error:', error.message);
    return {
      text: '❌ Error accessing files. Please try again.',
      parse_mode: 'Markdown'
    };
  }
}

// Utility: List user files from history
async function listUserFiles(chatId) {
  try {
    // In a real implementation, this would fetch from Google Sheets/Drive
    // For now, return mock data
    return [
      {
        name: 'Sample_Assignment.txt',
        date: new Date().toLocaleDateString(),
        url: 'https://example.com/file1'
      }
    ];
  } catch (error) {
    console.error('File listing error:', error.message);
    return [];
  }
}

// Utility: Collect feedback with inline keyboard (returns markup for bot)
async function collectFeedback(draftId) {
  try {
    const keyboard = {
      inline_keyboard: [
        [
          { text: '⭐', callback_data: `rate_${draftId}_1` },
          { text: '⭐⭐', callback_data: `rate_${draftId}_2` },
          { text: '⭐⭐⭐', callback_data: `rate_${draftId}_3` },
          { text: '⭐⭐⭐⭐', callback_data: `rate_${draftId}_4` },
          { text: '⭐⭐⭐⭐⭐', callback_data: `rate_${draftId}_5` }
        ],
        [
          { text: '💬 Add Comment', callback_data: `comment_${draftId}` }
        ]
      ]
    };

    return {
      text: '⭐ **Rate Your Experience:**\n\nHow satisfied are you with this draft?',
      reply_markup: keyboard,
      parse_mode: 'Markdown'
    };
  } catch (error) {
    console.error('Feedback collection error:', error.message);
    return {
      text: '✅ Draft completed! Thank you for using the academic assistant.',
      parse_mode: 'Markdown'
    };
  }
}

// Utility: Log monitoring data for admin oversight
async function logMonitoring(data) {
  try {
    const monitoringData = {
      timestamp: new Date().toISOString(),
      ...data
    };

    console.log('Monitoring data:', monitoringData);
    
    // In a real implementation, this would log to monitoring system
    return true;
  } catch (error) {
    console.error('Monitoring error:', error.message);
    return false;
  }
}

// Utility: Generate usage statistics report
async function generateUsageReport() {
  try {
    // In a real implementation, this would aggregate from Google Sheets
    return {
      totalApiCalls: 150,
      successRate: 95.5,
      averageRating: 4.2,
      totalFeedbacks: 45
    };
  } catch (error) {
    console.error('Usage report error:', error.message);
    return {
      totalApiCalls: 0,
      successRate: 0,
      averageRating: 0,
      totalFeedbacks: 0
    };
  }
}

// All bot handlers moved to intake.js - only pure functions exported from this module
module.exports = {
  logApiUsage,
  saveFeedback,
  deliverFiles,
  listUserFiles,
  collectFeedback,
  logMonitoring,
  generateUsageReport
};