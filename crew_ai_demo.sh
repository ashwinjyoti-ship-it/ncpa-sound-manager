#!/bin/bash
# Crew Assignment AI - Live Demo Script
# Production URL: https://a6b15877.ncpa-sound.pages.dev

API_BASE="https://c87c620e.ncpa-sound.pages.dev/api"

echo "================================================"
echo "🤖 NCPA Sound Crew - AI Assignment Demo"
echo "================================================"
echo ""

echo "📊 1. Checking System Learning Status..."
echo "================================================"
curl -s "$API_BASE/crew/learning-stats" | jq '{
  total_assignments,
  days_of_learning,
  confidence_level,
  readiness,
  recommendation
}'
echo ""
echo ""

echo "🎯 2. Smart Crew Suggestion for TET Venue (Dec 20)"
echo "================================================"
curl -s -X POST "$API_BASE/crew/auto-suggest" \
  -H "Content-Type: application/json" \
  -d '{"event_date":"2025-12-20","venue":"TET","crew_size":2}' | jq '{
  recommendations: .data.recommendations[0:3] | map({
    name,
    score,
    venueExperience,
    currentWorkload,
    reasoning
  }),
  confidence_level: .data.confidence_level,
  busy_crew: .data.busy_crew_members,
  insights: .data.insights
}'
echo ""
echo ""

echo "⚖️  3. December 2025 Workload Balance"
echo "================================================"
curl -s "$API_BASE/crew/workload-balance?month=2025-12" | jq '{
  month: .data.month,
  balance_score: .data.balance_score,
  avg_assignments: .data.average_assignments,
  overloaded: [.data.crew_analysis[] | select(.status == "overloaded") | {
    name: .crew_name,
    assignments,
    venues: .venues_worked[0:3]
  }][0:3],
  underutilized: [.data.crew_analysis[] | select(.status == "underutilized") | {
    name: .crew_name,
    assignments,
    venues: .venues_worked
  }],
  recommendations: .data.recommendations
}'
echo ""
echo ""

echo "🎓 4. Top 3 Crew Members by Expertise"
echo "================================================"
curl -s "$API_BASE/crew/expertise-report" | jq '{
  total_crew: .data.total_crew,
  top_experts: .data.crew_members[0:3] | map({
    name: .crew_name,
    total_assignments,
    primary_venue,
    specialization,
    top_2_venues: .venues[0:2] | map({venue, assignments})
  })
}'
echo ""
echo ""

echo "✅ Demo Complete!"
echo "================================================"
echo "📖 Full API documentation: CREW_AI_USAGE_GUIDE.md"
echo "🌐 Production: https://c87c620e.ncpa-sound.pages.dev"
echo "📦 GitHub: https://github.com/ashwinjyoti-ship-it/ncpa-sound-manager"
echo "================================================"
