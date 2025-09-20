require('dotenv').config();
const axios = require('axios');
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
    intake: intakeSchema,
    source: sourceSchema,
    draft: draftSchema 
  };

  const schema = schemas[type];
  if (!schema) {
    return { isValid: false, errors: [`Unknown validation type: ${type}`] };
  }

  try {
    const { error, value } = schema.validate(data, { abortEarly: false });
    
    if (error) {
      const errors = error.details.map(detail => detail.message);
      return { isValid: false, errors, validatedData: null };
    }
    
    return { isValid: true, errors: [], validatedData: value };
  } catch (validationError) {
    return { 
      isValid: false, 
      errors: [`Validation failed: ${validationError.message}`],
      validatedData: null 
    };
  }
}

// Utility: Get assignment history from Google Sheets
async function getAssignmentHistory(chatId, tagFilter = null) {
  try {
    // In a real implementation, this would use Google Sheets API
    // For now, return a mock structure
    return {
      history: [],
      totalAssignments: 0,
      tags: []
    };
  } catch (error) {
    console.error('History retrieval error:', error.message);
    return { history: [], totalAssignments: 0, tags: [] };
  }
}

// Utility: Update assignment history in Google Sheets
async function updateHistory(chatId, newHistory, tags = []) {
  try {
    console.log(`Updating history for ${chatId}:`, { newHistory, tags });
    
    // In a real implementation, this would update Google Sheets
    // For now, just log the action
    return true;
  } catch (error) {
    console.error('History update error:', error.message);
    
    // Alert admin on history update failure
    if (ADMIN_CHAT_ID) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: ADMIN_CHAT_ID,
        text: `History update failed for ${chatId}: ${error.message}`
      });
    }
    return false;
  }
}

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

🎯 **Quality Score:** ${lastDraft.qualityScore || 'N/A'}/10
⏱️ **Time Taken:** ${lastDraft.processingTime || 'N/A'}

✅ ${lastDraft.plagiarismScore <= 0.15 ? 'Low plagiarism detected' : '⚠️ High plagiarism - revision needed'}
    `;
  } catch (error) {
    console.error('Report error:', error.message);
    return '❌ Error generating report. Please try again.';
  }
}

// Export functions for other modules (all bot handlers moved to intake.js)
module.exports = {
  validateData,
  getAssignmentHistory,
  updateHistory,
  generateReport,
  intakeSchema
};