This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Apple Pay (Stripe domain verification)

Stripe Apple Pay domain verification requires a file to be served at:

`/.well-known/apple-developer-merchantid-domain-association`

This project serves it from an App Route:

`src/app/.well-known/apple-developer-merchantid-domain-association/route.ts`

Set this environment variable in Vercel (Production) with the exact file contents provided by Stripe:

`APPLE_PAY_DOMAIN_ASSOCIATION`

If your platform has issues with multiline env vars, set a base64-encoded value instead:

`APPLE_PAY_DOMAIN_ASSOCIATION_B64`

## Stripe Webhook (recommended)

This project supports server-side, idempotent purchase fulfillment via a Stripe webhook:

Endpoint:

`/api/stripe/webhook`

Add this environment variable in Vercel (Production, Preview, Development):

`STRIPE_WEBHOOK_SECRET`

In Stripe Dashboard, create a Webhook Endpoint pointing to:

`https://mestrygames.com/api/stripe/webhook`

Subscribe at least to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

## Admin coins panel

Open:

`/admin/coins`

Allow access by setting one of these environment variables in Vercel:

- `ADMIN_EMAIL` (recommended)
- `ADMIN_EMAILS` (comma/space-separated)
