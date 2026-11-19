# Publishing on Google Play

Everything the repo can prepare is already done: a signed-release build, store graphics, listing text and a privacy-policy page. This guide covers the steps that only you can do, in order. Google's rules change, so where a requirement is marked **verify**, check Play Console's current wording.

| Already decided | Value |
| --- | --- |
| App name on the device | ToolHaven |
| Store title | ToolHaven: PDF & Video Tools |
| Package id (permanent) | `app.toolhaven.studio` |
| Public contact email | babaralikhan5551@gmail.com |
| Privacy policy URL (after step 3) | https://shoukattaz-ux.github.io/alltoolappforweb/privacy.html |

Ready-made files: `store/listing.json` (all store text), `store/icon-512.png`, `store/feature-graphic-1024x500.png`, `store/screenshots/` (6 phone screenshots, 1080x1920).

## 1. Create your Google Play developer account

1. Go to <https://play.google.com/console/signup> and sign in with the Google account you want to own the app.
2. Pay the one-time registration fee (US$25 at the time of writing) and complete identity verification. **verify**
3. **Closed-testing rule (verify):** newly created *personal* developer accounts have had to run a **closed test with at least 12 testers for 14 continuous days** before they can publish to production. Organization accounts are exempt. Ask 12+ friends or colleagues for their Google-account emails early, because this is the longest part of the process.

## 2. Create the upload key and add the secrets (one time)

The upload key proves that updates come from you. **Lose it and you cannot update the app without Google's help, so back it up** (for example in a password manager). Never commit it. Run this on your own computer (it needs Java's `keytool`):

```bash
keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Choose strong passwords and remember them. Then base64-encode the file:

```bash
base64 -w0 upload.jks          # Linux
base64 -i upload.jks | tr -d '\n'   # macOS
```

In GitHub: **Settings > Secrets and variables > Actions > New repository secret**, and add these four:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 text from above |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | the key password |

## 3. Publish the privacy-policy page

Google Play requires a public privacy-policy URL.

1. Merge the pull request into `main`.
2. In GitHub: **Settings > Branches**, make `main` the default branch (the repo was created with the work branch as default, and Pages deploys from the default branch).
3. **Settings > Pages > Build and deployment > Source: GitHub Actions**.
4. Open **Actions > Privacy site (GitHub Pages) > Run workflow** (it also runs on every push to `main`).
5. Open <https://shoukattaz-ux.github.io/alltoolappforweb/privacy.html> and check it loads. That is the URL for Play Console.

## 4. Build the release

**Actions > Android release (signed AAB for Google Play) > Run workflow**, enter a version such as `1.0.0`. It runs the tests, builds, signs, and checks that the result has the right version, is signed, is not debuggable and requests no `INTERNET` permission. Download the artifact `toolhaven-release-...`: it contains `app-release.aab` (upload this to Play) and `app-release.apk` (for installing on a phone to test).

Each run gets a higher version code automatically (Play rejects a repeat). To ship an update later, just run the workflow again with a new version name.

## 5. Create the app in Play Console

**Create app**: name `ToolHaven: PDF & Video Tools`, default language English, **App** (not game), **Free**, accept the declarations.

### Set up your app (the "Dashboard" checklist)

| Item | What to answer |
| --- | --- |
| Privacy policy | The URL from step 3 |
| App access | All functionality is available without special access or login |
| Ads | **No**, the app contains no ads |
| Content rating | Fill in the questionnaire honestly: category *Utility / Productivity*, no violence, no user-generated content, no sharing of location, no purchases. Expect the lowest age rating |
| Target audience | **13 and over** (it is a general utility, not designed for children) |
| Data safety | **No data collected, no data shared.** The app has no network permission and no servers. Encryption in transit: not applicable. Data deletion: not applicable |
| Government / financial / news app | No |
| Health | The app has a BMI calculator with a "not medical advice" disclaimer. If Play's health declaration asks, answer accurately: a general-information calculator, not a medical device and no health data stored |
| COVID-19 / other special declarations | No |

### Main store listing

Copy the text from `store/listing.json` (title, short description, full description). Category **Tools**. Contact email `babaralikhan5551@gmail.com` (shown publicly). Upload `store/icon-512.png`, `store/feature-graphic-1024x500.png` and the six phone screenshots. Tablet screenshots are optional.

## 6. Test first, then release

1. **Testing > Closed testing** (or Internal testing for a quick check): create a track, add your testers' emails, and create a release uploading the `.aab`. When Play asks about **Play App Signing**, accept the default (Google keeps the app-signing key; your upload key stays with you).
2. Install from the testers' opt-in link on real phones and try every tool, especially video compression and saving a file. Fix anything you find, then run the release workflow again for a new build.
3. After the required closed-testing period (step 1), **Production > Create release**, upload the tested `.aab`, add release notes from `store/listing.json`, and submit. The first review can take several days.

## Likely review problems and how this app avoids them

- **"Minimum functionality / web view wrapper"**: the app is not a website in a frame. Every tool is bundled inside the app, works offline, and uses native features (the share sheet for saving files). Keep the listing text factual, as it is now.
- **Permissions**: the app requests none, so there is nothing to justify. (The build includes one internal AndroidX permission scoped to the app itself, `app.toolhaven.studio.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. It grants no access and is not shown to users.)
- **Target API level**: the app targets API 36. Play raises its minimum each year, so after each Android release check that `targetSdkVersion` in `android/variables.gradle` is still accepted. **verify**
- **Misleading claims**: the listing says what the app does and does not do (for example, the PDF Signer adds a signature image and is not a certificate-based digital signature).

## Regenerating things

```bash
npm run store:assets    # screenshots, icon and feature graphic (build the web app first: npm run build)
npm run site            # the privacy-policy web page into site/
npm run og              # the link-preview image
npm run android:assets  # the launcher icons and splash screens
```

`npm test` checks the listing's character limits, the graphics' sizes, that the manifest declares no permissions, and that the privacy policy still matches what the code stores.
