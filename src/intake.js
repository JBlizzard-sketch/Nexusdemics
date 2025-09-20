require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const Tesseract = require('tesseract.js');
const Joi = require('joi');

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

// Middleware for user mode detection (tutor/student/guest)
bot.use(async (ctx, next) => {
  // Comment: Detect user type from Sheets or default to guest.
  // Multi-message aggregation: Use session to collect over 5 mins.
  ctx.session = ctx.session || { messages: [], isAggregating: false };
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

// Callback for type selection
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (data.startsWith('type_')) {
    const userType = data.replace('type_', '');
    ctx.session.userType = userType;
    // Log initial
    await logToConsole({ userType, chatId: ctx.session.chatId, topic: '/start', text: '/start' });
    // Send confirmation
    ctx.reply(`Mode set to ${userType}. Send your request (text/image/voice).`);
  } else if (data === 'confirm') {
    // Human-in-the-loop: Confirm aggregated intake
    const aggregated = ctx.session.messages.join('\n');
    await logToConsole({ userType: ctx.session.userType, text: aggregated, chatId: ctx.session.chatId, topic: 'aggregated_request' });
    ctx.reply('Instructions confirmed! 📚 This is a demo - sources and drafting features coming soon...'); 
    // Clear session
    ctx.session.messages = [];
    ctx.session.isAggregating = false;
  } else if (data === 'cancel') {
    ctx.session.messages = [];
    ctx.reply('Session cancelled.');
  }
  ctx.answerCbQuery();
});

// Handle text messages (aggregate)
bot.on('text', async (ctx) => {
  // Comment: Aggregate multi-messages for full request.
  if (ctx.session.isAggregating) {
    ctx.session.messages.push(ctx.message.text);
    ctx.reply('Added. More? Reply "done" or send image/voice.');
  } else {
    ctx.session.isAggregating = true;
    ctx.session.messages = [ctx.message.text];
    ctx.reply('Request received. Confirm full instructions?', { 
      reply_markup: { 
        inline_keyboard: [[{ text: 'Confirm', callback_data: 'confirm' }]] 
      } 
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

// Command: /help - Show available commands
bot.command('help', async (ctx) => {
  const helpText = `
🤖 Academic Bot Commands:

/start - Choose your mode (Student/Tutor/Guest)
/help - Show this help message
/history - View past assignments
/status - Check bot status

📝 Features:
• Text input for academic requests
• Image OCR for screenshot processing
• Voice transcription for hands-free input
• Multi-message aggregation

🚧 Coming Soon:
• Source retrieval (Semantic Scholar, CrossRef)
• Draft generation with citations
• Export to Word/PDF/PPT
• Google Sheets integration
  `;
  ctx.reply(helpText);
});

// Command: /status - Bot status
bot.command('status', async (ctx) => {
  const status = `
🟢 Bot Status: Online
📊 Features Available:
• ✅ Text input
• ✅ Image OCR ${EDEN_AI_KEY ? '(Eden AI)' : '(Tesseract fallback)'}
• ✅ Voice transcription ${EDEN_AI_KEY ? '(Eden AI)' : '(Disabled - no API key)'}
• ❌ Google Sheets (requires setup)
• ❌ Source retrieval (requires API keys)
• ❌ Draft generation (requires API keys)

🔑 API Keys Status:
• Telegram: ✅ Connected
• Eden AI: ${EDEN_AI_KEY ? '✅' : '❌'} ${EDEN_AI_KEY ? 'Connected' : 'Not configured'}
• Google Sheets: ${GOOGLE_SHEETS_ID ? '✅' : '❌'} ${GOOGLE_SHEETS_ID ? 'Configured' : 'Not configured'}
  `;
  ctx.reply(status);
});

// Error handling/retry (basic for Block 1)
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  if (ctx) {
    ctx.reply('Error occurred. Please try again or contact support.');
  }
});

// Start bot
console.log('Starting Telegram Academic Bot...');
console.log('Required environment variables:');
console.log('- TELEGRAM_TOKEN:', TELEGRAM_TOKEN ? '✅ Set' : '❌ Missing');
console.log('- EDEN_AI_KEY:', EDEN_AI_KEY ? '✅ Set' : '❌ Missing (will use fallbacks)');
console.log('- GOOGLE_SHEETS_ID:', GOOGLE_SHEETS_ID ? '✅ Set' : '❌ Missing (will use console logging)');

bot.launch();
console.log('Bot started successfully! Send /start to your bot to begin.');

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Export for modularity (used in later blocks)
module.exports = { performOCR, transcribeVoice, logToConsole, intakeSchema };