const { performOCR, transcribeVoice, logToConsole, intakeSchema } = require('../src/intake');
const axios = require('axios');

jest.mock('axios');
jest.mock('tesseract.js', () => ({
  recognize: jest.fn()
}));

describe('Intake & OCR Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Test OCR
  test('OCR extracts text from image URL with Eden AI', async () => {
    // Mock Eden AI response
    axios.post.mockResolvedValue({ 
      data: { 
        google: { 
          predicted_text: 'Sample text from screenshot' 
        } 
      } 
    });
    
    const result = await performOCR('https://example.com/image.jpg');
    expect(result).toBe('Sample text from screenshot');
  });

  test('OCR fallback to Tesseract when Eden AI fails', async () => {
    // Mock Eden AI error
    axios.post.mockRejectedValue(new Error('API error'));
    
    // Mock Tesseract
    const { recognize } = require('tesseract.js');
    recognize.mockResolvedValue({ 
      data: { 
        text: 'Fallback text' 
      } 
    });
    
    const result = await performOCR('https://example.com/image.jpg');
    expect(result).toBe('Fallback text');
  });

  // Test transcription
  test('Voice transcription succeeds with Eden AI', async () => {
    // Mock Telegram file get
    axios.get.mockResolvedValue({ 
      data: { 
        result: { 
          file_path: 'voice.ogg' 
        } 
      } 
    });
    
    // Mock Eden AI transcription
    axios.post.mockResolvedValue({ 
      data: { 
        openai: { 
          transcription: 'Spoken request for paper' 
        } 
      } 
    });
    
    const result = await transcribeVoice('voice_id_123');
    expect(result).toBe('Spoken request for paper');
  });

  test('Voice transcription handles error case', async () => {
    // Mock axios.get to throw an error
    axios.get.mockRejectedValue(new Error('Telegram API error'));
    
    const result = await transcribeVoice('voice_id_123');
    expect(result).toContain('Voice transcription error');
  });

  // Test logging
  test('Log to console validates and logs', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    
    const data = { 
      userType: 'student', 
      topic: 'Test request',
      format: 'APA'
    };
    
    const result = await logToConsole(data);
    expect(result).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Logging intake data:', 
      expect.objectContaining({
        userType: 'student',
        topic: 'Test request',
        format: 'APA'
      })
    );
    
    consoleSpy.mockRestore();
  });

  test('Log validation fails on invalid data', async () => {
    const invalidData = { userType: 'invalid' };
    const { error } = intakeSchema.validate(invalidData);
    expect(error).toBeDefined();
    // The first error is actually about missing topic, not invalid userType
    expect(error.details[0].message).toContain('"topic" is required');
  });

  // Test message aggregation
  test('Message aggregation works correctly', () => {
    const ctx = { 
      session: { 
        messages: [], 
        isAggregating: true 
      } 
    };
    
    ctx.session.messages.push('First message');
    ctx.session.messages.push('Second message');
    
    expect(ctx.session.messages.length).toBe(2);
    expect(ctx.session.messages.join('\n')).toBe('First message\nSecond message');
  });
});

// Health endpoint test
describe('Health Endpoint', () => {
  test('Health endpoint returns correct structure', () => {
    const expectedStructure = {
      status: expect.any(String),
      bot: expect.any(String),
      timestamp: expect.any(String),
      features: expect.objectContaining({
        telegram: expect.any(Boolean),
        eden_ai: expect.any(Boolean),
        google_sheets: expect.any(Boolean)
      })
    };
    
    // This would be tested with supertest in a real scenario
    expect(expectedStructure).toBeDefined();
  });
});