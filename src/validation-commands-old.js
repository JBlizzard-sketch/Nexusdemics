require('dotenv').config();
const axios = require('axios');
const { Telegraf } = require('telegraf');
const { google } = require('googleapis');
const Joi = require('joi');

// Env vars
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_KEY = process.env.GROQ_KEY;
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// Define intakeSchema locally to avoid circular dependency
const intakeSchema = Joi.object({
  topic: Joi.string().required(),
  format: Joi.string().valid('APA', 'MLA', 'Chicago').default('APA'),
  length: Joi.number().min(1).max(50).default(5),
  deadline: Joi.string().isoDate(),
  tags: Joi.array().items(Joi.string()),
  userType: Joi.string().valid('tutor', 'student', 'mixed', 'guest').required()
});

const { sourceSchema } = require('./source-retrieval');
const { draftSchema } = require('./draft-generation');

// Utility: Validate data with comprehensive error reporting
async function validateData(type, data) {
  const schemas = { 
    assignment: intakeSchema, 
    source: sourceSchema, 
    draft: draftSchema 
  };
  
  const schema = schemas[type];
  if (!schema) throw new Error(`Invalid validation type: ${type}`);

  const { error, value } = schema.validate(data, { abortEarly: false });
  if (error) {
    const errorMsg = `Validation error (${type}): ${error.details.map(d => d.message).join('; ')}`;
    console.error(errorMsg);
    
    // Alert admin
    if (ADMIN_CHAT_ID) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: ADMIN_CHAT_ID,
        text: errorMsg
      });
    }
    
    throw new Error(errorMsg);
  }
  
  return value;
}

// Utility: Setup Google Sheets authentication
function getGoogleAuth() {
  return new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}

// Utility: Get assignment history from Google Sheets
async function getAssignmentHistory(chatId, tag = '') {
  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: 'A:M'
    });

    const rows = response.data.values || [];
    const userRow = rows.find(row => row[0] === chatId.toString());
    
    if (!userRow || !userRow[7]) {
      return { history: [], suggestedTags: [] };
    }

    let history = JSON.parse(userRow[7] || '[]');
    
    // Filter by tag if specified
    if (tag) {
      history = history.filter(h => h.tags?.includes(tag));
    }

    // Extract unique tags for suggestions
    const allTags = history.flatMap(h => h.tags || []);
    const uniqueTags = [...new Set(allTags)].slice(0, 5);

    return { history: history.slice(-10), suggestedTags: uniqueTags };
  } catch (error) {
    console.error('History fetch error:', error.message);
    return { history: [], suggestedTags: [] };
  }
}

// Utility: Update assignment history
async function updateHistory(chatId, entry, tags = []) {
  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // Get current data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: 'A:M'
    });

    const rows = response.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === chatId.toString());

    if (rowIndex >= 0) {
      // Update existing row
      const history = JSON.parse(rows[rowIndex][7] || '[]');
      history.push({
        ...entry,
        tags,
        timestamp: new Date().toISOString()
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEETS_ID,
        range: `H${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[JSON.stringify(history)]]
        }
      });
    } else {
      // Create new row
      const newHistory = [{
        ...entry,
        tags,
        timestamp: new Date().toISOString()
      }];

      await sheets.spreadsheets.values.append({
        spreadsheetId: GOOGLE_SHEETS_ID,
        range: 'A:M',
        valueInputOption: 'RAW',
        resource: {
          values: [[
            chatId.toString(), // A: Chat_ID
            'student', // B: User_Type
            'new', // C: Student_ID
            '', // D: Text
            '', // E: Image_URL
            '', // F: Voice_URL
            '', // G: Deadline
            JSON.stringify(newHistory), // H: History
            JSON.stringify(tags), // I: Tags
            GOOGLE_DRIVE_FOLDER_ID, // J: Folder_ID
            '', // K: Docs_URL
            'true', // L: Use_Shared
            'Free' // M: Payment_Status
          ]]
        }
      });
    }
  } catch (error) {
    console.error('History update error:', error.message);
    
    // Alert admin on history update failure
    if (ADMIN_CHAT_ID) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: ADMIN_CHAT_ID,
        text: `History update failed for ${chatId}: ${error.message}`
      });
    }
  }
}

// Bot handlers moved to intake.js - only pure functions exported from this module

// Function: Generate report (called from intake.js)
async function generateReport(chatId) {
  try {
    const { history } = await getAssignmentHistory(chatId);
    const lastEntry = history[history.length - 1];
    const lastDraft = lastEntry?.draft;

    if (!lastDraft) {
      return '📊 No draft found. Please generate a draft first using the /start command.';
    }

    return `📊 **Draft Report**

📝 **Topic:** ${lastDraft.topic || 'N/A'}
📄 **Format:** ${lastDraft.format || 'APA'}
📏 **Length:** ~${lastDraft.length || 0} pages
🔍 **Plagiarism Score:** ${((lastDraft.plagiarismScore || 0) * 100).toFixed(1)}%
📚 **Sources Used:** ${lastDraft.sources?.length || 0}
📅 **Generated:** ${lastDraft.timestamp || 'Recently'}

${lastDraft.driveLink ? `📁 **File:** ${lastDraft.driveLink}` : ''}

**Status:** ${lastDraft.plagiarismScore > 0.1 ? '⚠️ Needs Review' : '✅ Approved'}
    `;

    await ctx.reply(report, { parse_mode: 'Markdown' });
  } catch (error) {
    await ctx.reply('❌ Error generating report. Please try again.');
    console.error('Report command error:', error.message);
  }
});

// Command: /files - List available files
bot.command('files', async (ctx) => {
  try {
    const auth = getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    const response = await drive.files.list({
      q: `'${GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id,name,webViewLink,mimeType,createdTime)',
      orderBy: 'createdTime desc'
    });

    const files = response.data.files || [];
    
    if (files.length === 0) {
      return await ctx.reply('📂 No files found. Generate a draft first to create files.');
    }

    const fileList = files.slice(0, 10).map((file, i) => 
      `${i + 1}. [${file.name}](${file.webViewLink})`
    ).join('\n');

    await ctx.reply(`📂 **Your Files:**\n\n${fileList}\n\n*Click any link to open the file*`, {
      parse_mode: 'Markdown'
    });

  } catch (error) {
    await ctx.reply('❌ Error fetching files. Please try again.');
    console.error('Files command error:', error.message);
  }
});

