# Crew Assignment AI - Usage Guide

## Overview

The Crew Assignment AI learns from your historical crew assignments to provide intelligent recommendations for future events. The system analyzes:

- **Venue Expertise**: Which crew members have experience at specific venues
- **Workload Fairness**: Distribution of assignments across your team
- **Availability**: Crew members already assigned on the same date
- **Patterns**: Historical assignment patterns and preferences

## System Status

**Current Production Stats (Dec 2025):**
- ✅ **Ready for Use**: 91% confidence level
- 📊 **301 valid assignments** analyzed over **337 days** (filters out Ashwin and invalid names)
- 👥 **14 valid crew members** tracked (from dropdown menu)
- 🎯 **System Recommendation**: "You can start using smart suggestions now!"

**Valid Crew Members (14):**
The AI only learns from these crew members in the dropdown:
- Naren, Sandeep, Coni, Nikhil, NS
- Aditya, Viraj, Shridhar, Nazar, Omkar, Akshay
- OC1, OC2, OC3 (on-call crew)

**Excluded from AI Learning:**
- **Ashwin**: Team head, assigned selectively on custom basis (not included in auto-suggestions)
- **Invalid names**: BBK, AGN, AK, LD GD GD LD, etc. (data quality filtering)

---

## API Endpoints

### 1. Auto-Suggest Crew (`POST /api/crew/auto-suggest`)

Get smart crew recommendations for a specific event.

**Request:**
```bash
curl -X POST https://a6b15877.ncpa-sound.pages.dev/api/crew/auto-suggest \
  -H "Content-Type: application/json" \
  -d '{
    "event_date": "2025-12-20",
    "venue": "TET",
    "crew_size": 2
  }'
```

**Optional Parameters:**
- `program`: Event program name (for pattern matching)
- `event_type`: "Classical", "Dance", "Theatre", etc. (for future specialization)

**Response Example:**
```json
{
  "success": true,
  "data": {
    "recommendations": [
      {
        "name": "BBK",
        "score": 80,
        "expertiseScore": 67,
        "fairnessScore": 100,
        "venueExperience": 6,
        "currentWorkload": 0,
        "reasoning": "Some experience at TET (6 assignments) • Light workload this month"
      },
      {
        "name": "AGN",
        "score": 73,
        "expertiseScore": 56,
        "fairnessScore": 100,
        "venueExperience": 5,
        "currentWorkload": 0,
        "reasoning": "Some experience at TET (5 assignments) • Light workload this month"
      }
    ],
    "requested_crew_size": 2,
    "confidence_level": 95,
    "total_assignments_analyzed": 673,
    "busy_crew_members": ["NS", "Viraj"],
    "insights": [
      "✅ High confidence - System has learned crew patterns well.",
      "🎯 Strong recommendation: BBK is an excellent match."
    ]
  }
}
```

**Understanding Scores:**
- **Final Score (0-100)**: Overall recommendation strength
  - 80-100: Excellent match
  - 60-79: Good match
  - 40-59: Acceptable match
  - 0-39: Consider alternatives

- **Expertise Score**: Based on venue-specific experience (60% weight)
- **Fairness Score**: Based on current month workload (40% weight)

---

### 2. Workload Balance (`GET /api/crew/workload-balance`)

Analyze crew workload distribution for a specific month.

**Request:**
```bash
curl https://a6b15877.ncpa-sound.pages.dev/api/crew/workload-balance?month=2025-12
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "month": "2025-12",
    "balance_score": 0,
    "average_assignments": 9.9,
    "max_assignments": 16,
    "min_assignments": 0,
    "crew_analysis": [
      {
        "crew_name": "Viraj",
        "assignments": 16,
        "deviation_from_avg": 6.07,
        "status": "overloaded",
        "venues_worked": ["TET", "TT", "GDT", "LT"]
      },
      {
        "crew_name": "OC2",
        "assignments": 1,
        "deviation_from_avg": -8.93,
        "status": "underutilized",
        "venues_worked": ["Expl ZCB"]
      }
    ],
    "recommendations": [
      "⚠️ Viraj, Omkar, NS, Nazar may be overloaded. Consider redistributing.",
      "💡 OC3, Coni, OC2 have capacity for more assignments."
    ]
  }
}
```

**Status Types:**
- **overloaded**: >1.5x average assignments
- **balanced**: Within normal range
- **underutilized**: <0.5x average assignments

**Balance Score:**
- 100: Perfect balance across all crew
- 50-99: Good balance
- 0-49: Significant imbalance

---

