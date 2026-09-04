---
name: central-registry-workday-sync
description: Compare the app's central employee registry against Workday to find new hires or data-quality issues for one Havas entity (e.g. Havas International Paris / company code HIP), then add confirmed new hires with their manager link. Use when asked to check Workday for new arrivals, update/reconcile the central registry, or verify a company code's headcount against HR.
---

# Central registry ↔ Workday reconciliation

Established 2026-09-04 doing exactly this for company code `HIP` (Havas
International Paris, tree under Thierry Joly / Léa Furio). The naive approach
(one Workday header-search string vs. the registry) undercounts badly and
produces misleading "missing" lists — every gotcha below was hit for real that
session.

## What the central registry actually is

Not a dedicated table. It's the `org_charts` row with `is_registry = true`
(id `e53b8650-0d48-47e1-b9f3-15465608b329` in this project — confirm with the
query below rather than hard-coding it blindly if this drifts), and its
"members" are ordinary `employees` rows scoped to that `org_chart_id`. Key
columns: `first_name, last_name, job_title, department, company,
has_left_company`. `company` is a short internal code (`HIP`, `HMF`, `HMK`,
`Play`, `City`, `HBS`, `COE`, `Arena`, `FWD`, …), **not** a Workday org name —
map the user's "which entity" answer to a `company` value first via:

```sql
select company, count(*)
from employees e join org_charts oc on oc.id = e.org_chart_id
where oc.is_registry = true group by company order by count(*) desc;
```

Pull the full roster for one code with `has_left_company` included (don't
filter it out — you need it to interpret "missing from Workday" correctly,
see below):

```sql
select e.first_name, e.last_name, e.job_title, e.department, e.has_left_company
from employees e join org_charts oc on oc.id = e.org_chart_id
where oc.is_registry = true and e.company = 'HIP'
order by e.has_left_company, e.last_name, e.first_name;
```

## Do not trust a single Workday org-name search as the full roster

The obvious move — search Workday's header for the entity's display name
(e.g. `HM-International-Paris`) and treat the result count as "everyone" —
undercounted by roughly a third in the measured case (70 found vs. 96 in the
registry, including departures). Confirmed root causes, all real and all
worth checking before concluding someone is "missing":

1. **A manager who leads a sub-org named `<Entity> (Their Name)` does not
   themselves appear in that search.** Their own position sits in the
   *parent* org one level up. Hit for the CEO of the whole entity and for at
   least two team leads. If a name is missing, open their profile directly
   (search their name) and read `Supervisory Organization` — don't conclude
   absence from a bulk org-name search alone.
2. **Shared/central-function staff** (Finance business partners, a
   cross-entity "Team Connectée"-style group) sit in a shared functional org,
   not the entity's own tree, even though their job title carries the
   entity's tag (e.g. `(HI)`). They are legitimately part of the entity's
   headcount but invisible to an org-name text search.
3. **The same entity can have more than one org-name label.** `HM-HIP` turned
   out to be a second, parallel label for people who should logically fall
   under `HM-International-Paris` — some managers' teams used one, some the
   other. Search every label variant you can find (autocomplete the base
   entity name and read every suggestion, not just the first).
4. **Label collision is not proof of membership either.** Someone can surface
   under a plausible-looking label search while genuinely belonging to an
   unrelated entity (confirmed once: a person surfaced under `HM-HIP` whose
   real `Supervisory Organization` was a completely different agency). Open
   the individual profile and read the real org before accepting a match.
5. **Full-name text search silently returns zero results for some real,
   current employees** — hyphenated first names, some accented surnames. On
   a genuine `0 result`, retry with the surname alone (bare, no first name)
   before concluding the person isn't in Workday at all.

## The actual procedure

1. Get the registry roster for the target `company` code (query above),
   including `has_left_company`.
2. Search Workday for the entity under every org-name label variant you can
   find (autocomplete on the base name, read all suggestions — don't stop at
   the first).
3. For every registry name **not** found by name-only search: open their
   individual Workday profile before writing them off. Check
   `Supervisory Organization` and `Manager`. If the name search returned zero
   hits, retry surname-only. A `has_left_company = true` row that still comes
   up genuinely active in Workday is a real anomaly worth flagging to the
   user, not silently "fixing" — Workday may simply not have processed an
   already-effective departure yet; ask before changing the flag.
4. For every Workday hit **not** in the registry roster: before treating it
   as a new-hire candidate, open their profile and confirm `Supervisory
   Organization` genuinely belongs to the target entity (see gotcha 4 above).
5. Report the reconciled list to the user: confirmed new hires, anomalies
   (flag mismatches, pre-hire-only records, unfindable names), and ask before
   writing anything.

## Adding a confirmed new hire

Find their Workday `Manager`, confirm that manager already exists in the
registry roster (search by last name in the same `company` scope) — if not,
stop and tell the user rather than guessing a manager. Then:

```sql
insert into employees (first_name, last_name, job_title, department, company, org_chart_id)
values ('First', 'Last', '<workday job title>', '<managers department>', 'HIP',
        'e53b8650-0d48-47e1-b9f3-15465608b329')
returning id;

insert into reporting_relationships (employee_id, manager_id, is_primary, org_chart_id)
values ('<new id>', '<manager id>', true, 'e53b8650-0d48-47e1-b9f3-15465608b329');
```

`department` has no reliable Workday equivalent to copy directly — default it
to the manager's own `department` value (new hires normally join their
manager's team) rather than leaving it null or guessing from the Workday job
title.

## Photos for a newly added employee

Try [[workday-employee-photos]] first — no homonym risk, since Workday's
"1 Result" already confirms identity. Fall back to [[linkedin-profile-access]]
only with its full employer-verification step; do not accept a name-only
match. A brand-new hire (especially an intern) very often has **no** photo in
either source yet — that's a normal outcome, not a failure to keep digging on.
Report it as "no photo available" and move on rather than spending many
LinkedIn guesses on one low-stakes case; ask the user for a URL if they want
one badly enough to spend their own time on it.

## Related

[[workday-employee-photos]] and [[linkedin-profile-access]] cover the photo
side once someone's identity is settled. This skill is only about *finding
and confirming who's new or mismatched* — never chain straight into a photo
fetch without the manager-link + confirmation step above.
