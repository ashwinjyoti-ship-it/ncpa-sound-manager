# CSV Upload Guide for NCPA Sound Crew

## ✅ What's Been Fixed

The CSV upload now supports:
- ✅ **Multiple date formats**: DD/MM/YYYY, DD-MM-YY, DD-MM-YYYY, MM/DD/YYYY, YYYY-MM-DD
- ✅ **Flexible column names**: "Sound Requirement" (singular) or "Sound Requirements" (plural)
- ✅ **Better error messages**: See exactly which rows failed and why
- ✅ **Console logging**: Check browser console for detailed parsing information

## 📋 Required CSV Format

### Minimum Required Columns

Your CSV **must** have these three columns (names are case-insensitive):
1. **Date** - Event date
2. **Program** - Event/program name
3. **Venue** - Location

### Optional Columns

- **Team** (or "Curator") - Team/curator name
- **Sound Requirement** or **Sound Requirements** - Technical requirements
- **Call Time** (or "CallTime") - Setup and call times
- **Crew** (or "Sound Crew") - Assigned crew members

### Supported Column Name Variations

The system recognizes these variations:

| Field | Accepted Column Names |
|-------|----------------------|
| Date | `Date`, `date`, `EVENT DATE`, `Event Date` |
| Program | `Program`, `program`, `Program/Event`, `Event` |
| Venue | `Venue`, `venue` |
| Team | `Team`, `team`, `Curator` |
| Sound Requirements | `Sound Requirements`, `sound_requirements`, `Sound Requirement`, `sound_requirement` |
| Call Time | `Call Time`, `call_time`, `CallTime` |
| Crew | `Crew`, `crew`, `Sound Crew` |

## 📅 Date Formats Supported

The system automatically recognizes these date formats:

1. **DD/MM/YYYY** - `01/11/2025` ✅ (Most common from Google Sheets)
2. **DD-MM-YY** - `01-11-25` ✅
3. **DD-MM-YYYY** - `01-11-2025` ✅
4. **YYYY-MM-DD** - `2025-11-01` ✅ (ISO format)
5. **MM/DD/YYYY** - `11/01/2025` ✅ (US format)

**Note**: The system treats ambiguous formats as DD/MM (day first), which is standard internationally.

## 📝 Example CSV Formats

### Format 1: Your Current Google Sheets Format ✅

```csv
Date,Program,Crew,Team,Venue,Sound Requirement,Call Time
01/11/2025,Nakshatra Dance Festival,Nazar,Dr.Swapno/Team,JBT 5pm,4 DPA mics; 12 Microphones,Setup 7am
02/11/2025,Keys to Joy,Nikhil,Farrahnaz & Team,TT 6.30pm,NCPA Audio Recording,Piano 12:45pm
```

### Format 2: Alternative with Different Column Names ✅

```csv
Date,Program/Event,Sound Crew,Curator,Venue,Sound Requirements,CallTime
2025-11-01,Dance Performance,John,Dr.Swapno,JBT 8pm,Basic sound setup,Setup at 2pm
2025-11-02,Concert,Sarah,Team Lead,TT 7pm,Full recording,Setup at 1pm
```

### Format 3: Minimal (Only Required Fields) ✅

```csv
Date,Program,Venue
01/11/2025,Event Name 1,JBT
02/11/2025,Event Name 2,TT
```

## 🔍 Troubleshooting CSV Upload

### Issue: "No valid events found"

**Causes:**
1. Missing required columns (Date, Program, or Venue)
2. Invalid date format that couldn't be parsed
3. Empty required fields

**Solutions:**
1. Check your CSV has "Date", "Program", and "Venue" columns
2. Ensure date cells are not empty
3. Try one of the supported date formats listed above

### Issue: "Only some events uploaded"

**Causes:**
- Some rows have empty Date, Program, or Venue fields
- Some dates couldn't be parsed

**Solutions:**
1. Open browser console (F12) to see detailed parsing log
2. Look for "Invalid events details" in console
3. Fix the problematic rows and re-upload

### Issue: Sound Requirements not showing