// Command: /history - Show assignment history with tag filtering
bot.command('history', async (ctx) => {
  try {
    const { history, suggestedTags } = await getAssignmentHistory(ctx.chat.id);

    if (history.length === 0) {
      return await ctx.reply('📜 No history found. Start by sending me an assignment request!');
    }

    const historyText = history.slice(-5).map((entry, i) => {
      const time = new Date(entry.timestamp).toLocaleDateString();
      const tags = entry.tags?.join(', ') || 'None';
      const topic = entry.topic || entry.text?.substring(0, 30) || 'Unknown';
      
      return `${i + 1}. **${topic}**\n   📅 ${time} | 🏷️ ${tags}`;
    }).join('\n\n');

    let keyboard = { inline_keyboard: [] };
    if (suggestedTags.length > 0) {
      keyboard.inline_keyboard = suggestedTags.map(tag => [
        { text: `🔖 Filter: ${tag}`, callback_data: `filter_tag_${tag}` }
      ]);
    }

    await ctx.reply(`📜 **Assignment History (last 5):**\n\n${historyText}`, {
      reply_markup: keyboard,
      parse_mode: 'Markdown'
    });

  } catch (error) {
    await ctx.reply('❌ Error fetching history. Please try again.');
    console.error('History command error:', error.message);
  }
});

// Command: /cancel - Cancel current session
bot.command('cancel', async (ctx) => {
  ctx.session = {};
  await ctx.reply('❌ **Session Cancelled**\n\nAll current operations have been stopped. Use /start to begin a new session.', {
    parse_mode: 'Markdown'
  });
});

// Handle text input for revisions
bot.on('text', async (ctx) => {
  if (ctx.session?.waitingForRevision) {
    try {
      const revision = ctx.message.text;
      await ctx.reply('🤖 Generating revision suggestions...');

      // Get AI revision suggestions
      const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'llama3-70b-8192',
        messages: [{
          role: 'user',
          content: `Provide detailed revision suggestions for this request: "${revision}". Include specific actions and improvements.`
        }],
        max_tokens: 500
      }, {
        headers: { 'Authorization': `Bearer ${GROQ_KEY}` }
      });

      const suggestion = response.data.choices[0].message.content;
      
      await ctx.reply(`📝 **Revision Suggestions:**\n\n${suggestion}\n\nWould you like me to implement these changes?`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Apply Changes', callback_data: 'apply_revision' }],
            [{ text: '📝 More Details', callback_data: 'more_revision_details' }],
            [{ text: '❌ Cancel', callback_data: 'cancel_revision' }]
          ]
        },
        parse_mode: 'Markdown'
      });

      ctx.session.pendingRevision = { request: revision, suggestion };
      ctx.session.waitingForRevision = false;

    } catch (error) {
      await ctx.reply('❌ Error processing revision request. Please try again.');
      console.error('Revision processing error:', error.message);
      ctx.session.waitingForRevision = false;
    }
  }
});

// Handle callback queries
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;

  try {
    if (data.startsWith('filter_tag_')) {
      const tag = data.replace('filter_tag_', '');
      const { history } = await getAssignmentHistory(ctx.chat.id, tag);
      
      if (history.length === 0) {
        await ctx.reply(`🔖 No assignments found with tag "${tag}".`);
      } else {
        const filteredText = history.slice(-3).map((entry, i) => {
          const time = new Date(entry.timestamp).toLocaleDateString();
          const topic = entry.topic || entry.text?.substring(0, 30) || 'Unknown';
          return `${i + 1}. **${topic}** (${time})`;
        }).join('\n');

        await ctx.reply(`🔖 **Assignments tagged "${tag}":**\n\n${filteredText}`, {
          parse_mode: 'Markdown'
        });
      }
    } else if (data === 'restart_sources') {
      await ctx.reply('🔄 Starting new source search...\n\nPlease tell me your research topic or use a previous topic.');
    } else if (data === 'apply_revision') {
      await ctx.reply('✅ Applying revision changes... This may take a few minutes.');
      // Here you would trigger the draft regeneration with revision
    }

  } catch (error) {
    await ctx.reply('❌ Error processing request. Please try again.');
    console.error('Callback query error:', error.message);
  }

  ctx.answerCbQuery();
});

// Export functions for other modules (all bot handlers moved to intake.js)
module.exports = {
  validateData,
  getAssignmentHistory,
  updateHistory,
  generateReport
};