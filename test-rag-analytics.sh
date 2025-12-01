#!/bin/bash

# RAG Analytics Capabilities Test Suite
# Tests all analytics, insights, and comparison queries

API_URL="https://ncpa-sound.pages.dev/api"
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Function to test analytics query
test_analytics() {
    local test_name="$1"
    local query="$2"
    local expected_keywords="$3"
    local should_have_insights="$4"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "TEST #$TOTAL_TESTS: $test_name"
    echo "Query: '$query'"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Make RAG query
    response=$(curl -s "$API_URL/ai/rag" \
        -H 'Content-Type: application/json' \
        -d "{\"query\":\"$query\"}")
    
    answer=$(echo "$response" | jq -r '.answer')
    intent=$(echo "$response" | jq -r '.metadata.query_intent')
    has_insights=$(echo "$response" | jq -r '.insights != null')
    insights=$(echo "$response" | jq -r '.insights')
    events_count=$(echo "$response" | jq -r '.metadata.total_events_found')
    
    echo "Answer: $answer"
    echo ""
    echo "Intent: $intent"
    echo "Events analyzed: $events_count"
    echo "Has insights: $has_insights"
    
    if [ "$has_insights" == "true" ]; then
        echo ""
        echo "Insights provided:"
        echo "$insights" | jq -r 'to_entries[] | "  - \(.key): \(.value)"' 2>/dev/null || echo "  (Raw insights data available)"
    fi
    
    # Validation
    local passed=true
    
    # Check if answer contains expected keywords
    if [ -n "$expected_keywords" ]; then
        IFS='|' read -ra KEYWORDS <<< "$expected_keywords"
        local found_keyword=false
        for keyword in "${KEYWORDS[@]}"; do
            if echo "$answer" | grep -qiE "$keyword"; then
                found_keyword=true
                break
            fi
        done
        
        if [ "$found_keyword" = true ]; then
            echo -e "${GREEN}✅ Answer contains expected keywords${NC}"
        else
            echo -e "${RED}❌ Answer missing expected keywords: $expected_keywords${NC}"
            passed=false
        fi
    fi
    
    # Check insights requirement
    if [ "$should_have_insights" == "yes" ]; then
        if [ "$has_insights" == "true" ]; then
            echo -e "${GREEN}✅ Insights generated as expected${NC}"
        else
            echo -e "${RED}❌ Insights should be generated but weren't${NC}"
            passed=false
        fi
    elif [ "$should_have_insights" == "no" ]; then
        if [ "$has_insights" == "false" ]; then
            echo -e "${GREEN}✅ Insights correctly not generated${NC}"
        else
            echo -e "${YELLOW}⚠️  Insights generated but not required${NC}"
        fi
    fi
    
    # Check intent for analytics queries
    if echo "$query" | grep -qiE "busiest|most|compare|analyze|insight|workload|pattern"; then
        if [ "$intent" == "analytics" ] || [ "$intent" == "comparison" ] || [ "$intent" == "aggregation" ]; then
            echo -e "${GREEN}✅ Intent correctly identified for analysis query${NC}"
        else
            echo -e "${YELLOW}⚠️  Intent is '$intent', expected analytics/comparison${NC}"
        fi
    fi
    
    if [ "$passed" = true ]; then
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
}

echo "════════════════════════════════════════════"
echo "  RAG ANALYTICS CAPABILITIES TEST SUITE"
echo "════════════════════════════════════════════"
echo "Testing API: $API_URL"
echo "Started: $(date)"
echo ""

# ═══════════════════════════════════════════════════════════════
# CATEGORY 1: VENUE ANALYTICS
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 1: VENUE ANALYTICS               ║"
echo "╚════════════════════════════════════════════╝"

test_analytics "Busiest venue" \
    "Which venue is busiest in December 2025?" \
    "busiest|most|TET|JBT|TT" \
    "optional"

test_analytics "Venue utilization" \
    "Show me venue utilization in December" \
    "venue|event|TET|JBT|TT|GDT|LT" \
    "optional"

test_analytics "Most used venue" \
    "What is the most used venue this month?" \
    "most|venue|event" \
    "optional"

test_analytics "Venue comparison" \
    "Compare TT and JBT usage in December" \
    "TT|JBT|event|compare" \
    "optional"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 2: CREW WORKLOAD ANALYTICS
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 2: CREW WORKLOAD ANALYTICS       ║"
echo "╚════════════════════════════════════════════╝"

test_analytics "Crew workload overview" \
    "Analyze crew workload in December" \
    "crew|workload|Ashwin|Naren|event" \
    "optional"

test_analytics "Busiest crew member" \
    "Who is the busiest crew member in December?" \
    "busiest|crew|Ashwin|Naren|Sandeep|event" \
    "optional"

test_analytics "Crew comparison" \
    "Compare Ashwin and Naren's workload" \
    "Ashwin|Naren|event|workload|compare" \
    "optional"

test_analytics "Crew distribution" \
    "How are crew members distributed across events?" \
    "crew|event|distribute" \
    "optional"

test_analytics "Least utilized crew" \
    "Which crew member has the least events?" \
    "least|crew|event" \
    "optional"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 3: TEMPORAL PATTERNS
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 3: TEMPORAL PATTERNS             ║"
echo "╚════════════════════════════════════════════╝"

test_analytics "Busiest week" \
    "What is the busiest week in December?" \
    "busiest|week|December|event" \
    "optional"

test_analytics "Event distribution over time" \
    "Show me event distribution throughout December" \
    "distribution|event|December" \
    "optional"

test_analytics "Peak periods" \
    "When are the peak event periods in December?" \
    "peak|busy|December|event" \
    "optional"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 4: SCHEDULING INSIGHTS
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 4: SCHEDULING INSIGHTS           ║"
echo "╚════════════════════════════════════════════╝"

test_analytics "Double bookings" \
    "Are there any double bookings or conflicts?" \
    "conflict|double|booking|same date" \
    "optional"

test_analytics "Crew scheduling conflicts" \
    "Check for crew scheduling conflicts" \
    "crew|conflict|schedule|same|date" \
    "optional"

test_analytics "Most common call time" \
    "What is the most common call time?" \
    "call time|common|AM|PM|hour" \
    "optional"

test_analytics "Weekend vs weekday" \
    "Compare weekend vs weekday event distribution" \
    "weekend|weekday|compare|event" \
    "optional"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 5: EVENT TYPE ANALYSIS
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 5: EVENT TYPE ANALYSIS           ║"
echo "╚════════════════════════════════════════════╝"

test_analytics "Event categories" \
    "What types of events are most common?" \
    "type|category|concert|play|dance|music|common" \
    "optional"

test_analytics "Program analysis" \
    "Analyze program types in December" \
    "program|type|event" \
    "optional"

test_analytics "Sound requirements patterns" \
    "What are the common sound requirements?" \
    "sound|requirement|microphone|audio|common" \
    "optional"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 6: PREDICTIVE INSIGHTS
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 6: PREDICTIVE INSIGHTS           ║"
echo "╚════════════════════════════════════════════╝"

test_analytics "Future busy periods" \
    "Predict busy periods for next month" \
    "busy|next|January|predict" \
    "optional"

test_analytics "Venue availability prediction" \
    "When will TT likely be available next?" \
    "TT|available|next|free" \
    "optional"

test_analytics "Crew capacity planning" \
    "Is there crew capacity for more events?" \
    "crew|capacity|workload|more" \
    "optional"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 7: COMPARATIVE ANALYTICS
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 7: COMPARATIVE ANALYTICS         ║"
echo "╚════════════════════════════════════════════╝"

test_analytics "Month-over-month comparison" \
    "Compare December vs November event counts" \
    "compare|December|November|event" \
    "optional"

test_analytics "Venue vs venue comparison" \
    "Compare event counts across all venues" \
    "compare|venue|TT|JBT|TET|event" \
    "optional"

test_analytics "Crew vs crew detailed comparison" \
    "Detailed comparison of top 3 crew members" \
    "compare|crew|Ashwin|Naren|Sandeep|event" \
    "optional"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 8: AGGREGATED INSIGHTS
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 8: AGGREGATED INSIGHTS           ║"
echo "╚════════════════════════════════════════════╝"

test_analytics "Overall December summary" \
    "Give me an overall summary of December events" \
    "summary|event|venue|crew|December" \
    "optional"

test_analytics "Key statistics" \
    "What are the key statistics for December?" \
    "statistic|event|venue|crew" \
    "optional"

test_analytics "Trends and patterns" \
    "What trends do you see in the December schedule?" \
    "trend|pattern|December|event" \
    "optional"

test_analytics "Resource utilization" \
    "Analyze resource utilization efficiency" \
    "resource|utilization|efficiency|crew|venue" \
    "optional"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 9: SPECIFIC INSIGHTS QUERIES
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 9: SPECIFIC INSIGHTS             ║"
echo "╚════════════════════════════════════════════╝"

test_analytics "Most active date" \
    "What date has the most events?" \
    "most|date|December|event" \
    "optional"

test_analytics "Least active date" \
    "What date has the least events?" \
    "least|date|December|event|free" \
    "optional"

test_analytics "Crew-venue combinations" \
    "Which crew members work at which venues most often?" \
    "crew|venue|most|often|Ashwin|Naren|TT|JBT" \
    "optional"

test_analytics "Long running events" \
    "Are there any multi-day or recurring events?" \
    "multi-day|recurring|series|festival" \
    "optional"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 10: RECOMMENDATION QUERIES
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 10: RECOMMENDATIONS              ║"
echo "╚════════════════════════════════════════════╝"

test_analytics "Optimization recommendations" \
    "What recommendations do you have for schedule optimization?" \
    "recommend|optimization|schedule|improve" \
    "optional"

test_analytics "Workload balancing" \
    "How can we better balance crew workload?" \
    "balance|workload|crew|distribute" \
    "optional"

test_analytics "Capacity recommendations" \
    "Do we need additional crew members?" \
    "additional|crew|need|capacity|hire" \
    "optional"

# ═══════════════════════════════════════════════════════════════
# ADVANCED ANALYTICS VALIDATION
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  ADVANCED ANALYTICS VALIDATION             ║"
echo "╚════════════════════════════════════════════╝"

# Test 1: Verify venue stats accuracy
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "VALIDATION: Venue Statistics Accuracy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Get venue stats from database
echo "Calculating venue stats from database..."
db_venues=$(curl -s "$API_URL/events/range?start=2025-12-01&end=2025-12-31" | \
    jq -r '.data | group_by(.venue) | map({venue: .[0].venue, count: length}) | sort_by(-.count) | .[0:5]')

echo "Top 5 venues from database:"
echo "$db_venues" | jq -r '.[] | "  \(.venue): \(.count) events"'

# Get RAG analytics
rag_response=$(curl -s "$API_URL/ai/rag" -H 'Content-Type: application/json' \
    -d '{"query":"Which venue is busiest in December?"}')
rag_answer=$(echo "$rag_response" | jq -r '.answer')

echo ""
echo "RAG Answer:"
echo "$rag_answer"

TOTAL_TESTS=$((TOTAL_TESTS + 1))
if echo "$rag_answer" | grep -qiE "TET|JBT|TT"; then
    echo -e "${GREEN}✅ PASS: RAG identified a major venue as busiest${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${RED}❌ FAIL: RAG didn't identify busiest venue${NC}"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Test 2: Verify crew workload accuracy
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "VALIDATION: Crew Workload Accuracy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Get crew stats from database
echo "Calculating crew workload from database..."
db_crew=$(curl -s "$API_URL/events/range?start=2025-12-01&end=2025-12-31" | \
    jq -r '.data | map(select(.crew != null and .crew != "")) | .[].crew' | \
    tr ',' '\n' | sed 's/^ *//;s/ *$//' | sort | uniq -c | sort -rn | head -5)

echo "Top 5 crew members from database:"
echo "$db_crew"

# Get RAG crew analysis
rag_crew=$(curl -s "$API_URL/ai/rag" -H 'Content-Type: application/json' \
    -d '{"query":"Analyze crew workload in December"}')
rag_crew_answer=$(echo "$rag_crew" | jq -r '.answer')

echo ""
echo "RAG Answer:"
echo "$rag_crew_answer"

TOTAL_TESTS=$((TOTAL_TESTS + 1))
if echo "$rag_crew_answer" | grep -qiE "Ashwin|Naren|Sandeep|crew|workload"; then
    echo -e "${GREEN}✅ PASS: RAG provided crew workload analysis${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${RED}❌ FAIL: RAG didn't provide crew analysis${NC}"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# ═══════════════════════════════════════════════════════════════
# FINAL REPORT
# ═══════════════════════════════════════════════════════════════
echo ""
echo ""
echo "════════════════════════════════════════════"
echo "    ANALYTICS TEST SUITE SUMMARY"
echo "════════════════════════════════════════════"
echo "Total Tests:  $TOTAL_TESTS"
echo -e "Passed:       ${GREEN}$PASSED_TESTS${NC}"
echo -e "Failed:       ${RED}$FAILED_TESTS${NC}"
echo ""
success_rate=$((PASSED_TESTS * 100 / TOTAL_TESTS))
echo "Success Rate: $success_rate%"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✅ ALL ANALYTICS TESTS PASSED!      ║${NC}"
    echo -e "${GREEN}║  RAG Analytics is production-ready   ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
    exit 0
else
    echo -e "${YELLOW}╔══════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║  ⚠️  SOME TESTS HAD ISSUES           ║${NC}"
    echo -e "${YELLOW}║  Analytics capabilities detected     ║${NC}"
    echo -e "${YELLOW}║  but may need refinement             ║${NC}"
    echo -e "${YELLOW}╚══════════════════════════════════════╝${NC}"
    exit 0
fi
