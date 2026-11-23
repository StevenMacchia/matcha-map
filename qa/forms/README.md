# QA: forms group (390 = 500 px headless render clipped to 390; mascots do not draw from file://, a capture artifact)

Routes: add, add-review, report (event=00b35dbb0041), claim (brand=333.matcha), alerts, privacy, data-deletion. Files: `<route>-<390|1440>-<light|dark>.png` in this folder.

| route | 390 light | 390 dark | 1440 light | 1440 dark | findings | fixed in |
|---|---|---|---|---|---|---|
| add | ok | ok | ok | ok | 3 s bot check could eat a fast autofill; phone clock ahead of server read as bot | validate.js, add.js |
| add-review | ok | ok | ok | ok | none | |
| report | ok | ok | ok | ok | none | |
| claim | ok | ok | ok | ok | none | |
| alerts | ok | ok | ok | ok | none | |
| privacy | ok | ok | ok | ok | `STEVEN_EMAIL_HERE` placeholder still shown | needs Steven |
| data-deletion | ok | ok | ok | ok | same placeholder | needs Steven |

Fixes: bot gate now 1.5 s, measured from the form's own send time (`n`) so clock drift cannot trip it; 503/400/429/offline messages rewritten kindly (no "storage is not connected"); docs/INTAKE.md and test/intake.test.js updated. add-390-dark.png is 197 KB.

Handed off: `test/weekend.test.js` fails (not mine; app weekend logic). Empty-state strings for app.js are in docs/COPY.md.
