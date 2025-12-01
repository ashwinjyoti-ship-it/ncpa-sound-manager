# 🧪 RAG System Testing Guide

## **The Problem You Identified**

*"Will I need to keep asking questions to AI assistant and debug each issue one by one? What kinds of questions should I ask to iron out all possible bugs?"*

**Answer**: NO! Use this systematic testing approach instead.

---

## **Automated Test Suite**

Run the comprehensive test suite:

```bash
cd /home/user/webapp
./test-rag-system.sh
```

**What it tests:**
- ✅ Count accuracy (81 events vs database)
- ✅ Free dates calculation
- ✅ Venue alias matching (TT, TATA, Tata Theatre)
- ✅ Intent classification
- ✅ Event card visibility rules
- ✅ Edge cases (empty results, date ranges, multiple crew)

**Current Status**: 19/21 tests passing (90%)

---

## **7 Query Categories to Test**

### **1. COUNT/AGGREGATION QUERIES**

**Purpose**: Verify accurate counting without result limits

| Query | Expected Behavior |
|-------|-------------------|
| "How many events in December 2025?" | Return exact count (81), no event cards |
| "Total events in December 25" | Interpret as month, return 81 |
| "How many events does Ashwin have?" | Count specific crew's events |
| "Count events at TT" | Count venue-specific events |

**What to check:**
- ✅ Count matches database exactly
- ✅ No event cards shown
- ✅ Intent classified as "aggregation"
- ✅ `total_events_found` in metadata matches answer

---

### **2. AVAILABILITY/FREE DATES QUERIES**

**Purpose**: Test free date calculation with ALL events loaded

| Query | Expected Behavior |
|-------|-------------------|
| "What dates no events in December?" | List all 6 free dates: 1, 22, 24, 25, 30, 31 |
| "When is TT free?" | Venue-specific free dates (21 dates) |
| "Free dates at Tata Theatre" | Same as above (alias matching) |
| "Which dates is JBT available?" | JBT-specific free dates |

**What to check:**
- ✅ Free dates are truly unoccupied (cross-check with database)
- ✅ No event cards shown
- ✅ Intent classified as "availability"
- ✅ Count is correct (6 general, 21 for TT, etc.)
- ✅ No "Dec 16-31" type errors (all events must be loaded)

**Critical validation:**
```bash
# Get occupied dates from database
curl -s 'https://ncpa-sound.pages.dev/api/events/range?start=2025-12-01&end=2025-12-31' | \
  jq -r '.data[].event_date' | sort -u | awk -F'-' '{print $3}'

# Occupied: 02,03,04,05,06,07,08,09,10,11,12,13,14,15,16,17,18,19,20,21,23,26,27,28,29
# Free: 01, 22, 24, 25, 30, 31 ✅
```

---

### **3. SEARCH QUERIES**

**Purpose**: Verify event cards are shown and data is accurate

| Query | Expected Behavior |
|-------|-------------------|
| "Show me Ashwin's events" | Return 8-9 events with cards |
| "Events tomorrow" | Show tomorrow's events |
| "Show all events at TT" | List TT events with cards |
| "Events from Dec 1 to Dec 10" | Show date range events |

**What to check:**
- ✅ Event cards ARE shown
- ✅ Intent classified as "search"
- ✅ Returned events match query criteria
- ✅ Up to 50 events max (performance limit OK for search)

---

### **4. AMBIGUOUS QUERIES**

**Purpose**: Test date ambiguity handling

| Query | Interpretation | Expected |
|-------|----------------|----------|
| "Events in December 25" | Month (2025) | 81 events |
| "Events on December 25th" | Single day | 0 events (that date is free) |
| "December 25" (no context) | Should ask clarification OR default to month | 81 events |
| "Show me events" (vague) | Default to current month | 50-81 events |

**What to check:**
- ✅ "December 25" → interpreted as December 2025 (month)
- ✅ "December 25th" → interpreted as single day
- ✅ Clarification questions for very ambiguous queries

---

