# High Point Deal Room

An independent, public HTML dashboard for High Point, NC 27260 property research. Visitors need no account. It is hosted on GitHub Pages; scheduled collection runs on GitHub Actions. No AI account, paid data provider or private API key is needed.

Website: https://taher5352.github.io/highpoint-deal-room-web/

## Rough renovation estimates

Open **Renovation estimates** for three assumed repair scopes, a recorded-transfer resale benchmark and conditional purchase ceilings. Property addresses open their public-record page directly; the separate **Inspect estimate** button opens the renovation worksheet. Property, county and source links use ordinary navigation in the same tab, with the browser Back button available. The drawer shows the exact transfers used and lets visitors enter a proposed purchase price to calculate project cost, profit before income tax and return on cost. Proposed prices stay in the visitor's browser session and are not published or sent to a provider.

The default **Top 10 to investigate** view ranks the complete latest residential queue before applying the visitor's search and coverage filters. It requires a positive lower offer ceiling, at least five distinct other-parcel transfer comparisons and at least half of those transfers within the past twelve months. The twelve-month window uses the current Eastern date at publication, even when a failed source check retains an older transfer snapshot. Invalid dates, future transfers, repeated parcels and repeated deed references do not inflate the counts. These thresholds are analyst screening choices, not a calibrated probability model.

Rank is the lower offer ceiling divided by the lower resale scenario: the share of modeled resale value left for purchase after the higher repair allowance, costs and target return. Ties favor a higher recent-sale share, then more recent comparisons, more total comparisons, a later transfer and the stable property key. The fixed dollar profit target can favor higher-value properties. Changing repair scope or investment assumptions reranks the queue; an empty or shorter shortlist is retained rather than filled with properties that fail the rules. Asking prices, current condition and availability for sale are unknown, so this rank is an investigation priority, not a measured bargain or likelihood of profit. **All properties** keeps the full research queue available.

