# VM maintenance notes

Private notes for the owner. **Keep this repository private on GitHub.**

## Admin recovery phrase

```text
habit hawk million move insane vacant ozone beauty arena scatter sunny six
```

- Type it exactly as written: all lowercase, with one space between words. The app uses the text as it is, so any difference makes it a different phrase.

- It must be at least 16 characters long.
- Set it, or change it, on the VM with `sudo mm-admin setup-recovery`. Changing it asks for the current phrase and re-locks every user to the new one.
- Use it on the VM with `sudo mm-admin recover-user <name>`.
- The phrase alone gives no access. It only unlocks data when used together with the database: the live database on the VM, or a backup copy.
- Users who chose "only I" for recovery are never affected by it.
- Before the repository goes to GitHub, make sure the repository is **private**. Anyone who has both this file and a copy of the database can read the data of every user who chose "the admin can help me".
