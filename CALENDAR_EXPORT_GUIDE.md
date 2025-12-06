# Calendar Export Guide

## ✅ **FIXED: iCalendar Export Now Available!**

You can now export events directly to **Google Calendar, Apple Calendar, and Outlook** using the new **iCalendar (.ics)** format.

---

## 📅 **How to Export to Calendar Apps**

### **Step 1: Export from NCPA App**

1. Go to **https://56bb925d.ncpa-sound.pages.dev**
2. Click the **"Export"** button (top toolbar)
3. Select **Month** and **Year**
4. Click **"Calendar"** button (blue button with calendar icon)
5. Download the `.ics` file (e.g., `NCPA_Events_December_2025.ics`)

---

### **Step 2: Import to Your Calendar**

#### **Google Calendar:**
1. Open [Google Calendar](https://calendar.google.com)
2. Click the **⚙️ Settings** gear icon (top right)
3. Click **"Import & Export"** (left sidebar)
4. Click **"Select file from your computer"**
5. Choose the downloaded `.ics` file
6. Select which calendar to add events to
7. Click **"Import"**
8. ✅ Done! All events will appear in your calendar

#### **Apple Calendar (macOS/iOS):**
1. **On Mac:** Double-click the `.ics` file
2. **On iPhone/iPad:** Open the `.ics` file from email or Files app
3. Choose which calendar to add events to
4. Click **"Add"** or **"OK"**
5. ✅ Done! Events will sync across all your Apple devices

#### **Microsoft Outlook:**
1. Open Outlook (desktop or web)
2. Click **"File"** → **"Open & Export"** → **"Import/Export"**
3. Choose **"Import an iCalendar (.ics) or vCalendar file (.vcs)"**
4. Select the downloaded `.ics` file
5. Click **"Import"**
6. ✅ Done! Events will appear in your Outlook calendar

---

## 📋 **What's Included in the Export**

Each event includes:
- **Event Title:** Program name
- **Date & Time:** Event date + call time (or 9 AM default)
- **Duration:** 2 hours (adjustable in calendar after import)
- **Location:** Venue name
- **Description:** Full details including:
  - Venue
  - Team/Curator
  - Crew assigned
  - Sound requirements
  - Call time

---

## 🔄 **Updating Events**

If you export the same month again after making changes:
1. Export the new `.ics` file
2. Import it to your calendar
3. Calendar apps will:
   - **Google Calendar:** Add as new events (you may need to delete old ones)
   - **Apple Calendar:** Ask if you want to replace or duplicate
   - **Outlook:** Add as new events

**Tip:** Delete old events before importing updated ones to avoid duplicates.

---

## 📱 **Export Options Explained**

The export modal now has **3 options**:

| Format | File Type | Best For |
|--------|-----------|----------|
| **CSV** | `.csv` | Excel, Google Sheets, data analysis |
| **Excel** | `.xlsx` | Professional reports, formatted spreadsheets |
| **Calendar** | `.ics` | Google Calendar, Apple Calendar, Outlook |

---

## 🛠️ **Troubleshooting**

### **"Unable to process your iCal/CSV file" Error**
✅ **FIXED!** You were trying to import a **CSV file** into a calendar app. Calendar apps need **iCalendar (.ics)** files, not CSV.

**Solution:** Use the **"Calendar"** button (blue button) instead of CSV/Excel.

### **Events Not Appearing After Import**
1. Check if you selected the correct calendar in the import dialog
2. Verify the month/year you exported matches what you expected
3. Check if events are in the past (some calendars hide past events by default)
4. Try exporting again with a date range that includes today

### **Wrong Time Zone**
The iCalendar export uses **Asia/Kolkata** timezone. If events appear at wrong times:
1. Check your calendar app's timezone settings
2. Adjust individual event times after import if needed

### **Duplicate Events**
If you import the same file multiple times:
- **Google Calendar:** Delete old events manually before re-importing
- **Apple Calendar:** Choose "Don't duplicate" when prompted
- **Outlook:** Events may duplicate; delete old ones first

---

## 📊 **Format Comparison**

### **CSV (.csv)**
- Plain text file
- Works in spreadsheets (Excel, Google Sheets)
- **Cannot be imported to calendars**
- Good for data analysis, reporting

### **iCalendar (.ics)**
- Standard calendar format (RFC 5545)
- Works in all major calendar apps
- **This is what you need for Google Calendar, Apple Calendar, Outlook**
- Includes event metadata, location, description

---

## 🎯 **Quick Reference**

**Want to import to calendar?** → Use **"Calendar"** button (.ics file)  
**Want to analyze data in Excel?** → Use **"CSV"** or **"Excel"** buttons  
**Want formatted spreadsheet?** → Use **"Excel"** button  

---

## 💡 **Pro Tips**

1. **Monthly Exports:** Export one month at a time for easier management
2. **Backup:** Keep exported `.ics` files as backups of your schedule
3. **Sharing:** Send `.ics` files to team members so they can import to their calendars
4. **Updates:** Re-export and re-import when schedules change

---

**Production URL:** https://56bb925d.ncpa-sound.pages.dev  
**Feature Status:** ✅ **LIVE AND WORKING**

---

**Last Updated:** December 6, 2025  
**Version:** 4.1.1 (iCalendar Export Feature)