**Causes:**
- Column might be named "Sound Requirement" (singular)
- System now supports both singular and plural

**Solution:**
- Both "Sound Requirement" and "Sound Requirements" work
- Should be fixed in the latest version

## 🧪 Testing Your CSV Before Upload

### Method 1: Browser Console (Recommended)

1. Open the application
2. Press F12 to open Developer Tools
3. Go to "Console" tab
4. Upload your CSV
5. Watch the console for detailed information:
   ```
   CSV parsed, total rows: 70
   CSV headers: Date, Program, Crew, Team, Venue, Sound Requirement, Call Time
   Valid events: 68
   Invalid/skipped events: 2
   Invalid events details: [array of problem rows]
   ```

### Method 2: Test Page

1. Open: `/test_csv_parse.html` in your browser
2. Select your CSV file
3. Click "Parse CSV"
4. See detailed breakdown of what will be imported

## 📊 What Happens During Upload

1. **File Selection**: You choose your CSV file
2. **Parsing**: PapaParse library reads the CSV
3. **Column Mapping**: System maps your columns to database fields
4. **Date Conversion**: Dates are converted to YYYY-MM-DD format
5. **Validation**: Each row is checked for required fields
6. **Filtering**: Invalid rows are skipped with console warnings
7. **Upload**: Valid events are sent to the database
8. **Confirmation**: Success message shows how many events were uploaded

## 💡 Best Practices

### Exporting from Google Sheets

1. **File → Download → Comma Separated Values (.csv)**
2. Use the first row for column headers
3. Ensure no merged cells
4. Remove any extra empty rows at the bottom

### Preparing Your Data

✅ **DO:**
- Use consistent date format throughout
- Fill in at least Date, Program, and Venue for each event
- Use UTF-8 encoding
- Remove any extra columns you don't need

❌ **DON'T:**
- Leave Date, Program, or Venue empty
- Use special characters in date fields
- Merge cells
- Include formulas (export values only)

### Handling Large Uploads

- The system handles up to ~1000 events at once
- For your typical 60-80 events per month, no issues
- If you have many months of data, consider splitting into monthly files

## 🔧 Advanced: Custom Date Formats

If you have a date format not listed above, you can:

1. Pre-format dates in your spreadsheet to YYYY-MM-DD
2. Or use a formula in Google Sheets:
   ```
   =TEXT(A2,"YYYY-MM-DD")
   ```
   Where A2 is your original date cell

## 📞 Quick Reference

### Minimum CSV Structure
```csv
Date,Program,Venue
01/11/2025,Event Name,Theatre Name
```

### Full CSV Structure
```csv
Date,Program,Crew,Team,Venue,Sound Requirement,Call Time
01/11/2025,Event Name,Crew Name,Team Name,Theatre Name,Requirements,Call Time
```

### Supported Date Examples
- `01/11/2025` ✅
- `1/11/2025` ✅
- `01-11-25` ✅
- `2025-11-01` ✅
- `11/01/2025` ✅

## 🎯 After Upload

1. **Check the calendar** - Events should appear on their dates
2. **Switch to table view** - Verify all data imported correctly
3. **Edit any mistakes** - Use inline editing to fix issues
4. **Verify count** - Success message tells you how many were uploaded

## ❓ Still Having Issues?

1. **Open browser console** (F12) and look for error messages
2. **Check the test page** at `/test_csv_parse.html`
3. **Verify your CSV** has the three required columns
4. **Try the sample CSV** at `/home/user/webapp/sample_events.csv` to verify the system works

## 📧 Example Error Messages

| Message | Meaning | Solution |
|---------|---------|----------|
| "No valid events found" | All rows missing required fields | Check Date, Program, Venue columns exist |
| "Successfully uploaded 65 events! (Skipped 5 invalid rows)" | Some rows had issues | Check console for which rows were skipped |
| "Failed to parse CSV file" | File format issue | Ensure it's a proper CSV file |

---

**Updated**: October 24, 2025  
**Version**: 1.1 - Enhanced CSV parsing with DD/MM/YYYY support
