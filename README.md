# Hall Pass

Hall Pass rates University of Minnesota dining hall food for your goal, builds a plate, and tracks protein, calories, fiber and key vitamins.

Independent project by a UMN student (Aaryan Maharaj). Not affiliated with or endorsed by the University of Minnesota, M Food Co., Chartwells or Dine On Campus.

## How the daily update works

Once a day (4:23 AM Central in winter, 5:23 AM in summer; GitHub sometimes starts a few minutes late), a GitHub Action:

1. Runs the offline tests.
2. Reads today's published UMN menus (`scripts/fetch-umn.mjs`): UMN only, about 35 requests, one at a time with a pause. It never retries 404s, retries busy or server errors at most 3 times (waiting as the server asks), and stops the whole run after 3 failed requests in a row.
3. Runs safety checks. If the new menu looks broken (for example fewer dining halls than yesterday, or far fewer foods), it keeps yesterday's menu and the app says it's showing an earlier day.
4. Saves `data/umn.json` and a run summary in `data/last-run.json`.
5. Builds `site/index.html` and publishes it with GitHub Pages.

Permission: M Food Co. (UMN Dining) said by email on Nov 6, 2026 that using the published menus is fine as long as it doesn't affect their website, and that the thread is not an endorsement. Keep that email. Keep the update to once a day, and never describe the app as official, endorsed or partnered.

## One-time setup

1. **GitHub account.** Sign up at github.com. Students can claim the free GitHub Student Developer Pack.
2. **Create a repository** named `DINING`. On a free account it must be **Public** for GitHub Pages to work. (A private repository needs GitHub Pro, included in the Student Pack.) Either way the website itself is public to anyone with the link, and its page contains the menu, so "private" only hides your code and history.
3. **Add the files.** Easiest: give Claude the repository name and it can push everything. By hand: on the repository page, "Add file → Upload files" and drag in everything **except** the `.github` folder (browser uploads often skip it). Then "Add file → Create new file", type the name `.github/workflows/daily.yml`, and paste in that file's contents.
4. **Turn on Pages:** Settings → Pages → Build and deployment → Source: **GitHub Actions**.
5. **First live run:** Actions tab → "Daily UMN menu" → Run workflow. When it finishes, open the run and read the "Read today's UMN menu" step. A green check is not enough on its own:
   - `Saved data/umn.json: N places (N dining halls), N foods` → it worked. Your site link is on the run page.
   - A yellow warning such as `Not publishing` or `Update failed, keeping the previous menu` → the site still works with the saved menu. Copy the log (and `data/last-run.json`) and send it to Claude to adjust.
6. **Share the link** only with pilot testers at first. The page asks search engines not to list it.

## Files

| Path | What it is |
| --- | --- |
| `app/app.src.html` | The app (one file). `__UMN_JSON__` is where the menu goes; `/*LIVE*/false` turns on website mode. |
| `data/umn.json` | Today's UMN menu in the app's format. |
| `data/last-run.json` | Summary of the last update: requests, places, foods, problems. |
| `scripts/fetch-umn.mjs` | The daily menu reader. |
| `scripts/lib/convert.mjs` | Converts menu responses into the app's format, plus safety checks. |
| `scripts/build.mjs` | Builds `site/index.html`. |
| `tests/run-tests.mjs` | Offline tests (`node tests/run-tests.mjs`), using the frozen menu in `tests/fixtures/`. |

## Local commands

```
node tests/run-tests.mjs          # offline tests, no internet
node scripts/fetch-umn.mjs --dry  # live read without saving (use sparingly)
node scripts/build.mjs            # build site/index.html
```
