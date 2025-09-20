require('dotenv').config();
const axios = require('axios');
const { Telegraf } = require('telegraf');
const Joi = require('joi');

// Env vars
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_KEY = process.env.GROQ_KEY;
const ZOTERO_USER_ID = process.env.ZOTERO_USER_ID;
const ZOTERO_API_KEY = process.env.ZOTERO_API_KEY;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// Schema for source validation
const sourceSchema = Joi.object({
  title: Joi.string().required(),
  authors: Joi.array().items(Joi.object({
    name: Joi.string().required()
  })),
  year: Joi.number().min(2020).max(new Date().getFullYear()),
  doi: Joi.string().required(),
  abstract: Joi.string(),
  url: Joi.string().uri(),
  zoteroKey: Joi.string()
});

// Utility: Generate search keywords with Groq
async function generateKeywords(topic, history = []) {
  try {
    const historyText = history.length ? `Previous searches: ${history.map(h => h.topic || h.text).join(', ')}` : '';
    const prompt = `Generate 10 academic search keywords for "${topic}". ${historyText}. Return as JSON array of strings.`;
    
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama3-70b-8192',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200
    }, {
      headers: { 'Authorization': `Bearer ${GROQ_KEY}` }
    });

    const content = response.data.choices[0].message.content;
    try {
      return JSON.parse(content);
    } catch {
      // Fallback to simple keywords if JSON parsing fails
      return content.split('\n').filter(line => line.trim()).slice(0, 10);
    }
  } catch (error) {
    console.error('Groq keywords error:', error.message);
    // Fallback keywords
    return [topic, `${topic} research`, `${topic} study`, `${topic} analysis`];
  }
}

// Utility: Fetch sources from Semantic Scholar
async function fetchSemanticScholar(keywords, limit = 10) {
  try {
    const query = keywords.join(' ');
    const url = `https://api.semanticscholar.org/graph/v1/paper/search`;
    
    const response = await axios.get(url, {
      params: {
        query: query,
        fields: 'title,authors,year,abstract,doi,openAccessPdf',
        'publicationDateOrYear': '2020:',
        limit: limit
      }
    });

    return response.data.data || [];
  } catch (error) {
    console.error('Semantic Scholar error:', error.message);
    return [];
  }
}

// Utility: Validate DOI with CrossRef
async function validateDOI(doi) {
  try {
    const response = await axios.get(`https://api.crossref.org/works/${doi}`);
    return response.data.message;
  } catch (error) {
    console.error('CrossRef validation error:', error.message);
    return null;
  }
}

// Utility: Import to Zotero
async function importToZotero(source) {
  try {
    const zoteroItem = {
      itemType: 'journalArticle',
      title: source.title,
      creators: source.authors?.map(a => ({ creatorType: 'author', name: a.name })) || [],
      date: source.year?.toString() || '',
      DOI: source.doi,
      abstractNote: source.abstract || '',
      url: source.url || ''
      // Note: Removed collections as it requires specific collection keys
    };

    const response = await axios.post(`https://api.zotero.org/users/${ZOTERO_USER_ID}/items`, [zoteroItem], {
      headers: { 
        'Zotero-API-Key': ZOTERO_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    // Handle Zotero API response correctly
    if (response.data && response.data.success) {
      const successfulItems = Object.keys(response.data.success);
      return successfulItems.length > 0 ? successfulItems[0] : null;
    }
    
    return null;
  } catch (error) {
    console.error('Zotero import error:', error.message);
    return null;
  }
}

// Utility: Deduplicate sources
function deduplicateSources(sources) {
  const seen = new Set();
  return sources.filter(source => {
    const key = source.doi || source.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Main function: Process sources for a topic
async function processSources(topic, chatId, history = []) {
  try {
    console.log(`Processing sources for topic: ${topic}`);
    
    // Step 1: Generate keywords
    const keywords = await generateKeywords(topic, history);
    console.log('Generated keywords:', keywords);

    // Step 2: Fetch from Semantic Scholar
    const rawSources = await fetchSemanticScholar(keywords, 15);
    console.log(`Fetched ${rawSources.length} sources from Semantic Scholar`);

    // Step 3: Filter and validate sources
    const validSources = [];
    for (const source of rawSources.slice(0, 10)) {
      if (source.doi && source.year >= 2020) {
        // Validate with CrossRef
        const validated = await validateDOI(source.doi);
        if (validated) {
          validSources.push({
            title: source.title,
            authors: source.authors || [],
            year: source.year,
            doi: source.doi,
            abstract: source.abstract,
            url: source.openAccessPdf?.url || ''
          });
        }
      }
    }

    // Step 4: Deduplicate
    const dedupedSources = deduplicateSources(validSources);
    console.log(`${dedupedSources.length} unique, valid sources found`);

    // Step 5: Import to Zotero
    const sourcesWithZotero = [];
    for (const source of dedupedSources) {
      const zoteroKey = await importToZotero(source);
      sourcesWithZotero.push({
        ...source,
        zoteroKey: zoteroKey
      });
    }

    return sourcesWithZotero;
  } catch (error) {
    console.error('Source processing error:', error.message);
    // Send error to admin
    if (ADMIN_CHAT_ID) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: ADMIN_CHAT_ID,
        text: `Source processing failed for ${topic}: ${error.message}`
      });
    }
    return [];
  }
}

// Bot handlers moved to intake.js for unified bot instance

// Export for other modules
module.exports = { 
  processSources, 
  generateKeywords, 
  fetchSemanticScholar, 
  validateDOI, 
  importToZotero,
  sourceSchema 
};