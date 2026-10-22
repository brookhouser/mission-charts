# Mission Charts

Phone-first morning and evening charts for Sam and Wally.

**Live site:** https://brookhouser.github.io/mission-charts/

Preview mode is on until Firebase is connected. [SETUP.md](SETUP.md) is the parent checklist for that.

## Preview mode

Open the site. Pick Sam, Wally, Kevin, or Beth. Nothing is sent anywhere. Checks, tiers, and routine edits stay in this browser.

- **Switch** leaves the chart and shows the four people again.
- **Clock** pretends the time. Useful ones: `6:32 AM · morning`, `7:40 AM · morning closed`, `4:10 PM · before dinner`, `8:02 PM · winddown`, `9:45 PM · bedtime`.
- **Use the real time** puts the clock back.
- **Reset preview data** clears this phone’s sample days and edits.

Add `?demo=1` to the address to force preview even after Firebase is configured.

Sam only sees Sam. Wally only sees Wally. Kevin and Beth see both, set the tier, and edit the charts.

## How a day moves

The chart day runs from 4:00am to 3:59am, so a late bedtime still belongs to that night.

On a school morning (Monday–Friday, unless a parent switches the day):

- Before 7:26 the morning chart is open. Out of bed by **6:40**. Ready by **7:25**.
- After 7:25 the morning is closed. Leftover morning tasks count as late.
- From 3:30pm the evening chart is the focus. For Sam, that starts with **Feed the animals** before dinner.
- After bedtime the screen says **Bedtime**.

On a day off there is no morning chart. Evening still runs, starting at noon. Wally’s **winddown** (screens off) starts 30 minutes before tonight’s bedtime.

## Tiers

Morning and evening together suggest tonight’s tier. A parent confirms it, changes it, or waives it. Kids cannot set their own.

| | On time, on your own | On time, needed reminders | Late |
| --- | --- | --- | --- |
| Sam | S · 9:30, screens until bed | A · 9:15 | B · 9:00 |
| Wally | S · 8:30, winddown 8:00 | A · 8:15, winddown 7:45 | B · 8:00, winddown 7:30 |

The app can see the clock, not the reminders:

- **S** — every step checked by its time, and the routine finished by 7:25 or bedtime.
- **A** — finished by 7:25 or bedtime, but some steps were late.
- **B** — still open after 7:25 or after bedtime.

Until a parent confirms, bedtime stays on the S time. Confirming A or B moves bedtime, and Wally’s winddown, immediately. **Waive** clears the score and keeps the S bedtime. Waived nights do not break an S streak.

The minutes between 6:40 and 7:25, and the evening offsets, are defaults so the clock can walk through the list. They are not extra rules from the paper chart. Parents can change tasks, order, sections, and times under **Routines** without editing code. Hard edges from the chart stay the defaults: out of bed by 6:40, ready by 7:25, Sam’s before-dinner feed, Wally’s by-winddown and during-winddown groups.

## Data

Firestore collections, both under the `missionCharts` prefix so other Brookhouser Family Apps can share the project:

- `missionCharts_routines/{sam|wally}_{morning|evening}`
- `missionCharts_days/{sam|wally}_{YYYY-MM-DD}`

Rules are in [`firestore.rules`](firestore.rules). Kids can read their routines and write their own check-offs. Only Kevin and Beth can set tiers, school days, or routines, and only they can read both kids.
