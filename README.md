# High Point Deal Room

An independent, public HTML dashboard for High Point, NC 27260 property research. Visitors need no account. It is hosted on GitHub Pages; scheduled collection runs on GitHub Actions. No AI account, paid data provider or private API key is needed.

Website: https://taher5352.github.io/highpoint-deal-room-web/

## Open an individual property

Select a property address or **Open property** in the records table. Each shareable property page groups the available records for that exact county-qualified parcel ID. Code cases from other counties remain separate. The page links to the official county property record when its Guilford parcel identity is established. General publisher pages and raw case data are labeled separately.

## Update shared scenarios

Open [config/workspace.json in GitHub's editor](https://github.com/taher5352/highpoint-deal-room-web/edit/main/config/workspace.json), sign in to the repository owner's GitHub account, edit the numbers, and commit the changes. The publishing workflow validates the file and updates the website. Visitors cannot change the shared file. This version uses GitHub's file editor; it does not include a separate in-dashboard editing account.

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
python3 -m http.server 4175 --directory docs
```

Open http://localhost:4175. Filtered CSV and JSON downloads are generated in the visitor's browser. The page checks for newer published records every five minutes while visible.

The workflow uses free standard GitHub-hosted runners and Pages for this public repository. GitHub applies service limits, can delay scheduled jobs, and may disable schedules after 60 days of inactivity; recurring snapshot commits normally keep this repository active. A public research site is not a guarantee of uninterrupted service.
