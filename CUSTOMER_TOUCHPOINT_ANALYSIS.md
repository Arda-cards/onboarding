# Arda Customer Touchpoint Analysis

> Generated: February 16, 2026
> Data Sources: HubSpot CRM (contacts, deals, engagements, property history), AWS Cognito user records
> Scope: 60 customer companies, 74 contacts

---

## Executive Summary

This analysis maps every recorded touchpoint across Arda's 60 customer companies — emails, calls, meetings, deal stage changes, form submissions, lifecycle transitions, and platform signups — to identify patterns in successful conversions, engagement gaps, and pipeline falloff points.

| Metric | Value |
|--------|-------|
| Total companies analyzed | 60 |
| Closed Won | 28 (47%) |
| Stalled (active pipeline) | 11 (18%) |
| Churned | 1 (2%) |
| No Deal | 20 (33%) |
| Total Closed Won revenue | $72,801 |
| Average deal size (Closed Won) | $2,600 |

---

## 1. Touchpoint Volume by Outcome

Companies that close have significantly more touchpoints than those that stall.

| Outcome | Companies | Avg Touchpoints | Median | Min | Max |
|---------|-----------|----------------|--------|-----|-----|
| **Closed Won** | 28 | **43.3** | 42 | 10 | 110 |
| Stalled | 11 | 27.4 | 28 | 9 | 48 |
| Churned | 1 | 36.0 | 36 | 36 | 36 |
| No Deal | 20 | 25.6 | 34 | 1 | 42 |

### Engagement Channel Presence

| Channel | Closed Won (28) | Stalled (11) |
|---------|----------------|--------------|
| Emails | 25 (89%) | 9 (82%) |
| Meetings | 20 (71%) | 8 (73%) |
| Calls | — | — |
| Notes | — | — |
| Form Submissions | varies | varies |

**Key takeaway:** Closed Won companies average **58% more touchpoints** than stalled ones. Email presence is nearly universal in both groups, but the *volume* of emails (avg 19 per Closed Won company vs 12 per stalled) is a differentiator.

---

## 2. Acquisition Channel Effectiveness

| Channel | Companies | Closed Won | Win Rate |
|---------|-----------|------------|----------|
| PAID_SOCIAL | 3 | 2 | **67%** |
| ORGANIC_SEARCH | 5 | 3 | **60%** |
| OFFLINE / CRM Import | 25 | 13 | 52% |
| PAID_SEARCH | 4 | 2 | 50% |
| DIRECT_TRAFFIC | 15 | 6 | 40% |
| Unknown | 7 | 2 | 29% |
| OTHER_CAMPAIGNS | 1 | 0 | 0% |

### Channel Breakdown Detail

**PAID_SOCIAL (3 companies, 67% win rate)**
- Closed Won: Felips Auto Service ($3,598), Landis Electric ($3,598)
- No Deal: Woodworking
- Pattern: Facebook leads via "gh - leads - calendar schedule" campaign. Fast demo scheduling.

**ORGANIC_SEARCH (5 companies, 60% win rate)**
- Closed Won: GrowthHit, Shop Tool Company ($1,799), boost manufacturing ($3,598)
- No Deal: Studiorrd, Graham
- Pattern: Google/Bing organic → Kanban card generator page or demo booking. Higher intent leads.

**PAID_SEARCH (4 companies, 50% win rate)**
- Closed Won: c4 Manufacturing ($3,598), Bella+Canvas ($8,388)
- Stalled: Titan Architectural Products, Trace Audio
- Pattern: PPC "pmax" campaigns. Includes the highest-value deal (Bella+Canvas at $8,388).

**OFFLINE / CRM Import (25 companies, 52% win rate)**
- Largest channel by volume. Includes legacy imports and manual CRM entries.
- Closed Won: 13 companies including Elliott Equipment ($8,388), Northstar Chemical ($3,500)
- Stalled: Neff Machine, Cheo, Feldman Tool Co.

**DIRECT_TRAFFIC (15 companies, 40% win rate)**
- Mix of payment link clicks and direct website visits.
- Closed Won: Forager Cycles, Capital Stainless, Caliper Studio, NexGen, Deer Valley, The Label Factory
- Includes self-service payment link conversions (Caliper Studio, The Label Factory, NexGen)

---

## 3. Falloff Points — Where Deals Stall or Drop

### Current Stage of Stalled Deals

