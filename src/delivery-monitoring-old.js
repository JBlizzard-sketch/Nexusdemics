require('dotenv').config();
const axios = require('axios');
const { Telegraf } = require('telegraf');
const { google } = require('googleapis');

// Env vars
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// Utility: Log API usage for monitoring
async function logApiUsage(apiName, success = true) {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: 'ApiUsage!A:C',
      valueInputOption: 'RAW',
      resource: {
        values: [[
          apiName,
          success ? 'Success' : 'Failed',
          new Date().toISOString()
        ]]
      }
    });
  } catch (error) {
    console.error('API usage logging error:', error.message);
  }
}

// Utility: Log monitoring data
async function logMonitoring(data) {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: 'Monitoring!A:F',
      valueInputOption: 'RAW',
      resource: {
        values: [[
          new Date().toISOString(), // A: Timestamp
          data.groqCalls || 0, // B: Groq_Calls
          data.zoteroCalls || 0, // C: Zotero_Calls
          data.edenCalls || 0, // D: Eden_Calls
          data.uptime || 0, // E: Uptime
          JSON.stringify(data.errors || []) // F: Errors
        ]]
      }
    });
  } catch (error) {
    console.error('Monitoring logging error:', error.message);
  }
}

// Utility: Send files via Telegram
async function deliverFiles(chatId, files) {
  try {
    // Bot instance removed - using unified bot from intake.js
    
    for (const file of files) {
      if (file.url) {
        await bot.telegram.sendMessage(chatId, `📁 **${file.name}**\n[Download](${file.url})`, {
          parse_mode: 'Markdown'
        });
      }
    }
    
    await logApiUsage('Telegram File Delivery', true);
    return true;
  } catch (error) {
    console.error('File delivery error:', error.message);
    await logApiUsage('Telegram File Delivery', false);
    return false;
  }
}

// Utility: Collect user feedback
async function collectFeedback(ctx, draftId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '1 ⭐', callback_data: `rate_${draftId}_1` },
        { text: '2 ⭐', callback_data: `rate_${draftId}_2` },
        { text: '3 ⭐', callback_data: `rate_${draftId}_3` }
      ],
      [
        { text: '4 ⭐', callback_data: `rate_${draftId}_4` },
        { text: '5 ⭐', callback_data: `rate_${draftId}_5` }
      ],
      [
        { text: '💬 Leave Comment', callback_data: `comment_${draftId}` }
      ]
    ]
  };

  await ctx.reply('⭐ **Rate Your Experience**\n\nHow satisfied are you with the generated draft?', {
    reply_markup: keyboard,
    parse_mode: 'Markdown'
  });
}

// Utility: Save feedback to Google Sheets
async function saveFeedback(chatId, rating, comment = '') {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: 'Feedback!A:D',
      valueInputOption: 'RAW',
      resource: {
        values: [[
          chatId.toString(), // A: Chat_ID
          rating, // B: Rating
          comment, // C: Comment
          new Date().toISOString() // D: Timestamp
        ]]
      }
    });

    // Alert admin for low ratings
    if (rating <= 2 && ADMIN_CHAT_ID) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: ADMIN_CHAT_ID,
        text: `⚠️ Low rating received: ${rating}⭐\nUser: ${chatId}\nComment: ${comment || 'None'}`
      });
    }

    return true;
  } catch (error) {
    console.error('Feedback save error:', error.message);
    return false;
  }
}

// Utility: Generate usage report
async function generateUsageReport() {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Get API usage data
    const apiResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: 'ApiUsage!A:C'
    });

    const apiData = apiResponse.data.values || [];
    const totalCalls = apiData.length - 1; // Exclude header
    const successRate = apiData.filter(row => row[1] === 'Success').length / totalCalls * 100;

    // Get feedback data
    const feedbackResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: 'Feedback!A:D'
    });

    const feedbackData = feedbackResponse.data.values || [];
    const avgRating = feedbackData.slice(1).reduce((sum, row) => sum + parseInt(row[1] || 0), 0) / (feedbackData.length - 1) || 0;

    return {
      totalApiCalls: totalCalls,
      successRate: successRate.toFixed(1),
      averageRating: avgRating.toFixed(1),
      totalFeedbacks: feedbackData.length - 1
    };
  } catch (error) {
    console.error('Usage report error:', error.message);
    return {
      totalApiCalls: 0,
      successRate: '0',
      averageRating: '0',
      totalFeedbacks: 0
    };
  }
}

