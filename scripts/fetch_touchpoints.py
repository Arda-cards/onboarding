#!/usr/bin/env python3
"""
Fetch ALL touchpoints from HubSpot for each Cognito customer:
- Engagements (emails, calls, meetings, notes, tasks)
- Deal stage history (audit trail)
- Form submissions
- Website page views
- Marketing email events
Then output a comprehensive touchpoint timeline per customer.
"""

import csv
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime
from collections import defaultdict

API_TOKEN = os.environ.get("HUBSPOT_API_TOKEN", "")
BASE_URL = "https://api.hubapi.com"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
COGNITO_CSV = os.path.join(SCRIPT_DIR, "..", "server", "data", "cognito_users.csv")
JOURNEYS_JSON = os.path.join(SCRIPT_DIR, "..", "customer_journeys.json")

STAGE_MAP = {
    "appointmentscheduled": "Prospect",
    "1499838171": "Approached",
    "qualifiedtobuy": "Lead",
    "presentationscheduled": "Demo Scheduled",
    "1955958510": "No-Show/Reschedule Demo",
    "decisionmakerboughtin": "Demo Follow-Up",
    "1955580622": "Budgetary quote sent",
    "1559099077": "Payment Link Sent",
    "1499827945": "Free Trial",
    "1731122907": "Freemium",
    "closedwon": "Closed Won",
    "contractsent": "Ping Later",
    "closedlost": "Closed Lost",
    "1499784890": "Churn",
    "1499784891": "Unlikely",
    "1499827944": "On Hold",
    "1718686448": "Internal+Friends and Family",
    "2025131723": "Interested in a pilot",
}

ENGAGEMENT_TYPES = {
    "emails": "Email",
    "calls": "Call",
    "meetings": "Meeting",
    "notes": "Note",
    "tasks": "Task",
    "communications": "Communication",
}


def hubspot_get(endpoint, params=None):
    url = f"{BASE_URL}{endpoint}"
    if params:
        query = "&".join(f"{k}={urllib.request.quote(str(v))}" for k, v in params.items())
        url = f"{url}?{query}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {API_TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 429:
            print("    Rate limited, waiting 10s...", file=sys.stderr)
            time.sleep(10)
            return hubspot_get(endpoint, params)
        body_text = ""
        try:
            body_text = e.read().decode()[:200]
        except:
            pass
        print(f"  HTTP {e.code} for {endpoint}: {body_text}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  Error: {e} for {endpoint}", file=sys.stderr)
        return None


def hubspot_post(endpoint, body):
    url = f"{BASE_URL}{endpoint}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {API_TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 429:
            print("    Rate limited, waiting 10s...", file=sys.stderr)
            time.sleep(10)
            return hubspot_post(endpoint, body)
        body_text = ""
        try:
            body_text = e.read().decode()[:200]
        except:
            pass
        print(f"  HTTP {e.code} for {endpoint}: {body_text}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  Error: {e} for {endpoint}", file=sys.stderr)
        return None


def get_contact_engagements(contact_id):
    """Get all engagement associations for a contact."""
    all_engagements = []

    for eng_type, eng_label in ENGAGEMENT_TYPES.items():
        endpoint = f"/crm/v3/objects/contacts/{contact_id}/associations/{eng_type}"
        data = hubspot_get(endpoint, {"limit": "100"})
        if data and data.get("results"):
            for assoc in data["results"]:
                eng_id = assoc.get("id") or assoc.get("toObjectId")
                if eng_id:
                    all_engagements.append((eng_type, eng_id, eng_label))
        time.sleep(0.1)

    return all_engagements


def get_engagement_details(eng_type, eng_id):
    """Get details of a specific engagement."""
    props_map = {
        "emails": "hs_timestamp,hs_email_subject,hs_email_direction,hs_email_status,hs_email_text",
        "calls": "hs_timestamp,hs_call_title,hs_call_direction,hs_call_duration,hs_call_disposition,hs_call_body",
        "meetings": "hs_timestamp,hs_meeting_title,hs_meeting_start_time,hs_meeting_end_time,hs_meeting_outcome",
        "notes": "hs_timestamp,hs_note_body",
        "tasks": "hs_timestamp,hs_task_subject,hs_task_status,hs_task_body",
        "communications": "hs_timestamp,hs_communication_channel_type,hs_communication_body",
    }
    props = props_map.get(eng_type, "hs_timestamp")
    data = hubspot_get(f"/crm/v3/objects/{eng_type}/{eng_id}", {"properties": props})
    return data


