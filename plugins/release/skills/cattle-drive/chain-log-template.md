# V<first> chain log

Every UTC stamp in this log comes from `<release>/scripts/stamp.sh` (`<release>`: the wolfpack `release` plugin's installed folder), not from memory.

Conductor: `the-protagonist`, session `<conductor id>`. Started <UTC> by Alexander.
Chain: V<v1> → V<v2> → V<v3>
Stamps: V<v1> ok · V<v2> ok · V<v3> ok (`## Ready to build` in each plan)
Floors (from lessons.md, <date>): release <n>% · deploy <n>%

## Sessions (the only ones the conductor may touch)
Taken by the conductor (option b): idle, in this repo's folder, created in the last 15 minutes, no events.
Sidebar group: `chain <first>` `<group id>` | none (<why>)

| # | Title (set by the conductor) | Session id | Kind | Created | Checked |
|---|---|---|---|---|---|
| 1 | chain <first> · <v1> release | `<id>` | release | <UTC> | <UTC> ok |
| 2 | chain <first> · <v1> deploy+wrap | `<id>` | deploy+wrap | <UTC> | <UTC> ok |

Not touched: <title> `<id>` :: <why> (or none)
Arm tap (the one yes): <UTC>
Chain arm: present
Frozen-file releases (tap at their own arm): <versions> | none

## Conductor lines
<UTC> sent V<version> <kind> -> <title>
<UTC> got LINK DONE V<version> <kind> <PR url>; facts: <fields read> ok | not backed
<UTC> ignored <sender>
<UTC> WRAP-UP SKIPPED V<version> :: <reason>

## V<version> <kind>
(the link's report, appended by the link before its message; `self-wake until <UTC>` while it sleeps to the 5-hour reset)

## CHAIN DONE <UTC>
or
## CHAIN STOPPED <UTC> at V<version> <kind>
Reason:
PR: <url> <state>
Markers: absent | removed by the-protagonist
Sessions not used:
To go on:
