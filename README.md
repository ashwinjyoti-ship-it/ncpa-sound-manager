# NCPA Sound Crew - Event Schedule & Technical Dashboard

A comprehensive event management system for NCPA Sound Crew with calendar views, editable tables, CSV imports, and real-time search capabilities.

## 🌐 URLs

**Production (Live):**
- 🚀 **Web App: https://ncpa-sound.pages.dev**
- API Base: https://ncpa-sound.pages.dev/api
- Short, memorable URL for easy access!

**Development (Sandbox):**
- Web App: https://3000-icrqtba2jsfb6kz8v3mvv-cbeee0f9.sandbox.novita.ai
- API Base: https://3000-icrqtba2jsfb6kz8v3mvv-cbeee0f9.sandbox.novita.ai/api

**GitHub Repository:**
- 📦 **https://github.com/ashwinjyoti-ship-it/ncpa-sound-manager**
- Complete source code with full git history
- All documentation included

---

## 🦁 Safari Compatibility

**✅ Safari 18.6 Support Added (Jan 25, 2025)**

The app now works perfectly in Safari 18.6+ with enhanced CORS headers and security policies.

**If Safari still shows issues:**
1. Clear cache: Safari > Settings > Privacy > Manage Website Data
2. Force refresh: `Shift + Cmd + R`
3. Check Console for errors: Right-click > Inspect Element > Console tab

**For detailed troubleshooting:** See [SAFARI_FIX.md](./SAFARI_FIX.md)

**Tested Browsers:**
- ✅ Chrome (all versions)
- ✅ Safari 18.6+
- ✅ GenSpark Browser
- ✅ Comet Browser
- ✅ Firefox (all versions)

---

## ✨ Features Implemented

### ✅ Completed Features

1. **📅 Calendar View**
   - Monthly navigation (previous/next month)
   - **Today's date highlighted**: Blue border and background for current day
   - Event cards color-coded by status:
     - 🟢 Green: Sound requirements filled
     - 🟡 Peach: Sound requirements pending
   - Click cards to view full event details in modal
   - Shows: Program name, Venue, Crew

2. **📊 Table View**
   - All events in sortable table format
   - **Inline editing**: Click any cell to edit
   - Auto-save on blur (500ms debounce)
   - Frozen header row that stays visible while scrolling
   - Delete button for each event
   - Columns: Date, Program, Venue, Team, Sound Requirements, Call Time, Crew, Actions

3. **📤 CSV Upload with Smart Duplicate Detection**
   - Drag & drop or click to upload CSV files
   - Automatic parsing with flexible column mapping
   - **Intelligent duplicate detection**: Prevents re-importing existing events
   - **Preserves manual entries**: Won't overwrite manually-added shows
   - **Append-only behavior**: New events added alongside existing data
   - Detailed feedback shows: inserted, skipped (duplicates), invalid
   - Validates data before import
   - Supports common CSV formats

3b. **📄 Word Document Upload (AI-Powered Multi-Chunk Processing)**
   - Upload .docx files with event schedules (ANY SIZE!)
   - **Multi-chunk AI parsing**: Processes entire document in sequential chunks
   - **100% data capture**: No truncation, all events extracted
   - **Intelligent chunking**: Splits large documents, processes each chunk with Claude AI
   - **Automatic deduplication**: Removes duplicate events across chunk boundaries
   - **Smart duplicate detection**: Preserves manually-added events when re-importing
   - **Append-only uploads**: New events added alongside existing data, no deletion
   - **Persistent progress notification**: Shows real-time processing status
   - **Auto-navigation**: Automatically jumps to uploaded month in calendar
   - No strict formatting requirements - works with tables, lists, or any structure
   - Automatically detects: dates, programs, venues, sound requirements, call times, crew
   - Smart call time prioritization: Sound > Tech > Utility times
   - Example: 32KB document → 3 chunks → 50 events in ~45 seconds
   - Fallback: CSV upload available for extremely large files (>50KB)