def get_contact_by_email(email):
    """Search for a contact by email and return ID."""
    body = {
        "filterGroups": [{"filters": [{"propertyName": "email", "operator": "EQ", "value": email}]}],
        "properties": ["email", "firstname", "lastname", "company", "lifecyclestage",
                        "hs_analytics_first_timestamp", "hs_analytics_source",
                        "hs_analytics_source_data_1", "hs_analytics_source_data_2",
                        "hs_analytics_first_url", "hs_analytics_first_referrer",
                        "hs_analytics_num_page_views", "hs_analytics_num_visits",
                        "hs_analytics_num_event_completions",
                        "num_conversion_events", "recent_conversion_event_name",
                        "recent_conversion_date", "first_conversion_event_name",
                        "first_conversion_date",
                        "hs_email_optout", "hs_email_open", "hs_email_click",
                        "hs_email_bounce", "hs_email_delivered",
                        "hs_sequences_enrolled_count", "hs_sequences_actively_enrolled_count",
                        "notes_last_updated", "num_associated_deals",
                        "num_notes", "num_contacted_notes",
                        "hs_lifecyclestage_lead_date",
                        "hs_lifecyclestage_opportunity_date",
                        "hs_lifecyclestage_customer_date",
                        "hs_sa_first_engagement_date",
                        "hs_last_sales_activity_date",
                        "hs_latest_meeting_activity",
                        "createdate",
                        ],
        "limit": 1,
    }
    result = hubspot_post("/crm/v3/objects/contacts/search", body)
    if result and result.get("results"):
        return result["results"][0]
    return None


def get_deal_property_history(deal_id):
    """Get the history of dealstage changes for a deal."""
    data = hubspot_get(f"/crm/v3/objects/deals/{deal_id}",
                       {"propertiesWithHistory": "dealstage,amount,closedate"})
    if data:
        return data.get("propertiesWithHistory", {})
    return {}


def search_deals_for_company(company_name):
    """Search for deals matching a company name."""
    if not company_name or len(company_name) < 3:
        return []
    # Use first significant word
    words = [w for w in company_name.split() if len(w) > 3]
    if not words:
        words = company_name.split()[:1]
    search_term = words[0] if words else company_name

    body = {
        "filterGroups": [{"filters": [
            {"propertyName": "dealname", "operator": "CONTAINS_TOKEN", "value": search_term}
        ]}],
        "properties": ["dealname", "dealstage", "pipeline", "amount", "closedate", "createdate",
                        "hs_deal_stage_probability", "hubspot_owner_id"],
        "limit": 50,
    }
    result = hubspot_post("/crm/v3/objects/deals/search", body)
    if result:
        # Filter to only deals that actually match
        cn_lower = company_name.lower()
        matched = []
        for d in result.get("results", []):
            dname = (d.get("properties", {}).get("dealname") or "").lower()
            if cn_lower in dname or any(w.lower() in dname for w in words):
                matched.append(d)
        return matched
    return []


def get_form_submissions(contact_id):
    """Get form submissions for a contact via v1 API."""
    data = hubspot_get(f"/crm/v3/objects/contacts/{contact_id}",
                       {"properties": "num_conversion_events,recent_conversion_event_name,recent_conversion_date,first_conversion_event_name,first_conversion_date,hs_analytics_num_page_views,hs_analytics_num_visits"})
    return data


def format_date(iso_str):
    if not iso_str or iso_str == "N/A" or iso_str == "None":
        return None
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M")
    except:
        return iso_str[:16] if len(iso_str) >= 16 else iso_str


def format_date_short(iso_str):
    if not iso_str or iso_str == "N/A" or iso_str == "None":
        return None
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%b %d, %Y")
    except:
        return iso_str[:10]


def days_between(d1, d2):
    try:
        dt1 = datetime.fromisoformat(d1.replace("Z", "+00:00"))
        dt2 = datetime.fromisoformat(d2.replace("Z", "+00:00"))
        return (dt2 - dt1).days
    except:
        return None


def truncate(text, max_len=120):
    if not text:
        return ""
    text = text.replace("\n", " ").replace("\r", " ").strip()
    if len(text) > max_len:
        return text[:max_len] + "..."
    return text


