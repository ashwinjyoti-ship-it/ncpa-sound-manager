# Deployment Guide - NCPA Sound Crew

## 🚀 Quick Start (Current Development Environment)

Your application is **already running** at:
- **URL**: https://3000-icrqtba2jsfb6kz8v3mvv-cbeee0f9.sandbox.novita.ai

## 📋 What's Been Set Up

### ✅ Completed
- [x] Project initialized with Hono + Cloudflare Pages
- [x] D1 Database schema created (local)
- [x] Sample data seeded (3 events)
- [x] Frontend with Calendar and Table views
- [x] CSV upload functionality
- [x] Manual event entry form
- [x] Search functionality
- [x] Analytics API for future AI integration
- [x] PM2 process management configured
- [x] Git repository initialized with commits

### ⏳ Pending (For Production Deployment)
- [ ] Cloudflare API authentication
- [ ] Production D1 database creation
- [ ] Cloudflare Pages deployment
- [ ] GitHub repository push
- [ ] Custom domain setup (optional)

---

## 🧪 Testing Your Application

### 1. Open in Browser
Visit: https://3000-icrqtba2jsfb6kz8v3mvv-cbeee0f9.sandbox.novita.ai

### 2. Test Calendar View
- See events displayed on calendar
- Click event cards to view details
- Navigate between months
- Note color coding: Green (requirements filled) vs Peach (pending)

### 3. Test Table View
- Switch to "Table" tab
- Click any cell to edit inline
- Type new value and click outside to save
- Try editing Sound Requirements or Call Time fields

### 4. Test CSV Upload
- Click "Upload CSV" button
- Use the sample file: `/home/user/webapp/sample_events.csv`
- 9 additional events will be imported

### 5. Test Add Show
- Click "Add Show" button
- Fill in the form
- Submit to add a single event

### 6. Test Search
- Type in search box (e.g., "Dance", "JBT", "Orchestra")
- See results filter in real-time

---

## 🔧 Local Development Commands

### Managing the Service

```bash
# Check service status
pm2 list

# View logs (non-blocking)
pm2 logs ncpa-sound-crew --nostream

# Restart service (after code changes)
cd /home/user/webapp && npm run build && pm2 restart ncpa-sound-crew

# Stop service
pm2 delete ncpa-sound-crew

# Start service from scratch
fuser -k 3000/tcp 2>/dev/null || true
cd /home/user/webapp && npm run build && pm2 start ecosystem.config.cjs
```

### Database Management

```bash
# View all events in database
cd /home/user/webapp && npx wrangler d1 execute ncpa-sound-crew-db --local --command="SELECT * FROM events"

# Count events
cd /home/user/webapp && npx wrangler d1 execute ncpa-sound-crew-db --local --command="SELECT COUNT(*) FROM events"

# Reset database (delete all data and reapply migrations)
cd /home/user/webapp && npm run db:reset

# Add more sample data
cd /home/user/webapp && npm run db:seed
```

### Testing API Endpoints

```bash
# Get all events
curl http://localhost:3000/api/events

# Search events
curl "http://localhost:3000/api/events/search?q=Dance"

# Get analytics
curl "http://localhost:3000/api/analytics/stats"

# Add new event
curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_date": "2025-12-01",
    "program": "Test Event",
    "venue": "Test Theatre",
    "team": "Test Team",
    "sound_requirements": "Basic sound",
    "call_time": "2pm",
    "crew": "Test Crew"
  }'
```

---

## 🌍 Production Deployment (When Ready)

### Prerequisites

1. **Cloudflare Account** (free tier is sufficient)
2. **Cloudflare API Token** with permissions:
   - Account.Workers Scripts:Edit
   - Account.Workers KV:Edit  
   - Account.D1:Edit

### Step 1: Setup Cloudflare Authentication

**Option A: Using the Deploy Tab** (Recommended)
1. Go to the **Deploy** tab in your interface
2. Follow instructions to add Cloudflare API token
3. Once added, authentication will be available in terminal

**Option B: Manual Setup**
```bash
# If you have the API token, set it directly
export CLOUDFLARE_API_TOKEN="your-token-here"
```

### Step 2: Create Production D1 Database

```bash
cd /home/user/webapp
npx wrangler d1 create ncpa-sound-crew-db
```

**Important**: Copy the `database_id` from the output and update `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "ncpa-sound-crew-db",
    "database_id": "PASTE-YOUR-DATABASE-ID-HERE"
  }
]
```

### Step 3: Apply Migrations to Production

```bash
cd /home/user/webapp
npm run db:migrate:prod
```