4. **➕ Manual Event Entry**
   - "Add Show" button on both views
   - Form with all fields:
     - Date (required, dropdown calendar)
     - Program/Event (required)
     - Venue (required)
     - Team (optional)
     - Sound Requirements (optional, textarea)
     - Call Time (optional)
     - Crew (optional)
   - Tracks creation date in database

5. **🔍 Search Functionality**
   - Real-time search across all fields
   - Searches: Program, Venue, Team, Crew, Sound Requirements
   - Debounced (500ms) for performance
   - Shows results immediately
   - Empty result feedback

5b. **📥 CSV Export**
   - Export events for any specific month/year
   - Select month and year from dropdown
   - Downloads CSV file: `NCPA_Events_MonthName_Year.csv`
   - Includes all fields: Date, Program, Venue, Team, Sound Requirements, Call Time, Crew
   - Proper CSV formatting with quote escaping
   - Perfect for backup, Excel analysis, or sharing with team
   - One-click download

6. **💬 WhatsApp Export**
   - Export events for WhatsApp messaging
   - Time ranges: Tomorrow, This Week, Next Week, Custom Date
   - **Bold headers** for clear formatting (*Program:*, *Venue:*, etc.)
   - Concise program names (removes organizer info, limits to 60 chars)
   - **Sound-focused requirements** extraction
   - Team field excluded from export (kept in database/table/calendar)
   - One-click copy to clipboard

7. **🤖 AI Assistant**
   - Natural language queries using Claude Haiku
   - Ask about events: "Show all events tomorrow", "Events at Tata Theatre"
   - Find missing data: "Events with missing sound requirements"
   - Crew analysis: "Events assigned to Ashwin"
   - SQL generation from plain English
   - Results displayed in formatted table

8. **📈 Analytics API**
   - `/api/analytics/stats` endpoint ready for AI queries
   - Provides:
     - Total events count (last 6 months default)
     - Events by venue (with counts)
     - Events by crew (with counts)
   - Date range configurable

### 🚧 Features Not Yet Implemented (Version 2)

1. **🔔 Smart Notifications**
   - Email reminders for upcoming events
   - Slack integration
   - Crew assignment notifications
   - Missing requirements alerts

2. **📊 Advanced Reporting**
   - Export data to Excel/PDF
   - Generate crew schedules
   - Venue booking calendars
   - Sound equipment usage reports

3. **🎛️ Equipment Tracking**
   - Sound equipment inventory management
   - Equipment assignment to events
   - Maintenance schedules
   - Usage analytics

---

## 🗄️ Data Architecture

### Data Models

**Event Model:**
```typescript
{
  id: number (auto-increment)
  event_date: date (required)
  program: string (required)
  venue: string (required)
  team: string (optional)
  sound_requirements: text (optional)
  call_time: string (optional)
  crew: string (optional)
  requirements_updated: boolean (auto-calculated)
  created_at: datetime (auto)
  updated_at: datetime (auto)
}
```

### Storage Services

**Primary Database:** Cloudflare D1 (SQLite)
- Globally distributed
- Automatic replication
- SQL-based queries
- Indexed fields: date, program, venue, crew, team

**Current Status:**
- ✅ Local D1 database active (.wrangler/state/v3/d1)
- ⏳ Production D1 database (to be created on deployment)

**Indexes:**
- `idx_event_date` - Fast date-based queries
- `idx_program` - Program name searches
- `idx_venue` - Venue filtering
- `idx_crew` - Crew assignment lookups
- `idx_team` - Team curator searches
- `idx_created_at` - Creation date tracking

### Data Flow

```
User Input → Frontend (Table/Form/CSV) 
    ↓
API Layer (Hono) 
    ↓
Validation & Processing
    ↓
D1 Database (SQLite)
    ↓
Index Updates
    ↓
Response to Frontend
    ↓
Real-time UI Update
```

---

