# Set up Firebase for Mission Charts

The site runs in **preview mode** until this is done. Preview mode is sample data on one phone. It is not shared between people.

You are adding a web app named **Mission Charts** to the Firebase project **Brookhouser Family Apps**. Later family apps can live in the same project. This one keeps its data in collections whose names start with `missionCharts`, so the others can share the database without mixing.

Do this once, in order.

## 1. Open the project

Go to [Firebase console](https://console.firebase.google.com/) and open **Brookhouser Family Apps**. Create it first if it does not exist yet. A Google account that will be an owner (Kevin or Beth) is the right one to use.

## 2. Register the web app

1. Project overview → the gear → **Project settings**.
2. Under **Your apps**, choose **Add app** → **Web** (`</>`).
3. App nickname: `Mission Charts`.
4. Do **not** set up Firebase Hosting. The site is already on GitHub Pages.
5. Register the app and copy the `firebaseConfig` object. It looks like `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`.

## 3. Paste the config

The placeholders live in one file: `js/config.js`.

On GitHub, open:

https://github.com/brookhouser/mission-charts/edit/main/js/config.js

Replace each `YOUR_...` value with the matching field from the console. Leave the quotes. Commit the change to `main` (the button says **Commit changes**).

GitHub Pages updates a minute or two later. On the phone, hard-refresh the site (or close the tab and open it again). The sign-in screen should change from the four preview names to **Continue with Google**.

The web config is not a secret. It is visible in the app on purpose. Access is limited by the rules and the four Google accounts below.

## 4. Turn on Google sign-in

1. **Build** → **Authentication** → **Sign-in method** (or **Get started**, then the method).
2. Enable **Google**.
3. If it asks for a support email, use `brookhouser@gmail.com`.
4. Save.

If Google Cloud says the OAuth app is in **Testing**, add these four addresses as test users. Otherwise only the person who created the project can sign in:

- `sambrookhouser@gmail.com` (Sam)
- `wilsonbrookhouser@gmail.com` (Wally)
- `brookhouser@gmail.com` (Kevin)
- `bbrookhouser@gmail.com` (Beth)

Everyone else who tries Google sign-in is signed back out. The same list is enforced in `firestore.rules`.

## 5. Authorize the Pages domain

**Authentication** → **Settings** → **Authorized domains** → **Add domain**:

```
brookhouser.github.io
```

No `https://` and no `/mission-charts`. `localhost` is already there if you ever open the site on a computer.

## 6. Create Firestore

1. **Build** → **Firestore Database** → **Create database**.
2. Edition: standard Firestore is fine.
3. Location: **United States (nam5)** is a good default. You cannot change it later.
4. Start in **production mode**.

## 7. Publish the rules

1. Open the **Rules** tab.
2. Replace everything in the editor with the contents of [`firestore.rules`](firestore.rules) from this repo.
3. **Publish**.

What those rules do:

- Only the four Google accounts above can read or write Mission Charts data, and only through Google sign-in.
- Sam can read his two routines and check off his own days. Wally can do the same for his. Neither can see the other.
- A kid cannot set a tier, waive a night, change a school day, or edit the routine.
- Kevin and Beth can see both boys, confirm or change or waive the tier, toggle school days, and edit tasks.

Other future apps in this Firebase project are untouched as long as they use a different collection prefix.

Optional, if you install the Firebase CLI later: `npx firebase-tools deploy --only firestore:rules` from this folder. The console paste is enough.

## 8. Try it

Open https://brookhouser.github.io/mission-charts/ and sign in as `brookhouser@gmail.com`.

The four charts are built into the app, so they show up before anything is saved. The first time a parent taps **Save** in **Routines**, that chart is written to Firestore and both kids will see the edit. Check-offs and tiers are written the moment someone taps them.

Sam and Wally sign in with their own Gmail accounts. Each one only sees his chart.

## Add it to a phone

- iPhone: Safari → Share → **Add to Home Screen**.
- Android: Chrome menu → **Add to Home screen** or **Install app**.

## If something fails

- **“isn’t on the family list”** — that Google account is not one of the four. Sign out and use the right one. Check spelling, including `wilsonbrookhouser` for Wally.
- **“Missing or insufficient permissions”** or a save error — the rules were not published, or the signed-in account is a kid trying to do a parent action.
- **Popup closes immediately / unauthorized domain** — add `brookhouser.github.io` (step 5), and check the test users (step 4).
- **Still seeing Preview and the four names** — `js/config.js` on `main` still has `YOUR_` in it, or the phone is showing a cached copy. Hard-refresh.
- **Google says the app isn’t verified** — normal for a private family project. Continue, or add the four emails as test users.