| Stage | Count | Companies |
|-------|-------|-----------|
| **Demo Scheduled** | 6 | Neff Machine, Uriel (test), Douglas Anderson, Casey Case, Perfect Catch, Titan Architectural |
| Demo Follow-Up | 1 | Motorola Solutions |
| Payment Link Sent | 1 | Trace Audio |
| Free Trial | 1 | Cheo |
| On Hold | 1 | Dallas Makerspace |
| Freemium | 1 | Feldman Tool Co. |

**Demo Scheduled is the #1 falloff point.** 6 of 11 stalled deals are stuck here, meaning the demo either didn't happen, wasn't compelling enough, or follow-up was insufficient.

### Stage Transition Patterns (All Deals)

| Transition | Count | Interpretation |
|------------|-------|---------------|
| Closed Won → Closed Won | 13 | Repeat purchases / upsells |
| Closed Won → Demo Scheduled | 7 | Won customers entering new deals |
| **Demo Follow-Up → Payment Link Sent** | **6** | Critical conversion step |
| Demo Scheduled → Demo Scheduled | 6 | Rescheduled demos |
| **Demo Scheduled → Closed Won** | **5** | Fast-track wins (skipping stages) |
| **Payment Link Sent → Closed Won** | **5** | Payment completion |
| Payment Link Sent → Free Trial | 4 | Trial before purchase |
| Free Trial → Closed Won | 4 | Trial conversion |
| Demo Scheduled → Demo Follow-Up | 3 | Standard pipeline progression |
| Demo Scheduled → Payment Link Sent | 3 | Skipping follow-up (fast close) |
| Demo Follow-Up → Closed Won | 2 | Direct close after follow-up |

### Critical Pipeline Path

The most common successful path through the pipeline:

```
Demo Scheduled → Demo Follow-Up → Payment Link Sent → Closed Won
                                                    → Free Trial → Closed Won
```

Alternative fast paths:
- Demo Scheduled → Closed Won (5 deals — skipping intermediate stages)
- Direct payment link → Closed Won (self-service)

---

## 4. Engagement Gap Analysis

Gaps between touchpoints are a leading indicator of deal health.

| Outcome | Avg Gap | Max Gap | Gaps >14 days | Gaps >30 days |
|---------|---------|---------|---------------|---------------|
| **Closed Won** | **12.3 days** | 124 days | 76/348 (22%) | 38/348 (11%) |
| Stalled | **21.0 days** | 196 days | 24/63 (38%) | 13/63 (21%) |
| Churned | 9.0 days | 24 days | 1/4 (25%) | 0/4 (0%) |

**Stalled deals have nearly double the average gap** between touchpoints compared to Closed Won, and almost twice the rate of 30+ day gaps.

### Companies with Concerning Engagement Gaps

| Company | Stage | Max Gap | Pattern |
|---------|-------|---------|---------|
| Feldman Tool Co. | Freemium | 196 days | Long silence after initial contact, re-engaged for onboarding |
| Studiorrd | No Deal | 155 days | 5-month gap between demo and re-engagement |
| Matt Hager | No Deal | 153 days | Internal user, irregular engagement |
| Douglas Anderson | Demo Scheduled | 124 days | 4-month gap, lost momentum |
| Kyle Henson | Closed Won | 124 days | Internal/special case |
| Darren Luvaas | No Deal | 123 days | 4-month silence before re-contact |
| Roamrig (Aaron) | No Deal | 102 days | Long gap between initial touch and signup |
| c4 Manufacturing | Closed Won | 102 days | Slow start but eventually closed |
| Reachable Technology | Closed Won | 101 days | Gap between deal creation and re-engagement |
| Northstar Chemical | Closed Won | 90 days | Long gap between HubSpot entry and deal close |

---

## 5. Conversion Speed Patterns

Time from first touch to platform signup correlates with outcomes.

| Speed Bucket | Companies | Closed Won | Win Rate |
|-------------|-----------|------------|----------|
| Same day | 12 | 4 | 33% |
| 1-7 days | 14 | 4 | 29% |
| 8-30 days | 5 | 3 | **60%** |
| **31-90 days** | **4** | **4** | **100%** |
| 90+ days | 17 | 11 | 65% |

### Interpretation

- **Same-day and 1-7 day signups** have lower win rates (29-33%). These may be "tire-kickers" — quick signups but no deal commitment. Many are self-service payment link visitors who sign up but don't fully engage.
- **8-30 day window** has a solid 60% win rate — enough time to evaluate but still showing buying intent.
- **31-90 days** has a **100% win rate** (4/4) — these are deliberate buyers who took time to evaluate and then committed fully.
- **90+ days** at 65% is the long sales cycle — enterprise-type deals (Elliott Equipment, Bella+Canvas) that take longer but still convert well with sustained engagement.