## 🎯 API Endpoints

### Events

- `GET /api/events` - Get all events
- `GET /api/events/:id` - Get single event
- `GET /api/events/range?start=YYYY-MM-DD&end=YYYY-MM-DD` - Get events by date range
- `GET /api/events/search?q=query` - Search events
- `POST /api/events` - Create new event
- `POST /api/events/bulk` - Bulk upload events with duplicate detection (CSV/Word)
- `PUT /api/events/:id` - Update event
- `DELETE /api/events/:id` - Delete event

### AI Services

- `POST /api/ai/query` - Natural language to SQL conversion
  - Input: `{ query: "your question" }`
  - Output: SQL query + results + explanation
  - Example: "Show all events tomorrow" → generates SQL → returns matching events

- `POST /api/ai/parse-word` - AI-powered Word document parsing
  - Input: `{ text: "document text", filename: "optional.docx" }`
  - Output: Structured events array extracted from document
  - Uses Claude to intelligently parse any document format

### Analytics

- `GET /api/analytics/stats?start=YYYY-MM-DD&end=YYYY-MM-DD` - Get statistics
  - Total events count
  - Events by venue (sorted by count)
  - Events by crew (sorted by count)

---

## 📖 User Guide

### Getting Started

1. **View Events**
   - Default view: Calendar showing current month
   - Switch to Table view using top tabs

2. **Add a New Show**
   - Click "Add Show" button (top right)
   - Fill in required fields: Date, Program, Venue
   - Optionally add: Team, Sound Requirements, Call Time, Crew
   - Click "Add Show" to save

3. **Upload Multiple Events (CSV/Word)**
   - Click "Upload CSV" or "Upload Word" button
   - Select your file (CSV or .docx)
   - Required columns: Date, Program, Venue
   - Optional columns: Team, Sound Requirements, Call Time, Crew
   - **Smart duplicate detection**: System checks for existing events
   - **Preserves manual entries**: Your manually-added shows won't be affected
   - Events will be imported automatically (only new ones added)
   - Detailed feedback shows what was added, skipped, or invalid

4. **Edit Event Details**
   - Switch to Table view
   - Click any cell to edit
   - Type new value
   - Press Enter or click outside to save
   - Changes save automatically

5. **Search Events**
   - Use search box (top right)
   - Search works across all fields
   - Results appear instantly
   - Clear search to see all events

5b. **Export Events to CSV**
   - Click "Export CSV" button (top toolbar)
   - Select the month and year you want to export
   - Click "Download CSV"
   - File downloads as: `NCPA_Events_MonthName_Year.csv`
   - Open in Excel, Google Sheets, or any spreadsheet software
   - Perfect for:
     - Monthly reports
     - Backup copies
     - Sharing with team members
     - Data analysis

6. **View Event Details**
   - In Calendar view, click any event card
   - Modal shows all details including sound requirements
   - Click outside or X to close

### CSV File Format

**📘 See detailed guide: [CSV_UPLOAD_GUIDE.md](CSV_UPLOAD_GUIDE.md)**

Your CSV file should have these columns (headers can vary):

```csv
Date,Program,Venue,Team,Sound Requirement,Call Time,Crew
01/11/2025,Dance Performance,JBT 8pm,Dr.Swapno/Team,4 DPA mics; 6 microphones,Setup 7am,John
02/11/2025,Classical Concert,TT 6.30pm,Farahnaz & Team,NCPA Audio Recording,Piano 12.45pm,Sarah
```

**Supported date formats:**
- `01/11/2025` (DD/MM/YYYY) ✅ From Google Sheets
- `01-11-25` (DD-MM-YY) ✅
- `2025-11-01` (YYYY-MM-DD) ✅
- And more (see CSV guide)

**Supported column name variations:**
- Date: `Date`, `date`, `EVENT DATE`, `Event Date`
- Program: `Program`, `program`, `Program/Event`, `Event`
- Venue: `Venue`, `venue`
- Sound Requirements: `Sound Requirements`, `Sound Requirement` (both work!)
- Others: Case-insensitive

### Duplicate Detection & Data Preservation

**🔒 Your Manual Entries Are Safe!**

The system uses intelligent duplicate detection to protect your data:

**How It Works:**
- Events are considered duplicates if they have the **same date + program + venue**
- When uploading CSV or Word files, the system checks every event before inserting
- If an event already exists, it's skipped (not replaced)

**What This Means:**
1. ✅ **Manually-added shows are preserved** - They won't be overwritten during uploads
2. ✅ **Append-only behavior** - New events are added alongside existing ones
3. ✅ **Re-import protection** - If you upload the same file twice, duplicates are skipped
4. ✅ **Detailed feedback** - You'll see exactly what was added vs. skipped

**Example:**
- You manually add: "Romeo and Juliet" on Nov 20 at JBT
- You upload a Word document containing the same show
- Result: System skips the duplicate, shows "1 duplicates skipped (already exist)"
- Your manual entry remains unchanged! ✨

### Color Coding

- **🟢 Green cards**: Sound requirements have been filled in
- **🟡 Peach cards**: Sound requirements still pending
- This helps identify which events need technical planning

---

## 🛠️ Technical Stack

- **Backend:** Hono (TypeScript) - Lightweight edge framework
- **Runtime:** Cloudflare Workers - Edge computing platform
- **Database:** Cloudflare D1 (SQLite) - Globally distributed SQL database
- **Frontend:** Vanilla JavaScript + TailwindCSS
- **Libraries:**
  - Axios - HTTP client
  - PapaParse - CSV parsing
  - Mammoth.js - Word document extraction
  - Font Awesome - Icons
- **AI Integration:**
  - **Claude Sonnet 4 (claude-sonnet-4-20250514)** - Advanced natural language processing & document parsing
  - 100% data capture, matches chat agent quality

---

## 🚀 Deployment

### Current Status
- ✅ **Development:** Active on sandbox
- ⏳ **Production:** Ready to deploy to Cloudflare Pages

### Local Development

```bash
# Build the project
npm run build

# Apply database migrations
npm run db:migrate:local

# Seed with sample data
npm run db:seed

# Start development server
pm2 start ecosystem.config.cjs

# Check logs
pm2 logs ncpa-sound-crew --nostream

# Stop server
pm2 delete ncpa-sound-crew
```

### Production Deployment Steps

1. **Setup Cloudflare API Key**
   ```bash
   # Set up authentication
   # (Requires Cloudflare API token from Deploy tab)
   ```

2. **Create Production D1 Database**
   ```bash
   npx wrangler d1 create ncpa-sound-crew-db
   # Copy database_id to wrangler.jsonc
   ```

3. **Apply Migrations to Production**
   ```bash
   npm run db:migrate:prod
   ```

4. **Deploy to Cloudflare Pages**
   ```bash
   npm run deploy:prod
   ```

5. **Set Environment Variables (if needed)**
   ```bash
   npx wrangler pages secret put API_KEY --project-name ncpa-sound-crew
   ```

---

## 📊 Database Management

### Useful Commands

```bash
# Reset local database (delete all data & reapply migrations)
npm run db:reset

# Execute SQL query on local database
npm run db:console:local

# Execute SQL query on production database
npm run db:console:prod

# Create new migration
# Add new .sql file to migrations/ folder
# Format: 000X_description.sql
```

### Sample Queries

```sql
-- Get events by date range
SELECT * FROM events 
WHERE event_date >= '2025-11-01' AND event_date <= '2025-11-30'
ORDER BY event_date;

-- Count events by venue
SELECT venue, COUNT(*) as count 
FROM events 
GROUP BY venue 
ORDER BY count DESC;

-- Find events without crew assigned
SELECT * FROM events 
WHERE crew IS NULL OR crew = '';

-- Search by program name
SELECT * FROM events 
WHERE program LIKE '%Dance%';
```

