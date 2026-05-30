# World Cup 2026 Prediction Pool

Private friends prediction pool for FIFA World Cup 2026 Group Stage scorelines.

## Supabase Setup

1. Open your Supabase project.
2. Go to **SQL Editor**.
3. Run the full contents of `supabase-schema.sql`.
4. Go to **Project Settings > API** and copy:
   - Project URL
   - anon public key

## Local Setup

1. Copy `config.local.example.js` to `config.local.js`.
2. Fill in your Supabase URL and anon key.
3. Serve the folder with any static web server.

The pool passcode created by the SQL script is:

```text
Fifa2026
```

## Optional Test Pool

To create a separate staging/test pool in the same Supabase project, run `add-test-pool.sql` in the Supabase SQL Editor.

That creates this passcode:

```text
Test2026
```

Use `Test2026` for fake players, test matches, and lock-timing tests. Use `Fifa2026` for the real friends pool.

## Vercel Deployment

Add these environment variables in Vercel:

```text
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_ANON_KEY=YOUR-SUPABASE-ANON-KEY
```

Then deploy the project. Friends can open the Vercel URL from desktop, laptop, or mobile and enter `Fifa2026`.

## Privacy Note

This passcode is suitable for a casual private friends pool. It is not strong security, because the browser app still uses a public Supabase anon key. Do not use this app to process payments or store sensitive personal data.