// Telegram bot setup for delivery and monitoring
// Bot instance removed - using unified bot from intake.js

// Handle rating feedback
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;

  if (data.startsWith('rate_')) {
    const [, draftId, rating] = data.split('_');
    
    await saveFeedback(ctx.chat.id, parseInt(rating));
    await ctx.reply(`✅ Thank you for rating us ${rating}⭐!\n\nYour feedback helps us improve the service.`);
    
    // Ask for additional comment on low ratings
    if (parseInt(rating) <= 3) {
      ctx.session.waitingForComment = draftId;
      await ctx.reply('💬 We value your feedback! Please share what we can improve:');
    }
  } else if (data.startsWith('comment_')) {
    const draftId = data.replace('comment_', '');
    ctx.session.waitingForComment = draftId;
    await ctx.reply('💬 Please share your feedback about the draft:');
  } else if (data === 'approve_draft') {
    await ctx.reply('✅ **Draft Approved!**\n\nYour assignment is complete. Files have been saved to your Drive folder.');
    
    // Collect feedback after approval
    const draftId = Date.now().toString();
    await collectFeedback(ctx, draftId);
  } else if (data === 'download_files') {
    // Get user's files from Drive
    const files = ctx.session?.lastDraft ? [
      {
        name: ctx.session.lastDraft.filename,
        url: ctx.session.lastDraft.driveLink
      }
    ] : [];
    
    if (files.length > 0) {
      await deliverFiles(ctx.chat.id, files);
    } else {
      await ctx.reply('📂 No files available for download.');
    }
  }

  ctx.answerCbQuery();
});

// Handle comment input
bot.on('text', async (ctx) => {
  if (ctx.session?.waitingForComment) {
    const comment = ctx.message.text;
    const success = await saveFeedback(ctx.chat.id, 0, comment); // 0 rating for comment-only feedback
    
    if (success) {
      await ctx.reply('✅ Thank you for your feedback! We appreciate your input.');
    } else {
      await ctx.reply('❌ Error saving feedback. Please try again.');
    }
    
    delete ctx.session.waitingForComment;
  }
});

// Command: /report (admin only) - Generate usage statistics
bot.command('adminreport', async (ctx) => {
  if (ctx.chat.id.toString() !== ADMIN_CHAT_ID) {
    return await ctx.reply('❌ Access denied. Admin only command.');
  }

  await ctx.reply('📊 Generating usage report...');
  
  const report = await generateUsageReport();
  
  const reportText = `
📊 **System Usage Report**

🔢 **API Calls:** ${report.totalApiCalls}
✅ **Success Rate:** ${report.successRate}%
⭐ **Avg Rating:** ${report.averageRating}/5
💬 **Total Feedback:** ${report.totalFeedbacks}

📈 **System Status:** ${report.successRate > 90 ? '🟢 Healthy' : '🟡 Needs Attention'}
  `;

  await ctx.reply(reportText, { parse_mode: 'Markdown' });
});

// Error monitoring middleware
bot.use(async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    console.error('Bot error:', error.message);
    
    // Log error for monitoring
    await logMonitoring({
      errors: [{ message: error.message, timestamp: new Date().toISOString() }]
    });
    
    // Alert admin on critical errors
    if (ADMIN_CHAT_ID) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: ADMIN_CHAT_ID,
        text: `🚨 Bot Error: ${error.message}\nUser: ${ctx.chat?.id}\nCommand: ${ctx.message?.text}`
      });
    }
    
    await ctx.reply('❌ An error occurred. Our team has been notified. Please try again.');
  }
});

// Export functions for other modules
module.exports = {
  logApiUsage,
  logMonitoring,
  deliverFiles,
  collectFeedback,
  saveFeedback,
  generateUsageReport
};