---

## 🎨 UI Components

### Calendar View
- Grid layout (7 columns for days of week)
- Event cards with hover effects
- Color-coded status indicators
- Responsive design for mobile/tablet

### Table View
- Sticky header row
- Inline cell editing
- Horizontal scroll for wide data
- Action buttons (delete)

### Modals
- Event detail modal
- Add show form modal
- Click-outside-to-close behavior
- Keyboard accessible (ESC to close)

---

## 🔄 Recommended Next Steps

### Immediate Priorities

1. **Deploy to Production**
   - Set up Cloudflare API credentials
   - Create production D1 database
   - Deploy to Cloudflare Pages
   - Test production environment

2. **GitHub Integration**
   - Push code to GitHub repository
   - Set up automated deployments
   - Enable version control

3. **User Testing**
   - Test CSV upload with actual NCPA data
   - Verify all editing workflows
   - Test search across different fields
   - Mobile device testing

### Short-term Enhancements (Next 2-4 weeks)

1. **Improved Data Validation**
   - Date format validation
   - Required field enforcement
   - Duplicate event detection

2. **Enhanced UI**
   - Better mobile responsiveness
   - Print-friendly views
   - Export to PDF/Excel

3. **Filtering & Sorting**
   - Filter by venue
   - Filter by crew
   - Filter by date range
   - Sort table columns

### Medium-term Features (Version 2 - Next 1-3 months)

1. **Word Document Parsing**
   - Upload .docx files
   - Extract tabular data
   - Map to event structure

2. **AI-Powered Analytics**
   - Natural language queries
   - Crew workload analysis
   - Venue utilization reports
   - Predictive scheduling

3. **Advanced Features**
   - Multi-user support with roles
   - Email notifications
   - Calendar sync (iCal, Google Calendar)
   - Equipment tracking

---

## 📞 Support & Maintenance

### Database Backup
- D1 database is automatically backed up by Cloudflare
- Local development data stored in `.wrangler/state/v3/d1`
- For manual backups, export data via API

### Troubleshooting

**Issue: Events not loading**
- Check browser console for errors
- Verify API endpoints are responding
- Check D1 database connection

**Issue: CSV upload fails**
- Verify CSV format matches expected columns
- Check for special characters in data
- Ensure date format is valid

