# Design notes (M0)

**Mockup:** [mockup-v1.html](mockup-v1.html), a clickable prototype with sample data. Open it in a browser. Published privately at https://claude.ai/artifact/AFwvkCJppTTN68kVvXYZKG.

**Card contrast mockup:** [mockup-contrast.html](mockup-contrast.html), the same prototype with a *Card contrast* dial (16 Nov 2026, approved; now in Settings > Look).

## Goal

Understand your money **without effort**: where you stand, where it went, and who owes whom, each readable at a glance.

## Inspiration (outside budgeting apps)

| Source | What we borrowed |
|---|---|
| Health and fitness dashboards | **Summary first:** one big number at the top, then small cards that open into detail |
| Splitwise (bill splitting) | **Who owes whom:** red/green with words ("you owe", "owes you"), two tabs, a "You → Rahim" arrow, a calm "You owe nobody" state |
| Habit trackers (e.g. HabitKit) | **Calm and minimal:** strong typography, one accent colour, and a **calendar heatmap** for daily spending |
| Weather apps | **Plain sentences** instead of raw numbers: "You spent ৳21,430 and earned ৳85,000." |

## Principles

1. **One number first.** Home opens with *Money I have*, then net worth after loans.
2. **Sentences over tables.** Key facts are written as short sentences.
3. **Colour means something.** Red = money out or owed by me, green = money in or owed to me. It's always paired with a sign (−/+) or words, never colour alone.
4. **Loans are always visible.** A Loans card on Home, a Loans tab, and progress bars.
5. **Big tap targets and one-thumb use** on phones. The ＋ button sits in the middle of the tab bar.
6. **Bangladeshi conventions:** ৳ with lakh grouping (৳1,24,500), lakh on chart axes, the week starting on Saturday, and local names (bKash, Nagad, DESCO).

## Two styles (decided 15 Nov 2026)

- **Colour (default):** soft blue accent, and a colour per category (validated for colour-blind readability in light and dark).
- **Ink:** black and white. Colour only for meaning (red/green).

Users switch in **Settings → Style**. Both come in light, dark and auto.

## Layout (decided 15 Nov 2026)

- **Phone:** a single column with the bottom tab bar. Approved as is, apart from small spacing polish during build.
- **Wide (PC):** uses the **full screen width**, with a sidebar plus two columns, or three columns from 1280 px:
  - Home: totals, month and loans | recent entries | all accounts
  - Stats: categories | charts | daily heatmap
  - History: filters on the left, list on the right
  - Loans and Accounts: card grids
- **Login and setup on wide screens:** a split card, with a brand panel (or setup steps) on the left and the form on the right.
