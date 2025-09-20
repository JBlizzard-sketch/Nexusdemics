# Nexusdemics


### README.md
```markdown
# Telegram Academic Bot

An AI-powered Telegram bot for automating academic paper workflows, from request intake to draft delivery. It handles text/screenshot/voice inputs, fetches sources (Semantic Scholar/CrossRef, 2020+), generates cited drafts (APA/MLA/Chicago via Groq/Zotero), checks plagiarism (Eden AI), exports to Word/PDF/PPT, logs history in Google Sheets, and delivers via Telegram/Drive. Built with Node.js (Replit) and N8N workflows.

## Features
- **Intake**: Parse Telegram messages/screenshots/voice (OCR/transcription).
- **Source Retrieval**: Fetch/deduplicate/validate sources, import to Zotero.
- **Drafting**: Generate papers with in-text citations, format via Zotero.
- **Export**: Word/PDF/PPT via Pandoc/docxtemplater.
- **Plagiarism**: Check with Eden AI, retry if score >10%.
- **Commands**: `/start`, `/sources`, `/revise`, `/report`, `/files`, `/history`, `/cancel`.
- **History**: Tag-based logging in Google Sheets.
- **Monitoring**: Track API usage, uptime, errors; admin alerts.
- **CI/CD**: GitHub Actions for testing/deployment.

## File Structure
```
telegram-academic-bot/
├── .env                    # Credentials (hidden, gitignored)
├── package.json            # Node.js dependencies
├── requirements.txt        # Dependency list for clarity
├── src/                   # Main logic
│   ├── intake.js          # Block 1: Request intake, OCR
│   ├── source-retrieval.js # Block 2: Source fetch, Zotero
│   ├── draft-generation.js # Block 3: Drafting, formatting
│   ├── validation-commands.js # Block 4: Validation, commands
│   ├── delivery-monitoring.js # Block 5: Delivery, monitoring
├── n8n-workflows/         # N8N JSON workflows
│   ├── intake-workflow.json
│   ├── source-workflow.json
│   ├── draft-workflow.json
│   ├── validation-workflow.json
│   ├── delivery-workflow.json
├── tests/                 # Jest unit tests
│   ├── intake.test.js
│   ├── source-retrieval.test.js
│   ├── draft-generation.test.js
│   ├── validation-commands.test.js
│   ├── delivery-monitoring.test.js
├── utils/                 # Helpers
│   ├── ocr.js
│   ├── source-validator.js
│   ├── format-converter.js
│   ├── schema-validator.js
│   ├── monitoring.js
├── schemas/               # JSON schemas
│   ├── intake-schema.json
│   ├── source-schema.json
│   ├── draft-schema.json
│   ├── assignment-schema.json
│   ├── feedback-schema.json
├── ci-cd/                 # GitHub Actions
│   ├── intake-deploy.yml
│   ├── source-deploy.yml
│   ├── draft-deploy.yml
│   ├── validation-deploy.yml
│   ├── full-deploy.yml
├── .eslintrc.json         # Linting config
├── README.md              # This file
```

## Prerequisites
- **Replit Account**: Free account at replit.com for development/testing.
- **N8N Account**: Free Cloud account at n8n.io for workflow hosting.
- **Telegram Bot**: Create via @BotFather, get `TELEGRAM_TOKEN`.
- **Google Account**: For Sheets/Drive (OAuth2 credentials).
- **API Keys**: Groq, Zotero, Eden AI (free tiers).
- **GitHub Account**: For CI/CD (optional).

## Setup in Replit
1. **Create Repl**:
   - Go to replit.com > Create Repl > Node.js > Name: `telegram-academic-bot`.
2. **Upload Files**:
   - Files tab > Upload folder/files (e.g., `src/`, `n8n-workflows/`).
   - Or: Copy-paste each file from code blocks.
3. **Create .env**:
   - Files tab > Add file > Name: `.env` (hidden, tap three dots > Show hidden files).
   - Paste (no quotes around values):
     ```
     TELEGRAM_TOKEN=your_bot_token_here
     GROQ_KEY=your_groq_key_here
     ZOTERO_USER_ID=your_zotero_user_id
     ZOTERO_API_KEY=your_zotero_api_key
     EDEN_AI_KEY=your_eden_key_here
     GOOGLE_SHEETS_ID=your_sheets_id
     GOOGLE_DRIVE_FOLDER_ID=your_drive_folder_id
     ADMIN_CHAT_ID=your_admin_chat_id
     N8N_URL=your_n8n_instance_url
     N8N_API_KEY=your_n8n_api_key
     ```
4. **Install Dependencies**:
   - In Replit console: `npm install`.
   - Or: Run button (installs automatically).
5. **Test Locally**:
   - Run: `node src/intake.js` (test intake).
   - Run: `npm test` (Jest tests for all blocks).
   - Debug: Check console logs for errors (e.g., "API error").

## Setup in N8N
1. **Log In**: Browser > n8n.io > Sign in.
2. **Add Credentials**:
   - Sidebar > Credentials > “+” Add Credential.
   - **StudentBot (Telegram)**: Telegram API > Paste `TELEGRAM_TOKEN` > Name: `StudentBot`.
   - **GroqFree**: HTTP Header Auth > Name: Authorization > Value: `Bearer [GROQ_KEY]` > Name: `GroqFree`.
   - **ZoteroApi**: HTTP Header Auth > Name: Zotero-API-Key > Value: `[ZOTERO_API_KEY]` > Name: `ZoteroApi`.
   - **EdenAIFree**: HTTP Header Auth > Name: Authorization > Value: `Bearer [EDEN_AI_KEY]` > Name: `EdenAIFree`.
   - **SharedSheets**: Google Sheets OAuth2 API > Connect with Google > Name: `SharedSheets`.
   - **SharedDrive**: Google Drive OAuth2 API > Connect with Google > Name: `SharedDrive`.
   - **N8nApi**: HTTP Header Auth > Name: Authorization > Value: `Bearer [N8N_API_KEY]` > Name: `N8nApi`.
3. **Import Workflows**:
   - Dashboard > “+” > Import from File > Select `n8n-workflows/*.json` (one-by-one or all).
   - Activate each workflow (toggle on).
4. **Test**:
   - In Telegram, message your bot (e.g., `@MyAcademicBot`) > Send `/start`.
   - Expect: Mode selection (Student/Tutor/Guest).
   - Try: “Write APA paper on climate” > Follow prompts (approve sources, draft) > Get files/feedback prompt.

## Google Sheets Setup
1. **Create Spreadsheet**: Google Sheets > New > Name: `StudentDB`.
2. **Headers (Row 1)**:
   - A: Chat_ID, B: User_Type, C: Student_ID, D: Text, E: Image_URL, F: Voice_URL, G: Deadline, H: History, I: Tags, J: Folder_ID, K: Docs_URL, L: Use_Shared, M: Payment_Status.
3. **Sample Row (Row 2)**:
   - L2: `true`, M2: `Free` (no quotes).
4. **Tabs**:
   - Add: `Monitoring` (A:F - Timestamp, Groq_Calls, Zotero_Calls, Eden_Calls, Uptime, Errors).
   - Add: `Feedback` (A:D - Chat_ID, Rating, Comment, Timestamp).
   - Add: `ApiUsage` (A:C - API, Success, Timestamp).
5. **Share**: Get `GOOGLE_SHEETS_ID` (URL: `docs.google.com/spreadsheets/d/[ID]/edit`).

## Google Drive Setup
1. **Create Folder**: drive.google.com > New > Folder > Name: `Users`.
2. **Get ID**: Right-click folder > Share > Copy link > ID from `drive.google.com/drive/folders/[ID]`.
3. **Public Links**: Folder > Share > “Anyone with the link” > Viewer (for public viewing).

## Running and Testing
- **Replit**: `node src/[file].js` (e.g., `node src/delivery-monitoring.js`) for block testing.
- **N8N**: Activate workflows > Test in Telegram.
- **Debug**: Check Replit console (JS errors) or N8N Executions tab.
- **CI/CD**: Push to GitHub repo > GitHub Actions runs tests/deploys to N8N.

## Notes
- Bot name (e.g., `@MyAcademicBot`) doesn’t affect code; `TELEGRAM_TOKEN` does.
- Free APIs: Groq (~1M tokens/month), Zotero (unlimited), Eden AI (10 checks/min).
- Handles ~10-20 users/day; scales with N8N Cloud.
- N8N JSONs are independent; Replit runs JS for dev, not workflows.

## Troubleshooting
- **Bot not responding**: Check `TELEGRAM_TOKEN` in `.env` and N8N `StudentBot` credential.
- **API errors**: Verify keys in `.env` and N8N credentials.
- **Workflow fails**: N8N Executions tab > Check node errors.
- **Contact**: Message admin (your `ADMIN_CHAT_ID`) for alerts.
```

### requirements.txt
```text
# Node.js dependencies for Replit (matches package.json)
axios@^1.7.2
telegraf@^4.16.3
googleapis@^140.0.1
joi@^17.13.3
jest@^29.7.0
pandoc@^0.2.0
docxtemplater@^3.37.0
eslint@^8.50.0
```

### Notes for Replit and N8N Compatibility
- **Replit**:
  - `requirements.txt` mirrors `package.json` dependencies for clarity (Replit uses `package.json` for Node.js, but this helps users understand needs).
  - Create `package.json` in Replit root:
    ```json
    {
      "name": "telegram-academic-bot",
      "version": "1.0.0",
      "scripts": {
        "test": "jest"
      },
      "dependencies": {
        "axios": "^1.7.2",
        "telegraf": "^4.16.3",
        "googleapis": "^140.0.1",
        "joi": "^17.13.3",
        "pandoc": "^0.2.0",
        "docxtemplater": "^3.37.0"
      },
      "devDependencies": {
        "jest": "^29.7.0",
        "eslint": "^8.50.0"
      }
    }
    ```
  - Run `npm install` to install everything. Replit handles it automatically if you hit Run.
  - `.env` in root (hidden) loads credentials for Replit runs (e.g., `node src/intake.js`).
- **N8N**:
  - Workflows (`n8n-workflows/*.json`) are self-contained; importing them (Dashboard > “+” > Import from File) doesn’t rely on Replit or `requirements.txt`.
  - Credentials (e.g., `StudentBot`) must match names exactly, as workflows reference them (e.g., `"credentials": { "telegramApi": { "id": "StudentBot" } }`).
  - No dependency conflicts—N8N Cloud runs workflows serverlessly, not Node.js.

### Ensuring No Breakage for N8N Import
- **Workflows**: The JSON files (e.g., `intake-workflow.json`) are unchanged and reference credential names (e.g., `StudentBot`), not the bot’s Telegram handle (e.g., `@MyAcademicBot`). Import works regardless of bot name.
- **Credentials**: Set up in N8N as instructed (exact names, no extra spaces in keys). The README clarifies this to avoid mismatches.
- **Testing**: Replit runs JS for debugging (e.g., `node src/delivery-monitoring.js`); N8N runs workflows. No overlap—Replit won’t mess with N8N imports.

### Setup Steps (Phone-Friendly)
1. **Replit**:
   - Create Repl (replit.com > Node.js > `telegram-academic-bot`).
   - Copy-paste README files into Replit (Files tab > New folder/file).
   - Add `.env` (root, paste vars).
   - Run `npm install` (console) > Test: `node src/intake.js`.
2. **N8N**:
   - Log in (n8n.io) > Add credentials (follow README).
   - Import workflows (Dashboard > “+” > Import > Select JSONs).
   - Activate workflows > Test in Telegram (e.g., `@MyAcademicBot /start`).
3. **Sheets/Drive**:
   - Create `StudentDB` spreadsheet, add headers/tabs (per README).
   - Create `Users` folder in Drive, set public (Viewer).
4. **GitHub** (Optional):
   - Create repo > Upload files from Replit/Colab > Push.
   - GitHub Actions runs CI/CD (tests, deploys to N8N).

### Value and Context
The bot automates academic papers (intake → sources → drafts → delivery), handling ~10-20 users/day on free APIs. It’s unique for Telegram (few bots do Zotero citations, full pipeline). Industry bots (e.g., Paperpal, $25/month) are more polished; ours is free, great for prototypes. If errors (e.g., “Bot not responding”), check `.env` or N8N Executions.

