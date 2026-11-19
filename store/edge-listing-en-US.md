# Microsoft Edge Add-ons Store Listing (English)

## Name

VideoTracker - Episode Progress Tracker

## Short description

Track episodes and watch time across streaming sites, with browser-account sync on your own devices.

## Full description

VideoTracker is a browser extension for keeping track of episodic video progress. It automatically detects standard HTML5 video players, including players inside iframes, and records the current show title, episode, playback position, duration, and watch time.

Start tracking the current video with one click. VideoTracker saves progress during playback and provides a full management page for reviewing the position, completion status, watching device, and last update time for every episode. Separate Watch History and Devices views support search, status filters, continue watching, deleting an episode, deleting a complete show, editing device names, and exporting or importing JSON backups.

Watch data is stored locally first and synchronized with Chromium browser-sync extension storage. Synchronization pulls and merges cloud data before selectively pushing newer local records, reducing the risk of overwriting newer cloud data with stale local state. A manual Sync Now action and a clear local/cloud alignment status are available in the management page.

The header provides network-information and Chinese/English controls. The device page lets users rename current and remote devices. LAN and public IP collection is optional, disabled by default, and runs only after the user explicitly enables network information. VideoTracker has no separate account system, does not sell user data, does not use advertising, and does not execute remote code.

## Single purpose

Record video episode progress and synchronize watch history between devices using the user's own browser-sync account.

## Permission justifications

- `tabs`: reads the active tab title, URL, audible state, and active state to identify the video being watched.
- `scripting`: checks standard HTML5 video elements in all frames on demand after the user starts tracking; no persistent content script is used.
- `storage`: stores local history, browser-sync history, device settings, and active tracking state.
- `alarms`: periodically updates tracked playback progress and checks synchronization.
- `activeTab`: reads the video page selected by the user.
- `http://*/*` and `https://*/*`: supports arbitrary video sites and cross-origin iframe players that are not known in advance. Detection is limited to standard HTML5 video elements.

## Remote code

No remote code is used.

## Data usage

Stores page titles, URLs, show and episode metadata, playback position, duration, watch time, device display name, browser, and platform. LAN and public IP addresses are optional and disabled by default. Data is used only for watch history, playback progress, and synchronization through the user's browser account.

## Privacy policy

https://github.com/Peterosh/VideoTracker/blob/main/PRIVACY.md