---

## 6. Winning Patterns — What Closed Won Companies Have in Common

### Fast Closers (First Touch → Close < 30 days)

| Company | Days | Amount | Channel | Key Pattern |
|---------|------|--------|---------|-------------|
| Caliper Studio | 0 (same day) | $2,148 | DIRECT_TRAFFIC | Self-service payment link |
| The Label Factory | 4 | $2,148 | DIRECT_TRAFFIC | Self-service payment link |
| Landis Electric | 12 | $3,598 | PAID_SOCIAL | Facebook → demo → close in 12 days |
| Felips Auto Service | 12 | $3,598 | PAID_SOCIAL | Facebook → form → demo → close |
| Capital Stainless | 7 | $1,799 | DIRECT_TRAFFIC | Kanban generator → demo → payment |
| Bella+Canvas | 6 | $8,388 | PAID_SEARCH | PPC → form → demo → close |
| Forager Cycles | 23 | $1,799 | DIRECT_TRAFFIC | Kanban generator → emails → payment |

**Common traits of fast closers:**
- Booked a demo within 1-2 days of first touch
- Had a meeting (demo) within the first week
- Received payment link within 1-2 days of demo
- Low engagement gap (avg 2-6 days between touchpoints)

### High-Value Deals

| Company | Amount | Touchpoints | Days to Close | Channel |
|---------|--------|-------------|---------------|---------|
| Elliott Equipment | $8,388 | 110 | ~58 days | OFFLINE |
| Bella+Canvas | $8,388 | 42 | 6 days | PAID_SEARCH |
| Northstar Chemical | $3,500 | 31 | ~144 days | OFFLINE |
| Momentum Woodworks | $3,598 | 56 | 14 days | OFFLINE |
| Fortitude Welding | $3,598 | 41 | ~10 days | OFFLINE |

**Elliott Equipment** is the standout: highest touchpoint count (110), 4 contacts on the platform, 77 emails, $8,388 deal. Multi-contact enterprise accounts drive the most revenue and engagement.

### Multi-Contact Accounts

| Company | Contacts | Stage | Stickiness |
|---------|----------|-------|-----------|
| Elliott Equipment | 4 | Closed Won | Highest engagement (110 TPs) |
| Henson Home | 2 | Closed Won | Friends & family, recurring |
| Momentum Woodworks | 2 | Closed Won | Fast onboarding |
| Trace Audio | 6 | Payment Link Sent | High adoption, pending close |
| Studiorrd | 3 | No Deal | Active, likely to convert |

---

## 7. At-Risk & Opportunity Accounts

### Stalled Deals Needing Attention

| Company | Stage | Amount | Last Activity | Gap | Recommended Action |
|---------|-------|--------|--------------|-----|-------------------|
| **Trace Audio** | Payment Link Sent | $3,598 | Feb 6, 2026 | 10 days | Close follow-up — 6 users already on platform |
| **Cheo** | Free Trial | $8,388 | Dec 8, 2025 | 70 days | High-value at risk — re-engage Trevor Wilson |
| **Motorola Solutions** | Demo Follow-Up | $3,598 | Dec 23, 2025 | 55 days | Enterprise account losing momentum |
| **Neff Machine** | Demo Scheduled | $3,598 | Oct 28, 2025 | 111 days | Long stalled — needs new outreach approach |
| **Dallas Makerspace** | On Hold | $1,799 | Jan 1, 2026 | 46 days | Check if circumstances have changed |
| **Feldman Tool Co.** | Freemium | $3,500 | Feb 2, 2026 | 14 days | Recently re-engaged, push toward paid |

### No Deal Accounts Worth Re-engaging

| Company | Touchpoints | Last Activity | Signal |
|---------|-------------|--------------|--------|
| Studiorrd | 42 | Feb 3, 2026 | 3 contacts, recent activity, had demos |
| RoamRig | 36+33 | Feb 17, 2026 | 2 contacts (Meg + Aaron), just had meeting |
| Graham (Lights Out MFG) | 37 | Jan 16, 2026 | Organic search, signed up, had meeting |
| ELIZABETH EATON | 22 | Nov 12, 2025 | Had demo + onboarding, went quiet |

---

## 8. Key Insights & Recommendations

### 1. Demo Scheduled Is the Critical Bottleneck
6 of 11 stalled deals are stuck at "Demo Scheduled." This stage has the highest falloff.

