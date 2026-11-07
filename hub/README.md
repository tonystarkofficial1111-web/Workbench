# Workbench Hub

The Hub is a small server that runs on the rig: the computer that stays on. It keeps one folder on one drive, and that folder holds everything:

- Work: jobs, customers and leads, plus every design file and version.
- Music and videos, for each person.
- Everyone's saves and settings.

Every device runs Workbench and keeps in step with the Hub by itself:

- **Your devices:** the Android phone, the laptop, and the family's devices.
- **Opening Workbench:** the app gets the rig's latest. Changes go back up as you work.
- **Away from home:** at school or a coffee shop it works the same way, through Tailscale.
- **Offline:** each device keeps going with its last copy.
- **Conflicts:** if the same thing was changed on a device and on the rig, Workbench asks you which one to keep.
- **Phone notifications:** follow-ups, due jobs and money to collect arrive even when the app is closed.
- **The AI:** Ollama runs on the rig's graphics card for every device.

**The full step-by-step guide, with tick boxes:** https://tonystarkofficial1111-web.github.io/Workbench/hub/guide.html

## Setting it up (about 20 minutes, once)

### 1. Tailscale on the rig
1. Install Tailscale from https://tailscale.com/download and sign in.
2. Open https://login.tailscale.com/admin/dns and turn on **MagicDNS** and **HTTPS Certificates**.

### 2. The Hub on the rig
1. On the rig, download https://tonystarkofficial1111-web.github.io/Workbench/hub/WorkbenchHub.zip.
2. Right-click the zip, choose **Extract All**, and open the folder.
3. Double-click **Install Workbench Hub**. If Windows says "Windows protected your PC", press **More info**, then **Run anyway**. The installer is a plain script you can open and read.
4. Answer its questions:
   - **Where to keep everything:** pick the drive with the most space. You can add a second drive later.
   - **Your name and a PIN:** you use these to sign in on every device.
   - **Install the AI (Ollama) and the model:** say yes. It's about 6 GB and runs on the rig's graphics card (8 GB of graphics memory is enough).
5. At the end it shows your Hub's address, for example `https://rig.tail1234.ts.net`, and copies it for you.

The Hub now starts with Windows and has an icon in the tray. Right-click the icon to:
- open Workbench
- open the Hub folder
- copy the address
- restart the Hub
- see the log

**With the monitor unplugged:** the Hub starts when Windows signs in. So that it comes back by itself after Windows updates, go to Settings → Accounts → Sign-in options and turn on **Use my sign-in info to automatically finish setting up after an update**. The installer has already turned sleep off while the rig is plugged in.

### 3. Tailscale on the other devices
Install Tailscale on the phone (Play Store) and the laptop, and sign in with the same account.

For family members, either:
- sign their devices into your Tailscale too, or
- if they have their own Tailscale account, share the rig with them: Tailscale admin → Machines → the rig → ⋯ → Share.

### 4. Sign in on each device
1. In Workbench, press **your picture** at the top right (the menu), then **Hub**.
2. Enter the address, your name and your PIN, then press **Connect**.
3. Start with the laptop, because its Work folder goes up to the rig first.
4. Then do the phone: Work, design files, saves and settings come over by themselves. Open Work with your usual Work PIN.

### 5. Phone notifications
On the phone, in the Workbench app: your picture (top right) → Hub → **Notifications on this device** → **Turn on** → Allow. Then press **Send a test**.

