# Arda Customer Touchpoint Analysis

> Generated 2026-02-16 from HubSpot CRM touchpoints and AWS Cognito user records.
> This repository copy keeps only aggregate findings. Detailed customer timelines and CRM exports remain local-only.

---

## Executive Summary

| Metric | Value |
|---|---|
| Total companies analyzed | 60 |
| Closed Won | 28 (47%) |
| Stalled (active pipeline) | 11 (18%) |
| Churned | 1 (2%) |
| No Deal | 20 (33%) |
| Total Closed Won revenue | $72,801 |
| Average deal size (Closed Won) | $2,600 |

## Touchpoint Volume by Outcome

| Outcome | Companies | Avg Touchpoints | Median | Min | Max |
|---|---|---|---|---|---|
| Closed Won | 28 | 43.3 | 42 | 10 | 110 |
| Stalled | 11 | 27.4 | 28 | 9 | 48 |
| Churned | 1 | 36.0 | 36 | 36 | 36 |
| No Deal | 20 | 25.6 | 34 | 1 | 42 |

Closed-won customers show materially higher total engagement volume than stalled or no-deal customers.

## Channel Effectiveness

| Channel | Companies | Closed Won | Win Rate |
|---|---|---|---|
| PAID_SOCIAL | 3 | 2 | 67% |
| ORGANIC_SEARCH | 5 | 3 | 60% |
| OFFLINE / CRM Import | 25 | 13 | 52% |
| PAID_SEARCH | 4 | 2 | 50% |
| DIRECT_TRAFFIC | 15 | 6 | 40% |
| Unknown | 7 | 2 | 29% |
| OTHER_CAMPAIGNS | 1 | 0 | 0% |

## Falloff Points

| Stage | Count |
|---|---|
| Demo Scheduled | 6 |
| Demo Follow-Up | 1 |
| Payment Link Sent | 1 |
| Free Trial | 1 |
| On Hold | 1 |
| Freemium | 1 |

`Demo Scheduled` is the largest visible bottleneck among still-open deals.

## Engagement Gap Analysis

| Outcome | Avg Gap | Max Gap | Gaps >14 days | Gaps >30 days |
|---|---|---|---|---|
| Closed Won | 12.3 days | 124 days | 76/348 (22%) | 38/348 (11%) |
| Stalled | 21.0 days | 196 days | 24/63 (38%) | 13/63 (21%) |
| Churned | 9.0 days | 24 days | 1/4 (25%) | 0/4 (0%) |

Longer quiet periods correlate with stalled deals more than closed-won outcomes.

## Conversion Speed

| Speed Bucket | Companies | Closed Won | Win Rate |
|---|---|---|---|
| Same day | 12 | 4 | 33% |
| 1-7 days | 14 | 4 | 29% |
| 8-30 days | 5 | 3 | 60% |
| 31-90 days | 4 | 4 | 100% |
| 90+ days | 17 | 11 | 65% |

## Recommendations

- Follow up on demo-scheduled accounts within 48 hours and lock in the next touchpoint before the first meeting ends.
- Watch for 14-day and 30-day inactivity gaps; they are strong warning signals for stalled deals.
- Preserve fast paths for high-intent channels such as direct traffic and payment-link flows.
- Keep raw CRM exports out of version control; publish only summarized or anonymized outputs.

## Usage Notes

- Run `scripts/fetch_touchpoints.py` locally with `HUBSPOT_API_TOKEN` set after generating `customer_journeys.json`.
- The generated JSON outputs are gitignored because they include customer-identifying and communication-derived CRM data.
