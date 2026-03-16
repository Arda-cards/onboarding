# Arda Customer Journey Map

> Generated 2026-02-16 from HubSpot CRM and AWS Cognito data.
> This checked-in report is intentionally aggregate-only. Raw customer-level exports stay local and are gitignored.

---

## Executive Summary

| Metric | Value |
|---|---|
| Total customer companies (Cognito) | 60 |
| Matched in HubSpot | 53 (88%) |
| Avg. First Touch to Signup | 60 days |
| Fastest conversion | 0 days |
| Longest conversion | 213 days |
| Closed Won deals | 28 (47%) |

## Acquisition Channels

| Source | Count | % |
|---|---|---|
| OFFLINE (CRM/Integration/Import) | 25 | 42% |
| DIRECT_TRAFFIC (website/payments) | 15 | 25% |
| ORGANIC_SEARCH (Google/Bing) | 5 | 8% |
| PAID_SEARCH (PPC) | 4 | 7% |
| PAID_SOCIAL (Facebook) | 3 | 5% |
| OTHER_CAMPAIGNS | 1 | 2% |
| Unknown | 7 | 12% |

## Deal Stage Distribution

| Stage | Count |
|---|---|
| Closed Won | 28 |
| No Deal Found | 20 |
| Demo Scheduled | 6 |
| Free Trial | 1 |
| Freemium | 1 |
| Payment Link Sent | 1 |
| Demo Follow-Up | 1 |
| On Hold | 1 |
| Churn | 1 |

## Aggregate Patterns

- Offline-imported accounts are the largest source segment and represent the largest share of converted customers.
- Direct-traffic customers often convert with shorter journeys, especially when they enter through self-serve payment flows.
- Organic and paid channels represent lower volume, but they still produce meaningful closed-won outcomes.
- A substantial portion of Cognito tenants have no matched deal, which suggests customer onboarding can happen outside the formal sales pipeline.

## Usage Notes

- Run `scripts/fetch_hubspot_journeys.py` locally with `HUBSPOT_API_TOKEN` set to regenerate the raw JSON export.
- The raw files `customer_journeys.json` and `customer_touchpoints.json` are intentionally excluded from version control because they contain customer-identifying CRM data.
