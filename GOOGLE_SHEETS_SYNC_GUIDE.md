# 📊 Google Sheets Auto-Sync Guide

## **Problem Solved**
Previously, you had to manually export CSV from the app and import to Google Sheets every time data changed. This was time-consuming and error-prone.

**Now:** Google Sheets automatically refreshes with latest data every hour! ✨

---

## **🚀 Quick Setup (5 Minutes)**

### **Step 1: Open Your Google Sheet**
1. Go to your existing Google Sheet (or create a new one)
2. Open a **fresh sheet tab** (recommended to keep existing data separate)

### **Step 2: Add the Magic Formula**
1. Click on cell **A1**
2. Copy and paste this formula:

```
=IMPORTDATA("https://ncpa-sound.pages.dev/api/export/latest-csv")
```

3. Press **Enter**

### **Step 3: Wait a Few Seconds**
- Google Sheets will fetch data from your app
- You'll see "Loading..." briefly
- Then all your events will appear! 🎉

---

## **✅ What You'll See**

### **Columns (8 total):**
| Column | Description |
|--------|-------------|
| Date | Event date (YYYY-MM-DD) |
| Program | Event name/program |
| Venue | JBT, TET, GDT, LT, TT, SVR, DP Art Gallery |
| Team | Team responsible |
| Crew | Assigned crew members |
| Sound Requirements | Technical requirements |
| Call Time | Event call time |
| Status | confirmed/pending |

### **Sample Data:**
```
Date        | Program                    | Venue | Team           | Crew         | Sound Requirements | Call Time | Status
2025-12-02  | 1876 Hindi and English Play| TET   | Bruce/Rajeshri | Viraj        |                    |           | confirmed
2025-12-03  | Anna Karenina Ballet       | JBT   | Dance Team     | Aditya, NS   | Full PA system     | 15:00     | confirmed
```

---

## **🔄 How Often Does It Update?**

- **Google's Limit**: Every **1 hour** (automatic)
- **You can force refresh**: 
  1. Right-click on the sheet
  2. Select **Data** → **Refresh data range**

---

## **💡 Pro Tips**

### **Tip 1: Use a Separate Tab**
Don't put the formula in your main working sheet. Create a new tab called "Auto Import" and import there. Then reference it from other sheets:
```
='Auto Import'!A2:H100
```

### **Tip 2: Add Filters**
1. Select row 1 (header row)
2. Click **Data** → **Create a filter**
3. Now you can filter by venue, date, crew, etc.

### **Tip 3: Format Dates**
If dates look wrong:
1. Select the Date column
2. **Format** → **Number** → **Date**

### **Tip 4: Freeze Header Row**
1. Click on row 2
2. **View** → **Freeze** → **1 row**
3. Header stays visible when scrolling

### **Tip 5: Add Conditional Formatting**
Highlight events without sound requirements:
1. Select "Sound Requirements" column
2. **Format** → **Conditional formatting**
3. Rule: "Is empty" → Choose red background

---

## **🛠️ Troubleshooting**

### **Issue 1: "Loading..." Never Finishes**
**Solution:**
- Check your internet connection
- Try refreshing the page (Ctrl+R or Cmd+R)
- Wait 1-2 minutes (large datasets take time)

### **Issue 2: "#N/A" Error**
**Solution:**
- The URL might be wrong. Copy-paste again:
  ```
  https://ncpa-sound.pages.dev/api/export/latest-csv
  ```
- Make sure there are no extra spaces before/after

### **Issue 3: Data Not Updating**
**Solution:**
- Google refreshes every hour automatically
- **Force refresh**: Right-click → Data → Refresh data range
- If still not working, delete the formula and re-add it

### **Issue 4: Special Characters Look Weird**
**Solution:**
- Go to **File** → **Settings**
- Under "Locale", select your region
- Under "Calculation", check "Use locale-specific functions"

---

## **📱 Using on Mobile**

### **Google Sheets App:**
1. Open your Google Sheet in the app
2. Formula works the same way
3. Data auto-refreshes when you open the sheet
4. Pull down to manually refresh

---

## **🔐 Security & Privacy**

### **Is the data public?**
- The CSV export URL is public
- Anyone with the link can view your event data
- **If you need privacy**: Let me know, I can add API key authentication

### **Can others edit the data?**
- **No** - Google Sheets imports are **read-only**
- Team members can view but can't edit the source data
- Only you can edit data in your web app

---

## **🎯 Advanced: Using Formulas**

### **Filter Specific Venue:**
```
=FILTER('Auto Import'!A2:H100, 'Auto Import'!C2:C100="TET")
```

### **Count Events by Venue:**
```
=COUNTIF('Auto Import'!C:C, "JBT")
```

### **Events This Month:**
```
=FILTER('Auto Import'!A2:H100, MONTH('Auto Import'!A2:A100)=12)
```

### **Events Without Sound Requirements:**
```
=FILTER('Auto Import'!A2:H100, 'Auto Import'!F2:F100="")
```

---

## **📊 Sample Dashboard Setup**

### **Create a Summary Tab:**

**Sheet 1: "Auto Import"** (Raw data from formula)
**Sheet 2: "Dashboard"** (Your custom view)

In Dashboard tab:
```
Total Events: =COUNTA('Auto Import'!A:A)-1
JBT Events:   =COUNTIF('Auto Import'!C:C,"JBT")
TET Events:   =COUNTIF('Auto Import'!C:C,"TET")
Missing Sound: =COUNTIF('Auto Import'!F:F,"")
```

---

## **🆘 Need Help?**

### **Common Questions:**

**Q: Can I edit the imported data?**
A: No, imported data is read-only. Make changes in your web app, and Google Sheets will auto-update.

**Q: Can I change the column order?**
A: Yes! After import, you can create formulas to rearrange columns in a different sheet.

**Q: Does this work with multiple sheets?**
A: Yes! You can use the same formula in multiple Google Sheets.

**Q: What if I want more columns?**
A: Let me know which columns you need, I can add them to the export.

**Q: Can I filter before import?**
A: Not with IMPORTDATA, but I can create filtered export URLs (e.g., only December events).

---

## **🔗 Quick Reference URLs**

- **CSV Export**: https://ncpa-sound.pages.dev/api/export/latest-csv
- **Production App**: https://ncpa-sound.pages.dev
- **GitHub**: https://github.com/ashwinjyoti-ship-it/ncpa-sound-manager

---

## **📝 Formula Template (Copy This)**

```
=IMPORTDATA("https://ncpa-sound.pages.dev/api/export/latest-csv")
```

---

## **✅ Success Checklist**

- [ ] Opened Google Sheet
- [ ] Added formula to cell A1
- [ ] Data loaded successfully
- [ ] Header row shows: Date, Program, Venue, Team, Crew, Sound Requirements, Call Time, Status
- [ ] Froze header row
- [ ] Added filters
- [ ] Bookmarked the sheet
- [ ] Shared with team members

---

## **🎉 You're Done!**

Your Google Sheet now auto-syncs every hour with your NCPA Sound Crew app. No more manual exports! 🚀

**Next Steps:**
1. Share this sheet with your team
2. Bookmark it for quick access
3. Set up any custom formulas or dashboards you need

**Questions?** Let me know and I'll help!
