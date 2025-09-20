# Telegram Academic Bot

## Overview
A Telegram bot that assists with academic paper workflows including text intake, OCR processing, and voice transcription. This is the core intake module extracted from a larger academic automation system.

## Current State
- ✅ **Functional**: Basic Telegram bot with health check endpoint
- ✅ **Tested**: Complete test suite with 100% pass rate
- ✅ **Configured**: Running on port 5000 with proper workflow setup
- ✅ **Ready**: Environment variables configured with API keys

## Recent Changes (September 20, 2025)
- Extracted project from Jupyter notebook into proper Node.js structure
- Created main bot functionality in `src/intake.js`
- Set up package.json with required dependencies
- Added comprehensive test suite
- Configured HTTP health check server on port 5000
- Set up Replit workflow for continuous running

## Project Architecture

### Core Components
- **`src/intake.js`**: Main bot file with Telegram integration
- **`tests/intake.test.js`**: Comprehensive test suite
- **`.env`**: Environment variables (API keys configured)
- **`package.json`**: Node.js dependencies and scripts

### Features Implemented
1. **Telegram Bot Interface**
   - `/start` command with user type selection
   - Text message aggregation
   - Image OCR processing (Eden AI + Tesseract fallback)
   - Voice transcription (Eden AI)
   - `/help`, `/status`, `/history` commands

2. **Health Check Endpoint**
   - HTTP server on port 5000 for Replit compatibility
   - Health status at `/health` endpoint
   - Feature availability reporting

3. **API Integrations**
   - Telegram Bot API
   - Eden AI (OCR and voice transcription)
   - Google Sheets integration (placeholder)

### File Structure
```
telegram-academic-bot/
├── src/intake.js           # Main bot logic
├── tests/intake.test.js    # Test suite
├── package.json            # Dependencies
├── .env                    # Environment variables
├── .env.example           # Example configuration
├── .gitignore             # Git ignore rules
└── replit.md              # This documentation
```

## Environment Variables Status
- **TELEGRAM_TOKEN**: ✅ Configured
- **EDEN_AI_KEY**: ✅ Configured  
- **GOOGLE_SHEETS_ID**: ✅ Configured
- **GROQ_KEY**: ✅ Configured
- **ZOTERO_USER_ID**: ✅ Configured
- **ZOTERO_API_KEY**: ✅ Configured

## Future Development Areas
Based on the original notebook, the following features are planned:
1. **Source Retrieval**: Semantic Scholar and CrossRef integration
2. **Draft Generation**: AI-powered paper writing with citations
3. **Export Functionality**: Word/PDF/PPT output
4. **N8N Workflows**: Importable workflow definitions
5. **Advanced Google Sheets Integration**: Full logging and history

## User Preferences
- Clean, modular code structure
- Comprehensive error handling and fallbacks
- Test-driven development
- API key management through environment variables
- Health monitoring and status reporting