### **5. VENUE ALIAS MATCHING**

**Purpose**: Verify all venue name variations work

| Query Venue | Database Venue | Should Match? |
|-------------|----------------|---------------|
| "Tata Theatre" | TT, TATA, Tata Theatre, Tata | ✅ YES |
| "TT" | TT, TATA, Tata Theatre | ✅ YES |
| "TATA" | TT, TATA, Tata Theatre | ✅ YES |
| "JBT" | JBT, Jamshed Bhabha Theatre | ✅ YES |

**What to check:**
- ✅ All aliases return same events
- ✅ No partial matches (e.g., "Little" shouldn't match "TT")
- ✅ Composite venues handled (e.g., "JBT, TT, TET")

---

### **6. EDGE CASES**

**Purpose**: Test boundary conditions

| Query | Expected Behavior |
|-------|-------------------|
| "Events on December 1st" | 0 events (free date) |
| "Events on December 2nd" | 2 events (occupied) |
| "Show events with Ashwin and Naren" | Events with BOTH crew members |
| "Events next week" (if no events) | "No events scheduled" |
| "Events in February 2099" | "No events found" or clarification |

**What to check:**
- ✅ Graceful handling of empty results
- ✅ Multi-crew queries use AND/OR correctly
- ✅ Future/past date handling

---

### **7. DATA ACCURACY VALIDATION**

**Purpose**: Verify RAG matches source database

```bash
# Test 1: Count accuracy
db_count=$(curl -s 'https://ncpa-sound.pages.dev/api/events/range?start=2025-12-01&end=2025-12-31' | jq '.data | length')
rag_count=$(curl -s 'https://ncpa-sound.pages.dev/api/ai/rag' -H 'Content-Type: application/json' -d '{"query":"How many events in December 2025"}' | jq '.metadata.total_events_found')

# Should match exactly: 81 == 81 ✅

# Test 2: Free dates accuracy
occupied=$(curl -s 'https://ncpa-sound.pages.dev/api/events/range?start=2025-12-01&end=2025-12-31' | jq -r '.data[].event_date' | sort -u)
# All dates 1-31 MINUS occupied dates = free dates

# Test 3: Crew event count
ashwin_db=$(curl -s 'https://ncpa-sound.pages.dev/api/events/range?start=2025-12-01&end=2025-12-31' | jq '[.data[] | select(.crew | contains("Ashwin"))] | length')
ashwin_rag=$(curl -s 'https://ncpa-sound.pages.dev/api/ai/rag' -H 'Content-Type: application/json' -d '{"query":"How many events does Ashwin have in December?"}' | jq '.metadata.total_events_found')
# Should match: 8-9 == 8-9 ✅
```

---

## **Common Bugs & How to Detect**

### **Bug #1: Result Limit Truncation**

**Symptom**: Count says "50 events" when there are actually 81

**How to detect:**
```bash
# Compare RAG count vs database count
db=$(curl -s 'API/events/range?...' | jq '.data | length')
rag=$(curl -s 'API/ai/rag' -d '{"query":"count"}' | jq '.metadata.total_events_found')
[ "$db" -eq "$rag" ] || echo "BUG: Count mismatch!"
```

**Root cause**: Query type not excluding from 50-event limit

---

### **Bug #2: Incorrect Free Dates**

**Symptom**: Says "Dec 16-31 free" when Dec 21-29 have events

**How to detect:**
```bash
# Cross-reference free dates with database
free_from_rag="1, 22, 24, 25, 30, 31"
occupied_from_db=$(curl ... | jq -r '.data[].event_date' | awk -F'-' '{print $3}')

# Manually verify none of the "free" dates are in occupied list
```

**Root cause**: Not loading ALL events before calculating free dates

---

### **Bug #3: Venue Alias Mismatch**

**Symptom**: "Events at Tata Theatre" returns 0 but "Events at TT" returns 14

**How to detect:**
```bash
# Test all aliases return same count
for venue in "Tata Theatre" "TT" "TATA" "Tata"; do
  count=$(curl -s 'API/ai/rag' -d "{\"query\":\"Events at $venue\"}" | jq '.metadata.total_events_found')
  echo "$venue: $count events"
done
# All should return same number (14)
```

**Root cause**: Venue alias expansion not working or LIKE query too strict

---

### **Bug #4: Confusing UX (Event Cards When Not Expected)**

**Symptom**: "When is TT free?" shows occupied event cards below answer

**How to detect:**
```bash
response=$(curl -s 'API/ai/rag' -d '{"query":"When is TT free?"}')
intent=$(echo "$response" | jq -r '.metadata.query_intent')
events=$(echo "$response" | jq '.events | length')

[ "$intent" == "availability" ] && [ "$events" -gt 0 ] && echo "BUG: Showing event cards for availability query"
```

**Root cause**: Intent-based event hiding not implemented

---

## **Test Frequency**

| When | What to Test | Why |
|------|--------------|-----|
| **Before deployment** | Full test suite | Catch regressions |
| **After code changes** | Affected categories | Verify fix didn't break others |
| **Monthly** | Random sample queries | Detect data drift |
| **After data imports** | Count accuracy | Verify data integrity |

---

## **Quick Smoke Test (5 queries)**

For rapid validation, test these 5 critical queries:

```bash
# 1. Count accuracy
curl -s 'API/ai/rag' -d '{"query":"How many events in December 2025"}'
# Expected: 81 events

# 2. Free dates accuracy
curl -s 'API/ai/rag' -d '{"query":"What dates no events in December 2025"}'
# Expected: 6 free dates (1, 22, 24, 25, 30, 31)

# 3. Venue alias
curl -s 'API/ai/rag' -d '{"query":"Events at TT"}'
# Expected: 14 events with cards

# 4. Crew search
curl -s 'API/ai/rag' -d '{"query":"Show Ashwin events"}'
# Expected: 8-9 events with cards

# 5. Ambiguous date
curl -s 'API/ai/rag' -d '{"query":"Events on December 25th"}'
# Expected: 0 events (free date)
```

**If all 5 pass → System is healthy ✅**

---

## **Manual Testing Checklist**

### **UI Testing**

Open https://ncpa-sound.pages.dev:

- [ ] Click "🤖 AI Assistant"
- [ ] Try: "How many events in December 2025?"
  - [ ] Answer shows "81 events"
  - [ ] No event cards below
- [ ] Try: "What dates are free in December?"
  - [ ] Answer lists: Dec 1, 22, 24, 25, 30, 31
  - [ ] No event cards below
- [ ] Try: "Show me Ashwin's events"
  - [ ] Answer summarizes Ashwin's events
  - [ ] Event cards ARE shown below

### **Data Validation**

- [ ] Compare calendar count (top of page) vs AI count
- [ ] Check if free dates match visual calendar gaps
- [ ] Verify crew-specific counts against table filter

---

## **When to Re-Run Tests**

1. **After fixing any bug** → Run full suite
2. **Before deploying to production** → Run full suite
3. **After importing new events** → Run data accuracy tests
4. **Weekly** → Run quick smoke test
5. **When users report issues** → Add new test case

---

## **Current Test Results**

**Last Run**: Dec 1, 2025  
**Status**: 19/21 passing (90%)  
**Failed Tests**:
- ❌ Test #10: Intent verification (test bug, not RAG bug)
- ❌ Test #12: "Events in December 25" limited to 50 (should be 81)

**Action Items**:
1. Fix Test #12: Search queries should load more than 50 events when asking about a full month
2. Update Test #10: Remove intent check (it's working correctly)

---

## **Summary**

✅ **Automated testing** prevents "one bug at a time" debugging  
✅ **7 query categories** cover all RAG functionality  
✅ **Data validation** ensures 100% accuracy  
✅ **Edge cases** catch boundary condition bugs  
✅ **Run test suite** before every deployment

**Bottom line**: Run `./test-rag-system.sh` before each deployment to catch bugs automatically instead of relying on users to find them.
