#!/bin/bash

# RAG System Comprehensive Test Suite
# Tests all query types, edge cases, and accuracy validation

API_URL="https://ncpa-sound.pages.dev/api"
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to test RAG query
test_rag() {
    local test_name="$1"
    local query="$2"
    local expected_pattern="$3"
    local validation_type="$4"
    
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
    metadata=$(echo "$response" | jq -r '.metadata')
    total_events=$(echo "$response" | jq -r '.metadata.total_events_found')
    intent=$(echo "$response" | jq -r '.metadata.query_intent')
    events_returned=$(echo "$response" | jq -r '.events | length')
    
    echo "Answer: $answer"
    echo "Intent: $intent"
    echo "Total events found: $total_events"
    echo "Events returned: $events_returned"
    
    # Validation based on type
    case "$validation_type" in
        "count")
            # For count queries, verify against database
            db_count=$(curl -s "$API_URL/events/range?start=2025-12-01&end=2025-12-31" | jq '.data | length')
            if echo "$answer" | grep -q "$db_count"; then
                echo -e "${GREEN}✅ PASS: Count matches database ($db_count)${NC}"
                PASSED_TESTS=$((PASSED_TESTS + 1))
            else
                echo -e "${RED}❌ FAIL: Count mismatch. Expected $db_count, got: $answer${NC}"
                FAILED_TESTS=$((FAILED_TESTS + 1))
            fi
            ;;
        "availability")
            # For availability queries, check if free dates are listed
            if echo "$answer" | grep -qE "([0-9]+|free date)"; then
                echo -e "${GREEN}✅ PASS: Free dates provided${NC}"
                PASSED_TESTS=$((PASSED_TESTS + 1))
            else
                echo -e "${RED}❌ FAIL: No free dates in answer${NC}"
                FAILED_TESTS=$((FAILED_TESTS + 1))
            fi
            ;;
        "pattern")
            # For pattern matching
            if echo "$answer" | grep -qE "$expected_pattern"; then
                echo -e "${GREEN}✅ PASS: Answer matches expected pattern${NC}"
                PASSED_TESTS=$((PASSED_TESTS + 1))
            else
                echo -e "${RED}❌ FAIL: Answer doesn't match pattern: $expected_pattern${NC}"
                FAILED_TESTS=$((FAILED_TESTS + 1))
            fi
            ;;
        "no_events")
            # For queries that should show event cards
            if [ "$events_returned" -gt 0 ]; then
                echo -e "${GREEN}✅ PASS: Event cards returned ($events_returned events)${NC}"
                PASSED_TESTS=$((PASSED_TESTS + 1))
            else
                echo -e "${RED}❌ FAIL: No event cards returned${NC}"
                FAILED_TESTS=$((FAILED_TESTS + 1))
            fi
            ;;
        "hide_events")
            # For queries that should NOT show event cards
            if [ "$events_returned" -eq 0 ]; then
                echo -e "${GREEN}✅ PASS: Event cards correctly hidden${NC}"
                PASSED_TESTS=$((PASSED_TESTS + 1))
            else
                echo -e "${RED}❌ FAIL: Event cards shown when they shouldn't be ($events_returned events)${NC}"
                FAILED_TESTS=$((FAILED_TESTS + 1))
            fi
            ;;
        "intent")
            # Verify intent classification
            if [ "$intent" == "$expected_pattern" ]; then
                echo -e "${GREEN}✅ PASS: Intent correctly identified as '$intent'${NC}"
                PASSED_TESTS=$((PASSED_TESTS + 1))
            else
                echo -e "${RED}❌ FAIL: Intent is '$intent', expected '$expected_pattern'${NC}"
                FAILED_TESTS=$((FAILED_TESTS + 1))
            fi
            ;;
    esac
}

echo "════════════════════════════════════════════"
echo "  RAG SYSTEM COMPREHENSIVE TEST SUITE"
echo "════════════════════════════════════════════"
echo "Testing API: $API_URL"
echo "Started: $(date)"
echo ""

# ═══════════════════════════════════════════════════════════════
# CATEGORY 1: COUNT/AGGREGATION QUERIES
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 1: COUNT/AGGREGATION QUERIES     ║"
echo "╚════════════════════════════════════════════╝"

test_rag "Count - December 2025" \
    "How many events in December 2025?" \
    "" \
    "count"

test_rag "Count - Specific crew" \
    "How many events does Ashwin have in December?" \
    "Ashwin.*event" \
    "pattern"

test_rag "Count - Total query" \
    "Total events in December 25" \
    "" \
    "count"

test_rag "Count - Should hide event cards" \
    "How many events in December?" \
    "" \
    "hide_events"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 2: AVAILABILITY/FREE DATES QUERIES
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 2: AVAILABILITY QUERIES          ║"
echo "╚════════════════════════════════════════════╝"

test_rag "Availability - General free dates" \
    "What dates no events happening in December 2025" \
    "" \
    "availability"

