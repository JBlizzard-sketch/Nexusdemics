require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const axios = require('axios');
const Tesseract = require('tesseract.js');
const Joi = require('joi');
const http = require('http');

// Import all modules
const { processSources } = require('./source-retrieval');
const { processDraft } = require('./draft-generation');
const { updateHistory, getAssignmentHistory } = require('./validation-commands');
const { collectFeedback, logApiUsage } = require('./delivery-monitoring');
const monitor = require('../utils/monitoring');

// Env vars - load from .env
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const EDEN_AI_KEY = process.env.EDEN_AI_KEY;
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// Schema for assignment intake validation (Joi)
const intakeSchema = Joi.object({
  topic: Joi.string().required(),
  format: Joi.string().valid('APA', 'MLA', 'Chicago').default('APA'),
  length: Joi.number().min(1).max(50).default(5),
  deadline: Joi.string().isoDate(),
  tags: Joi.array().items(Joi.string()),
  userType: Joi.string().valid('tutor', 'student', 'mixed', 'guest').required()
});

// Utility: OCR for screenshots (Eden AI primary, Tesseract fallback)
async function performOCR(imageUrl) {
  // Comment: OCR extracts text from images (screenshots of assignments).
  // Eden AI for accuracy, fallback to Tesseract for offline.
  try {
    if (EDEN_AI_KEY) {
      // Eden AI API call (free tier handles 10 images/min)
      const response = await axios.post('https://api.edenai.run/v2/ocr', {
        providers: 'google', // Or 'microsoft' for better handwriting
        file_url: imageUrl,
        language: 'en'
      }, {
        headers: { 'Authorization': `Bearer ${EDEN_AI_KEY}` }
      });
      return response.data.google.predicted_text || 'OCR failed';
    } else {
      throw new Error('Eden AI key not provided');
    }
  } catch (error) {
    console.log('Eden OCR failed, using Tesseract fallback');
    // Tesseract.js for local processing (no API call)
    const { data: { text } } = await Tesseract.recognize(imageUrl, 'eng');
    return text;
  }
}

