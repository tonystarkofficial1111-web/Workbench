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
1. In Workbench, press the **bell** at the top right, then **Connect the Hub**.
2. Enter the address, your name and your PIN, then press **Connect**.
3. Start with the laptop, because its Work folder goes up to the rig first.
4. Then do the phone: Work, design files, saves and settings come over by themselves. Open Work with your usual Work PIN.

### 5. Phone notifications
On the phone, in the Workbench app: bell → Hub → **Notifications on this device** → **Turn on** → Allow. Then press **Send a test**.

### 6. Family
In the Hub window, under **People**, add each person with their own PIN. They sign in on their own device with that name and PIN. Each person sees only their own music, videos and saves. Work stays with you and the people you tick as **Can open Work**, and it still asks for the Work PIN.

### 7. Music and videos
You can add music and videos in two ways:
- In the Hub window, use **Send music to the rig** or **Send videos**.
- On the rig, copy files into the Hub folder:
  - `Users\<your name>\Music` and `Users\<your name>\Videos` for your own files
  - `Shared\Music` and `Shared\Videos` for everyone

To play them:
- **Anywhere:** Media → **Rig library**. Press play to stream from the rig, or **Keep** to download onto this device for offline. On a laptop with room to spare you can keep a whole library.
- **For DJing:** Work → DJ → Library → **Rig library**. The tracks play on whichever computer is DJing.

### 8. Move the AI off the laptop
1. On every device: bell → Hub → **Use the rig's AI here**.
2. On the laptop, uninstall Ollama: Settings → Apps → Installed apps → Ollama → Uninstall.
3. Delete the `.ollama` folder in your user folder. It holds the models, which are several GB.
4. You can also delete the OLLAMA_ORIGINS and OLLAMA_HOST environment variables. They're no longer needed.

## Good to know
- **Updates:** the Hub updates itself from the Workbench site. Nothing to do on the rig.
- **Backups:**
  - **Work data:** a copy of work.json is saved every day in the Hub folder (`.hub\backups`, the last 90 days).
  - **When the second drive arrives:** set `"backupDir": "E:\\Backups"` in `%LOCALAPPDATA%\WorkbenchHub\hub.json` to keep a copy there too.
  - **More music folders on that drive:** add them under `"libraries"` in the same file, for example `[{ "path": "E:\\Music", "kind": "music" }]`.
- **Forgot a PIN?** On the rig, run `reset-pin.bat` from the installer folder.
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
