# Anthropic Claude API - Usage Monitoring Guide

## 🎯 Quick Access

**Anthropic Console:** https://console.anthropic.com

---

## 📊 How to Check Your Usage

### **Step 1: Login to Console**
1. Go to https://console.anthropic.com
2. Login with your Anthropic account

### **Step 2: View Usage Dashboard**
1. Click **"Usage"** in left sidebar
2. You'll see:
   - **Current month spend** (USD)
   - **Total tokens used** (input + output)
   - **Cost breakdown by model**
   - **Daily usage graph**
   - **API call statistics**

### **Step 3: Check Your Balance**
1. Go to **Settings** → **Billing**
2. View:
   - **Current balance/credits**
   - **Billing history**
   - **Payment methods**

---

## ⚠️ Set Up Usage Alerts

### **In Anthropic Console:**

1. **Go to Settings** → **Billing** → **Usage Alerts**
2. **Configure alerts at:**
   - 50% of monthly budget
   - 75% of monthly budget  
   - 90% of monthly budget
3. **Receive alerts via:**
   - Email notifications
   - Dashboard warnings

### **Recommended Alert Thresholds:**

| Alert Level | Budget % | Action Required |
|-------------|----------|-----------------|
| 🟡 Warning  | 50%      | Review usage patterns |
| 🟠 Caution  | 75%      | Plan for recharge |
| 🔴 Critical | 90%      | Add credits immediately |

---

## 💰 Cost Estimation for NCPA Sound Crew

### **Claude Sonnet 4 Pricing:**
- **Input tokens**: $3.00 per million tokens
- **Output tokens**: $15.00 per million tokens

### **Typical Usage Per Document:**

**October 2025 Word Document (39KB, 63 events):**
- Processing time: ~116 seconds
- Chunks: 3 chunks
- Estimated tokens per chunk:
  - Input: ~12,000 tokens (document text + prompt)
  - Output: ~3,000 tokens (JSON response)
- **Total per document:**
  - Input: ~36,000 tokens = $0.11
  - Output: ~9,000 tokens = $0.14
  - **Cost: ~$0.25 per document**

### **Monthly Estimation:**

| Scenario | Documents/Month | Estimated Cost |
|----------|----------------|----------------|
| Light Use | 10 documents | $2.50 |
| Moderate Use | 30 documents | $7.50 |
| Heavy Use | 100 documents | $25.00 |

**Note:** This is for Word document parsing only. AI Assistant queries use less (~$0.01-0.05 per query).

---

## 📈 Usage Optimization Tips

### **To Reduce Costs:**

1. **Avoid re-uploading same documents**
   - Use bulk delete + re-upload only when needed
   - Don't test repeatedly with same file

2. **Use CSV for known formats**
   - CSV upload = FREE (no AI)
   - Word parsing = Uses Claude tokens

3. **AI Assistant queries**
   - Each query costs ~$0.01-0.05
   - Keep queries concise
   - Use search feature when possible (FREE)

4. **Batch uploads**
   - Upload multiple months at once
   - More efficient than one-by-one

---

## 🔔 Manual Usage Tracking

If you want to track usage yourself:

### **After Each Upload:**

**October 2025 document:**
- Cost: ~$0.25
- Log it in a spreadsheet

**AI Query:**
- Cost: ~$0.02
- Track per query

### **Weekly Check:**
- Visit console: https://console.anthropic.com/usage
- Review total spend
- Compare to your budget

---

## 💳 How to Recharge

### **When Balance Gets Low:**

1. **Go to Anthropic Console** → **Settings** → **Billing**
2. **Click "Add Credits"**
3. **Choose amount:**
   - Minimum: $5
   - Recommended: $20-50 (lasts 2-3 months with moderate use)
4. **Payment methods:**
   - Credit card
   - ACH transfer (for larger amounts)

### **Auto-Recharge (Optional):**
- Set up automatic top-up when balance drops below threshold
- Example: Auto-add $20 when balance < $5

---

## 🎯 Recommended Budget

**For NCPA Sound Crew:**

| Usage Pattern | Monthly Budget |
|---------------|----------------|
| **Minimal** (10 docs + queries) | $5 |
| **Normal** (30 docs + queries) | $15 |
| **Heavy** (100 docs + queries) | $30 |

**Suggested starting budget:** $20/month
- Covers ~80 Word documents
- Plus unlimited AI queries
- Safe buffer for testing

---

## 🚨 What Happens if You Run Out?

### **When Credits Depleted:**

1. **Word upload will fail** with error: "AI service not configured"
2. **AI Assistant will stop working**
3. **Everything else works:**
   - ✅ CSV upload (no AI needed)
   - ✅ Manual entry
   - ✅ Editing events
   - ✅ Calendar/Table view
   - ✅ Search
   - ✅ WhatsApp export
   - ✅ Bulk delete

### **To Fix:**
- Add credits to Anthropic account immediately
- Word parsing resumes instantly

---

## 📱 Mobile Monitoring

**Anthropic Console is mobile-friendly:**
- Check usage from phone: https://console.anthropic.com
- Get email alerts on mobile
- Quick top-up from anywhere

---

## 🔗 Quick Links

- **Console:** https://console.anthropic.com
- **Usage Dashboard:** https://console.anthropic.com/usage
- **Billing:** https://console.anthropic.com/settings/billing
- **Pricing:** https://anthropic.com/pricing
- **Docs:** https://docs.anthropic.com

---

## 📞 Support

**If you need help:**
- Anthropic Support: support@anthropic.com
- Console Chat: Available in dashboard
- Documentation: https://docs.anthropic.com

---

**Last Updated:** October 25, 2025  
**App:** NCPA Sound Crew Event Management  
**Model:** Claude Sonnet 4 (claude-sonnet-4-20250514)