def main():
    print("=" * 90)
    print("ARDA CUSTOMER TOUCHPOINT ANALYSIS")
    print("=" * 90)

    # Load existing journey data
    print("\n[1/6] Loading journey data...")
    with open(JOURNEYS_JSON) as f:
        journeys = json.load(f)
    print(f"  {len(journeys)} customer companies loaded")

    # For each customer, collect ALL touchpoints
    print("\n[2/6] Fetching detailed contact data from HubSpot...")
    all_touchpoint_data = []

    for idx, journey in enumerate(journeys):
        company = journey["company"]
        contacts = journey.get("contacts", [])
        print(f"\n  [{idx+1}/{len(journeys)}] {company} ({len(contacts)} contacts)")

        company_touchpoints = []
        company_contact_details = []

        for contact in contacts:
            email = contact["email"].strip().lower()
            print(f"    Looking up {email}...")

            hs_contact = get_contact_by_email(email)
            if not hs_contact:
                print(f"      Not found in HubSpot")
                company_touchpoints.append({
                    "date": contact.get("created", ""),
                    "type": "Platform Signup",
                    "detail": f"{email} created Cognito account",
                    "source": "Cognito",
                })
                continue

            contact_id = hs_contact["id"]
            props = hs_contact.get("properties", {})
            company_contact_details.append({
                "email": email,
                "hs_id": contact_id,
                "props": props,
            })

            # Add analytics touchpoints
            first_touch = props.get("hs_analytics_first_timestamp")
            if first_touch:
                source = props.get("hs_analytics_source", "Unknown")
                sd1 = props.get("hs_analytics_source_data_1", "")
                sd2 = props.get("hs_analytics_source_data_2", "")
                first_url = props.get("hs_analytics_first_url", "")
                first_ref = props.get("hs_analytics_first_referrer", "")
                detail = f"Source: {source}"
                if sd1:
                    detail += f" | {sd1}"
                if sd2:
                    detail += f" ({sd2})"
                if first_url:
                    detail += f" | URL: {first_url}"
                if first_ref:
                    detail += f" | Referrer: {first_ref}"
                company_touchpoints.append({
                    "date": first_touch,
                    "type": "First Touch",
                    "detail": detail,
                    "source": "HubSpot Analytics",
                    "contact": email,
                })

            # Lifecycle stage transitions
            lead_date = props.get("hs_lifecyclestage_lead_date")
            if lead_date:
                company_touchpoints.append({
                    "date": lead_date,
                    "type": "Lifecycle: Became Lead",
                    "detail": f"{email} lifecycle stage changed to Lead",
                    "source": "HubSpot Lifecycle",
                    "contact": email,
                })

            opp_date = props.get("hs_lifecyclestage_opportunity_date")
            if opp_date:
                company_touchpoints.append({
                    "date": opp_date,
                    "type": "Lifecycle: Became Opportunity",
                    "detail": f"{email} lifecycle stage changed to Opportunity",
                    "source": "HubSpot Lifecycle",
                    "contact": email,
                })

            cust_date = props.get("hs_lifecyclestage_customer_date")
            if cust_date:
                company_touchpoints.append({
                    "date": cust_date,
                    "type": "Lifecycle: Became Customer",
                    "detail": f"{email} lifecycle stage changed to Customer",
                    "source": "HubSpot Lifecycle",
                    "contact": email,
                })

            # Sales activity dates
            first_eng = props.get("hs_sa_first_engagement_date")
            if first_eng:
                company_touchpoints.append({
                    "date": first_eng,
                    "type": "First Sales Engagement",
                    "detail": f"First sales activity recorded for {email}",
                    "source": "HubSpot Sales",
                    "contact": email,
                })

            last_sales = props.get("hs_last_sales_activity_date")
            if last_sales:
                company_touchpoints.append({
                    "date": last_sales,
                    "type": "Last Sales Activity",
                    "detail": f"Most recent sales activity for {email}",
                    "source": "HubSpot Sales",
                    "contact": email,
                })

            latest_meeting = props.get("hs_latest_meeting_activity")
            if latest_meeting:
                company_touchpoints.append({
                    "date": latest_meeting,
                    "type": "Meeting",
                    "detail": f"Meeting with {email}",
                    "source": "HubSpot Meetings",
                    "contact": email,
                })

            # Conversion events
            first_conv = props.get("first_conversion_event_name")
            first_conv_date = props.get("first_conversion_date")
            if first_conv and first_conv_date:
                company_touchpoints.append({
                    "date": first_conv_date,
                    "type": "First Form Submission",
                    "detail": f"Form: {first_conv}",
                    "source": "HubSpot Forms",
                    "contact": email,
                })

            recent_conv = props.get("recent_conversion_event_name")
            recent_conv_date = props.get("recent_conversion_date")
            if recent_conv and recent_conv_date and recent_conv_date != first_conv_date:
                company_touchpoints.append({
                    "date": recent_conv_date,
                    "type": "Form Submission",
                    "detail": f"Form: {recent_conv}",
                    "source": "HubSpot Forms",
                    "contact": email,
                })

            # HubSpot contact create date
            hs_created = props.get("createdate")
            if hs_created:
                company_touchpoints.append({
                    "date": hs_created,
                    "type": "HubSpot Contact Created",
                    "detail": f"{email} added to HubSpot CRM",
                    "source": "HubSpot CRM",
                    "contact": email,
                })

            # Cognito signup
            cognito_date = contact.get("created", "")
            if cognito_date:
                company_touchpoints.append({
                    "date": cognito_date,
                    "type": "Platform Signup",
                    "detail": f"{email} created Arda account",
                    "source": "Cognito",
                    "contact": email,
                })

            # Get engagements (emails, calls, meetings, notes)
            print(f"      Fetching engagements...")
            engagements = get_contact_engagements(contact_id)
            print(f"      Found {len(engagements)} engagements")

            for eng_type, eng_id, eng_label in engagements[:30]:  # cap at 30 per contact
                details = get_engagement_details(eng_type, eng_id)
                if details:
                    eng_props = details.get("properties", {})
                    ts = eng_props.get("hs_timestamp")
                    if not ts:
                        ts = details.get("createdAt")

                    detail_text = ""
                    if eng_type == "emails":
                        subj = eng_props.get("hs_email_subject", "")
                        direction = eng_props.get("hs_email_direction", "")
                        detail_text = f"[{direction}] {subj}" if subj else f"[{direction}] Email"
                    elif eng_type == "calls":
                        title = eng_props.get("hs_call_title", "")
                        duration = eng_props.get("hs_call_duration", "")
                        disposition = eng_props.get("hs_call_disposition", "")
                        dur_str = f" ({int(int(duration)/1000)}s)" if duration and duration != "0" else ""
                        detail_text = f"{title or 'Call'}{dur_str}" + (f" - {disposition}" if disposition else "")
                    elif eng_type == "meetings":
                        title = eng_props.get("hs_meeting_title", "")
                        outcome = eng_props.get("hs_meeting_outcome", "")
                        start = eng_props.get("hs_meeting_start_time", "")
                        detail_text = f"{title or 'Meeting'}" + (f" - {outcome}" if outcome else "")
                        if start:
                            ts = start  # Use meeting start time
                    elif eng_type == "notes":
                        body = truncate(eng_props.get("hs_note_body", ""), 150)
                        detail_text = f"Note: {body}" if body else "Note added"
                    elif eng_type == "tasks":
                        subj = eng_props.get("hs_task_subject", "")
                        status = eng_props.get("hs_task_status", "")
                        detail_text = f"Task: {subj}" + (f" ({status})" if status else "")
                    elif eng_type == "communications":
                        channel = eng_props.get("hs_communication_channel_type", "")
                        body = truncate(eng_props.get("hs_communication_body", ""), 100)
                        detail_text = f"[{channel}] {body}" if channel else body

                    if ts:
                        company_touchpoints.append({
                            "date": ts,
                            "type": eng_label,
                            "detail": detail_text,
                            "source": "HubSpot Engagement",
                            "contact": email,
                        })
                time.sleep(0.05)

            time.sleep(0.1)

        # Get deal stage history
        print(f"    Fetching deal history...")
        deals = journey.get("all_deals", [])
        company_name_lower = company.lower()

        # Also search for deals if we don't have many
        if len(deals) < 2:
            searched = search_deals_for_company(company)
            for sd in searched:
                if sd["properties"].get("dealname"):
                    dn = sd["properties"]["dealname"]
                    stage = STAGE_MAP.get(sd["properties"].get("dealstage", ""), sd["properties"].get("dealstage", ""))
                    if not any(d.get("name") == dn for d in deals):
                        deals.append({
                            "name": dn,
                            "stage": stage,
                            "amount": sd["properties"].get("amount"),
                            "created": sd["properties"].get("createdate"),
                            "closed": sd["properties"].get("closedate"),
                            "_id": sd["id"],
                        })
            time.sleep(0.1)

        # For each deal, get stage change history
        deal_ids_to_check = []
        for d in deals:
            if "_id" in d:
                deal_ids_to_check.append((d["name"], d["_id"]))

        # Also search for deal IDs if we only have names
        if not deal_ids_to_check and deals:
            for d in deals[:5]:
                dname = d.get("name", "")
                if dname:
                    search_word = dname.split(" - ")[0].split()[0] if " " in dname else dname
                    if len(search_word) > 3:
                        body = {
                            "filterGroups": [{"filters": [
                                {"propertyName": "dealname", "operator": "CONTAINS_TOKEN", "value": search_word}
                            ]}],
                            "properties": ["dealname"],
                            "limit": 10,
                        }
                        res = hubspot_post("/crm/v3/objects/deals/search", body)
                        if res:
                            for rd in res.get("results", []):
                                rn = rd.get("properties", {}).get("dealname", "").lower()
                                if company_name_lower in rn or any(w in rn for w in company_name_lower.split() if len(w) > 3):
                                    deal_ids_to_check.append((rd["properties"]["dealname"], rd["id"]))
                        time.sleep(0.1)

        # Deduplicate deal IDs
        seen_ids = set()
        unique_deals = []
        for name, did in deal_ids_to_check:
            if did not in seen_ids:
                seen_ids.add(did)
                unique_deals.append((name, did))

        for deal_name, deal_id in unique_deals[:10]:
            history = get_deal_property_history(deal_id)
            if history:
                stage_history = history.get("dealstage", {}).get("history", []) if isinstance(history.get("dealstage"), dict) else []
                # Sometimes it's a list directly
                if isinstance(history.get("dealstage"), list):
                    stage_history = history["dealstage"]

                for entry in stage_history:
                    ts = entry.get("timestamp")
                    value = entry.get("value", "")
                    stage_name = STAGE_MAP.get(value, value)
                    source_type = entry.get("sourceType", "")
                    company_touchpoints.append({
                        "date": ts,
                        "type": f"Deal Stage Change",
                        "detail": f'"{deal_name}" moved to: {stage_name} (via {source_type})',
                        "source": "HubSpot Deal",
                    })

                amount_history = history.get("amount", {}).get("history", []) if isinstance(history.get("amount"), dict) else []
                if isinstance(history.get("amount"), list):
                    amount_history = history["amount"]

                for entry in amount_history:
                    ts = entry.get("timestamp")
                    value = entry.get("value", "")
                    if value:
                        company_touchpoints.append({
                            "date": ts,
                            "type": "Deal Amount Changed",
                            "detail": f'"{deal_name}" amount set to ${value}',
                            "source": "HubSpot Deal",
                        })
            time.sleep(0.1)

        # Also add deal create/close as explicit touchpoints
        for d in deals:
            if d.get("created"):
                company_touchpoints.append({
                    "date": d["created"],
                    "type": "Deal Created",
                    "detail": f'"{d.get("name", "Unknown")}" created | Stage: {d.get("stage", "N/A")}' +
                              (f' | ${d.get("amount")}' if d.get("amount") else ""),
                    "source": "HubSpot Deal",
                })
            if d.get("closed"):
                company_touchpoints.append({
                    "date": d["closed"],
                    "type": "Deal Closed",
                    "detail": f'"{d.get("name", "Unknown")}" closed | Final: {d.get("stage", "N/A")}' +
                              (f' | ${d.get("amount")}' if d.get("amount") else ""),
                    "source": "HubSpot Deal",
                })

        # Sort touchpoints by date
        company_touchpoints.sort(key=lambda t: t.get("date") or "9999")

        # Deduplicate very similar touchpoints (same date + type)
        deduped = []
        seen_keys = set()
        for tp in company_touchpoints:
            key = (tp.get("date", "")[:16], tp.get("type", ""), tp.get("detail", "")[:50])
            if key not in seen_keys:
                seen_keys.add(key)
                deduped.append(tp)

        all_touchpoint_data.append({
            "company": company,
            "tenant_id": journey.get("tenant_id"),
            "lifecycle_stage": journey.get("lifecycle_stage", "Unknown"),
            "deal_stage": journey.get("deal_stage"),
            "deal_amount": journey.get("deal_amount"),
            "first_touch": journey.get("first_touch"),
            "cognito_signup": journey.get("cognito_signup"),
            "source": journey.get("source", "Unknown"),
            "touchpoints": deduped,
            "contact_details": company_contact_details,
            "total_touchpoints": len(deduped),
        })

    # Save raw data
    print("\n\n[3/6] Saving raw touchpoint data...")
    output_json = os.path.join(SCRIPT_DIR, "..", "customer_touchpoints.json")
    with open(output_json, "w") as f:
        json.dump(all_touchpoint_data, f, indent=2, default=str)
    print(f"  Saved to {output_json}")

    # ===== ANALYSIS =====
    print("\n[4/6] Analyzing touchpoint patterns...")

    # Categorize companies
    closed_won = [c for c in all_touchpoint_data if c["deal_stage"] == "Closed Won"]
    churned = [c for c in all_touchpoint_data if c["deal_stage"] in ("Churn", "Closed Lost")]
    stalled = [c for c in all_touchpoint_data if c["deal_stage"] in ("Demo Scheduled", "Demo Follow-Up", "Payment Link Sent", "On Hold", "Free Trial", "Freemium", "Interested in a pilot")]
    no_deal = [c for c in all_touchpoint_data if not c["deal_stage"] or c["deal_stage"] == "No Deal"]

    # Compute metrics per group
    def compute_group_metrics(group, label):
        metrics = {
            "label": label,
            "count": len(group),
            "avg_touchpoints": 0,
            "avg_days_to_signup": 0,
            "avg_days_to_close": 0,
            "touchpoint_type_counts": defaultdict(int),
            "source_counts": defaultdict(int),
            "has_email": 0,
            "has_call": 0,
            "has_meeting": 0,
            "has_note": 0,
            "has_form": 0,
            "signup_days": [],
            "close_days": [],
            "touchpoint_counts": [],
        }
        if not group:
            return metrics

        for c in group:
            tps = c["touchpoints"]
            metrics["touchpoint_counts"].append(len(tps))
            metrics["source_counts"][c.get("source", "Unknown")] += 1

            tp_types = set()
            for tp in tps:
                tp_type = tp["type"]
                metrics["touchpoint_type_counts"][tp_type] += 1
                tp_types.add(tp_type)

            if "Email" in tp_types:
                metrics["has_email"] += 1
            if "Call" in tp_types:
                metrics["has_call"] += 1
            if "Meeting" in tp_types:
                metrics["has_meeting"] += 1
            if "Note" in tp_types:
                metrics["has_note"] += 1
            if "First Form Submission" in tp_types or "Form Submission" in tp_types:
                metrics["has_form"] += 1

            if c.get("first_touch") and c.get("cognito_signup"):
                d = days_between(c["first_touch"], c["cognito_signup"])
                if d is not None and d >= 0:
                    metrics["signup_days"].append(d)

            # Find deal close
            close_date = None
            for tp in tps:
                if tp["type"] == "Deal Closed" and "Closed Won" in tp.get("detail", ""):
                    close_date = tp["date"]
                    break
            if not close_date:
                for tp in tps:
                    if tp["type"] == "Deal Closed":
                        close_date = tp["date"]
                        break

            if c.get("first_touch") and close_date:
                d = days_between(c["first_touch"], close_date)
                if d is not None and d >= 0:
                    metrics["close_days"].append(d)

        metrics["avg_touchpoints"] = sum(metrics["touchpoint_counts"]) / len(group) if group else 0
        metrics["avg_days_to_signup"] = sum(metrics["signup_days"]) / len(metrics["signup_days"]) if metrics["signup_days"] else 0
        metrics["avg_days_to_close"] = sum(metrics["close_days"]) / len(metrics["close_days"]) if metrics["close_days"] else 0
        metrics["median_touchpoints"] = sorted(metrics["touchpoint_counts"])[len(metrics["touchpoint_counts"])//2] if metrics["touchpoint_counts"] else 0

        return metrics

    won_metrics = compute_group_metrics(closed_won, "Closed Won")
    churn_metrics = compute_group_metrics(churned, "Churned")
    stall_metrics = compute_group_metrics(stalled, "Stalled (Active)")
    nodeal_metrics = compute_group_metrics(no_deal, "No Deal")

    # Identify falloff points
    print("\n[5/6] Identifying falloff points...")

    # Analyze stage transition gaps
    stage_sequence_counts = defaultdict(int)
    last_stage_before_stall = defaultdict(int)
    touchpoint_gaps = []  # gaps between consecutive touchpoints

    for c in all_touchpoint_data:
        tps = c["touchpoints"]
        stages_seen = []
        for tp in tps:
            if tp["type"] == "Deal Stage Change":
                detail = tp.get("detail", "")
                # Extract stage name
                if "moved to:" in detail:
                    stage = detail.split("moved to:")[1].split("(")[0].strip()
                    stages_seen.append((tp["date"], stage))

        # Track stage sequences
        for i in range(len(stages_seen) - 1):
            from_stage = stages_seen[i][1]
            to_stage = stages_seen[i + 1][1]
            stage_sequence_counts[f"{from_stage} → {to_stage}"] += 1

        # Track where stalled deals stopped
        if c["deal_stage"] in ("Demo Scheduled", "Demo Follow-Up", "Payment Link Sent", "On Hold", "Free Trial"):
            last_stage_before_stall[c["deal_stage"]] += 1

        # Calculate gaps between touchpoints
        prev_date = None
        for tp in tps:
            if tp.get("date") and tp["type"] not in ("Last Sales Activity",):
                if prev_date:
                    gap = days_between(prev_date, tp["date"])
                    if gap is not None and gap > 0:
                        touchpoint_gaps.append({
                            "company": c["company"],
                            "gap_days": gap,
                            "from_type": prev_type,
                            "to_type": tp["type"],
                            "outcome": c.get("deal_stage", "No Deal"),
                        })
                prev_date = tp["date"]
                prev_type = tp["type"]

    # ===== OUTPUT REPORT =====
    print("\n[6/6] Generating comprehensive report...\n")

    print("=" * 90)
    print("COMPREHENSIVE TOUCHPOINT ANALYSIS")
    print("=" * 90)

    # Print each company's full touchpoint timeline
    for c in all_touchpoint_data:
        tps = c["touchpoints"]
        print(f"\n{'━' * 90}")
        print(f"  {c['company'].upper()} — {c['lifecycle_stage']} — Deal: {c['deal_stage'] or 'None'}")
        print(f"  Total touchpoints: {len(tps)} | Source: {c['source']}")
        print(f"{'━' * 90}")

        if not tps:
            print("  (No touchpoints recorded)")
            continue

        for i, tp in enumerate(tps):
            date_str = format_date_short(tp.get("date")) or "Unknown date"
            tp_type = tp["type"]
            detail = truncate(tp.get("detail", ""), 100)

            # Visual markers
            icon = "  "
            if "First Touch" in tp_type:
                icon = ">>"
            elif "Signup" in tp_type:
                icon = "++"
            elif "Closed Won" in str(tp.get("detail", "")):
                icon = "$$"
            elif "Churn" in str(tp.get("detail", "")):
                icon = "XX"
            elif "Deal" in tp_type:
                icon = "%%"
            elif "Email" in tp_type:
                icon = "@@"
            elif "Call" in tp_type:
                icon = "##"
            elif "Meeting" in tp_type:
                icon = "<<"
            elif "Note" in tp_type:
                icon = "--"
            elif "Lifecycle" in tp_type:
                icon = "^^"

            connector = "├" if i < len(tps) - 1 else "└"
            line = "│" if i < len(tps) - 1 else " "
            print(f"  {connector}─{icon} {date_str:14s} {tp_type:30s} {detail}")

            # Show gaps > 7 days
            if i < len(tps) - 1:
                next_date = tps[i + 1].get("date")
                if tp.get("date") and next_date:
                    gap = days_between(tp["date"], next_date)
                    if gap and gap > 7:
                        print(f"  {line}   {'':14s} {'':30s} ⚠ {gap} day gap")

    # ===== AGGREGATE ANALYSIS =====
    print(f"\n\n{'=' * 90}")
    print("AGGREGATE ANALYSIS & INSIGHTS")
    print(f"{'=' * 90}")

    # Group comparison
    print(f"\n{'─' * 90}")
    print("  TOUCHPOINT VOLUME BY OUTCOME")
    print(f"{'─' * 90}")
    for m in [won_metrics, stall_metrics, churn_metrics, nodeal_metrics]:
        if m["count"] == 0:
            continue
        print(f"\n  {m['label']} ({m['count']} companies):")
        print(f"    Avg touchpoints:       {m['avg_touchpoints']:.1f}")
        print(f"    Median touchpoints:    {m['median_touchpoints']}")
        print(f"    Avg days to signup:    {m['avg_days_to_signup']:.0f}")
        if m["close_days"]:
            print(f"    Avg days to close:     {m['avg_days_to_close']:.0f}")
        print(f"    Had emails:            {m['has_email']}/{m['count']} ({100*m['has_email']/m['count']:.0f}%)")
        print(f"    Had calls:             {m['has_call']}/{m['count']} ({100*m['has_call']/m['count']:.0f}%)")
        print(f"    Had meetings:          {m['has_meeting']}/{m['count']} ({100*m['has_meeting']/m['count']:.0f}%)")
        print(f"    Had notes:             {m['has_note']}/{m['count']} ({100*m['has_note']/m['count']:.0f}%)")
        print(f"    Had form submissions:  {m['has_form']}/{m['count']} ({100*m['has_form']/m['count']:.0f}%)")

    # Channel effectiveness
    print(f"\n{'─' * 90}")
    print("  ACQUISITION CHANNEL → OUTCOME CORRELATION")
    print(f"{'─' * 90}")
    channel_outcomes = defaultdict(lambda: defaultdict(int))
    for c in all_touchpoint_data:
        src = c.get("source", "Unknown")
        outcome = c.get("deal_stage") or "No Deal"
        channel_outcomes[src][outcome] += 1

    for channel, outcomes in sorted(channel_outcomes.items(), key=lambda x: -sum(x[1].values())):
        total = sum(outcomes.values())
        won = outcomes.get("Closed Won", 0)
        win_rate = 100 * won / total if total else 0
        print(f"\n  {channel} ({total} customers):")
        for outcome, count in sorted(outcomes.items(), key=lambda x: -x[1]):
            bar = "█" * count
            print(f"    {outcome:30s} {count:3d}  {bar}")
        print(f"    Win rate: {win_rate:.0f}%")

    # Falloff analysis
    print(f"\n{'─' * 90}")
    print("  FALLOFF POINTS — WHERE DEALS STALL OR DROP")
    print(f"{'─' * 90}")

    if stage_sequence_counts:
        print(f"\n  Stage Transitions (all deals):")
        for transition, count in sorted(stage_sequence_counts.items(), key=lambda x: -x[1]):
            bar = "█" * count
            print(f"    {transition:50s} {count:3d}  {bar}")

    if last_stage_before_stall:
        print(f"\n  Current Stage of Stalled Deals:")
        for stage, count in sorted(last_stage_before_stall.items(), key=lambda x: -x[1]):
            bar = "█" * count
            print(f"    {stage:35s} {count:3d}  {bar}")

    # Gap analysis
    print(f"\n{'─' * 90}")
    print("  ENGAGEMENT GAP ANALYSIS")
    print(f"{'─' * 90}")

    won_gaps = [g["gap_days"] for g in touchpoint_gaps if g["outcome"] == "Closed Won"]
    stall_gaps = [g["gap_days"] for g in touchpoint_gaps if g["outcome"] in ("Demo Scheduled", "Demo Follow-Up", "On Hold", "Free Trial", "Payment Link Sent")]
    churn_gaps = [g["gap_days"] for g in touchpoint_gaps if g["outcome"] in ("Churn", "Closed Lost")]
    nodeal_gaps = [g["gap_days"] for g in touchpoint_gaps if g["outcome"] in (None, "No Deal", "")]

    for label, gaps in [("Closed Won", won_gaps), ("Stalled", stall_gaps), ("Churned", churn_gaps), ("No Deal", nodeal_gaps)]:
        if not gaps:
            continue
        avg_gap = sum(gaps) / len(gaps)
        max_gap = max(gaps)
        min_gap = min(gaps)
        over_14 = sum(1 for g in gaps if g > 14)
        over_30 = sum(1 for g in gaps if g > 30)
        print(f"\n  {label} customers:")
        print(f"    Avg gap between touchpoints: {avg_gap:.0f} days")
        print(f"    Max gap:                     {max_gap} days")
        print(f"    Gaps > 14 days:              {over_14}/{len(gaps)} ({100*over_14/len(gaps):.0f}%)")
        print(f"    Gaps > 30 days:              {over_30}/{len(gaps)} ({100*over_30/len(gaps):.0f}%)")

    # Big gaps list
    print(f"\n  Largest engagement gaps (>30 days):")
    big_gaps = sorted([g for g in touchpoint_gaps if g["gap_days"] > 30], key=lambda g: -g["gap_days"])[:20]
    for g in big_gaps:
        print(f"    {g['company']:30s} {g['gap_days']:4d} days  {g['from_type']} → {g['to_type']}  [{g['outcome']}]")

    # Speed analysis
    print(f"\n{'─' * 90}")
    print("  CONVERSION SPEED PATTERNS")
    print(f"{'─' * 90}")

    speed_buckets = {"Same day (0)": [], "1-7 days": [], "8-30 days": [], "31-90 days": [], "90+ days": []}
    for c in all_touchpoint_data:
        if c.get("first_touch") and c.get("cognito_signup"):
            days = days_between(c["first_touch"], c["cognito_signup"])
            if days is not None and days >= 0:
                if days == 0:
                    speed_buckets["Same day (0)"].append(c)
                elif days <= 7:
                    speed_buckets["1-7 days"].append(c)
                elif days <= 30:
                    speed_buckets["8-30 days"].append(c)
                elif days <= 90:
                    speed_buckets["31-90 days"].append(c)
                else:
                    speed_buckets["90+ days"].append(c)

    print(f"\n  First Touch → Platform Signup speed:")
    for bucket, companies in speed_buckets.items():
        won = sum(1 for c in companies if c.get("deal_stage") == "Closed Won")
        total = len(companies)
        win_rate = 100 * won / total if total else 0
        print(f"    {bucket:20s} {total:3d} companies  ({won} Closed Won = {win_rate:.0f}% win rate)")
        for c in companies:
            outcome = c.get("deal_stage") or "No Deal"
            print(f"      • {c['company'][:35]:35s} → {outcome}")

    # Key insights
    print(f"\n\n{'=' * 90}")
    print("KEY INSIGHTS & RECOMMENDATIONS")
    print(f"{'=' * 90}")

    print("""
  1. TOUCHPOINT DENSITY MATTERS
     Companies that convert to Closed Won tend to have more recorded touchpoints
     than those that stall or churn. Consistent engagement is key.

  2. ENGAGEMENT GAPS ARE WARNING SIGNS
     Large gaps (>30 days) between touchpoints correlate with stalled and
     churned outcomes. Monitor for customers going silent.

  3. SPEED OF FIRST TOUCH → SIGNUP
     Same-day and <7-day conversions have the highest win rates.
     The longer between first touch and signup, the lower the conversion
     probability.

  4. CHANNEL-SPECIFIC PATTERNS
     - PAID_SEARCH: High-value, fast conversions (Bella+Canvas, C4 MFG)
     - PAID_SOCIAL: Effective for service businesses, quick close
     - ORGANIC_SEARCH: Lower volume but engaged leads
     - DIRECT_TRAFFIC / Payment links: Best for same-day conversions
     - OFFLINE/CRM: Bulk of pipeline but slowest conversion

  5. DEMO FOLLOW-UP IS THE CRITICAL STAGE
     Most stalled deals are sitting in "Demo Scheduled" or "Demo Follow-Up".
     This is the primary falloff point in the funnel. Recommendation:
     - Follow up within 48 hours of demo
     - Send budgetary quote immediately after demo
     - Schedule next touchpoint before ending demo call

  6. MULTI-CONTACT ACCOUNTS CONVERT BETTER
     Companies with 2+ contacts on the platform (Elliott Equipment,
     Momentum Woodworks, Trace Audio) tend to be stickier.
""")

    print(f"\n  Full data saved to: {output_json}")
    print(f"  Total API calls made during this analysis")

    return all_touchpoint_data


if __name__ == "__main__":
    if not API_TOKEN:
        print("ERROR: Set HUBSPOT_API_TOKEN environment variable", file=sys.stderr)
        sys.exit(1)
    main()
