# Free-tier limits

Checked: 2026-10-05
Refresh when older than about a month: the starter sends doc-brown to re-check before using it.

Every row comes from the vendor's own pricing or docs page, read on 2026-10-05. Rows marked *(secondhand)* or *(not stated)* are flagged where the vendor page was silent. Columns: limit · value · what happens when you hit it · source · date read.

## Supabase (Free plan)

| Limit | Value | When you hit it | Source | Read |
|---|---|---|---|---|
| Active free projects | 2. The pricing page says "per organization", but the billing docs say the limit "applies across all organizations where you are an Owner or Administrator". If an org has several owners/admins, their quotas count together | You can't launch a third active project. Paused projects don't count toward the limit | https://supabase.com/docs/guides/platform/billing-on-supabase · https://supabase.com/docs/guides/platform/billing-faq · https://supabase.com/pricing | 2026-10-05 |
| Inactivity pause | "paused after 1 week of inactivity" | Project paused. You restore it from the dashboard | https://supabase.com/pricing | 2026-10-05 |
| Database size | 500 MB per project | Grace period, then restrictions. Read-only database is one of them | https://supabase.com/pricing · https://supabase.com/docs/guides/platform/billing-faq | 2026-10-05 |
| File storage | 1 GB | Grace period, then restrictions | https://supabase.com/pricing | 2026-10-05 |
| Egress | 5 GB (plus 5 GB cached egress) | Grace period, then restrictions | https://supabase.com/pricing | 2026-10-05 |
| Monthly active users | 50,000 | Grace period, then restrictions | https://supabase.com/pricing | 2026-10-05 |
| Edge Function invocations | 500,000 / month | Grace period, then restrictions | https://supabase.com/pricing | 2026-10-05 |
| Realtime | 200 concurrent connections, 2 million messages / month | Grace period, then restrictions | https://supabase.com/pricing | 2026-10-05 |
| Over-quota restrictions (all rows above) | You get notified first. After a grace period of unstated length, the fair use policy can pause projects, make databases read-only, or return 402 on all API requests. Restrictions lift when the quota refills next cycle. There is no second grace period | Restricted, not billed | https://supabase.com/docs/guides/platform/billing-faq | 2026-10-05 |

Cheapest way out: Pro, "from $25/month" per org. A second org does NOT give you more free projects, because the limit follows the owner/admin across orgs. The free alternative is to pause a project you aren't using.

## Vercel (Hobby)

| Limit | Value | When you hit it | Source | Read |
|---|---|---|---|---|
| Commercial use | "Our Hobby plan is for personal, non-commercial use" | Any commercial project needs Pro | https://vercel.com/pricing · https://vercel.com/docs/plans/hobby | 2026-10-05 |
| Fast Data Transfer (bandwidth) | 100 GB / month | Feature paused. "In most cases" you wait 30 days | https://vercel.com/docs/plans/hobby | 2026-10-05 |
| Fast Origin Transfer | 10 GB / month | Paused, wait 30 days | https://vercel.com/docs/plans/hobby | 2026-10-05 |
| CDN requests | 1,000,000 / month | Paused, wait 30 days | https://vercel.com/docs/plans/hobby | 2026-10-05 |
| Function invocations | 1,000,000 / month | Paused, wait 30 days | https://vercel.com/docs/plans/hobby | 2026-10-05 |
| Active CPU / provisioned memory | 4 CPU-hrs / 360 GB-hrs per month | Paused, wait 30 days | https://vercel.com/docs/plans/hobby | 2026-10-05 |
| Function max duration | 300 s | Function times out | https://vercel.com/docs/plans/hobby | 2026-10-05 |
| Image transformations | 5,000 / month | Paused, wait 30 days | https://vercel.com/docs/plans/hobby | 2026-10-05 |
| Deployments | 100 / day, 100 builds / hour, 1 concurrent build, 45 min per build | Blocked until the window resets. A build past 45 min fails | https://vercel.com/docs/limits | 2026-10-05 |
| Projects | 200 | Can't create more | https://vercel.com/docs/limits | 2026-10-05 |
| Git org repos | A Hobby team can't connect repos owned by a Git organization | Blocked. Needs a team (Pro) | https://vercel.com/docs/limits | 2026-10-05 |

Cheapest way out: Pro at $20/month per developer seat, which includes $20 of usage credit, with on-demand billing after that. A static-only site could also move to Cloudflare Pages, where static requests are free and unlimited.

## GitHub Actions (GitHub Free account)

| Limit | Value | When you hit it | Source | Read |
|---|---|---|---|---|
| Public repos, standard hosted runners | Free, no minute cap | n/a | https://docs.github.com/en/billing/concepts/product-billing/github-actions | 2026-10-05 |
| Private repos, minutes | 2,000 / month | Blocked if there's no payment method. Billed if there is one | same | 2026-10-05 |
| Private repos, artifact storage | 500 MB | Same as above | same | 2026-10-05 |
| Runner cost after quota | Linux $0.006/min, Windows $0.010/min, macOS $0.062/min | Billed (needs a payment method) | same | 2026-10-05 |