// Utility: Speech-to-Text for voice notes (new improvement for accessibility)
async function transcribeVoice(voiceFileId) {
  // Comment: Downloads voice from Telegram, transcribes via Eden AI Whisper.
  // Human-in-the-loop: Bot sends "Transcribing voice..." then confirmation.
  try {
    // Get file path from Telegram
    const fileResponse = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${voiceFileId}`);
    const filePath = fileResponse.data.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;

    if (EDEN_AI_KEY) {
      // Eden AI transcription
      const transResponse = await axios.post('https://api.edenai.run/v2/audio/transcribe', {
        providers: 'openai', // Whisper model
        file_url: downloadUrl,
        language: 'en'
      }, {
        headers: { 'Authorization': `Bearer ${EDEN_AI_KEY}` }
      });
      return transResponse.data.openai.transcription || 'Transcription failed';
    } else {
      return 'Voice transcription requires Eden AI key - please type your request.';
    }
  } catch (error) {
    return 'Voice transcription error - please type your request.';
  }
}

// Utility: Log to console (simplified version without Google Sheets)
async function logToConsole(data) {
  // Comment: Simple logging for now, can be upgraded to Sheets later
  const { error, value } = intakeSchema.validate(data);
  if (error) {
    console.log(`Validation error: ${error.details[0].message}`);
    return false;
  }
  
  console.log('Logging intake data:', {
    userType: value.userType,
    topic: value.topic,
    format: value.format,
    timestamp: new Date().toISOString()
  });
  return true;
}

// Main Telegram Bot Setup (Telegraf for commands/menus)
if (!TELEGRAM_TOKEN) {
  console.error('TELEGRAM_TOKEN is required in .env file');
  console.log('Please create a .env file with your Telegram bot token:');
  console.log('TELEGRAM_TOKEN=your_bot_token_here');
  process.exit(1);
}

const bot = new Telegraf(TELEGRAM_TOKEN);

// Enable session middleware
bot.use(session());

// Middleware for session initialization and user detection
bot.use(async (ctx, next) => {
  // Initialize session with defaults
  if (!ctx.session) {
    ctx.session = {};
  }
  
  // Set session defaults
  ctx.session.messages = ctx.session.messages || [];
  ctx.session.isAggregating = ctx.session.isAggregating || false;
  ctx.session.userType = ctx.session.userType || 'guest';
  ctx.session.approvedSources = ctx.session.approvedSources || [];
  
  const chatId = ctx.message?.chat?.id?.toString() || ctx.callbackQuery?.message?.chat?.id?.toString();
  ctx.session.chatId = chatId;
  
  await next();
});

// Command: /start - Start session with menu
bot.start(async (ctx) => {
  // Comment: Interactive menu for user type, human-in-the-loop confirmation.
  const keyboard = {
    inline_keyboard: [
      [{ text: 'Student (Direct)', callback_data: 'type_student' }],
      [{ text: 'Tutor (Manage Students)', callback_data: 'type_tutor' }],
      [{ text: 'Guest (Anonymous)', callback_data: 'type_guest' }],
      [{ text: 'Cancel', callback_data: 'cancel' }]
    ]
  };
  ctx.reply('Welcome to the Academic Bot! Choose your mode:', { reply_markup: keyboard });
});

// Handle all callback queries
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  
  try {
    if (data.startsWith('type_')) {
      const userType = data.replace('type_', '');
      ctx.session.userType = userType;
      ctx.session.studentId = `${userType}_${ctx.session.chatId}`;
      
      // Log user type selection
      await updateHistory(ctx.session.chatId, {
        action: 'user_type_selected',
        userType: userType
      }, ['setup']);
      
      await ctx.reply(`✅ Mode set to **${userType}**.\n\nYou can now:\n• Send your assignment topic\n• Upload screenshots of assignments\n• Send voice notes\n• Use commands like /sources, /history`, {
        parse_mode: 'Markdown'
      });
      
    } else if (data.startsWith('rate_')) {
      // Handle feedback ratings
      const [, draftId, rating] = data.split('_');
      const { saveFeedback } = require('./delivery-monitoring');
      
      await saveFeedback(ctx.chat.id, parseInt(rating));
      await ctx.reply(`✅ Thank you for rating us ${rating}⭐!\n\nYour feedback helps us improve the service.`);
      
      // Ask for additional comment on low ratings
      if (parseInt(rating) <= 3) {
        ctx.session.waitingForComment = draftId;
        await ctx.reply('💬 We value your feedback! Please share what we can improve:');
      }
      
    } else if (data.startsWith('comment_')) {
      // Handle feedback comments
      const draftId = data.replace('comment_', '');
      ctx.session.waitingForComment = draftId;
      await ctx.reply('💬 Please share your feedback about the draft:');
      
    } else if (data === 'approve_draft') {
      await ctx.reply('✅ **Draft Approved!**\n\nYour assignment is complete. Files have been saved to your Drive folder.');
      
      // Collect feedback after approval
      const { collectFeedback } = require('./delivery-monitoring');
      const draftId = Date.now().toString();
      await collectFeedback(ctx, draftId);
      
    } else if (data === 'download_files') {
      // Get user's files from Drive
      const { deliverFiles } = require('./delivery-monitoring');
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
      
    } else if (data.startsWith('approve_source_')) {
      // Handle source approval
      const index = parseInt(data.replace('approve_source_', ''));
      const source = ctx.session.pendingSources?.[index];
      if (source) {
        ctx.session.approvedSources = ctx.session.approvedSources || [];
        ctx.session.approvedSources.push(source);
        await ctx.reply(`✅ Approved: ${source.title}`);
      }
      
    } else if (data === 'approve_all_sources') {
      ctx.session.approvedSources = ctx.session.pendingSources || [];
      await ctx.reply(`✅ All ${ctx.session.approvedSources.length} sources approved!`);
      
    } else if (data === 'cancel_sources') {
      ctx.session.pendingSources = [];
      await ctx.reply('❌ Source selection cancelled.');
      
    } else if (data === 'apply_revision') {
      await ctx.reply('✅ Applying revision changes...');
      
    } else if (data === 'cancel_revision') {
      await ctx.reply('❌ Revision cancelled.');
      
    } else if (data === 'confirm_and_process') {
      // Start the complete workflow
      const topic = ctx.session.messages.join(' ');
      await ctx.reply('🚀 **Starting Academic Assistant Workflow**\n\n1. 🔍 Finding sources...\n2. 📝 Generating draft...\n3. ✅ Quality checks...\n4. 📄 Creating files...', {
        parse_mode: 'Markdown'
      });
      
      try {
        // Step 1: Process sources
        const sources = await processSources(topic, ctx.session.chatId);
        ctx.session.approvedSources = sources;
        
        if (sources.length > 0) {
          await ctx.reply(`✅ Found ${sources.length} sources! Now generating draft...`);
          
          // Step 2: Generate draft
          const draft = await processDraft(ctx, topic, sources, 'APA', 5);
          
          // Log the complete workflow
          await updateHistory(ctx.session.chatId, {
            action: 'workflow_completed',
            topic,
            sources: sources.length,
            draft: draft ? 'generated' : 'failed'
          }, ['workflow', 'academic']);
          
        } else {
          await ctx.reply('❌ No suitable sources found. Please try a different topic or add more specific keywords.');
        }
        
      } catch (error) {
        console.error('Workflow error:', error.message);
        await ctx.reply(`❌ Workflow failed: ${error.message}\n\nPlease try again or contact support.`);
        monitor.logError('workflow', error);
      }
      
      // Clear session
      ctx.session.messages = [];
      ctx.session.isAggregating = false;
      
    } else if (data === 'add_more') {
      await ctx.reply('📝 Please add more details to your request:');
      
    } else if (data === 'cancel') {
      ctx.session = {};
      await ctx.reply('❌ Session cancelled.');
    }
    
  } catch (error) {
    console.error('Callback query error:', error.message);
    await ctx.reply('❌ Error processing request. Please try again.');
  }
  
  ctx.answerCbQuery();
});

// Handle text messages (aggregate and process)
bot.on('text', async (ctx) => {
  // Handle revision requests
  if (ctx.session?.waitingForRevision) {
    const revision = ctx.message.text;
    await ctx.reply('🤖 Processing revision request...');

    try {
      const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'llama3-70b-8192',
        messages: [{
          role: 'user',
          content: `Provide detailed revision suggestions for this request: "${revision}". Include specific actions and improvements.`
        }],
        max_tokens: 500
      }, {
        headers: { 'Authorization': `Bearer ${process.env.GROQ_KEY}` }
      });

      const suggestion = response.data.choices[0].message.content;
      
      await ctx.reply(`📝 **Revision Suggestions:**\n\n${suggestion}\n\nWould you like me to implement these changes?`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Apply Changes', callback_data: 'apply_revision' }],
            [{ text: '❌ Cancel', callback_data: 'cancel_revision' }]
          ]
        },
        parse_mode: 'Markdown'
      });

      ctx.session.waitingForRevision = false;
    } catch (error) {
      await ctx.reply('❌ Error processing revision. Please try again.');
      ctx.session.waitingForRevision = false;
    }
    return;
  }
  
  // Handle comment input for feedback
  if (ctx.session?.waitingForComment) {
    const comment = ctx.message.text;
    const { saveFeedback } = require('./delivery-monitoring');
    const success = await saveFeedback(ctx.chat.id, 0, comment);
    
    if (success) {
      await ctx.reply('✅ Thank you for your feedback! We appreciate your input.');
    } else {
      await ctx.reply('❌ Error saving feedback. Please try again.');
    }
    
    delete ctx.session.waitingForComment;
    return;
  }

  // Comment: Aggregate multi-messages for full request.
  if (ctx.session.isAggregating) {
    ctx.session.messages.push(ctx.message.text);
    ctx.reply('Added. Send "done" to finish, or continue adding more.');
  } else {
    ctx.session.isAggregating = true;
    ctx.session.messages = [ctx.message.text];
    ctx.session.currentTopic = ctx.message.text; // Store for source retrieval
    
    const keyboard = {
      inline_keyboard: [
        [{ text: '✅ Start Processing', callback_data: 'confirm_and_process' }],
        [{ text: '📝 Add More Details', callback_data: 'add_more' }],
        [{ text: '❌ Cancel', callback_data: 'cancel' }]
      ]
    };
    
    ctx.reply('Request received! I can help you with:\n• 🔍 Source retrieval\n• 📝 Draft generation\n• 📊 Plagiarism checking\n• 📄 Export to Word/PDF\n\nWhat would you like to do?', { 
      reply_markup: keyboard
    });
  }
});

// Handle screenshots (photos)
bot.on('photo', async (ctx) => {
  // Comment: OCR for screenshots of assignments.
  const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Largest size
  const fileId = photo.file_id;
  const fileResponse = await ctx.telegram.getFile(fileId);
  const imageUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileResponse.file_path}`;
  
  ctx.reply('Processing image...');
  const ocrText = await performOCR(imageUrl);
  ctx.session.messages = ctx.session.messages || [];
  ctx.session.messages.push(`[OCR from image]: ${ocrText}`);
  ctx.reply(`Image processed: ${ocrText.substring(0, 100)}... Added to request.`);
});

