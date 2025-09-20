const Tesseract = require('tesseract.js');
const axios = require('axios');

async function advancedOCR(imageBuffer, language = 'eng') {
  // Advanced OCR with confidence scores
  const { data: { text, confidence } } = await Tesseract.recognize(imageBuffer, language, {
    logger: m => console.log(m) // Progress log
  });
  
  if (confidence < 70) {
    throw new Error('Low OCR confidence - human review needed');
  }
  
  return { text, confidence };
}

async function processImageFromUrl(imageUrl, edenApiKey) {
  try {
    if (edenApiKey) {
      const response = await axios.post('https://api.edenai.run/v2/ocr', {
        providers: 'google',
        file_url: imageUrl,
        language: 'en'
      }, {
        headers: { 'Authorization': `Bearer ${edenApiKey}` }
      });
      
      return {
        text: response.data.google.predicted_text || '',
        confidence: 95 // Eden AI generally has high confidence
      };
    } else {
      // Fallback to Tesseract
      const { data: { text, confidence } } = await Tesseract.recognize(imageUrl, 'eng');
      return { text, confidence };
    }
  } catch (error) {
    console.error('OCR processing error:', error.message);
    throw error;
  }
}

module.exports = { advancedOCR, processImageFromUrl };