### Step 4: Create Cloudflare Pages Project

```bash
cd /home/user/webapp
npx wrangler pages project create ncpa-sound-crew --production-branch main
```

### Step 5: Deploy to Production

```bash
cd /home/user/webapp
npm run deploy:prod
```

You'll receive URLs like:
- Production: `https://ncpa-sound-crew.pages.dev`
- Branch: `https://main.ncpa-sound-crew.pages.dev`

### Step 6: Seed Production Database (Optional)

If you want to copy the sample data to production:

```bash
cd /home/user/webapp
npx wrangler d1 execute ncpa-sound-crew-db --file=./seed.sql
```

---

## 📦 GitHub Integration (Optional but Recommended)

### Setup GitHub

```bash
# This will configure GitHub authentication
# Follow prompts in #github tab if needed
```

### Push to GitHub

```bash
cd /home/user/webapp

# If repository exists on GitHub
git remote add origin https://github.com/YOUR-USERNAME/ncpa-sound-crew.git
git push -u origin main

# If creating new repository
# Create it on GitHub first, then:
git remote add origin https://github.com/YOUR-USERNAME/ncpa-sound-crew.git
git push -f origin main
```

---

## 🔍 Troubleshooting

### Application Not Loading

**Check PM2 Status:**
```bash
pm2 list
pm2 logs ncpa-sound-crew --nostream
```

**Common fixes:**
```bash
# Port already in use
fuser -k 3000/tcp 2>/dev/null || true

# Rebuild and restart
cd /home/user/webapp && npm run build && pm2 restart ncpa-sound-crew
```

### Database Issues

**Reset local database:**
```bash
cd /home/user/webapp && npm run db:reset
```

**Check database contents:**
```bash
cd /home/user/webapp && npx wrangler d1 execute ncpa-sound-crew-db --local --command="SELECT COUNT(*) FROM events"
```

### CSV Upload Fails

**Check CSV format:**
- Must have headers: Date, Program, Venue (minimum)
- Date format: YYYY-MM-DD or MM/DD/YYYY
- Save as UTF-8 encoding

**Test with sample file:**
```bash
# The sample_events.csv file is ready to use
# It has 9 properly formatted events
```

### Search Not Working

**Verify API endpoint:**
```bash
curl "http://localhost:3000/api/events/search?q=test"
```

Should return: `{"success":true,"data":[...]}`

### Deployment Errors

**Authentication issues:**
- Ensure Cloudflare API token is set
- Check token permissions include D1 and Workers
- Try `npx wrangler whoami` to verify

**Build errors:**
```bash
# Clean build
cd /home/user/webapp
rm -rf dist node_modules
npm install
npm run build
```

---

## 📊 Performance & Limits

### Current Environment (Sandbox)
- **Expected Load**: ~80 events/month
- **Concurrent Users**: 5 users
- **Database**: Local SQLite (unlimited for development)

### Production (Cloudflare Free Tier)
- **Requests**: 100,000/day
- **D1 Reads**: 5 million/day
- **D1 Writes**: 100,000/day
- **D1 Storage**: 5 GB
- **Workers CPU**: 10ms per request

**Your app is well within these limits!**

---

## 🎯 Next Steps

### Immediate Actions
1. ✅ **Test the application** (already running at sandbox URL)
2. ✅ **Try CSV upload** with sample_events.csv
3. ✅ **Test inline editing** in table view
4. ⏳ **Deploy to production** when ready

### Optional Enhancements
- Add more sample data to test with
- Customize colors/branding
- Add export functionality
- Set up custom domain

### Version 2 Planning
- Word document parsing
- AI-powered analytics
- Advanced reporting
- Email notifications

---

## 📞 Quick Reference

### URLs
- **Sandbox**: https://3000-icrqtba2jsfb6kz8v3mvv-cbeee0f9.sandbox.novita.ai
- **Production**: (After deployment)

### Files
- **Sample CSV**: `/home/user/webapp/sample_events.csv`
- **Database Schema**: `/home/user/webapp/migrations/0001_initial_schema.sql`
- **Frontend Code**: `/home/user/webapp/public/static/app.js`
- **Backend Code**: `/home/user/webapp/src/index.tsx`

### Commands
```bash
# Start: pm2 start ecosystem.config.cjs
# Restart: pm2 restart ncpa-sound-crew
# Logs: pm2 logs ncpa-sound-crew --nostream
# Stop: pm2 delete ncpa-sound-crew
```

---

**Ready to use! The application is fully functional and ready for testing.** 🎉