Cheapest way out: make the repo public (free minutes), or keep CI on Linux runners only. Otherwise add a payment method with a budget and pay $0.006 per Linux minute. Paid GitHub plans with bigger minute bundles exist, but their current prices were not checked here.

## Resend (Free)

| Limit | Value | When you hit it | Source | Read |
|---|---|---|---|---|
| Emails per day | 100 (sent and received both count, as does each recipient) | Blocked: HTTP 429 `daily_quota_exceeded`. Resets at midnight UTC | https://resend.com/docs/knowledge-base/account-quotas-and-limits · https://resend.com/docs/api-reference/errors | 2026-10-05 |
| Emails per month | 3,000 | Blocked: HTTP 429 `monthly_quota_exceeded` | same | 2026-10-05 |
| Verified domains | 3 | Can't add more *(consequence not stated, but implied)* | https://resend.com/pricing | 2026-10-05 |
| API rate | 10 requests / second | Rate-limited (429) | https://resend.com/docs/knowledge-base/account-quotas-and-limits | 2026-10-05 |
| Data retention | 30 days | Older logs dropped | https://resend.com/pricing | 2026-10-05 |

Cheapest way out: Pro at $20/month for 50,000 emails, then $0.90 per 1,000. Pro has no daily cap listed. To stay free longer, batch notifications into a digest so you stay under 100/day.

## Cloudflare (Workers and Pages, Free)

| Limit | Value | When you hit it | Source | Read |
|---|---|---|---|---|
| Workers requests | 100,000 / day, resets at midnight UTC | Blocked: Error 1027 until reset | https://developers.cloudflare.com/workers/platform/limits/ | 2026-10-05 |
| Workers CPU | 10 ms per request | Request fails | same | 2026-10-05 |
| Subrequests | 50 per request | Further subrequests fail | same | 2026-10-05 |
| Workers / cron triggers | 100 Workers, 5 cron triggers per account | Can't create more | same | 2026-10-05 |
| Static asset requests | "free and unlimited" | n/a | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-10-05 |
| Pages Functions | Billed as Workers, so they count toward the 100,000 / day | As Workers | https://developers.cloudflare.com/workers/platform/pricing/ · https://developers.cloudflare.com/pages/platform/limits/ | 2026-10-05 |
| Pages builds | 500 / month, 1 at a time, 20 min timeout | Blocked *(consequence not stated)* | https://developers.cloudflare.com/pages/platform/limits/ | 2026-10-05 |
| Pages files | 20,000 files per site, 25 MiB per file | Deploy fails *(consequence not stated)* | same | 2026-10-05 |
| Pages projects / domains | 100 projects per account, 100 custom domains per project | Can't add more | same | 2026-10-05 |
| KV (free) | 100,000 reads / day, 1,000 writes / day, 1 GB | Operations fail until reset | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-10-05 |
| D1 (free) | 5 million row reads / day, 100,000 row writes / day, 5 GB | Operations fail until reset | same | 2026-10-05 |

Cheapest way out: Workers Paid, $5/month minimum, with 10 million requests a month included, then $0.30 per million. That one plan also covers Pages Functions.

## Netlify (Free, credit-based)

| Limit | Value | When you hit it | Source | Read |
|---|---|---|---|---|
| Credits | 300 / month, hard limit, no auto-recharge | Sites paused until the next billing cycle | https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/ | 2026-10-05 |
| Bandwidth | 20 credits per GB (about 15 GB/month if credits went to nothing else) | Uses up credits | same · https://www.netlify.com/pricing/ | 2026-10-05 |
| Production deploys | 15 credits each (about 20/month if credits went to nothing else) | Uses up credits | same | 2026-10-05 |
| Web requests | 2 credits per 10,000 | Uses up credits | same | 2026-10-05 |
| Functions compute | 10 credits per GB-hour | Uses up credits | same | 2026-10-05 |
| Legacy Free (accounts before 2025-09-04 only) | 100 GB bandwidth, 300 build minutes / month. Switching to credits can't be undone | n/a for new accounts | same | 2026-10-05 |

Cheapest way out: Personal at $9/month for 1,000 credits, with optional auto-recharge of 500 credits for $5. Deploys cost credits, so on Free, deploy from main only, not every push.

## Not stated by the vendor (re-check on refresh)

- Supabase: how long the over-quota grace period lasts.
- Resend: what happens at the domain cap on Free.
- Cloudflare Pages: what happens at the build and file limits.
- GitHub: current prices of paid plans with bigger minute bundles.