test_rag "Availability - Venue specific (TT)" \
    "When is TT free in December?" \
    "" \
    "availability"

test_rag "Availability - Alternative phrasing" \
    "Free dates at Tata Theatre in December" \
    "" \
    "availability"

test_rag "Availability - Should hide event cards" \
    "Which dates is JBT available?" \
    "" \
    "hide_events"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 3: SEARCH QUERIES
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 3: SEARCH QUERIES                ║"
echo "╚════════════════════════════════════════════╝"

test_rag "Search - Show events" \
    "Show me Ashwin's events in December" \
    "" \
    "no_events"

test_rag "Search - Events tomorrow" \
    "Events tomorrow" \
    "" \
    "intent" \
    "search"

test_rag "Search - Specific venue" \
    "Show all events at Tata Theatre" \
    "" \
    "no_events"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 4: AMBIGUOUS QUERIES
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 4: AMBIGUOUS QUERIES             ║"
echo "╚════════════════════════════════════════════╝"

test_rag "Ambiguous - December 25 (month vs day)" \
    "Events in December 25" \
    "" \
    "count"

test_rag "Ambiguous - December 25th (specific day)" \
    "Events on December 25th" \
    "December 25" \
    "pattern"

test_rag "Ambiguous - Vague time period" \
    "Show me events" \
    "event" \
    "pattern"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 5: VENUE ALIAS MATCHING
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 5: VENUE ALIAS MATCHING          ║"
echo "╚════════════════════════════════════════════╝"

test_rag "Venue - TT (short form)" \
    "Events at TT in December" \
    "event" \
    "pattern"

test_rag "Venue - TATA (uppercase)" \
    "Free dates at TATA" \
    "" \
    "availability"

test_rag "Venue - Tata Theatre (full name)" \
    "Events at Tata Theatre" \
    "event" \
    "pattern"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 6: EDGE CASES
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 6: EDGE CASES                    ║"
echo "╚════════════════════════════════════════════╝"

test_rag "Edge - No events on specific date" \
    "Events on December 1st 2025" \
    "no event|0 event" \
    "pattern"

test_rag "Edge - Multiple crew members" \
    "Show events with Ashwin and Naren" \
    "Ashwin|Naren" \
    "pattern"

test_rag "Edge - Date range" \
    "Events from Dec 1 to Dec 10" \
    "event" \
    "pattern"

# ═══════════════════════════════════════════════════════════════
# CATEGORY 7: DATA ACCURACY VALIDATION
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  CATEGORY 7: DATA ACCURACY VALIDATION      ║"
echo "╚════════════════════════════════════════════╝"

# Validate count accuracy
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "DATA ACCURACY CHECK: Event Count Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

db_count=$(curl -s "$API_URL/events/range?start=2025-12-01&end=2025-12-31" | jq '.data | length')
rag_response=$(curl -s "$API_URL/ai/rag" -H 'Content-Type: application/json' -d '{"query":"How many events in December 2025"}')
rag_count=$(echo "$rag_response" | jq -r '.metadata.total_events_found')

echo "Database count: $db_count"
echo "RAG metadata count: $rag_count"

TOTAL_TESTS=$((TOTAL_TESTS + 1))
if [ "$db_count" -eq "$rag_count" ]; then
    echo -e "${GREEN}✅ PASS: Counts match exactly${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${RED}❌ FAIL: Count mismatch! DB: $db_count, RAG: $rag_count${NC}"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Validate free dates accuracy
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "DATA ACCURACY CHECK: Free Dates Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Get all occupied dates from database
occupied_dates=$(curl -s "$API_URL/events/range?start=2025-12-01&end=2025-12-31" | \
    jq -r '.data[].event_date' | sort -u | awk -F'-' '{print $3}' | tr '\n' ',' | sed 's/,$//')

echo "Occupied dates (from DB): $occupied_dates"

# Get RAG's free dates answer
rag_free=$(curl -s "$API_URL/ai/rag" -H 'Content-Type: application/json' \
    -d '{"query":"What dates no events happening in December 2025"}' | jq -r '.answer')

echo "RAG answer: $rag_free"
echo -e "${YELLOW}⚠️  Manual verification needed: Check if listed free dates are truly unoccupied${NC}"

# ═══════════════════════════════════════════════════════════════
# FINAL REPORT
# ═══════════════════════════════════════════════════════════════
echo ""
echo ""
echo "════════════════════════════════════════════"
echo "           TEST SUITE SUMMARY"
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
    echo -e "${GREEN}║  ✅ ALL TESTS PASSED!                ║${NC}"
    echo -e "${GREEN}║  RAG System is production-ready      ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
    exit 0
else
    echo -e "${RED}╔══════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ❌ SOME TESTS FAILED                ║${NC}"
    echo -e "${RED}║  Please review failures above        ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════╝${NC}"
    exit 1
fi
