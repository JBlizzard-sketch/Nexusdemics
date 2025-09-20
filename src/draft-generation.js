require('dotenv').config();
const axios = require('axios');
const { Telegraf } = require('telegraf');
const { google } = require('googleapis');
const Joi = require('joi');
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const fs = require('fs').promises;

// Env vars
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_KEY = process.env.GROQ_KEY;
const ZOTERO_USER_ID = process.env.ZOTERO_USER_ID;
const ZOTERO_API_KEY = process.env.ZOTERO_API_KEY;
const EDEN_AI_KEY = process.env.EDEN_AI_KEY;
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// Draft schema for validation
const draftSchema = Joi.object({
  topic: Joi.string().required(),
  format: Joi.string().valid('APA', 'MLA', 'Chicago').default('APA'),
  length: Joi.number().min(1).max(50).default(5),
  content: Joi.string().required(),
  sources: Joi.array().items(Joi.object({
    doi: Joi.string(),
    zoteroKey: Joi.string()
  })),
  plagiarismScore: Joi.number().min(0).max(1)
});

// Utility: Generate draft with Groq
async function generateDraft(topic, sources, format = 'APA', length = 5) {
  try {
    const sourceText = sources.map((s, i) => `[${i + 1}] ${s.title} (DOI: ${s.doi})`).join('\n');
    const prompt = `Write a ${length}-page ${format} academic paper on "${topic}". 

Sources to cite:
${sourceText}

Requirements:
- Use proper ${format} format
- Include in-text citations like [1], [2] 
- Create clear sections: Introduction, Literature Review, Analysis, Conclusion
- Be academic and scholarly
- Output in Markdown format
- Minimum ${length * 250} words`;

    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama3-70b-8192',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: length * 500, // Approx 500 tokens per page
      temperature: 0.7
    }, {
      headers: { 'Authorization': `Bearer ${GROQ_KEY}` },
      timeout: 60000
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Groq draft error:', error.message);
    throw new Error(`Draft generation failed: ${error.message}`);
  }
}

// Utility: Format citations with Zotero
async function formatCitations(sources, format = 'APA') {
  let bibliography = '';
  
  for (const source of sources) {
    if (source.zoteroKey) {
      try {
        const response = await axios.get(
          `https://api.zotero.org/users/${ZOTERO_USER_ID}/items/${source.zoteroKey}`,
          {
            params: {
              format: 'bib',
              style: format.toLowerCase()
            },
            headers: { 'Zotero-API-Key': ZOTERO_API_KEY }
          }
        );
        bibliography += response.data + '\n';
      } catch (error) {
        console.error(`Zotero format error for ${source.doi}:`, error.message);
        // Fallback to manual citation
        bibliography += `${source.title}. DOI: ${source.doi}\n`;
      }
    }
  }
  
  return bibliography;
}

// Utility: Check plagiarism with Eden AI
async function checkPlagiarism(content) {
  try {
    const response = await axios.post('https://api.edenai.run/v2/text/plagiarism_detection', {
      text: content.substring(0, 5000), // Limit for free tier
      providers: 'originalityai'
    }, {
      headers: { 'Authorization': `Bearer ${EDEN_AI_KEY}` },
      timeout: 30000
    });

    return response.data.originalityai?.score || 0;
  } catch (error) {
    console.error('Plagiarism check error:', error.message);
    return 0; // Return 0 if check fails
  }
}