### 3. Expertise Report (`GET /api/crew/expertise-report`)

Get detailed expertise analysis for all crew members.

**Request:**
```bash
curl https://a6b15877.ncpa-sound.pages.dev/api/crew/expertise-report
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "total_crew": 39,
    "crew_members": [
      {
        "crew_name": "AGN",
        "total_assignments": 111,
        "venues": [
          {
            "venue": "TET",
            "assignments": 44,
            "last_assignment": "2025-10-08",
            "experience_days": 221
          },
          {
            "venue": "GDT",
            "assignments": 14,
            "last_assignment": "2025-10-10",
            "experience_days": 125
          }
        ],
        "primary_venue": "TET",
        "specialization": "Multi-Venue Expert"
      }
    ]
  }
}
```

**Specialization Types:**
- **Venue Specialist**: >70% assignments at primary venue (deep expertise)
- **Multi-Venue Expert**: 3+ venues with significant experience (versatile)
- **Generalist**: Mixed experience across 1-2 venues (flexible)

---

### 4. Learning Stats (`GET /api/crew/learning-stats`)

Check the AI system's learning progress and readiness.

**Request:**
```bash
curl https://a6b15877.ncpa-sound.pages.dev/api/crew/learning-stats
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "total_assignments": 673,
    "days_of_learning": 337,
    "confidence_level": 95,
    "readiness": {
      "ready": true,
      "reason": "System ready for automatic assignments!"
    },
    "first_assignment_date": "2025-01-26",
    "last_assignment_date": "2025-12-29",
    "recommendation": "You can start using smart suggestions now!"
  }
}
```

**Confidence Levels:**
- 0-49%: Low confidence - System still learning
- 50-74%: Medium confidence - Suggestions improving
- 75-89%: High confidence - Reliable recommendations
- 90-100%: Very high confidence - Production ready

**Readiness Criteria:**
- ✅ 100+ assignments analyzed
- ✅ 90+ days of learning data

---

## How to Use

### For Manual Assignment
1. Call `/api/crew/auto-suggest` with event details
2. Review the top 2-3 recommendations
3. Check `reasoning` field for context
4. Consider `busy_crew_members` to avoid conflicts
5. Manually assign crew through your UI

### For Workload Management
1. Call `/api/crew/workload-balance` at the start of each month
2. Review `recommendations` for redistribution suggestions
3. Prioritize underutilized crew for new assignments
4. Consider reducing load for overloaded crew

### For Venue Planning
1. Call `/api/crew/expertise-report` when planning events
2. Match crew specialization with venue requirements
3. Use `primary_venue` info for optimal assignments
4. Cross-train generalists at new venues

---

## Best Practices

1. **Trust the Confidence Level**
   - At 95% confidence, recommendations are highly reliable
   - Still review suggestions for context-specific needs

2. **Balance Expertise and Fairness**
   - System already weighs these (60% expertise, 40% fairness)
   - Override for special requirements (training, preferences)

3. **Monitor Workload Monthly**
   - Check workload balance at month start
   - Adjust assignments to prevent burnout

4. **Track Learning Progress**
   - Monitor `learning-stats` as you add more events
   - System improves with every assignment

5. **Use Reasoning Field**
   - Read the AI's reasoning for each recommendation
   - Helps understand why crew was suggested

---

## Future UI Integration (Planned)

The current deployment is **backend-only**. Future UI features may include:

- 🎯 Auto-suggest button in event creation form
- 📊 Workload balance dashboard
- 👥 Crew expertise cards
- ⚡ One-click assignment from suggestions
- 📈 Learning progress visualization

---

## Technical Details

**Data Source:**
- Learns from `events` table in Cloudflare D1 database
- Parses comma-separated `crew` field for individual analysis
- No separate crew database needed

**Learning Algorithm:**
- Analyzes historical assignments per venue
- Calculates expertise scores based on assignment count
- Tracks current month workload for fairness
- Excludes crew with scheduling conflicts
- Provides weighted scoring (60% expertise, 40% fairness)

**Performance:**
- Average response time: 200-400ms
- Real-time conflict detection
- Scales with event data growth

---

## Questions or Issues?

If you encounter any issues or have questions about the Crew AI:
1. Check `/api/crew/learning-stats` for system status
2. Verify confidence level is adequate for your needs
3. Review this guide for proper API usage
4. Contact development team for assistance

**Production URL:** https://c87c620e.ncpa-sound.pages.dev (or https://ncpa-sound.pages.dev)  
**GitHub:** https://github.com/ashwinjyoti-ship-it/ncpa-sound-manager
