# Money Manager — Version 1 Specification

**Status:** ✅ **Approved** — version 1 baseline · **Date:** 15 Nov 2026

Changes after approval are recorded in the change log (section 18).

Items marked *(extra N, later)* are **not** in version 1. They're listed in section 13, to be chosen after version 1.

---

## 1. Purpose

A private, self-hosted web app to **keep a dated record of all my money**:

- what I spend and earn
- money I lend and borrow
- money I move between my own accounts

From those records it shows **balances** and **charts** that explain where the money goes.

**It is not a budgeting app.** Budgets may come in a later version. It's built for me and my family first, but **to industry standards**, so it could later be offered to friends and others.

### Design principles

1. **Simple first.** Few pages and few options. Every screen should be obvious without instructions.
2. **Fast to log.** Adding a daily expense should take under 10 seconds on a phone.
3. **Records are the truth.** Every balance and chart is calculated from entries. Nothing is typed in twice.
4. **Private by design.** Data is **end-to-end encrypted**: it's encrypted on the user's device, and the server only ever stores unreadable data (section 3).
6. **Just a website.** It's used in the normal web browser on a phone or PC. There's no app-store app; it can optionally be added to the phone's home screen.
5. **Hard to lose data.** Recovery options for forgotten passwords (3.3), deleted entries restorable for 30 days, and nightly backups kept off the VM.

---

## 2. Users and access

| Rule | Detail |
|---|---|
| Number of users | Up to ~20 (me plus family) |
| Who creates users | Only the **admin** (me), using a command-line tool on the VM (2.1). There is no public sign-up. |
| Admin is also a user | In the app, the admin's login works **exactly like any other user's**, with its own private money. There are no admin screens in v1. |
| Data privacy | Each user's data is **encrypted with their own key** (section 3). Nobody else, including the admin, can read it, unless the user chooses admin recovery (3.3). |
| Login | **Username + password.** No email address is needed. Sessions stay signed in on a device until you log out or 30 days pass without use. |
| Usernames | An ordinary name, e.g. `ayesha` or `rakib`. **Must be unique**, and uniqueness ignores capital letters (`Ayesha` and `ayesha` count as the same name). 3–30 characters: letters, numbers, dot, underscore or hyphen, with no spaces. Each user also has a **display name** shown in the app, which can be anything (e.g. "Ayesha Rahman"). |
| Passwords | At least 8 characters, with no other complexity rules. A forgotten password is handled by recovery (3.3). |
| Two-factor login | Not in v1 *(extra 9, later)*. |
| Sharing with other users | Not in v1 *(extra 10, later)*. |
| Default time zone | Asia/Dhaka |

### 2.1 Admin tasks in v1 (command line on the VM)

There are **no admin screens in the app** in v1. The admin manages users with a small command-line tool, run on the VM:

