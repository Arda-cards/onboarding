# Cognito User Provisioning (Order Pulse)

This doc covers how to ensure a Cognito user exists and is mapped to a tenant.

## Why this exists
Order Pulse resolves tenant + author data from Cognito for authenticated users. If a user email is missing from Cognito, Arda sync will fail with `TENANT_REQUIRED`.

The `create_new` tenant flow now auto-creates/updates the Cognito mapping, but you can also run it manually.

## Environment requirements
The backend uses AWS Cognito Admin APIs. These env vars must be set:

- `COGNITO_AWS_REGION` (or `AWS_REGION`)
- `COGNITO_USER_POOL_ID`
- `COGNITO_AWS_ACCESS_KEY_ID` / `COGNITO_AWS_SECRET_ACCESS_KEY`
  - or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`

## Manual CLI (local)
From `/Users/kylehenson/order-pulse/server`:

```bash
npm run cognito:ensure-user -- --email user@example.com --tenant <tenantId> --role User --name "User Name"
```

Notes:
- `--role` defaults to `User`.
- Invite emails are suppressed by default. Add `--send-invite` to email the user.
- The command updates existing users (by email) or creates new ones.

## Automatic flow (backend)
When a user selects **Create New Tenant**, the backend will:
1. Provision the tenant in Arda.
2. Create/update the Cognito user for the logged-in email.

Code path:
- `/Users/kylehenson/order-pulse/server/src/routes/arda.ts` (create_new branch)
- `/Users/kylehenson/order-pulse/server/src/services/cognito.ts` (`ensureUserMappingForEmail`)

## Troubleshooting
- `UnrecognizedClientException`: invalid AWS credentials.
- `ResourceNotFoundException`: wrong `COGNITO_USER_POOL_ID` or region.
- No mapping after sync: confirm the Cognito user exists and has `custom:tenant` set.