**Recommendations:**
- Follow up within 24 hours of demo scheduling with confirmation + agenda
- If demo no-shows, attempt reschedule within 48 hours (max 2 attempts)
- After demo, send budgetary quote or payment link the same day
- Schedule the next touchpoint before ending the demo call

### 2. Engagement Cadence Predicts Success
Closed Won companies have a 12-day average gap between touchpoints vs 21 days for stalled. Gaps >30 days are nearly twice as common in stalled deals.

**Recommendations:**
- Set up automated alerts for any deal with no touchpoint in 14+ days
- Create a "re-engagement" sequence triggered at the 10-day mark
- For high-value deals ($3,500+), maintain weekly touchpoints minimum

### 3. Paid Social Has the Highest ROI
PAID_SOCIAL (Facebook) has a 67% win rate with only 3 customers — the best conversion rate of any channel. ORGANIC_SEARCH is second at 60%.

**Recommendations:**
- Increase Facebook ad spend on the "gh - leads - calendar schedule" campaign
- Optimize the Kanban card generator page for organic search conversion
- The Kanban generator is a key top-of-funnel tool — ensure it has a clear CTA to book a demo

### 4. Self-Service Payment Links Work
Several Closed Won deals (Caliper Studio, The Label Factory, NexGen, Forager Cycles) came through direct payment links with minimal sales touchpoints. These are efficient, low-cost conversions.

**Recommendations:**
- Make payment links more prominent on the website
- Consider a self-service trial → paid conversion path
- Track payment link attribution to optimize placement

### 5. Multi-Contact Accounts Are Stickier
Companies with 2+ contacts (Elliott Equipment, Momentum Woodworks, Trace Audio) show higher engagement and larger deal sizes.

**Recommendations:**
- During onboarding, actively encourage adding team members
- Offer incentives for adding additional users
- Track "contacts per account" as a health metric

### 6. The 31-90 Day Window Is the Sweet Spot
100% win rate for companies that take 31-90 days from first touch to signup. These are deliberate, committed buyers.

**Recommendations:**
- Don't give up on leads that don't convert in the first week
- Create a 30/60/90-day nurture sequence for leads that went cold after initial interest
- The long sales cycle (90+ days) still converts at 65% — patience pays off

---

## Appendix: Individual Company Touchpoint Timelines

### Closed Won Companies

#### Elliott Equipment Company — $8,388 — OFFLINE — 110 touchpoints
- Sep 15, 2025: First touch (IMPORT)
- Sep 24, 2025: Deal created at Demo Scheduled
- Oct 13, 2025: First sales engagement
- Nov 7, 2025: Moved to Budgetary Quote Sent → Payment Link Sent (same day)
- Nov 12, 2025: Deal closed (Closed Won)
- Nov 14, 2025: Stage confirmed Closed Won
- Nov 18, 2025: 3 contacts signed up on platform (Brandon, Bryan, Zach)
- Jan 9, 2026: 4th contact added (Mike Lockhart)
- Engagement: 77 emails, 1 call, 5 meetings | Avg gap: 6 days

#### Bella+Canvas — $8,388 — PAID_SEARCH — 42 touchpoints
- Nov 14, 2025: First touch via PPC → booked demo same day
- Nov 18, 2025: First sales engagement
- Nov 19, 2025: Platform signup
- Nov 20, 2025: Deal closed (Closed Won) + meeting
- Engagement: 29 emails, 0 calls, 1 meeting | Avg gap: 2 days | **Fastest high-value close**

#### Momentum Woodworks — $3,598 — OFFLINE — 56 touchpoints
- Oct 13, 2025: First touch → form submission → demo booked (same day)
- Oct 14, 2025: Demo completed
- Oct 15, 2025: Onboarding form for 2nd contact (Brad)
- Oct 21, 2025: Onboarding meeting, both contacts on platform
- Oct 27, 2025: Deal closed (Closed Won)
- Engagement: 30 emails, 0 calls, 8 meetings | Avg gap: 5 days | **Model customer journey**

#### Felips Auto Service — $3,598 — PAID_SOCIAL — 39 touchpoints
- Sep 19, 2025: First touch via Facebook ad
- Sep 21, 2025: Form submission → deal created
- Sep 25, 2025: Demo completed
- Oct 1, 2025: Deal closed (Closed Won)
- Oct 29, 2025: Platform signup
- Engagement: 22 emails, 0 calls, 4 meetings | Avg gap: 6 days