Investment assumptions, repair bands and cohort policy are owner-managed in [config/renovation.json](https://github.com/taher5352/highpoint-deal-room-web/edit/main/config/renovation.json). The legacy deal pipeline is removed from the dashboard; its historical configuration remains available for the existing Excel export. The bands are analyst scenarios within cited national remodeling ranges. They are not property-condition diagnoses or local contractor quotes; the same resale range is used across all scopes and no future appreciation is assumed. The Charlotte historical budget is explanatory context and is not a property input. Reconstruction is outside this screening model.

The **Investment assumptions** panel changes the active analysis immediately on Apply and saves those choices in that browser. Reset loads the latest published defaults. These personal changes do not edit shared data or the Excel export. The six-month baseline includes a 3% acquisition allowance, an 8% all-in selling allowance, 20% repair contingency and $750 monthly carrying allowances ($200 tax, $200 insurance, $250 utilities and $100 maintenance/security/HOA). The financed case assumes 80% of purchase at 12% annual simple interest and two origination points; repairs are cash-funded. Cash mode removes interest and points. The nine-month stress test increases holding and interest costs, with extra extension fees entered separately.

A 5% default resale safety cushion reduces each historical resale scenario once. This is a stress assumption, not a forecast or verified after-repair value. The $30,000 profit and 20% return-on-total-cost targets are screening hurdles. Loan principal is already included in purchase cost, so only interest and points are added as financing expenses. The same complete cost calculation drives ceilings, worksheet profit and the Top 10 ranking. No purchase price means no dollar profit or ROI claim.

Defaults are provisional planning inputs, with source context linked in the dashboard. Tax allowances require verification against the parcel's actual taxable assessment and jurisdiction; insurance and financing require quotes. Negotiated selling costs include transfer excise in the all-in allowance, avoiding a second charge. Repair scopes remain uninspected alternatives; extraordinary costs and title arrears are not automatically priced.

County transfer data is collected through a bounded public query. Cohorts exclude observed multi-parcel deeds across the countywide recent snapshot, unsupported building types, multiple units/buildings, inconsistent living area, nominal prices and unclear deed dates. An arm's-length flag and renovated-condition history are not supplied, so these records remain unreviewed transfer benchmarks. Related-party and other nonmarket transfers can remain. The latest actual transfer date is displayed separately from retrieval time.

Similar-property cohorts exclude the subject itself, match living area within 70–130%, bedrooms within one when known, and year built within 25 years when known. They use at least 3 same-street records, else 5 county-neighborhood records, else 10 within the ZIP, capped at 20 nearest available points. The subject's area is multiplied by the 25th/50th/75th percentile cohort price per square foot. These are historical cohort scenarios, not prediction intervals or after-repair appraisals. Missing building identity, living area or a usable cohort leaves that portion unpriced.

The scheduled publish refreshes the transfer snapshot and generated estimates at 9 AM and 4 PM Eastern. Failed queries retain the previous snapshot and expose the error. This feature is not added to the Excel workbook.

## Open an individual property

Select a property address or **Open property** in the records table. Each shareable property page groups the available records for that exact county-qualified parcel ID. Code cases from other counties remain separate. The page links to the official county property record when its Guilford parcel identity is established. General publisher pages and raw case data are labeled separately.

## Daily Excel workbook

Use **Download full Excel workbook** on the dashboard for the latest published file. It is regenerated after each scheduled record check, including current county parcel characteristics. The workbook has a property table for matched 27260 research parcels, every saved source row, source health, and separate shared scenarios. Named tables, stable property keys, typed amounts/dates, hyperlinks and filter controls support PivotTables and dashboard imports.

Photo-page links open the county property application, where the Photos tab is available. Direct photo URLs remain blank because the county display uses temporary browser image URLs. Asking prices, listing descriptions and sale intent are not supplied by these sources.

A downloaded copy is a dated snapshot and does not refresh itself. Download the latest file for each daily review; keep private notes separately keyed by Property key so a new download cannot overwrite them. The workbook is generated on GitHub using the authored Excel template, with no paid service or local Mac installation.

## Update owner defaults and historical scenarios

Change shared dashboard assumptions in [config/renovation.json](https://github.com/taher5352/highpoint-deal-room-web/edit/main/config/renovation.json). The file is validated before publication.

For the historical Excel scenarios, open [config/workspace.json in GitHub's editor](https://github.com/taher5352/highpoint-deal-room-web/edit/main/config/workspace.json), sign in to the repository owner's GitHub account, edit the numbers, and commit the changes. The publishing workflow validates the file and updates the website. Visitors cannot change the shared file. This version uses GitHub's file editor; it does not include a separate in-dashboard editing account.

All scenarios and notes in this public file are visible to everyone. Keep private contact details and credentials out of this repository.

## Automatic public-record checks

Checks are scheduled for 9 AM and 4 PM America/New_York, including daylight saving changes. GitHub schedules can be delayed. The refresh history is under this repository's **Actions** tab; select the workflow and **Run workflow** for a manual check. This works while the owner's Mac is off.

Each run collects bounded public queries or a publisher-offered download from:

- Guilford County and High Point GIS address services, using exact parcel ID agreement on property ZIP 27260.
- High Point's published code-case query service. Investigation records remain unverified complaints.
- Guilford County's public foreclosure GIS service.
- The county-linked tax download portal. The collector streams the offered CSV and keeps unpaid real-property bills only for verified target parcels.

It requests no owner names, emails or phone numbers. Temporary signed tax-download URLs stay in memory. No Zillow/Redfin scraping or private connector is used. Public availability does not establish unrestricted licensing; source attribution, access notes and limitations remain in the published dataset. Stop a collector if a publisher changes its access terms or requires authorization.

These are research signals, not confirmed off-market listings or evidence an owner will sell. Assessments are not asking prices. Tax bills can be historical or not yet legally delinquent. Records for unmatched or conflicting ZIPs remain outside the default 27260 view. Probate is not connected.

Failed source checks retain the previous successful source dataset. The page displays the error and last successful check; the workflow reports failure after publishing the retained data. Snapshot commits provide history and keep the next run from reverting to an older cached extract. Every successful deployment also copies validated shared scenarios into the published folder.

## Run locally

Requires Node 24 or later; there are no package dependencies.

```sh
node --test tests/*.test.mjs
node scripts/collect.mjs
node scripts/enrich-properties.mjs
node scripts/renovation-data.mjs
python3 -m http.server 4175 --directory docs
```

Open http://localhost:4175. Filtered CSV and JSON downloads are generated in the visitor's browser. The page checks for newer published records every five minutes while visible.

The workflow uses free standard GitHub-hosted runners and Pages for this public repository. GitHub applies service limits, can delay scheduled jobs, and may disable schedules after 60 days of inactivity; recurring snapshot commits normally keep this repository active. A public research site is not a guarantee of uninterrupted service.