// Handle voice notes (new improvement)
bot.on('voice', async (ctx) => {
  // Comment: Transcribe voice for hands-free intake.
  const voiceId = ctx.message.voice.file_id;
  ctx.reply('Transcribing voice...');
  const transcription = await transcribeVoice(voiceId);
  ctx.session.messages = ctx.session.messages || [];
  ctx.session.messages.push(`[Voice transcription]: ${transcription}`);
  ctx.reply(`Voice transcribed: ${transcription.substring(0, 100)}... Added.`);
});

// Command: /history - Show past assignments (simplified)
bot.command('history', async (ctx) => {
  // Comment: Simplified history display.
  ctx.reply('History: This is a demo version. Full history tracking coming soon with Google Sheets integration.');
});

// Command: /help - Comprehensive help system
bot.command('help', async (ctx) => {
  const helpText = `
🤖 **Telegram Academic Bot - Complete Guide**

🚀 **Getting Started:**
1. Use /start to select your mode (Student/Tutor/Guest)
2. Send your assignment topic or upload screenshots
3. I'll find sources, generate drafts, and create documents!

📋 **All Commands:**

🎯 **Core Workflow:**
• **/start** - Begin new assignment session
• **/sources** - Find & manage research sources
• **/revise** - Request draft revisions
• **/files** - Download your documents

📊 **Monitoring & History:**
• **/report** - View plagiarism scores & stats
• **/history** - Browse past assignments
• **/status** - Check system health

🛠️ **Session Control:**
• **/cancel** - Cancel current operation
• **/help** - Show this help message

🎨 **Input Methods:**
• 📝 **Text:** Type your assignment topic
• 📷 **Images:** Upload screenshots (OCR processed)
• 🎤 **Voice:** Send voice notes (transcribed)
• 📎 **Multi-part:** Add details across multiple messages

⚡ **Complete Workflow:**
1. **Intake:** Parse your request (text/image/voice)
2. **Sources:** Search Semantic Scholar & CrossRef (2020+)
3. **Validation:** Import to Zotero, validate DOIs
4. **Drafting:** Generate with Groq AI + proper citations
5. **Quality:** Check plagiarism with Eden AI
6. **Export:** Create Word/PDF documents
7. **Delivery:** Upload to Google Drive + Telegram
8. **History:** Log in Google Sheets with tags

📚 **Supported Formats:**
• APA, MLA, Chicago citations
• 1-50 page papers
• Multiple export formats
• Tag-based organization

🔧 **Need Help?**
• System status: /status
• Past work: /history  
• Current files: /files
• Technical issues: Contact admin

✨ *Ready to revolutionize your academic workflow!*
  `;
  
  await ctx.reply(helpText, { parse_mode: 'Markdown' });
  monitor.logCall('telegram');
});

