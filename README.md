# Workbench
The all in one server

Stark Enterprises Workbench: Work, Educational, Media, Arcade, the Assistant and more, in one app.

**Open it:** https://tonystarkofficial1111-web.github.io/Workbench/

## Install it as an app

**Windows (Edge or Chrome)**
1. Open the address above.
2. Click the install icon at the right end of the address bar (Edge: "App available"; Chrome: a small screen with a down arrow), or go to **⋯ → Apps → Install Workbench**.
3. Workbench gets its own window, a Start menu entry and a taskbar icon.

**Android**
- Install the Workbench APK. To build it, enter `https://tonystarkofficial1111-web.github.io/Workbench/install.html` at pwabuilder.com (the small install page loads instantly; the APK opens the full app), or
- open the address in Chrome → **⋮ → Add to Home screen → Install**.

## Updates

Nothing to download by hand. Every time Workbench opens with internet, it checks this site and loads the newest version; without internet it opens the copy saved on the device.

To publish a new version, replace `index.html` in this repository with the new build and commit. Everyone gets it the next time they open the app.

## Workbench Hub (the home server)

The Hub runs on the computer that stays on at home. One folder there holds everything: Work, design files, music, videos and everyone's saves. Every device signs in once (the bell at the top right, then **Hub**) and keeps in step with it by itself, at home or away (through Tailscale). The Hub also sends phone notifications and runs the AI for every device.

**Set it up:** on that computer, download [hub/WorkbenchHub.zip](hub/WorkbenchHub.zip), unzip it and double-click **Install Workbench Hub**. The step-by-step guide is in [hub/README.md](hub/README.md). The Hub updates itself from this site.

## Your data stays on your devices

This repository holds only the app and the Hub program. Work files and invoices live in the folder you choose on your computer (and on your own Hub, if you set one up), and music, videos, notes and saves stay in the app on each device and on your Hub. None of it is uploaded here.