### The Rig
The **Rig** is one screen (6.12): Rig Start, with Manage the rig under it. It's in **Developer options** (the Stark emblem, bottom right), under **Work**, so it's out of sight; only the owner's sign-in sees it (a small **Rig | Table** switch opens the Table, the glossary). The whole dashboard fits the window, so it can stay open on the rig's screen: the eight cards across the top (processor, memory, graphics card, storage, AI, people, website visitors, Hub, with this week's graphs), then notifications, your to-dos (new form answers, company sign-ups, messages, songs to approve, changes to publish), traffic, and who's on the Hub (online now, and who was last seen when), and under them the rig's details in small cards: processor, memory and graphics card (name, video memory, power, fan), every drive, the AI and its models, and the Hub (running time, system, updates, last backup). Open a to-do to read everything, then decide. On the laptop or the phone, Rig Start shows after the access code. Nothing private is shown or even sent: no addresses, folder paths, drive letters, driver version, programs or private network.

Changes to the rig are made from Workbench **on the rig itself**, after typing the Assistant's access code: its folders, its people (add, new PIN, allow Work, remove, sign a device out), adding music and videos, and loading or letting go of the AI's model. On the laptop and the phone the Rig is view-only, unless the phone is a **Rig Remote** (below). The Hub knows a request comes from the rig because Tailscale passes along who is asking, and since 1.5.0 the Hub itself refuses rig settings (folders, people, keys, publishing setup) from anywhere but the rig.

### Rig Remote (your phone)
On the phone: Rig → **Ask the rig**. On the rig: Rig Start → To do → **Rig Remote request** → **Allow**. After the access code, the phone gets the controls: post or take down forms, publish, load or let go of the AI, restart the Hub, sign devices out (not the rig itself). Its notifications get buttons (**Approve** and **Turn down** on a company sign-up, **Done** on other answers, **Passed on** on messages) that decide on the rig without opening Workbench; each button works once. With Workbench installed, press and hold its icon → **Rig Remote**. Remove a phone in Manage the rig → **Remote**.

### Connect with a code (1.6.0)
Rig → Manage the rig → **Remote** → **Make a code** (for you, or for a person). On the other device: your picture → Hub → **Have a code?**. The device finds the rig through the website (which publishes the inbox's address), the code proves it's allowed, and the rig signs the device in as that person: no Tailscale, address or PIN. The code is 6 characters, works once, runs out in 5 minutes, and wrong tries are limited. For you it makes a Rig Remote, which can now do everything the rig's screen can; making keys and codes and choosing Rig Remotes stay on the rig itself.

### Trails, stamps, updates and reports (1.7.0)
Rig → Manage the rig → Discover. **Stamp QR** (per company) is a QR to print for its counter; it opens Workbench with `?stamp=name.WORD` and collects that stamp on the visitor's device (since 1.9.0 the website holds only a slow, salted scramble of each word, PBKDF2 with 50,000 rounds, so the word can't be worked out from the published file; new words are 8 letters, older 5-letter ones keep working. It still isn't a lock: a QR someone photographs can be shared. A finished trail's reward screen shows a ticking clock so an old screenshot doesn't pass). **New trail** joins 2 to 6 companies with a reward shown when all stamps are collected. **Update** adds a short note to a company's page (the newest 5 show). **Report** makes a one-page monthly summary (page opens, link visits, messages, stamps) to print or save as a PDF; it uses the anonymous counts below, so it starts counting from 1.6.0.

### The rig's browser (1.8.0)
A real Edge or Chrome that runs headless on the rig for one person at a time (the owner, and people the owner allows under Manage the rig → Browser). It shows in Workbench under Account → Profile → Accessibility as the fourth tile. Its picture is sent to the person's device as JPEGs; clicks and keys go back through the Hub. Each session uses a throwaway profile that is deleted when it ends (and after 10 idle minutes), downloads are refused, and everything it requests goes through a small filter on the rig (`browser.js`) that only connects to public addresses: loopback, the home network, link-local, the tailnet (100.64/10) and names like localhost, `.local` or `.ts.net` are refused, and the filter connects to the address it checked, so a DNS trick can't point it back at the rig. It won't start below about 1 GB of free memory. Only host names are kept (`.hub/browser-log.json`: who, when, site). It needs Hub 1.8.0 and Microsoft Edge or Google Chrome on the rig.

### Keeping visitor counts alive (1.9.0)
The inbox is how visitor counts, forms and messages reach the rig, so every 10 minutes the Hub checks it: does Tailscale still give the rig the address the website was told, and does the inbox answer from the internet? If the Funnel dropped (an update, a restart) it is switched on again. If the address moved, the Hub picks up the new one, adds "The rig's address changed" to the notifications and marks the website for a publish (Rig Start's To do says why; publishing clears it). If the inbox stays silent, Rig Start's To do and the Website tab say so ("Check it now" runs the check at once), once in the notifications until it's back. On the visitor's side, a count that couldn't be sent (rig off, no connection) waits on their device for up to two days and goes with their next visit. The first time a friend opens the rig's browser they read and accept a short notice (what the owner sees, what passes through the rig); the Hub remembers it per person.

### Traffic and company of the day (1.6.0)
The website tells the rig, anonymously, when it was opened, a company's page or link was used, or a form was opened or sent (`/hit` on the inbox: just a word and a slug, no addresses, 70 days of daily counts in `.hub/traffic.json`; never from the owner's own devices). Rig Start's **Traffic** card shows them on the rig and on a Rig Remote only. Discover's proof cards use them ("N people opened this page", only when it's real). **Spotlight today** on a company gives it the big Start tile for that day.

### Use from anywhere (no Tailscale)
For a device without Tailscale, like a Chromebook: Manage the rig → **Remote** → **Make a key**. The rig shows one address, `https://rig.<tailnet>.ts.net:8443/k/wbk_…`, on the inbox's Funnel. Paste it as the AI's address in the Assistant's settings (the key alone reaches the AI), or as the Hub address with a name and PIN to use the whole Hub (if the key allows sign-in). Without a valid key the door answers nothing; wrong keys are limited per address; through a key the device is never treated as the rig. **Remove** a key and it stops working straight away.

### Discover and Spotlight
**Discover** lists companies for everyone who opens Workbench, and **Spotlight** plays an artist's songs. Both are managed on the rig and then published to the Workbench website, so they're there even while the rig is off:

- **Publishing:** Rig → Manage the rig → **Website** (or the first **Post** on a form): paste a GitHub fine-grained key that can only write to the Workbench repository (Contents: Read and write). **Publish now** sends the companies and approved songs to the site's `public/` folder.
- **The inbox:** form answers and messages to companies arrive through a small public door on the rig (its own port, `8771`, shared with Tailscale Funnel on `:8443`). It only accepts those, limits how often, and your home address stays hidden behind Tailscale.
- **Companies:** add, edit, feature (shows a Featured tag), hide, give a logo, and copy each company's own link (`…/Workbench/?from=its-name`); visitors who arrive through it are counted anonymously for that company.
- **The artist:** add a person with **Spotlight artist** ticked. They add songs and their profile from the Spotlight tab; songs wait for the owner's approval.

### Forms
Workbench's own forms, like Google Forms: Rig → Manage the rig → **Forms**. Each form says **On the website** or **Not posted**: **Post** puts that one form on the website and in Discover, **Take down** removes it, **View** shows it as people see it. Three are ready (List your company, Contact Workbench, Be on Spotlight), and **New form** makes any other (short answer, paragraph, multiple choice, checkboxes, dropdown, email, phone, date, number, link, picture upload). Each form has its own link (`…/Workbench/?form=its-name`) and a QR code made inside Workbench; posted forms also show in Discover.

When someone answers, the Hub's tray icon shows a pop-up by the clock (click it to open the Rig), your phone gets a notification, and it waits in Rig Start's to-dos. Approving a company sign-up makes its company page from the answers; publish to put it on the website. The Hub keeps a week of telemetry (every 10 minutes) for Rig Start's graphs.

### 6. Family
On the rig, in the **Rig** tab under **People**, add each person with their own PIN. They sign in on their own device with that name and PIN. Each person sees only their own music, videos and saves. Work stays with you and the people you tick as **Can open Work**, and it still asks for the Work PIN.

### 7. Music and videos
You can add music and videos in two ways:
- On the rig, in the **Rig** tab: **Add music** or **Add videos**. From another device: Media → **Rig library** → **Send to the rig**.
- On the rig, copy files into the Hub folder:
  - `Users\<your name>\Music` and `Users\<your name>\Videos` for your own files
  - `Shared\Music` and `Shared\Videos` for everyone

To play them:
- **Anywhere:** Media → **Rig library**. Press play to stream from the rig, or **Keep** to download onto this device for offline. On a laptop with room to spare you can keep a whole library.
- **For DJing:** Work → DJ → Library → **Rig library**. The tracks play on whichever computer is DJing.

### Your own big folder
Got one folder with everything in it? Give its path to the installer, or add it later on the rig: **Rig** tab → **Folders on the rig** → paste the folder's address (or **Browse…** through the rig's drives).

- **Nothing is moved or copied:** it's read where it is, and new files show up by themselves.
- **What it picks out:** music and videos, by their folder names (Music, Songs, DJ, Videos, Movies…) and file types.
- **What it leaves alone:** photo and camera folders, programs and tiny sound effects.

### Save from a link
In Media → Rig library → **Save from a link**, paste a link to an MP3 or MP4:
- a file you own
- free or Creative Commons music
- a file in your own Google Drive or Dropbox

The rig downloads it into your Music or Videos, even while your devices are off. Streaming sites (YouTube, Spotify, SoundCloud…) aren't downloaded from.

### 8. Move the AI off the laptop
1. On every device: your picture (top right) → Hub → **Use the rig's AI here**.
2. On the laptop, uninstall Ollama: Settings → Apps → Installed apps → Ollama → Uninstall.
3. Delete the `.ollama` folder in your user folder. It holds the models, which are several GB.
4. You can also delete the OLLAMA_ORIGINS and OLLAMA_HOST environment variables. They're no longer needed.

## Good to know
- **Updates:** the Hub updates itself from the Workbench site. Nothing to do on the rig.
- **Backups:**
  - **Work data:** a copy of work.json is saved every day in the Hub folder (`.hub\backups`, the last 90 days).
  - **When the second drive arrives:** set `"backupDir": "E:\\Backups"` in `%LOCALAPPDATA%\WorkbenchHub\hub.json` to keep a copy there too.
  - **More music folders on that drive:** add them under `"libraries"` in the same file, for example `[{ "path": "E:\\Music", "kind": "music" }]`.
- **Forgot a PIN?** For family: on the rig, **Rig** tab → **People** → **New PIN**. For the owner: on the rig, run `reset-pin.bat` from the installer folder.
- **"Can't reach the Hub":** check that the rig is on and that Tailscale is on on the device. On the rig, the tray icon should say Online.
- **Removing it:** run `uninstall.ps1` from `%LOCALAPPDATA%\WorkbenchHub\app`. Your Hub folder and files stay.

## For the curious
- **What it is:** plain Node.js with no packages. Node is downloaded by the installer into `%LOCALAPPDATA%\WorkbenchHub\node`.
- **Where it listens:** only on `127.0.0.1:8770`. Tailscale (`tailscale serve`) makes it reachable as https inside your tailnet, so nothing is open to the internet.
- **Phone notifications:** standard Web Push, signed with the Hub's own keys.
- **Files:**

| File | What it does |
|---|---|
| `server.js` | The Hub |
| `push.js` | Notifications |
| `tags.js` | Song titles |
| `reminders.js` | The same reminder rules as the app |
| `tray.ps1`, `launch.vbs` | Tray icon and start-up |
| `install.ps1` | Setup |