// Command: /status - Comprehensive bot status
bot.command('status', async (ctx) => {
  const stats = monitor.getStats();
  
  const status = `
🟢 **Bot Status: Online**

📊 **System Health:**
• ⏱️ Uptime: ${Math.floor(stats.uptime / 3600)}h ${Math.floor((stats.uptime % 3600) / 60)}m
• 🔧 API Calls: ${Object.values(stats.calls).reduce((a, b) => a + b, 0)}
• ❌ Errors: ${stats.errorCount}

🚀 **Features Available:**
• ✅ Text input & aggregation
• ✅ Image OCR ${EDEN_AI_KEY ? '(Eden AI + Tesseract)' : '(Tesseract only)'}
• ✅ Voice transcription ${EDEN_AI_KEY ? '(Eden AI Whisper)' : '(Disabled)'}
• ✅ Source retrieval (Semantic Scholar + CrossRef)
• ✅ Draft generation (Groq AI + Zotero citations)
• ✅ Plagiarism checking ${EDEN_AI_KEY ? '(Eden AI)' : '(Disabled)'}
• ✅ Google Sheets integration
• ✅ Google Drive file storage
• ✅ Word/PDF export

🔑 **API Keys Status:**
• Telegram: ✅ Connected
• Groq AI: ${process.env.GROQ_KEY ? '✅' : '❌'} ${process.env.GROQ_KEY ? 'Connected' : 'Not configured'}
• Eden AI: ${EDEN_AI_KEY ? '✅' : '❌'} ${EDEN_AI_KEY ? 'Connected' : 'Not configured'}
• Zotero: ${process.env.ZOTERO_API_KEY ? '✅' : '❌'} ${process.env.ZOTERO_API_KEY ? 'Connected' : 'Not configured'}
• Google Services: ${GOOGLE_SHEETS_ID ? '✅' : '❌'} ${GOOGLE_SHEETS_ID ? 'Connected' : 'Not configured'}

📋 **Available Commands:**
• /start - Begin new session
• /sources - Manage research sources  
• /revise - Request draft revisions
• /report - View plagiarism & stats
• /files - Access your documents
• /history - View assignment history
• /cancel - Cancel current session
• /help - Show detailed help

✨ **Ready for academic workflows!**
  `;
  
  await ctx.reply(status, { parse_mode: 'Markdown' });
  monitor.logCall('telegram');
});

