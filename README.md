# NCPA Sound Crew - Event Schedule & Technical Dashboard

A comprehensive event management system for NCPA Sound Crew with calendar views, editable tables, CSV imports, and real-time search capabilities.

## 🌐 URLs

**Development (Sandbox):**
- Web App: https://3000-icrqtba2jsfb6kz8v3mvv-cbeee0f9.sandbox.novita.ai
- API Base: https://3000-icrqtba2jsfb6kz8v3mvv-cbeee0f9.sandbox.novita.ai/api

**Production:** 
- To be deployed to Cloudflare Pages

**GitHub Repository:**
- To be pushed to GitHub

---

## ✨ Features Implemented

### ✅ Completed Features

1. **📅 Calendar View**
   - Monthly navigation (previous/next month)
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

3. **📤 CSV Upload**
   - Drag & drop or click to upload CSV files
   - Automatic parsing with flexible column mapping
   - Bulk import of multiple events
   - Validates data before import
   - Supports common CSV formats

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

6. **📈 Analytics API**
   - `/api/analytics/stats` endpoint ready for AI queries
   - Provides:
     - Total events count (last 6 months default)
     - Events by venue (with counts)
     - Events by crew (with counts)
   - Date range configurable

### 🚧 Features Not Yet Implemented (Version 2)

1. **📄 Word Document Parsing**
   - Upload .docx files instead of CSV
   - Extract structured event data from Word tables
   - Integration with mammoth.js or similar

2. **🤖 AI-Powered Search & Analytics**
   - Natural language queries:
     - "How many shows in last 6 months?"
     - "Which venue has most shows?"
     - "When was [show name] last held?"
     - "Show me crew analysis"
   - Integration with OpenAI/Anthropic API
   - Crew workload analysis
   - Venue utilization reports
   - Historical data insights

3. **📊 Advanced Reporting**
   - Export data to Excel/PDF
   - Generate crew schedules
   - Venue booking calendars
   - Sound equipment usage reports

4. **🔔 Notifications**
   - Email reminders for upcoming events
   - Slack/WhatsApp integration
   - Crew assignment notifications

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
- `POST /api/events/bulk` - Bulk upload events (CSV)
- `PUT /api/events/:id` - Update event
- `DELETE /api/events/:id` - Delete event

### Analytics (Ready for AI Integration)

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

3. **Upload Multiple Events (CSV)**
   - Click "Upload CSV" button
   - Select your CSV file
   - Required columns: Date, Program, Venue
   - Optional columns: Team, Sound Requirements, Call Time, Crew
   - Events will be imported automatically

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
  - Font Awesome - Icons

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

### Version 1.0 (Current - October 24, 2025)

**Features:**
- ✅ Calendar view with monthly navigation
- ✅ Editable table view with frozen headers
- ✅ CSV bulk upload
- ✅ Manual event entry form
- ✅ Real-time search
- ✅ Event detail modal
- ✅ Color-coded status (requirements filled/pending)
- ✅ Analytics API endpoint
- ✅ D1 database with full schema
- ✅ RESTful API with CRUD operations

**Database:**
- ✅ Events table with all required fields
- ✅ Indexed columns for fast queries
- ✅ Automatic timestamps
- ✅ Requirements tracking

**Deployment:**
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

**Last Updated:** October 24, 2025
**Status:** ✅ Version 1.0 Active - Ready for Production Deployment