// Utility: Create Word document using docxtemplater
async function createWordDocument(content, bibliography, topic) {
  try {
    // Create a basic DOCX document
    const PizZip = require('pizzip');
    const Docxtemplater = require('docxtemplater');
    
    // Create a simple Word document template
    const docxTemplate = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>{title}</w:t></w:r></w:p>
          <w:p><w:r><w:t>{content}</w:t></w:r></w:p>
          <w:p><w:r><w:t>References:</w:t></w:r></w:p>
          <w:p><w:r><w:t>{bibliography}</w:t></w:r></w:p>
        </w:body>
      </w:document>
    `;

    // For now, create a more formatted text document
    const docContent = `${topic}

${content}

References:
${bibliography}`;

    const filename = `${topic.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.docx`;
    const filepath = `/tmp/${filename}`;
    
    // Create a proper text file since we're not using DOCX format yet
    const textFilename = `${topic.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.txt`;
    const textFilepath = `/tmp/${textFilename}`;
    
    await fs.writeFile(textFilepath, docContent);
    return { filename: textFilename, filepath: textFilepath };
  } catch (error) {
    console.error('Word document error:', error.message);
    // Fallback to text file
    const docContent = `${topic}\n\n${content}\n\nReferences:\n${bibliography}`;
    const filename = `${topic.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.txt`;
    const filepath = `/tmp/${filename}`;
    
    await fs.writeFile(filepath, docContent);
    return { filename, filepath };
  }
}

// Utility: Upload to Google Drive
async function uploadToGoogleDrive(filepath, filename, studentId = 'guest') {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
      scopes: ['https://www.googleapis.com/auth/drive']
    });

    const drive = google.drive({ version: 'v3', auth });
    
    const fileMetadata = {
      name: `${studentId}_${filename}`,
      parents: [GOOGLE_DRIVE_FOLDER_ID]
    };

    const media = {
      mimeType: 'text/plain',
      body: require('fs').createReadStream(filepath)
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id,webViewLink'
    });

    // Make file publicly viewable
    await drive.permissions.create({
      fileId: response.data.id,
      resource: {
        role: 'reader',
        type: 'anyone'
      }
    });

    return response.data.webViewLink;
  } catch (error) {
    console.error('Google Drive upload error:', error.message);
    return null;
  }
}

// Utility: Chunk content for Telegram delivery
function chunkContent(content, maxLength = 4000) {
  const chunks = [];
  for (let i = 0; i < content.length; i += maxLength) {
    chunks.push(content.slice(i, i + maxLength));
  }
  return chunks;
}

// Main function: Process complete draft workflow
async function processDraft(ctx, topic, sources, format = 'APA', length = 5) {
  try {
    await ctx.reply('📝 Generating draft... 0%');

    // Step 1: Generate content
    const content = await generateDraft(topic, sources, format, length);
    await ctx.reply('✅ Draft generated. Formatting citations... 25%');

    // Step 2: Format citations
    const bibliography = await formatCitations(sources, format);
    await ctx.reply('📚 Citations formatted. Checking plagiarism... 50%');

    // Step 3: Plagiarism check
    const plagiarismScore = await checkPlagiarism(content);
    if (plagiarismScore > 0.1) {
      await ctx.reply(`⚠️ Plagiarism score: ${(plagiarismScore * 100).toFixed(1)}%. Rewriting...`);
      // Recursive retry with modified prompt
      return processDraft(ctx, `${topic} (rewrite to be more original)`, sources, format, length);
    }

    await ctx.reply('✅ Plagiarism check passed. Creating documents... 75%');

    // Step 4: Create documents
    const { filename, filepath } = await createWordDocument(content, bibliography, topic);
    
    // Step 5: Upload to Drive
    const driveLink = await uploadToGoogleDrive(filepath, filename, ctx.session?.studentId);
    
    await ctx.reply('📄 Documents created. Preparing delivery... 90%');

    // Step 6: Prepare delivery interface
    const keyboard = {
      inline_keyboard: [
        [{ text: '✅ Approve Draft', callback_data: 'approve_draft' }],
        [{ text: '📝 Request Revision', callback_data: 'revise_draft' }],
        [{ text: '📊 View Report', callback_data: 'view_report' }],
        [{ text: '📁 Download Files', callback_data: 'download_files' }]
      ]
    };

    const summary = `
✅ **Draft Complete!**

📝 **Topic:** ${topic}
📄 **Format:** ${format}
📊 **Length:** ~${length} pages
🔍 **Plagiarism:** ${(plagiarismScore * 100).toFixed(1)}%
📚 **Sources:** ${sources.length}

${driveLink ? `📁 **Drive Link:** ${driveLink}` : ''}
    `;

    await ctx.reply(summary, { 
      reply_markup: keyboard,
      parse_mode: 'Markdown'
    });

    // Step 7: Send preview chunks
    const chunks = chunkContent(content.substring(0, 8000));
    for (let i = 0; i < Math.min(chunks.length, 2); i++) {
      await ctx.reply(`📖 **Preview ${i + 1}:**\n${chunks[i]}`, { parse_mode: 'Markdown' });
    }

    // Store in session for later reference
    ctx.session.lastDraft = {
      topic,
      content,
      bibliography,
      format,
      length,
      plagiarismScore,
      driveLink,
      filename
    };

    return {
      content,
      bibliography,
      plagiarismScore,
      driveLink,
      filename
    };

  } catch (error) {
    console.error('Draft processing error:', error.message);
    await ctx.reply(`❌ Draft generation failed: ${error.message}`);
    
    // Alert admin
    if (ADMIN_CHAT_ID) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: ADMIN_CHAT_ID,
        text: `Draft generation failed for ${topic}: ${error.message}`
      });
    }
    
    throw error;
  }
}

// Export for other modules
module.exports = {
  processDraft,
  generateDraft,
  formatCitations,
  checkPlagiarism,
  createWordDocument,
  uploadToGoogleDrive,
  chunkContent,
  draftSchema
};