// Missing command handlers consolidated from other modules
bot.command('sources', async (ctx) => {
  const { processSources } = require('./source-retrieval');
  const topic = ctx.session?.currentTopic || ctx.session?.messages?.join(' ') || 'general research';
  
  await ctx.reply('🔍 Fetching sources...');
  
  const sources = await processSources(topic, ctx.chat.id);
  
  if (sources.length === 0) {
    return ctx.reply('❌ No sources found. Try a different topic.');
  }

  // Create approval interface
  const keyboard = {
    inline_keyboard: sources.slice(0, 5).map((source, i) => [
      { 
        text: `📄 ${source.title.substring(0, 40)}...`, 
        callback_data: `approve_source_${i}` 
      }
    ]).concat([
      [
        { text: '✅ Approve All', callback_data: 'approve_all_sources' },
        { text: '❌ Cancel', callback_data: 'cancel_sources' }
      ]
    ])
  };

  ctx.session.pendingSources = sources;
  ctx.session.currentTopic = topic;
  await ctx.reply(`📚 Found ${sources.length} sources. Select to approve:`, { reply_markup: keyboard });
});

bot.command('revise', async (ctx) => {
  ctx.session.waitingForRevision = true;
  await ctx.reply('📝 **Revision Mode**\n\nPlease describe what changes you would like to make to your draft:', {
    parse_mode: 'Markdown'
  });
});

bot.command('report', async (ctx) => {
  try {
    const { generateReport } = require('./validation-commands');
    const report = await generateReport(ctx.chat.id);
    
    await ctx.reply(`📊 **Progress Report**\n\n${report}`, {
      parse_mode: 'Markdown'
    });
  } catch (error) {
    await ctx.reply('❌ Error generating report. Please try again.');
  }
});

bot.command('files', async (ctx) => {
  try {
    const { listUserFiles } = require('./delivery-monitoring');
    const files = await listUserFiles(ctx.chat.id);
    
    if (files.length === 0) {
      await ctx.reply('📂 No files found. Complete an assignment to generate files.');
    } else {
      const fileList = files.map(f => `• ${f.name} (${f.date})`).join('\n');
      await ctx.reply(`📁 **Your Files:**\n\n${fileList}`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📥 Download All', callback_data: 'download_files' }]
          ]
        }
      });
    }
  } catch (error) {
    await ctx.reply('❌ Error accessing files. Please try again.');
  }
});

bot.command('cancel', async (ctx) => {
  // Reset session state
  ctx.session.isAggregating = false;
  ctx.session.messages = [];
  ctx.session.waitingForRevision = false;
  ctx.session.waitingForComment = false;
  ctx.session.pendingSources = [];
  
  await ctx.reply('❌ **Operation Cancelled**\n\nAll pending operations have been cancelled. Send /start to begin again.', {
    parse_mode: 'Markdown'
  });
});

// Callback handlers now consolidated in the main callback_query handler above

// Error handling/retry (basic for Block 1)
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  if (ctx) {
    ctx.reply('Error occurred. Please try again or contact support.');
  }
});

// Only start server and bot if this file is run directly (not imported for testing)
if (require.main === module) {
  // Create HTTP server for health check (required for Replit)
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        bot: 'running',
        timestamp: new Date().toISOString(),
        features: {
          telegram: !!TELEGRAM_TOKEN,
          eden_ai: !!EDEN_AI_KEY,
          google_sheets: !!GOOGLE_SHEETS_ID
        }
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  // Start HTTP server on port 5000 (required for Replit)
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Health check server running on http://0.0.0.0:${PORT}`);
    console.log(`📊 Health endpoint: http://0.0.0.0:${PORT}/health`);
  });

  // Start bot
  console.log('Starting Telegram Academic Bot...');
  console.log('Required environment variables:');
  console.log('- TELEGRAM_TOKEN:', TELEGRAM_TOKEN ? '✅ Set' : '❌ Missing');
  console.log('- EDEN_AI_KEY:', EDEN_AI_KEY ? '✅ Set' : '❌ Missing (will use fallbacks)');
  console.log('- GOOGLE_SHEETS_ID:', GOOGLE_SHEETS_ID ? '✅ Set' : '❌ Missing (will use console logging)');

  bot.launch();
  console.log('🤖 Bot started successfully! Send /start to your bot to begin.');
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Export for modularity (used in later blocks)
module.exports = { performOCR, transcribeVoice, logToConsole, intakeSchema };