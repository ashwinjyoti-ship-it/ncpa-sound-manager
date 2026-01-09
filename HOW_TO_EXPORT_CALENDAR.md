# How to Export to Calendar (.ics) ✅

**Feature**: Export events to `.ics` format for Google Calendar, Apple Calendar, Outlook, etc.  
**Status**: **ACTIVE** ✅  
**Location**: More Actions → Export CSV → Calendar button

---

## 📍 **Step-by-Step Guide**

### **Step 1: Open More Actions Menu**

1. Go to https://ncpa-sound.pages.dev
2. Look for the **"More Actions"** button in the top-right area of the page
3. It's a gray button with three dots icon: `⋮ More Actions ▾`
4. Click it to open the dropdown menu

**Visual Location**:
```
[Calendar] [Table] [Crew]    [+ Add Show]  [🔍 Search]  | [⋮ More Actions ▾]
                                                          └─ Click here!
```

---

### **Step 2: Click "Export CSV" in Dropdown**

The dropdown menu will show:

```
┌─────────────────────────┐
│ Export                  │
├─────────────────────────┤
│ 📄 Export CSV          │ ← Click here!
│ 📱 WhatsApp Export      │
├─────────────────────────┤
│ Import                  │
│ 📁 Import from Word     │
└─────────────────────────┘
```

**Note**: Despite saying "Export CSV", this opens a **multi-format export modal** that includes CSV, Excel, AND Calendar options.

---

### **Step 3: Choose Month and Year**

The export modal will open:

```
┌─────────────────────────────────┐
│ 📥 Export Events               │
├─────────────────────────────────┤
│ Select month to export:         │
│                                 │
│ Month: [January        ▾]       │
│ Year:  [2026          ▾]       │
│                                 │
│ Export Format:                  │
│ [CSV] [Excel] [Calendar]       │
└─────────────────────────────────┘
```

**Actions**:
1. Select the **month** you want to export (e.g., January)
2. Select the **year** (e.g., 2026)
3. Click the **blue "Calendar"** button

---

### **Step 4: Download the .ics File**

- The system will:
  1. Fetch all events for the selected month
  2. Convert them to iCalendar format
  3. Download a file: `NCPA_Events_January_2026.ics`

- You'll see a success notification:
  ```
  ✅ Downloaded 87 events as calendar file (.ics)
  ```

---

## 📅 **How to Import into Your Calendar App**

### **Google Calendar**
1. Open https://calendar.google.com
2. Click the **Settings gear** (⚙️) → **Settings**
3. Click **Import & Export** (left sidebar)
4. Click **Select file from your computer**
5. Choose the downloaded `.ics` file
6. Select which calendar to import to
7. Click **Import**

### **Apple Calendar (Mac/iPhone)**
1. Double-click the `.ics` file
2. Apple Calendar will open automatically
3. Choose which calendar to add events to
4. Click **OK**

### **Outlook**
1. Open Outlook
2. Go to **File** → **Open & Export** → **Import/Export**
3. Select **Import an iCalendar (.ics) or vCalendar file**
4. Browse and select the `.ics` file
5. Click **Import**

### **Outlook.com (Web)**
1. Go to https://outlook.com/calendar
2. Click **Add calendar** → **Upload from file**
3. Select the `.ics` file
4. Click **Import**

---

## 📊 **What Gets Exported**

Each event includes:

| Field | Description | Example |
|-------|-------------|---------|
| **Event Title** | Program name | "Billy Kilson Live" |
| **Date** | Event date | January 31, 2026 |
| **Start Time** | Call time | 11:00 AM |
| **End Time** | Call time + 2 hours | 1:00 PM |
| **Location** | Venue | "Tata Theatre" |
| **Description** | Details | Venue: TT<br>Team: Farrahnaz/Team<br>Crew: Viraj, Omkar<br>Sound: In-house sound<br>Call Time: 11:00 |
| **Status** | Confirmation | CONFIRMED |

---

## 🎯 **Use Cases**

### **1. Share Schedule with External Team**
- Export month's events
- Email `.ics` file to external audio vendor
- They import into their calendar
- Everyone sees the same schedule

### **2. Personal Calendar Sync**
- Export your assigned events
- Import to personal Google Calendar
- Get reminders on your phone
- See conflicts with personal schedule