| Task | Command (example) |
|---|---|
| Set up admin recovery (once) | `npm run admin -- setup-recovery` (asks for the admin recovery phrase twice; see 3.3) |
| Create a user | `npm run admin -- create-user ayesha --display-name "Ayesha Rahman"` (refuses a username that's already taken, and prints a one-time password) |
| Recover a user | `npm run admin -- recover-user ayesha` (asks for the admin recovery phrase, then prints a temporary password; only for users who chose admin recovery) |
| Disable / enable a user | `npm run admin -- disable ayesha` · `enable ayesha` |
| Delete a user | `npm run admin -- delete-user ayesha` (asks for confirmation; erases all their data) |
| List users | `npm run admin -- list-users` (usernames, display names, recovery mode, last login; never financial data) |
| Back up now / restore | `npm run admin -- backup` · `restore <file>` |

- A **one-time password** only lets the user log in to finish setup. They must choose their own password straight away (section 5).
- The admin **cannot read users' data in the database**; it's encrypted. Problems are fixed **with the user, on their device**, or through admin recovery for users who chose it.

### 2.2 Admin mode and support access *(extra 8, later)*

*Not in v1.* The design below is kept for when it's added. **With encryption, support access only works for users who chose admin recovery, and it needs the admin recovery phrase.**

Admin powers are for **special occasions** only, e.g. fixing a problem for a less tech-savvy family member. They are kept out of everyday use.

**Normal mode (default):**
- After logging in, the admin is in **normal mode**, which looks and works **exactly like any other user's**.
- There are no admin pages, user lists or other people's data anywhere in normal mode.
- The only trace is one item at the bottom of the menu: **"Enter admin mode"**.

**Admin mode (on purpose, for a short time):**
- **Entering:** tap *Enter admin mode*, then **re-type the password** (and the 2FA code, if enabled). An open, unlocked phone alone is not enough.
- **Clearly different:** a **red bar** across the top says *"ADMIN MODE · Exit"*, and the navigation changes to admin pages only (Users, Access log, Backups).
- **Ends automatically** after **15 minutes** without activity, or immediately with **Exit**, returning to normal mode.
- **Logged:** entering and leaving admin mode are recorded in the access log.

Inside admin mode:
- **Support mode:** from **Admin → Users**, the admin opens a user's data. It opens **view-only**. An **"Allow changes"** switch must be turned on, with a reason, to fix something.
- **Always logged:** every support session is recorded with who, when, how long, the reason, and any changes made.
- **Visible to the user:** the user sees it in **Settings → Access log** ("Admin viewed your data on 15 Nov 2026, 9:40 PM"), and a one-time notice appears on their next login.
- **Other admin tasks:** everything the command-line tool does (2.1).
- **There must always be at least one admin.** The last admin can't remove their own admin role.

---

## 3. Privacy and encryption

### 3.1 What is protected

**End-to-end encryption:** all of a user's financial data is **encrypted in their browser before it is sent**, and decrypted only in their browser. That covers accounts, entries, amounts, notes, categories, loan account names and settings.

- **The server never sees readable financial data, or the keys to unlock it.** It stores and syncs encrypted records only.
- **All calculations run in the browser:** balances, loans, charts, search and filters. The data is small enough for any phone; even 10 years of entries is a few MB.
- **Protected against:**
  - the admin browsing the database
  - a stolen or leaked backup
  - someone breaking into the VM and copying the data

**What the server can see (unencrypted):**
- usernames and display names
- each user's recovery mode
- last login time
- how many records each user has, their sizes, and when they were changed
- the public dollar rates

### 3.2 Keys ("lockboxes")

Envelope encryption, the industry-standard pattern:

1. Each user has a random **data key**, created in their browser at setup. It encrypts all their records.
2. The data key itself is stored on the server only **inside lockboxes**: encrypted copies, each opened a different way.

| Lockbox | Opened by | Who has it |
|---|---|---|
| **Password lockbox** | a key made from the user's password | every user |
| **Personal recovery lockbox** | a **personal recovery key** the user writes down | users who want one (strongly suggested for everyone) |
| **Admin recovery lockbox** | the **admin recovery phrase** (3.3) | only users who choose admin recovery |

**Logging in:**
- The browser turns the password into **two different keys** using a slow, brute-force-resistant method (Argon2id):
  - a **login key**, sent to the server to prove who you are. The server stores only a hash of it.
  - an **unlock key**, which **never leaves the device** and opens the password lockbox.
- So the server never receives anything that can open the data.

**Changing your password** re-locks the password lockbox with the new password. The data itself doesn't need re-encrypting.

**After logging in,** the data key is kept in browser memory only while the app is open. It's never written to disk unprotected. Logging out (or closing the session) forgets it.

### 3.3 Recovery (forgotten passwords)

Without the data key, data can't be recovered by anyone, so every user picks how they want to be able to recover. **Each user chooses during setup** and can change it later in **Settings → Recovery**.

| Mode | What it means | Best for |
|---|---|---|
| **Admin can recover my account** | An admin recovery lockbox is created. If the password is forgotten, the admin can restore access. **This also means the admin can technically read the data**, and the setup screen says so plainly. | Family members who trust the admin |
| **Only I can recover my account** | No admin lockbox. Only the personal recovery key can restore access. If both the password and the recovery key are lost, **the data is gone permanently**. | People who want full privacy (e.g. friends, later) |

- **Personal recovery key:** anyone can create one (and replace it) in either mode. It's shown **once**, to print or write down.
- **Switching** from admin recovery to "only I" deletes the admin lockbox immediately. Switching back creates a new one.

**Admin recovery phrase (the admin's master phrase):**
- A long phrase that only the admin knows, set up **once** with `setup-recovery`.
- From it, the tool makes a **key pair**:
  - the **public half** is stored on the server. It can only **lock** admin lockboxes. Users' browsers use it to create their admin lockbox.
  - the **private half** is **never stored anywhere**. It's recreated from the phrase only while `recover-user` runs, then forgotten.
- A stolen database therefore can't open any admin lockbox.
- **Admin responsibility:** keep the phrase very safe, e.g. printed and stored securely. **If it's lost, admin recovery stops working for everyone who relies on it.** The admin's own account should use a personal recovery key.
- **Changing the phrase** (`setup-recovery` again) needs the old phrase. Every user's admin lockbox is re-locked with the new public half straight away, so nobody loses access. Backups made before the change can still only be opened with the old phrase.

**Recovering a user (admin recovery mode):**
1. The admin runs `recover-user ayesha` and types the recovery phrase.
2. The tool opens Ayesha's admin lockbox and creates a new password lockbox with a **temporary password**.
3. Ayesha logs in with the temporary password and must choose a new one immediately. **No data is lost.**

**Recovering with a personal recovery key:** on the login page, **"Forgot password? Use recovery key"** asks for the username and the key, then a new password.

### 3.4 Honest limits

- The server sends the app's code to every browser. An admin who **deliberately changed that code** could capture passwords. No website can fully prevent this. Encryption protects data **at rest** (database, backups, VM), and users of a self-hosted app must trust whoever runs it not to tamper with the app.
- Anything decrypted is visible **on the user's own unlocked device**.
- **Staying unlocked:** after unlocking, a device stays unlocked for **one hour after its last use**, so reloading doesn't ask for the password every time. The browser keeps the data key locked with a random device key, and only the server keeps that device key, deleting it when the hour is up, on **Lock now**, or on log out. Neither half is enough alone: the server never sees the locked data key, and the browser's copy can't be opened once the hour is up. Within the hour, someone with the unlocked device can open the app without the password, just as they could use an open tab.
- Metadata (3.1) is not encrypted.

### 3.5 Accounts PIN

The Accounts tab can be locked with a **PIN**, so friends or family using the owner's unlocked phone can't look at their accounts.

- **Set it up** at the bottom of the Accounts tab: **Set a PIN**, 4 to 8 digits, typed twice. **Change PIN** and **Turn off** ask for the current PIN.
- **When it asks:** every time the Accounts tab or an account's page is opened. Once the right PIN is entered, Accounts stays open until the user goes to another tab, the app goes to the background, 5 minutes pass without use, or the user taps **Lock** at the top of the page.
- **Entering it:** a number keypad on phones; the PIN is checked as soon as the last digit is typed.
- **Wrong tries:** the first 5 wrong tries in a row are free. After that, each wrong try means a wait before the next one: 30 seconds, then 1, 2, 4… minutes, up to 15 minutes. The count is kept on the device, so reloading doesn't reset it.
- **Forgot the PIN:** the user's password opens Accounts and turns the PIN off; they can then set a new one.
- **One PIN for all devices:** it is saved in the user's encrypted settings (10), so it applies on every device they use.
- **Stored safely:** only a check value is stored, made from the PIN and the user's data key, and it sits inside the encrypted settings. The server never sees the PIN.
- **What it is not:** a screen lock, not encryption. Accounts' data is already decrypted on the unlocked device, as on every other page. The PIN keeps the Accounts tab closed. Other pages still show what they always show: Home shows the accounts counted in its total, so accounts the user wants fully private should be left out of the Home total or have their balance hidden (4.1).

### 3.6 Building it properly

- **Only standard, well-reviewed cryptography.** Nothing home-made. Current choices:
  - **libsodium** for encryption and key pairs
  - **Argon2id** for turning passwords into keys
  - **AES-256-GCM or XChaCha20-Poly1305** for data
- **These tools are not fixed.** During implementation, any library or algorithm may be swapped for a better-fitting, equally standard and well-maintained one. The same goes for every other package in section 15. The requirement is the behaviour in this section, not the specific package.
- Every record is encrypted **separately** with its own random nonce, so one record can be updated without touching others.
- The encryption code lives in **one small module** with thorough automated tests (section 14).

---

## 4. Accounts

There are **two kinds of account**. They are kept **separate in the UI**.

| Kind | What it is | Where it appears |
|---|---|---|
| **Money accounts** | Places where my money sits: bank, mobile wallet, cash, credit card, FDR/DPS… | Home and the **Accounts** page |
| **Loan accounts** | People or organizations I lend to or borrow from | Only in the **Loans** section (section 7) |

Both kinds:
- start empty, with **no limit** on how many a user can create
- are created and named by the user
- each have **one currency**
- are **kept forever** unless deleted while empty. They can be archived to hide them.

### 4.1 Money account fields

| Field | Required | Notes |
|---|---|---|
| Name | ✅ | Free text, e.g. "City Bank Salary", "Drawer money" |
| Type | ✅ | See 4.2 |
| Currency | ✅ | BDT (৳) or USD ($). It cannot be changed once the account has entries. |
| Starting balance + start date | ✅ | The balance **as of** the start date (can be 0). See section 5. |
| Colour / icon | — | For quick recognition |
| Include in total | — | On by default. Controls only **Home**: its total ("Money I have" and net worth) and the accounts it lists. Turn it off for savings you don't want to see every day, or money held for someone. The **Accounts** page always shows the grand total of every money account, plus a total for each type (bank, mobile wallet, cash, …). |
| Hide balance | — | Off by default. Shows dots instead of this account's balance everywhere until tapped, for people looking over your shoulder. A Home total that includes it is hidden the same way. |
| Note | — | Free text. **Do not store full account or card numbers.** |
| Savings fields | — | For savings and investments only: interest rate, maturity date |

### 4.2 Money account types

A user can have several accounts of the same type, e.g. *Cash (wallet)* and *Cash (drawer)*.

| Type | Examples | Behaviour |
|---|---|---|
| Bank | City Bank, DBBL | Normal: money in, money out |
| Mobile wallet | bKash, Nagad, Rocket | Normal |
| E-wallet | A bank's own e-wallet | Normal |
| Cash | Wallet, drawer | Normal |
| Credit card | Any card | Balance = **amount owed**, shown as negative. Spending on the card increases what's owed. Paying the bill is a **transfer** from a bank to the card. |
| Savings & investments | FDR, DPS, savings certificates | Funded by a **transfer**. Interest is recorded as **income** into the account. On maturity, transfer the money out and archive the account. |
| Other | Anything else | Normal |

### 4.3 Actions (both kinds)

- **Create** an account.
- **Edit** it. Changing the starting balance recalculates its current balance.
- **Archive** it (closed account, matured FDR, someone you won't deal with again). It's hidden from daily views and pickers, but its history stays in records and charts. It can be un-archived.
- **Delete** it. Only allowed when the account has no entries; otherwise archive it.
- **Reorder** money accounts on the Home page.

---

## 5. Getting started

On a user's **first login** (with the one-time password from the admin), a short setup runs:

1. **Choose your password.**
2. **Choose recovery** (3.3): *Admin can recover my account* or *Only I can recover my account*. Then show the **personal recovery key** to print or write down. It's required for "only I" and offered for admin recovery.
3. **Start date:** the day you start recording (defaults to today).
4. **Money accounts:** add each account with its balance **as of the start date**.
5. **Existing loans:** add each person or organization who already owes you, or whom you already owe, with the amount. This creates a **loan account with a starting balance**. It does **not** touch any money account, because that money moved before you started using the app. The same can be done any time later: **Loans → Existing loan**, or **No account: it was owed from before** in the Lend and Borrow forms (which adds to an existing loan's starting balance). Such loans never change *Money I have* or the Accounts total; they count only in the loan totals and net worth.

Steps 1–2 are required. Steps 3–5 can be skipped and finished later from **Settings → Setup**.

**Rules:**
- Every account has a start date. Entries can't be dated before their account's start date. If you try, the app offers to move the account's start date back, along with its starting balance.
- Accounts added later get their own start date (defaults to the day they're added).

---

## 6. Entries

Every money event is an **entry**.

**Common fields** for all entry types:
- **Date** (defaults to today)
- **Amount** (greater than 0)
- **Note** (optional)
- **Tags** (optional) *(extra 3, later)*

### 6.1 Entry types

| Type | Fields | Effect |
|---|---|---|
| **Expense** | Money account, category; or **paid by someone else** (a loan account) | Account balance ↓ (on a credit card, amount owed ↑). When someone else paid, no money account changes: it counts as spending and adds to what I owe them. |
| **Income** | Money account, category | Account balance ↑ |
| **Transfer** | From money account, to money account, fee (optional) | From ↓, to ↑. Not counted as spending or income. |
| **Currency exchange** | From, to, amount sent, amount received, fee (optional) | A transfer between a BDT and a USD account. Both amounts are recorded, so the rate is kept. |
| **Lend** | From money account, to loan account, fee (optional) | Money account ↓. "*They* owe me" ↑. |
| **Borrow** | From loan account, into money account, fee (optional) | Money account ↑. "I owe *them*" ↑. |
| **Repay** | Loan account, money account, interest part (optional), fee (optional) | Direction is automatic: if I owe them, money goes out; if they owe me, money comes in. See 7.3. |
| **Write off** | Loan account | Clears what's left on a loan that will never be repaid. See 7.5. |
| **Balance correction** | Money account, the real balance | See 6.4. |

**Behind the scenes:** Lend, Borrow and Repay are **transfers between a money account and a loan account**. The ＋ menu still shows them as their own buttons with plain wording, so you never have to think "transfer from Rahim".

### 6.2 Fees

- Transfers, exchanges, lends, borrows and repayments have an optional **fee** field, for bKash/Nagad cash-out charges, bank charges and exchange fees.
- The fee comes out of the **money account** used, and is recorded as an **expense** in the **Fees & Charges** category.
- Fees **do** count as spending, so Stats shows how much goes on fees.

**Example:** cash out ৳10,000 from bKash with a ৳185 fee. bKash ↓ ৳10,185, Cash ↑ ৳10,000, and a ৳185 expense under *Fees & Charges*.

### 6.3 Rules

- Any entry can be **edited or deleted**. Balances recalculate immediately.
- **Deleting** moves the entry to **Recently deleted** (6.5) instead of erasing it.
- An expense or income in a USD account is stored in USD and converted to BDT only for totals and charts (section 9).
- **Gentle warnings** ask "Are you sure?" but don't block:
  - when a cash, bank, wallet or savings account would go **below zero** (usually a typo)
  - when the date is **in the future**

### 6.4 Balance correction

**When to use it:** a money account's balance in the app doesn't match the real balance, usually because a few small expenses were never recorded.

**Example:** the app says *bKash* has ৳5,200, but the bKash app on my phone shows ৳4,950. I can't remember what the missing ৳250 was.

1. Open *bKash* and tap **Correct balance**.
2. Type the real balance: **৳4,950**.
3. The app records a **correction of −৳250**, and the bKash balance now matches reality.

**Rules:**
- The correction is a normal record in History, labelled **"Balance correction"**, so it's clear something was missed.
- It is **not counted as spending or income** in charts, because the app doesn't know what the money was really for.
- If you later remember what it was, delete the correction and add the real expense instead.

### 6.5 Recently deleted

- Deleted entries go to **Settings → Recently deleted** for **30 days**, where they can be restored with one tap. Balances update straight away.
- After 30 days they are erased permanently. Because the server can't read records, the app does this the next time the user opens it.
- **Empty now** erases them immediately, after confirmation.

---

## 7. Loans (loan accounts)

**Priority:** this is one of the most important parts of the app. **Money I owe must always be easy to see** (7.8).

### 7.1 Loan accounts

- **One loan account per person or organization.** Its type is one of *Person*, *Bank*, *Organization* or *Other* (this sets the icon and label only).
- **Fields:** name, type, currency, starting balance with direction (*they owe me* / *I owe them*) and start date, optional phone and note, and **Show this loan on Home** (on by default; turn it off for loans that aren't an immediate concern — Home's loan card and net worth leave it out, the Loans page shows it marked "not on Home").
- **The balance shows the direction:**
  - **Owed to me:** they owe me
  - **I owe:** I owe them
  - **Settled ✓:** the balance is 0
- If the direction flips (Karim owed me, and now I owe Karim), the account **moves to the other list automatically**.
- **Kept and reused:** a settled loan account is **never removed**. Lending to or borrowing from the same person or organization again uses the **same account**, so their whole history stays in one place. Lend and Borrow forms list existing loan accounts; choosing **+ New person or organization…** creates a new one. Choosing **None (owed from before)** instead of a money account adds to the loan's starting balance without moving money.

### 7.2 Example

| Date | Entry | Money account | Rahim |
|---|---|---|---|
| 1 Nov | Borrow ৳10,000 from Rahim, into City Bank | City Bank +10,000 | I owe ৳10,000 |
| 15 Nov | Repay Rahim ৳4,000 from bKash | bKash −4,000 | I owe ৳6,000 |
| 1 Dec | Repay Rahim ৳6,000 from Cash (wallet) | Cash −6,000 | **Settled ✓** |
| 10 Mar | Borrow ৳3,000 from Rahim, into bKash | bKash +3,000 | I owe ৳3,000 (same account) |

### 7.3 Repayments and partial payments

- **Repay** picks the loan account and the money account. Direction is set automatically from the loan account's balance.
- **Partial payments** are just repayments for less than the full amount. You can add any number of them, from any money accounts.
- **No over-repaying:** a repayment larger than the outstanding amount is blocked with a clear message.
- **Interest part (optional):**
  - **Paying back,** e.g. a ৳12,000 bank EMI with "of which interest ৳2,000": the loan goes down by ৳10,000, and ৳2,000 is recorded as an expense under **Interest Paid**. The money account goes down by the full ৳12,000.
  - **Receiving,** e.g. ৳5,500 with "of which interest ৳500": the loan goes down by ৳5,000, and ৳500 is recorded as income under **Interest**.

### 7.4 Progress and Settled

- **Progress bar:** shows how much of the **current open amount** has been repaid since the account was last settled, e.g. "৳4,000 of ৳10,000 repaid".
- **Per-loan rows:** on the loan account's page, each lend or borrow is shown as its own row with its remaining amount. Repayments are applied to the **oldest first**, so older loans are settled first.
- An account whose balance reaches 0 is marked **Settled ✓** and moves to the *Settled* list.

### 7.5 Write off

For a loan that will never be repaid:
- **Owed to me:** **Write off** clears the remaining amount and records it as an expense under **Written-off Loans**, or as a gift under **Gifts & Donations** if I choose.
- **I owe** (the lender forgave it): it's recorded as income under **Gift**.
- The account becomes **Settled ✓**. The write-off shows in its history and in History.

### 7.6 Income and spending

Lending, borrowing and repaying the loan amount are transfers, so they are **not counted as income or spending**. Only the following count:
- interest (7.3)
- fees (6.2)
- write-offs (7.5)

### 7.7 Currency

- A loan account has **one currency**. A dollar loan is repaid and tracked in dollars.
- Lending or repaying from a money account in the other currency records **both amounts**, like a currency exchange.

### 7.8 Visual tracking

**Home: Loans card**, directly under the totals:
- **I owe:** a total in **red** with the top names listed (e.g. "Rahim ৳6,000")
- **Owed to me:** a total in **green** with the top names listed
- **Overdue** items get a warning badge *(extra 4, later)*
- When I owe nothing, the card shows **"You owe nobody ✓"**
- Loans kept off Home are left out of this card and of Home's net worth; if every open loan is kept off, the card says how many are hidden instead.

**Loans page** (its own tab in the main navigation):
- Two tabs: **I owe** (shown first) and **Owed to me**, each with its total at the top.
- One card per loan account, showing:
  - name and type icon (person, bank, organization)
  - outstanding amount
  - a **progress bar**
  - the next due date; overdue cards are highlighted *(extra 4, later)*
  - a **Repay** button that opens the repayment form pre-filled
- Sorted by the largest amount (overdue first, once extra 4 is added).
- A **Settled** section (collapsed) lists loan accounts with a zero balance. Each has **Lend** and **Borrow** buttons for reuse.
- An **＋ New** button adds a loan account with a starting balance, for loans from before the start date.

**Loan account page:**
- **Position** at the top: "You owe Rahim ৳6,000", "Karim owes you ৳3,000", or "Settled ✓".
- Open lends or borrows as rows (7.4), with amount remaining, a progress bar, and due date *(extra 4, later)*.
- The full timeline of every lend, borrow, repayment, interest and write-off, showing which money account each used.
- Buttons: **Lend**, **Borrow**, **Repay**, **Write off**, **Edit**, **Archive**.

**Navigation badge:** the Loans tab shows a red dot when anything is overdue *(extra 4, later)*.

**Stats:** a **"Loans over time"** chart showing *I owe* and *Owed to me* month by month.

---

## 8. Categories

- Expense and income categories are separate.
- Each new user gets **default categories**, which they can rename, recolour, add to, hide or delete:
  - **Expense:** Food & Groceries, Eating Out, Transport, Rent, Bills & Utilities, Mobile & Internet, Shopping, Clothing, Health, Education, Family, Gifts & Donations, Entertainment, Travel, Personal Care, **Fees & Charges**, **Interest Paid**, **Written-off Loans**, Other
  - **Income:** Salary, Business, Freelance, Interest, Gift, Other
- Categories are one level only in v1 (no sub-categories). Tags *(extra 3, later)* will cover cross-cutting grouping.
- Deleting a category that has entries requires choosing another category to move those entries to.

---

## 9. Currencies

- Supported currencies are **BDT (৳)**, the main currency, and **USD ($)**.
- **Number display:** BDT uses Bangladeshi grouping (৳1,00,000), switchable to international (৳100,000) in Settings. USD uses $1,000.00.
- Amounts are stored as whole paisa / cents to avoid rounding errors.

### 9.1 Dollar rate (USD → BDT)

**Automatic by default, manual when I want.**

| Mode | How it works |
|---|---|
| **Automatic** (default) | The server fetches the USD → BDT rate **once a day** from a free public rates service (currently ExchangeRate-API's open endpoint, with the free fawazahmed0 currency API as a fallback; either can be replaced). No account, key or payment is needed, and no personal data is sent. These public rates are the only data the server keeps unencrypted, and browsers download them. |
| **My own rate** | In Settings, I type a rate (e.g. the rate my bank or money changer actually gives me). It's used instead of the automatic rate **until I switch back** to Automatic. My own rates are stored **encrypted** with the rest of my data. |

- Settings and the Home totals show which rate is in use, e.g. "$1 = ৳122.40 · automatic · updated today" or "· your rate".
- **If fetching fails** (no internet, service down), the last known rate is kept, and its date is shown so it's obvious it may be stale.
- **Rate history:** every day's automatic rate is saved. Charts over time convert each past day using **that day's rate**. Periods when I used my own rate use my rate.
- Recording a currency exchange **offers to set** my own rate to the rate from that exchange.
- Online rates are market averages and can differ from what banks or money changers in Bangladesh actually pay. That's what "My own rate" is for.

---

## 10. Saving, syncing and conflicts

### 10.1 How data moves

- **On login,** the browser downloads the user's encrypted records, decrypts them, and builds everything (balances, loans, charts) in memory. An encrypted local copy may be kept in the browser to make later logins faster.
- **On every change,** the browser encrypts the changed record and sends **only that record** to the server.
- **Other devices** pick up changes when they're opened or brought back to the front, and every minute while open.
- **Online-only in v1:** saving needs a connection to the server. If it's offline, the app says so and keeps the unsaved form open to retry. *(Full offline use: extra 11, later.)*

### 10.2 Conflicts (same entry changed on two devices)

**Most changes can never conflict:**
- New entries on two devices are **separate records**, and both are saved.
- Balances, loan totals and charts are **calculated, never stored**, so they can't conflict either.

**A real conflict** only happens when the **same record** is edited on two devices at nearly the same time. It's handled with **versioning**, the industry-standard approach (optimistic concurrency):
- Every record has a **version number** that the server increases on each save.
- A device saving a change says which version it last saw, e.g. *"update entry #57, based on version 3"*.
- If the server already has a newer version, it **refuses** the save. Nothing is overwritten silently.
- The device then shows **"This entry was changed on another device"**, with both versions side by side. The user picks **Keep mine** or **Keep theirs**.
- A record **deleted** on one device and edited on another works the same way: the user chooses to restore it with their edit, or leave it deleted.

---

## 11. Pages

**Navigation**
- **Phone:** a bottom bar with Home · History · **＋** · Loans · Stats. Settings opens from the settings button at the top right of Home; Accounts opens from **All N** on Home's Accounts card (and account cards open their accounts).
- **PC:** a left sidebar with Home, History, Loans, Stats, Accounts and Settings, plus a prominent **＋ Add** button. The sidebar can be **collapsed** to a narrow strip of icons (names show on hover) and expanded again; each device remembers the choice.

| Page | Contents |
|---|---|
| **Login** | Username and password · **"Forgot password?"**, which explains the two options: use your recovery key, or ask the admin (admin recovery users only) |
| **Setup** | First-login setup (section 5) |
| **Home** | **Money I have** (money accounts counted in the Home total, in BDT) · **Net worth** (money I have + owed to me − I owe, counting only loans shown on Home) · **Loans card** (7.8) · the balances of accounts counted in the Home total (tap to open) · if a counted account hides its balance, the Home totals show dots until tapped · this month's income vs. spending · recurring entries waiting to be confirmed *(extra 2, later)* · last 10 entries |
| **Add entry (＋)** | First choose a type (Expense · Income · Transfer · Lend · Borrow · Repay · More…), then a short form for that type. Quick-add favourites appear on top *(extra 1, later)*. Opens as a bottom sheet on phones and a dialog on PC. |
| **History** | All entries, newest first, grouped by day · search by note or amount · filter by date range, type, account (money or loan), category, tag · totals for the filtered set · export *(extra 5, later)* |
| **Accounts** | **Money accounts only.** **All my money**: the grand total of every money account, shown as dots until the card is tapped, with a total per type inside it · accounts grouped by type, each group with its total (always shown, but leaving out hidden balances — "+ 1 hidden" — until they're tapped open) · balances hidden per account until tapped (4.1); shown amounts hide again after 30 seconds · **Add up**: pick accounts or whole groups to see their combined total, for that view only · add / edit / archive · account detail shows that account's own history and a **Correct balance** button · **PIN lock** (3.5): set, change or turn off at the bottom of the page; when on, the tab and every account page ask for the PIN, and **Lock** at the top locks it again |
| **Loans** | **Loan accounts only:** *I owe* / *Owed to me* tabs, cards with progress bars (loans kept off Home are marked "not on Home"), the Settled list, and loan account pages (7.8) · **Existing loan** adds a loan owed from before, without moving money |
| **Stats** | Charts (section 12), with a period picker: this month, last month, this year, custom |
| **Settings** | Look: style (Colour / Ink), theme (light / dark / auto) and number format · Categories · dollar rate (automatic / my own) · display name and password · **Recovery** (mode, new personal recovery key; asks for the password) · **Lock now** and **Log out** · **Recently deleted** · **Setup** (sharing, the access log, tags, favourites, recurring entries and export arrive with their extras) |
| **Admin mode** *(extra 8, later)* | Only reachable from *Enter admin mode* plus the password (2.2), with a red bar on every admin page. **Users:** create, disable, recover, open **support mode** · **Access log** · **Backups** |

---

## 12. Charts and statistics

All charts are in BDT and are calculated in the browser. Spending and income charts **exclude** transfers, currency exchanges, lending, borrowing, loan repayments and balance corrections. They **include** fees, interest and write-offs. So they show only **real spending and income**.

| Chart | Question it answers |
|---|---|
| **Spending by category** (donut, with a list beside it) | Where did my money go this period? |
| **Income vs. spending by month** (bars, last 12 months) | Am I spending more than I earn? |
| **Money I have and net worth over time** (two lines) | Is my money growing or shrinking? |
| **Daily spending this month** (bars) | Which days did I spend the most? |
| **Top 10 expenses** (list) | What were my biggest single purchases? |
| **Month-over-month insights** (short text cards) | e.g. "Food is up 25% vs. last month", "Fees cost you ৳640 this month" |
| **Spending by tag** (list) *(extra 3, later)* | What did the Eid shopping or the trip cost in total? |
| **Loans over time** (two lines: I owe, owed to me) | Are my debts going down? |

Tapping a chart slice or bar opens History filtered to those entries.

---

## 13. Extras (after version 1)

None of these are in version 1. They'll be chosen once version 1 is in use.

| # | Feature | Detail |
|---|---|---|
| 1 | **Quick-add favourites** | Saved one-tap entries, e.g. "Rickshaw ৳50 · Transport · Cash (wallet)". A tap opens the form pre-filled, so the amount can still be changed before saving. |
| 2 | **Recurring entries** | A rule such as "Salary, monthly on the 1st" or "Bank loan EMI, monthly on the 5th". When the app is opened on or after the due date, a **"Confirm"** card appears on Home: one tap adds it, and the amount can be changed first. (The server can't read the rules, so it can't add them by itself.) |
| 3 | **Tags** | Free-form labels on any entry (e.g. #Eid2026). Filter by tag in History and see totals per tag in Stats. |
| 4 | **Loan due dates and reminders** | Optional due date on lends and borrows. Overdue loans are highlighted on Home and the Loans page, and the Loans tab shows a red dot. Reminders are **in-app only** (no email or push). |
| 5 | **Export** | Download entries (with current filters) as CSV or Excel, decrypted in the browser. A full-data export is in Settings. |
| 6 | **Privacy mode** | An eye icon hides all amounts (••••). It's remembered per device. |
| 7 | **Receipt photos** | Attach up to 3 photos (or PDFs) to any entry, e.g. a receipt or a payment screenshot. On a phone, **Take photo** opens the camera directly. Entries with attachments show a 📎 icon in History, and tapping a thumbnail opens it full size. Storage details are in section 14.1. |
| 8 | **Admin mode and support access** | Admin screens inside the app, kept apart from normal use (2.2). Support access only for users who chose admin recovery. |
| 9 | **Two-factor login** | Optional per user: after the password, a 6-digit code from an authenticator app. Worth considering if the app is reachable from the public internet. |
| 10 | **Sharing (view-only)** | A user shares their money with another user, e.g. a spouse. The owner's browser places a copy of the data key in a lockbox only the other user can open (the same lockbox method as 3.2). It's view-only, can be turned off at any time (which re-keys the data), and comes with a clearly marked *"Viewing: Ayesha's money"* switcher. |
| 11 | **Offline use** | Add and edit entries without a connection, syncing when back online, with the same conflict handling (10.2). This also covers a **server that is switched off** (e.g. self-hosted on a home PC during a power cut): the installed app opens from its own saved copy, shows the data saved on the device, and keeps new changes in a queue until the server is back. Needs: the app cached by a service worker (so it opens with no server); the encrypted records saved in the browser's storage (IndexedDB), still encrypted; unlocking with the password works offline because the password lockbox is saved too ("stay unlocked" needs the server, so offline means typing the password); a clear "Offline: N changes waiting" banner; on reconnect, queued changes are sent with their version numbers, and any clash opens the usual conflict dialog. Limits: the device must have opened the app online at least once; iPhones may clear a website's storage after weeks without use unless it's added to the Home Screen; the dollar rate uses the last one saved. Reaching a home server from outside also needs a tunnel or private network (extra 12). |
| 12 | **Private network access (Tailscale)** | Take the app off the public internet, so only devices on a private Tailscale network can reach it. Every phone and PC would then need the Tailscale app installed and signed in. Consider it if the public login page ever becomes a concern. |

**Other ideas for later versions:** Bangla language, monthly summary report, budgets, bank statement import, shared access that allows editing.

---

## 14. Non-functional requirements

| Area | Requirement |
|---|---|
| **Devices** | Works well from 360 px phone width to large desktop screens, with no sideways scrolling. **Wide screens use the full width:** sidebar navigation (collapsible) plus two columns, or three on very wide screens (1280 px and up). Login and setup use a split layout on wide screens. See the approved mockup, [docs/design/mockup-v1.html](design/mockup-v1.html). |
| **Install** | Can be installed to the phone home screen (PWA) with its own icon |
| **Look** | Two styles, switchable in **Settings → Style**: **Colour** (default: blue accent and a colour per category) and **Ink** (black and white, with colour only for meaning). Each comes in light, dark, or follow the system. Red/green always comes with a −/+ sign or words, never colour alone. |
| **Speed** | Pages load in under 1 second on the home network. Unlocking and building all data after login takes under 2 seconds for 10 years of entries on a mid-range phone. |
| **Accessibility** | Readable font sizes, sufficient contrast, tap targets at least 44 px, works with the keyboard |
| **Security** | End-to-end encryption (section 3) · **public web address over HTTPS only** (HTTP redirects to HTTPS; HSTS) · login keys hashed on the server · login attempts rate-limited per username and per IP, with growing delays after failures · security headers · firewall open only for SSH, HTTP and HTTPS · SSH by key only · each user can only fetch and change their own encrypted records · strict Content Security Policy and no third-party scripts, to protect the code that handles keys · the admin command-line tool only runs on the VM itself |
| **Backups** | Automatic nightly backup of the database (plus the attachments folder once extra 7 is added), copied **off the VM to Google Drive** (free tier, via rclone), kept for 30 days, with a tested restore procedure. User data is already encrypted. The backup file is **also encrypted as a whole** (rclone crypt), so usernames and metadata aren't readable on Google Drive either. |
| **Reliability** | Restarts automatically if the VM or app restarts |
| **Light on the server** | The VM is small (15.4). The backend only stores and serves encrypted records, so it should use **under ~150 MB of memory** and almost no CPU when idle. The frontend is plain static files. |
| **Dedicated VM** | The VM is used only for this app (15.4). |
| **Quality** | **Automated tests** check, on every change: **encryption** (encrypt/decrypt round trips, login and unlock keys, password change, both recovery modes, admin phrase change, and a check that the server never receives readable data) · **sync** (version conflicts, delete-vs-edit) · **money math** (balances, transfers with fees, currency conversion, loan repayments oldest first, interest, write-offs, over-repay blocking, balance corrections, recently deleted) · **access** (users can only reach their own records) |

### 14.1 Attachment storage (for extra 7, later; no paid storage)

- **Encrypted** in the browser before upload, like everything else.
- **Shrunk in the browser** before encrypting: photos are resized to at most 1600 px on the long side and saved as WebP at about 75% quality. A typical phone photo of 3–5 MB becomes **about 150–300 KB**, and receipt text stays readable. A small thumbnail (~20 KB) is also made for lists.
- **Where:** encrypted files are saved in a folder on the VM's own disk (e.g. `/data/attachments/`), **not** inside the database.
- **Limits:** 15 MB per file before shrinking. Images (JPEG, PNG, HEIC, WebP) and PDFs only; PDFs are encrypted as they are.
- **Expected space:**

  | Usage | Per year |
  |---|---|
  | Me, ~20 receipts a month | ~60 MB |
  | 20 users, ~30 receipts a month each | ~1.8 GB |

- **Deleting** an entry deletes its attachments when the entry is permanently erased.
- **Settings** shows how much space your attachments use.

---

## 15. Technical design

### 15.1 Stack

All choices are **current preferences, not fixed**. Any of them may be replaced during implementation with a better-fitting, standard and well-maintained alternative (see 3.6).

The **frontend and backend are separate applications**, like an Angular + Spring Boot stack. They talk only through the HTTP API. Both use TypeScript, so the encryption code and record definitions can be shared through a common package instead of being written twice.

| Layer | Current choice |
|---|---|
| **Frontend** | React + TypeScript single-page app, built with Vite into **static files**. It holds all app logic: encryption, calculations, UI. |
| UI | Tailwind CSS + shadcn/ui, with Recharts for charts |
| **Backend** | Node.js (LTS) + TypeScript, with **Fastify** as a small HTTP API. It only handles login, sessions, and storing and syncing encrypted records. |
| **Shared** | A TypeScript package used by both: the encryption module, record definitions, and validation schemas (zod) for the API |
| Encryption | libsodium (Argon2id, XChaCha20-Poly1305 or AES-256-GCM, sealed boxes for lockboxes). Used in the browser and by the admin tool. |
| Browser data | Decrypted data in memory · encrypted local cache in IndexedDB |
| Server database | SQLite (one file) via the Drizzle ORM, holding encrypted records |
| Auth | Username + login-key hash, with session cookies. Implemented in the backend following standard practice (an auth library may be used if it fits the encryption login flow). |
| Tests | Vitest for encryption, sync, money math, API and access rules · Playwright for key screens |
| Web server | The VM's **existing nginx**: serves the frontend's static files, forwards `/api` to the backend, and handles HTTPS (Let's Encrypt certificate) |
| Running the backend | A **Docker container** (recommended: Docker is already installed, and it makes updates and rollbacks easy). A plain systemd service is the fallback. Images are built for ARM64. |
| Backups | Nightly SQLite backup → rclone crypt → Google Drive |
| Repository | **One git repository** with separate `frontend/`, `backend/` and `shared/` folders, using npm workspaces (15.5) |

```
Phone / PC browser                                         VM (Oracle Cloud, ARM64)
┌─────────────────────────────┐   encrypted    ┌──────────────────────────────────────┐
│ frontend (static React app) │   records      │ nginx (existing, HTTPS)              │
│ password → keys (Argon2id)  │ ◀────────────▶ │  ├─ /      → frontend static files   │
│ decrypt · calculate · UI    │    (HTTPS)     │  └─ /api   → backend (Fastify, Docker)│
│ encrypt each change         │                │                SQLite: encrypted data │
└─────────────────────────────┘                └──────────────────────┬───────────────┘
                                                                      └─nightly─▶ encrypted backup → Google Drive
```

### 15.2 Server database (what the server stores)

| Table | Key fields |
|---|---|
| `users` | id, username (unique, case-insensitive), display_name, role (admin/user), disabled, must_change_password, login_key_hash, kdf_salt, kdf_params, recovery_mode, created_at, last_login_at |
| `key_lockboxes` | user_id, kind (password / personal_recovery / admin_recovery), encrypted_data_key, created_at |
| `records` | id (random), user_id, record_type, version, ciphertext, nonce, updated_at |
| `sessions` | id, user_id, expires_at |
| `admin_recovery` | public_key, created_at |
| `exchange_rates` | date, usd_to_bdt, source (public, unencrypted) |

### 15.3 Record types (encrypted, inside `records`)

Each is a JSON object, encrypted as one record. Only the browser can read these fields.

| Record type | Key fields |
|---|---|
| `account` | kind (money/loan), type, name, currency, starting_balance, start_date, include_in_total, archived, colour, icon, note, phone, sort_order, interest_rate, maturity_date |
| `category` | kind (expense/income), name, colour, icon, hidden |
| `entry` | type, date, amount, account_id, to_account_id, to_amount, category_id, parent_entry_id, note, created_at, updated_at, deleted_at |
| `settings` | number format, theme, rate mode, own rates (with the periods each was used), setup progress |

**Added later, with their extras:** due dates on entries (4) · tags (3) · favourites (1) · recurring rules (2) · attachments (7) · access log (8) · share lockboxes (10)

- Amounts are integers in paisa/cents.
- **Balances are calculated in the browser, never stored:** each account's balance is its starting balance plus its entries. This applies to loan accounts too, which is how "I owe" and "owed to me" are worked out.
- **Fees, interest and write-offs** are their own expense or income entries, linked to the main entry by `parent_entry_id`. Deleting the main entry deletes them with it.
- **Recently deleted** entries have `deleted_at` set inside the encrypted record. They're ignored in all balances and charts, and erased by the app after 30 days.

### 15.4 The VM (checked 15 Nov 2026)

| Item | Value |
|---|---|
| Host | Oracle Cloud instance, public IP |
| OS | Ubuntu 24.04 LTS, **ARM64** (aarch64) |
| CPU / memory | 1 vCPU (Neoverse-N1) · 5.8 GB RAM (~5 GB available) · 2 GB swap |
| Disk | 45 GB, ~36 GB free |
| Already running | **nginx** (ports 80/443) · **certbot** with auto-renewing Let's Encrypt certificates for `138.2.66.148` and `138-2-66-148.sslip.io` · Docker · Oracle's monitoring agent |
| Old demo | **Removed 15 Nov 2026**: the "diagnostic-center" Docker project (containers, volumes, images), its folders, systemd service and nginx site. Kept and renamed: SSH hardening (`90-hardening.conf`: key-only, no root login), `99-swappiness.conf`, the firewall rules (22/80/443 only), and the certbot renewal hook (`reload-nginx`). |
| Current nginx site | `money-manager` ([deploy/nginx/money-manager.conf](../deploy/nginx/money-manager.conf)): a "coming soon" placeholder over HTTPS that keeps certificate renewal working until go-live |
| Not installed yet | Node.js, rclone, sqlite3 CLI |

**Verdict:** easily strong enough. The backend needs roughly 100 MB of memory and almost no CPU. Building should happen on the development Mac (also ARM64) or in CI, not on the VM. The single CPU makes building there slow, but running the app is fine.

**Rules for deployment:**
- The VM is **dedicated to this app**.
- **Keep** nginx, certbot and its certificates, Docker, and Oracle's agents.
- **The IP certificate is short-lived** and renews every few days through `/var/www/letsencrypt` on port 80. Any nginx change must keep the `/.well-known/acme-challenge/` location working. Check with `sudo certbot renew --dry-run`.
- Test the nginx configuration (`nginx -t`) before reloading.
- The backend listens only on `localhost`, never directly on the internet.

### 15.5 Repository layout

```
money-manager/
├── docs/          common: spec, design notes, decisions
├── shared/        common code: encryption module, record definitions, API schemas
├── frontend/      the web app (React + Vite): pages, components, calculations
├── backend/       the API server (Fastify): login, sessions, encrypted records, dollar rates
│   └── admin/     the admin command-line tool
├── deploy/        nginx site config, Docker files, backup scripts
└── package.json   npm workspaces tying the folders together
```

- **Frontend and backend never import each other's code.** They only talk through the HTTP API.
- Anything both need goes in `shared/`.
- Each of `frontend/` and `backend/` has its own `package.json`, scripts, tests and README, so each can be built, tested and run on its own.

---

## 16. Milestones

| # | Milestone | Result |
|---|---|---|
| M0 | **UI design** | Mockups of Login, Setup (including the recovery choice), Home, Add entry, History, Accounts, Loans and Stats, on phone and PC, approved before coding |
| M1 | Foundation: login and encryption | App runs locally; username + password login with separate login and unlock keys; data key and lockboxes; both recovery modes; admin command-line tool (create, recover, setup-recovery); encrypted record storage with versioning and conflict handling |
| M2 | Money accounts and entries | Setup flow, money accounts, categories, expenses, income, transfers, exchanges, fees, balance correction, recently deleted, History |
| M3 | Loans | Loan accounts, lend, borrow, repay (with interest), write off, Loans page and loan account pages, Home loans card |
| M4 | Home and Stats | Dashboard, net worth and all charts |
| M5 | Go live | Domain set up (17), new nginx site with HTTPS (existing site untouched), backend running on the VM, encrypted backups running, installed on phone, admin recovery phrase set up and stored safely |
| Later | Extras | Whichever of extras 1–12 are chosen after using version 1 |

Automated tests are written alongside each milestone, not at the end. M1 comes first on purpose: encryption is the foundation everything else sits on.

---

## 17. Open questions

**To decide at go-live (M5), without changing what's built:**

1. **Web address.** Options:
   - **Free, ready now:** `https://138-2-66-148.sslip.io`. It already has an auto-renewing HTTPS certificate on the VM.
   - **Own domain:** a nicer name, about $10 a year.

**Decided 15 Nov 2026:**
- **public web address:** the app is reached over the public internet with HTTPS, with extra hardening (14). Tailscale moves to **extra 12**.
- **separate frontend and backend** in one repository: React static app, Fastify API, and a shared package for common code (15.1, 15.5)
- **runs on the existing VM** (15.4), dedicated to this app, behind its existing nginx, with the backend in Docker
- **no import:** recording starts fresh from each user's start date (section 5)
- **end-to-end encryption:** data is encrypted in the browser, the server stores only encrypted records, and all calculations run in the browser (section 3)
- **recovery:** each user chooses *admin can recover* (via the admin recovery phrase) or *only I can recover* (personal recovery key) (3.3)
- **sync:** online-only in v1, with versioned records and a "changed on another device" choice for conflicts (section 10)
- **tools are flexible:** named libraries and algorithms may be replaced during implementation with standard, well-maintained alternatives (3.6, 15.1)
- sharing moves to **extra 10**, and offline use is **extra 11**
- the dollar rate is automatic, with an optional own rate (9.1)
- no admin screens in v1: users are managed with a command-line tool on the VM (2.1). In-app admin mode moves to **extra 8** (2.2).
- login is a **unique username + password**, with no email; two-factor login moves to **extra 9** (2)
- balance correction is kept (6.4)
- loans are **loan accounts**, one per person or organization, kept and reused after settling, and shown separately from money accounts (section 7)
- added: getting-started setup (5), fees (6.2), recently deleted (6.5), gentle warnings (6.3), one currency per loan account (7.7), admin is also a user (2), automated tests (14)

---

## 18. Change log

| Date | Change |
|---|---|
| 15 Nov 2026 | Spec approved as the version 1 baseline. |
| 15 Nov 2026 | **Architecture:** frontend and backend split into separate folders in one repo (React + Vite static app, Fastify API, shared package), replacing the single Next.js app (15.1, 15.5). **Hosting:** uses the VM's existing nginx instead of Caddy, with the backend in Docker; VM details recorded (15.4); VM dedicated to this app. **Access:** public web address with hardening; Tailscale moves to extra 12. |
| 15 Nov 2026 | **VM cleaned up:** old demo removed; placeholder nginx site installed; certificate renewal verified (15.4). |
| 15 Nov 2026 | **UI (M0):** mockup approved with changes: Colour style is the default with Ink switchable in Settings; wide screens use the full width; split login and setup on wide screens (14). |
| 15 Nov 2026 | **Built (M1-M5) and deployed** to https://138-2-66-148.sslip.io. Implementation choices within the spec's flexibility clause (3.6, 15.1): libsodium 0.8 (0.7's ESM build is broken); Node's built-in SQLite with plain SQL migrations instead of Drizzle (no native modules on the ARM VM); auth written in the backend instead of Better Auth (it had to fit the two-key login); the approved mockup's CSS reused instead of Tailwind/shadcn; the backend is bundled into one file and run in the official Node image, so no custom Docker image is needed. Added: an **Unlock** screen, because after a reload the session is still valid but the data key, kept in memory only, must be re-derived from the password; and ids derived from the data key for default records, to prevent duplicates. Backups are nightly on the VM; Google Drive is pending the owner's sign-in. |
| 15 Nov 2026 | **Stay unlocked for an hour** (3.4), at the owner's request: reloading no longer asks for the password within an hour of the last use. Added **Lock now** in Settings. Changing the recovery choice now asks for the password. |
| 15 Nov 2026 | **Two kinds of totals**, at the owner's request: Home counts only accounts marked "include in total"; the Accounts page shows the grand total of all money accounts and a total per account type (4.1). |
| 15 Nov 2026 | **Hide amounts from onlookers**, at the owner's request: the Accounts page's totals show dots until the top card is tapped, and each money account can **hide its balance** until tapped (4.1). Shown amounts hide again after 30 seconds. Stats charts are not hidden. |
| 15 Nov 2026 | Added the **E-wallet** account type (4.2). Loans owed from before can be added at any time without a money account (5), from the Loans page or the Lend/Borrow forms. |
| 15 Nov 2026 | **Add up** on the Accounts page: pick any accounts (or whole groups) to see their combined total. Only for that view; it changes no other total and nothing is saved. |
| 15 Nov 2026 | Accounts page group totals (Bank, Mobile wallet, …) are always shown again, but leave out hidden-balance accounts ("+ 1 hidden") until one is tapped open; then that group's total includes it. The grand total stays hidden until tapped. |
| 15 Nov 2026 | **Loans can be kept off Home** ("Show this loan on Home" in the loan's form): Home's loan card and net worth leave them out; the Loans page shows them, marked "not on Home". **Expenses paid by someone else**: "Paid from" in the expense form also lists people in Loans (and "+ Someone new…"); the expense counts as spending and adds to what you owe them, and no money account changes. |
| 15 Nov 2026 | **Admin recovery phrase** set up by the owner (3.3). The README was rewritten for new readers, with screenshots of the design mockup in `docs/screenshots/`. |
| 15 Nov 2026 | **Wide screens:** the sidebar can be collapsed to icons (11); account group cards on the Accounts page are at least 420 px wide and long account names wrap instead of being cut off. |
| 15 Nov 2026 | **UI fixes:** icons and text in buttons are centred; Settings' choice switches (style, theme, number format, category kind) were unstyled and are now pill switches with the chosen option in the accent colour; buttons beside an input match its height; long names in Home's loan cards are cut off with "…" instead of spilling out. **Saves run one at a time**, and quick settings changes are merged, so tapping two options in a row no longer shows a false "Changed on another device" dialog (10). |
| 15 Nov 2026 | **Accounts PIN** (3.5), at the owner's request: the Accounts tab can be locked with a 4 to 8 digit PIN, asked for every time it's opened, with waits after repeated wrong tries and the password as a way back in. |