#### Landis Electric — $3,598 — PAID_SOCIAL — 30 touchpoints
- Oct 23, 2025: First touch via Facebook → form → deal created (same day)
- Oct 24, 2025: Demo scheduled
- Nov 4, 2025: Onboarding meeting + payment + signup (all same day)
- Engagement: 9 emails, 4 calls, 3 meetings | Avg gap: 2 days | **Fastest full cycle**

#### Capital Stainless — $1,799 — DIRECT_TRAFFIC — 44 touchpoints
- Nov 13, 2025: First touch → Kanban card form
- Nov 14, 2025: Demo meetings booked
- Nov 20, 2025: Deal closed + payment + signup (same day)
- Engagement: 26 emails, 0 calls, 4 meetings | Avg gap: 2 days

#### Forager Cycles — $1,799 — DIRECT_TRAFFIC — 42 touchpoints
- Oct 28, 2025: First touch → Kanban card generator
- Oct 30, 2025: First sales engagement
- Nov 20, 2025: Deal closed via payment
- Nov 22, 2025: Platform signup
- Engagement: 30 emails, 0 calls, 1 meeting | Avg gap: 2 days

#### Northstar Chemical — $3,500 — OFFLINE — 31 touchpoints
- Mar 5, 2025: First meeting
- May 10, 2025: HubSpot contact created
- Oct 1, 2025: Deal closed (Closed Won) — 144-day sales cycle
- Oct 7, 2025: Onboarding meetings (5 meetings in one day)
- Nov 18, 2025: Platform signup
- Engagement: 15 emails, 0 calls, 6 meetings | Avg gap: 26 days | **Long cycle, patient close**

#### SmartCon Solutions — $250 — OFFLINE — 46 touchpoints
- Oct 24, 2025: Deal created → Demo Scheduled → Demo Follow-Up (same day)
- Nov 6, 2025: Moved to Payment Link Sent
- Jan 6, 2026: Payment via link, platform signup
- Jan 7, 2026: Deal confirmed Closed Won
- Engagement: 30 emails, 0 calls, 1 meeting | Avg gap: 8 days

### Stalled Deals

#### Trace Audio — Payment Link Sent — $3,598 — PAID_SEARCH — 48 touchpoints
- Dec 15, 2025: First touch via PPC
- Jan 1, 2026: Form → deal → first engagement
- Jan 2, 2026: Moved to Payment Link Sent, 1 signup
- Jan 9, 2026: 5 additional team members signed up
- **6 users on platform but deal not closed** — highest multi-contact stalled account

#### Cheo — Free Trial — $8,388 — OFFLINE — 32 touchpoints
- Nov 24, 2025: Deal created → Demo Scheduled → Payment Link Sent (same day)
- Nov 25, 2025: Moved to Free Trial, signed up
- Dec 4, 2025: Multiple meetings
- Dec 8, 2025: Deal closed at Free Trial stage
- **$8,388 deal value — highest stalled amount** — 70+ days since last activity

#### Motorola Solutions — Demo Follow-Up — $3,598 — OTHER_CAMPAIGNS — 30 touchpoints
- Oct 22, 2025: Deal created
- Oct 30, 2025: Demo meeting
- Nov 4, 2025: Platform signup
- Dec 9, 2025: Deal re-created/stage reset — **possible confusion in pipeline**
- Engagement: 11 emails, 1 call, 3 meetings, 1 note

#### Neff Machine — Demo Scheduled — $3,598 — OFFLINE — 43 touchpoints
- May 10, 2025: First touch
- Jun 12, 2025: Kanban card form submission
- Jun 19, 2025: Initial deal closed won ($2,148 — possibly different product)
- Aug 9, 2025: New deal at Demo Scheduled
- Oct 28, 2025: Platform signup
- **111 days stalled at Demo Scheduled** — 30 emails sent but no meeting conversion

---

## Methodology

Data was collected via the HubSpot CRM API v3:
- **Contacts**: Searched by email addresses from Cognito user records
- **Engagements**: Emails, calls, meetings, notes, tasks, communications via association API
- **Deal History**: Property history API for dealstage, amount, and closedate changes
- **Lifecycle Stages**: Lead, opportunity, and customer transition dates
- **Form Submissions**: First and most recent conversion events
- **Platform Signups**: AWS Cognito user creation timestamps

Touchpoints were deduplicated, sorted chronologically, and analyzed for patterns across outcome groups (Closed Won, Stalled, Churned, No Deal).

Scripts: `scripts/fetch_touchpoints.py` | Raw data: `customer_touchpoints.json`