### **3. Team Planning**
- Export next month's events
- Review in calendar view
- Check for date conflicts
- Plan crew assignments

### **4. Backup**
- Monthly backup of event schedule
- Store `.ics` files locally
- Can re-import if database issues occur

---

## 🔍 **Troubleshooting**

### **Problem: Can't find "More Actions" button**

**Solution**:
- Hard refresh the page: `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac)
- Clear browser cache
- Try a different browser
- Check if you're logged in

### **Problem: "Export CSV" option missing in dropdown**

**Solution**:
- Ensure you're on the latest version: https://ncpa-sound.pages.dev
- Check browser console (F12) for errors
- Try logging out and back in

### **Problem: "No events found for this month"**

**Solution**:
- Verify events exist for the selected month/year
- Switch to Table view and check data
- Try a different month that you know has events

### **Problem: Calendar doesn't open dropdown**

**Solution**:
- Click the "More Actions" button (not the dropdown itself)
- Wait 1 second after page load
- Refresh the page and try again

### **Problem: Download doesn't start**

**Solution**:
- Check if browser is blocking downloads
- Allow downloads from ncpa-sound.pages.dev
- Check Downloads folder (might have downloaded silently)
- Try a different browser

---

## 🛠️ **Technical Details**

### **File Format**
- **Standard**: iCalendar (.ics) - RFC 5545
- **Encoding**: UTF-8
- **Timezone**: Asia/Kolkata (IST)
- **Calendar Name**: NCPA Sound Crew Events

### **Event Properties**
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//NCPA Sound Crew//Event Schedule//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:NCPA Sound Crew Events
X-WR-TIMEZONE:Asia/Kolkata

BEGIN:VEVENT
UID:1420-2026-01-31@ncpa-sound.pages.dev
DTSTAMP:20260108T120000Z
DTSTART:20260131T110000
DTEND:20260131T130000
SUMMARY:Billy Kilson Live
DESCRIPTION:Venue: TT\nTeam: Farrahnaz/Team\nCrew: Viraj\nSound: In-house sound\nCall Time: 11:00
LOCATION:Tata Theatre
STATUS:CONFIRMED
TRANSP:OPAQUE
END:VEVENT

END:VCALENDAR
```

### **Default Duration**
- If no call time specified: Defaults to 9:00 AM
- Event duration: **2 hours** (call time + 2 hours)
- Example: Call time 11:00 → Event ends 1:00 PM

---

## 📝 **Current Limitations**

1. **Monthly export only**: Cannot export entire year at once
   - **Workaround**: Export each month separately

2. **Fixed 2-hour duration**: All events set to 2-hour blocks
   - **Note**: This is for calendar blocking; actual event may be longer/shorter

3. **No recurrence support**: Multi-day events exported as separate events
   - **Example**: 6-day event = 6 individual calendar entries

4. **No reminder settings**: Default calendar app reminders apply
   - **Tip**: Set reminders in your calendar app after import

---

## ✅ **Quick Reference**

**Fastest way to export current month**:

1. Click **"More Actions"** (top-right)
2. Click **"Export CSV"**
3. Verify month/year (defaults to current)
4. Click **blue "Calendar" button**
5. Done! `.ics` file downloads

**File location**: Usually in your `Downloads` folder

**File name format**: `NCPA_Events_[Month]_[Year].ics`

**Example**: `NCPA_Events_January_2026.ics`

---

## 🎯 **Summary**

| Step | Action | Location |
|------|--------|----------|
| 1 | Open dropdown | Click "More Actions" button (top-right) |
| 2 | Open export modal | Click "Export CSV" in dropdown |
| 3 | Select date | Choose month/year in modal |
| 4 | Export | Click blue "Calendar" button |
| 5 | Import | Open `.ics` file in calendar app |

**Time to export**: ~5 seconds  
**Supported apps**: Google Calendar, Apple Calendar, Outlook, Any calendar app that supports .ics files

---

**Status**: ✅ **FEATURE IS LIVE AND WORKING**

If you still can't see the "More Actions" button, please:
1. Share a screenshot of your screen
2. Check if you're logged in
3. Try the latest URL: https://da1861cd.ncpa-sound.pages.dev

---

**Last Updated**: 2026-01-08  
**Production URL**: https://ncpa-sound.pages.dev
