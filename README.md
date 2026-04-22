# ViperEdit

A powerful, Apple-glass document editor. No build step, no backend — every
file is static HTML/CSS/JS and your work lives in the browser's IndexedDB.

## Run it locally

Double-click `index.html`, or open it from a terminal:

```
xdg-open index.html       # Linux
open index.html           # macOS
start index.html          # Windows
```

That's it — the editor works **completely offline** from `file://`. Google Fonts
load from the CDN when you're online; when offline, system fonts take over.

For a nicer URL and to enable Google Sign-in, serve it instead:

```
cd ViperEdit
python3 -m http.server 8000
# then open http://localhost:8000
```

## Host it for free

ViperEdit is a pure static site — drop the folder onto any free static host:

| Host | Notes |
| --- | --- |
| **GitHub Pages** | `git push` to a repo → enable Pages → it's live at `https://YOU.github.io/viperedit` |
| **Cloudflare Pages** | Connect the repo, no build command, publish directory = `.` |
| **Netlify / Vercel** | Same idea — static folder, no build step |

## Add your logo

Save the ViperShard logo image as **`logo.png`** in this folder. The topbar
picks it up automatically; if it's missing, a purple-gradient SVG fallback
renders instead. Any square PNG works best (~200×200 px).

## Add your apps to the launcher

Open `apps.js` and add entries to the array:

```js
{ id: 'vipersheet', name: 'ViperSheet', desc: 'Spreadsheets',
  icon: '▦', accent: '#0891b2', url: 'https://your-domain/vipersheet/' }
```

The ViperShard logo in the topbar opens a Google-style app grid that lists them.

## Enable "Sign in with Google"

Google Sign-in requires a Client ID and an `https://` origin (or
`http://localhost`). The app works in guest mode without it.

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. Create a project.
3. **Create Credentials → OAuth 2.0 Client ID → Web application**.
4. Under *Authorized JavaScript origins* add:
   - your hosted URL (e.g. `https://you.github.io`)
   - `http://localhost:8000` for local testing
5. Copy the Client ID and paste it into `config.js`:

   ```js
   window.VE_CONFIG = {
     googleClientId: '1234567890-abcxyz.apps.googleusercontent.com'
   };
   ```

Each signed-in Google account gets its **own private workspace** — documents,
wallpaper, settings, presets. Signing out returns to a "guest" workspace.

## Storage

All data lives in **IndexedDB** under the origin you host from. Per-account
quotas are browser-dependent but generous — typically **several GB** of free
disk space per origin on desktop browsers.

Practical numbers (per account):

| Doc kind | Approx. size | How many fit in ~1 GB |
| --- | --- | --- |
| Plain text | 10 KB | ~100,000 |
| Formatted + small image | 200 KB | ~5,000 |
| Image-heavy (~2 MB each) | 2 MB | ~500 |

ViperEdit also:

- Compresses wallpaper uploads to 1920px at JPEG 85% quality (big files shrink from megabytes to ~100–300 KB with no visible loss).
- Requests **persistent storage** (`navigator.storage.persist()`) when you sign in, so the browser will avoid evicting your data.
- Shows a live storage meter in the profile menu.

If you ever want true unlimited cloud sync, drop in a free backend tier
(Firebase Firestore 1 GiB free, Cloudflare D1 5 GB free, Supabase 500 MB free)
and wire it into `Persist.saveDoc` / `loadAll`.

## File map

```
ViperEdit/
├── index.html      UI scaffolding
├── style.css       Apple crystal-white design system
├── config.js       Google Client ID slot
├── apps.js         ViperShard app registry (launcher content)
├── auth.js         Google Identity Services integration
├── idb.js          IndexedDB wrapper + per-account namespacing
├── fonts.js        Google Fonts catalog
├── templates.js    Document templates shown in the hub
├── editor.js       Everything else (editor, hub, settings, palette, find, …)
└── logo.png        (Save your ViperShard logo here)
```
