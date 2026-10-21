# Meezan Bank E-Commerce Gateway

Musa Traders will keep Cash on Delivery (COD) available alongside Meezan card payments. The live gateway must be enabled only after Meezan has onboarded Musa Traders as the merchant and supplied its merchant-specific integration guide and credentials.

## What Meezan must provide

Request these through the Musa Traders business account. Store all secret values only in `.env.local` for development and in the hosting provider's encrypted environment variables for staging/production.

- Merchant ID and gateway endpoint for UAT/staging and production.
- Authentication/signing credentials and the required signature algorithm.
- Allowed return URL and webhook/callback URL registration.
- Test card/payment scenarios for success, decline, cancellation and timeout.
- Transaction status-inquiry and refund/void API access, if included in the merchant agreement.
- Written confirmation of the settlement account: the Musa Traders Meezan business account.

Do not send passwords, API secrets or signing keys in chat, email, source code or `NEXT_PUBLIC_*` variables.

## Staging checklist

1. Deploy a separate staging site, for example `https://staging.musatraders.pk`, from a staging branch/project.
2. Create a separate staging Supabase project or a database copy with test-only products and users.
3. Set the staging site's `MEEZAN_GATEWAY_MODE=staging`, Meezan UAT credentials and HTTPS return/callback URLs.
4. Configure the same staging URL in Supabase Auth redirect URLs.
5. Test a successful payment, declined payment, customer cancellation, gateway timeout, duplicate callback and status inquiry.
6. Confirm that the webhook signature is verified server-side before an order is marked paid.
7. Test refund/void only when Meezan confirms that the merchant account has the required API access.

## Production release criteria

- Production merchant credentials and production callback URL are configured in hosting secrets.
- The Meezan merchant portal identifies Musa Traders as the merchant and shows the agreed Meezan business account as the settlement account.
- A controlled real transaction, status inquiry and refund/void procedure have been accepted by Musa Traders.
- COD remains enabled and checkout still calculates totals only on the server.

Meezan describes its e-commerce platform as an API-based 3DS-2 payment gateway that accepts major card schemes and offers merchant-branded checkout. Its exact request fields, signing method, URLs and test data are merchant-specific, so implementation must follow the integration guide issued to Musa Traders. See [Meezan Bank's official e-commerce gateway overview](https://www.meezanbank.com/ways-to-bank).