**Issue: Word upload processing**
- Large documents take 30-60 seconds (this is normal!)
- Progress notification shows real-time status
- Document is processed in chunks (you'll see: "AI is analyzing in 3 chunks...")
- After upload, calendar automatically navigates to the uploaded month

**Issue: Edits not saving**
- Check network connection
- Verify API is accessible
- Check browser console for errors

### Performance Notes

- Expected load: ~80 events/month
- Concurrent users: Up to 5
- Database reads: <1000/day (within D1 free tier)
- Response time: <100ms for API calls

---

## 📝 Changelog

### Version 2.3.2 (Current - November 29, 2025) 🎨

**🆕 New in Version 2.3.2:**
- ✅ **New Orange Color Scheme** - Switched from brown (#8B4513) to vibrant orange (#FF6B35)
- ✅ **Updated Button Colors** - All buttons now use consistent orange theme
- ✅ **Cache-Busting** - Version bump to force browser refresh
- ✅ **Event Count Fix** - Resolved caching issue showing incorrect count
- ✅ **DEPLOYED TO PRODUCTION** - Live at https://ncpa-sound.pages.dev 🚀

### Version 2.3 (November 24, 2025) 📊

**🆕 New in Version 2.3:**
- ✅ **Event Count Display** - Shows number of events in current month
- ✅ **Multi-Date Event Creation** - Create same show across multiple dates
- ✅ **Enhanced Event Editing** - Edit dates and extend events to multiple days

### Version 2.2 (November 14, 2025) 📥

**🆕 New in Version 2.2:**
- ✅ **CSV Export** - Export events for any specific month/year
- ✅ **Month/Year Selector** - Easy dropdown selection for export period
- ✅ **Auto-formatted Filenames** - Downloads as `NCPA_Events_MonthName_Year.csv`
- ✅ **Complete Data Export** - All fields included (Date, Program, Venue, Team, Sound Requirements, Call Time, Crew)

### Version 2.1 (November 14, 2025) 🔒

**Features in Version 2.1:**
- ✅ **Smart Duplicate Detection** - Protects manually-added events during uploads
- ✅ **Append-Only Imports** - Word/CSV uploads add new events without replacing existing ones
- ✅ **Detailed Import Feedback** - Shows inserted, skipped (duplicates), and invalid counts
- ✅ **Data Preservation** - Your manual entries are never overwritten

### Version 2.0 (October 25, 2025) 🚀

**Major Features in Version 2.0:**
- ✅ **Today's date indicator** - Blue highlight for current day in calendar
- ✅ **Production deployment** - Live on https://ncpa-sound.pages.dev

**Major Features:**
- ✅ Calendar view with monthly navigation and today indicator
- ✅ Editable table view with fixed columns (no horizontal scroll)
- ✅ CSV bulk upload (working perfectly)
- ✅ **Multi-chunk AI Word parsing** - processes entire documents (100% data capture!)
- ✅ **Persistent progress notifications** - shows real-time processing status
- ✅ **Auto-navigation to uploaded month** - jumps to correct month after upload/add
- ✅ Manual event entry form with auto-navigation
- ✅ Real-time search with empty result feedback
- ✅ **WhatsApp export** with bold headers and sound-focused requirements
- ✅ **AI Assistant** for natural language queries
- ✅ Event detail modal with Edit and Delete buttons
- ✅ Color-coded status (requirements filled/pending)
- ✅ Analytics API endpoint
- ✅ D1 database with full schema
- ✅ RESTful API with CRUD operations

**AI Integrations:**
- ✅ **Claude Sonnet 4 (claude-sonnet-4-20250514)** - UPGRADED for 100% data capture!
- ✅ **Multi-chunk processing**: Splits documents into 18K chunks, processes sequentially
- ✅ **Automatic deduplication**: Removes duplicate events across chunks
- ✅ **Smart event-boundary splitting**: Avoids cutting events in half
- ✅ Natural language to SQL conversion
- ✅ Intelligent Word document parsing (no pattern matching, pure AI)
- ✅ Environment variable configuration (.dev.vars)

**Performance (with Claude Sonnet 4):**
- ✅ Small documents (<18K): ~40 seconds, 1 chunk
- ✅ Medium documents (18-36K): ~80 seconds, 2 chunks
- ✅ Large documents (36-54K): ~120 seconds, 3 chunks
- ✅ **Example: October 2025 (39KB) → 63 events extracted in 116 seconds**
- ✅ **100% data capture**: All events from first day to last day of month

**Database:**
- ✅ Events table with all required fields
- ✅ Indexed columns for fast queries
- ✅ Automatic timestamps
- ✅ Requirements tracking

**Deployment:**
- ✅ **Production: https://ncpa-sound.pages.dev** 🌍
- ✅ Cloudflare Pages with D1 database
- ✅ Local development environment
- ✅ PM2 process management
- ✅ Sandbox deployment active

---

## 📄 License

This project is developed for NCPA Sound Crew internal use.

---

## 🙏 Credits

Built with:
- Hono Framework
- Cloudflare Workers & D1
- TailwindCSS
- Font Awesome
- Axios
- PapaParse

Developed for: **NCPA Sound Crew**

---

**Last Updated:** November 14, 2025
**Status:** ✅ Version 2.3.2 Active - PRODUCTION DEPLOYED at https://ncpa-sound.pages.dev 🚀
**Latest Features:** 
- 📥 CSV Export for any month/year
- 🔒 Smart duplicate detection protects your manual entries
