# Workbench
The all in one server

Stark Enterprises Workbench: Work, Educational, Media, Arcade, the Assistant and more, in one app.

**Discover** lists companies worth knowing (each with its own link, `…/Workbench/?from=its-name`), and **Spotlight** plays music from a featured artist. Both are managed on the owner's rig and published here. **Forms** (like Google Forms: company sign-ups, messages, anything) each get their own link and QR code once posted, and the answers go to the rig. The owner's phone can be a **Rig Remote**, and a device without Tailscale can use the rig's AI with a key made on the rig.

New to it? Open the **Table** tab (on the rail down the left): it explains every name the app uses, what each tab does, and how to connect a device.

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

To publish a new version, replace `index.html` in this repository with the new build and commit. Everyone gets it the next time they open the app. Since 6.18 the website's `index.html` is the light copy (about 7.6 MB): the screen-saver videos (`ss/`) and the Play cards' pictures and clips (`fm/`) sit beside it and load only when shown. The single-file build (everything inside, about 20 MB) is the one to save for use without internet.

## Workbench Hub (the home server)

The Hub runs on the computer that stays on at home. One folder there holds everything: Work, design files, music, videos and everyone's saves. Every device signs in once (your picture at the top right, then **Hub**) and keeps in step with it by itself, at home or away (through Tailscale). The Hub also sends phone notifications and runs the AI for every device.

**Set it up:** on that computer, download [hub/WorkbenchHub.zip](hub/WorkbenchHub.zip), unzip it and double-click **Install Workbench Hub**. The step-by-step guide is in [hub/README.md](hub/README.md). The Hub updates itself from this site.

## Your data stays on your devices

This repository holds only the app and the Hub program. Work files and invoices live in the folder you choose on your computer (and on your own Hub, if you set one up), and music, videos, notes and saves stay in the app on each device and on your Hub. None of it is uploaded here.

**Accounts:** on the website, each person chooses where their progress lives: **on this device** (nothing leaves the browser) or **with Google**, which keeps their profile, scores and settings on the owner's rig (never here) so they can sign in on another device. Block World worlds always stay in the browser they were made in. Anyone can delete their copy from the rig from Account → Profile.

**Counting visitors:** the website counts how many devices open it each day, anonymously, through GoatCounter: no names, nothing you type, no cookies. Devices that ask websites not to track them are never counted, a copy opened from a file never is, and anyone can switch it off in the Table tab (Counting).
