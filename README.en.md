[简体中文](README.md) | **English**

# VideoTracker

A browser extension for Microsoft Edge and Google Chrome that records the current episode and playback position of TV series and anime, then synchronizes watch history across devices.

**Microsoft Edge Add-ons:** [Install VideoTracker](https://microsoftedge.microsoft.com/addons/detail/%E5%89%A7%E8%BF%B9-videotracker/edpemnlileelclgelhbgjdlglhbeffjb)

## Features

- Automatically detects HTML5 videos, show titles, episode labels, and playback time, including players inside iframes.
- The extension popup includes Current Video and Tracked Shows tabs for starting or stopping tracking, searching saved shows, and syncing immediately.
- Start or stop tracking the current episode with one click.
- Reopening a saved show in a new tab or after restarting the browser automatically resumes tracking. A show explicitly stopped by the user is not resumed automatically.
- Automatically saves playback position and updates the record when the episode changes.
- Records the highest episode ever watched for each show and displays the latest episode found on the site in both the popup and management page.
- While the browser is running, checks tracked shows for new episodes every hour and shows a New tag plus a `NEW` badge on the extension icon.
- Treats an episode as complete after 80% of the video has played naturally, so ending credits can be skipped. Seeking directly to the end is not treated as natural completion.
- Filters common ad overlays, short Tencent Video ads, source changes, and abnormal durations. Ad playback does not overwrite content progress.
- The management page shows the playback position, total duration, progress, watch time, and completion status for every episode.
- Continue Watching opens the most recent unfinished episode and resumes three seconds before the saved position. If a site blocks automatic positioning, the page still opens normally.
- Watch History and Devices are separate management views. Language and network-information controls are available in the header.
- Episode records store the viewing device name, browser, operating system, LAN IP, and public IP.
- Supports Chinese and English interfaces and follows the browser language by default.
- LAN and public IP collection is disabled by default and must be enabled explicitly from the management page header.
- Supports manual editing of show titles, episode labels, device names, and episode detection behavior.
- Supports deleting a complete show or an individual episode record.
- Supports pinning frequently watched shows so they appear first in the watch-history list.
- Saves complete records locally and synchronizes them through the current browser account.
- Pulls and merges cloud records before uploading, and only uploads newer local records to avoid replacing newer cloud data.
- Supports manual synchronization and shows whether local and cloud storage are aligned.
- Supports JSON backup export and import.
- When playback position regresses or an older episode is selected, the change must persist for at least one minute before it is saved, preventing player loading or automatic jumps from overwriting records.

## Installation

### Microsoft Edge

Install from [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/%E5%89%A7%E8%BF%B9-videotracker/edpemnlileelclgelhbgjdlglhbeffjb).

Developer installation:

1. Open `edge://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked and select the project directory.

### Google Chrome

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked and select the project directory.

Keep one installed copy of the extension. To update it, click Reload instead of installing duplicate copies from different directories.

## Usage

### Start Tracking

1. Open a video playback page and start playback.
2. Click the VideoTracker icon in the browser toolbar.
3. Review the detected show title and episode label, and edit them if needed.
4. Click Start Tracking.
5. The extension saves the current episode and playback position during playback.

### Manage Watch History

1. Click the list icon in the top-right corner of the extension popup.
2. Select a show from the left panel.
3. Review the highest watched episode, latest episode found on the site, and each episode's playback position, total duration, progress, and viewing device.
4. Filter records with All, Watching, and Completed.
5. Click Continue Watching next to the show title to open the most recent unfinished episode at the saved playback position.
6. Use the button next to an episode to open it at the saved position; use the delete button to remove that episode record.
7. Use Delete Show to delete a complete show and all of its episode records.
8. Use the pin button next to a show to pin or unpin it.

### Check for New Episodes

1. Keep the browser running. The extension checks tracked shows after installation, when the browser starts, and once per hour afterward.
2. You do not need to open the popup or management page. When a new episode is found, the tracked list shows New and the extension icon shows a `NEW` badge.
3. The latest episode number only moves upward and will not regress because a page temporarily displays older content.
4. Some sites render episode lists with JavaScript, block background requests, or require additional verification. In those cases the check may fail; the management page shows the reason while keeping the previously detected latest episode.
5. Background checks cannot run while the browser is completely closed.

### Synchronization

1. Sign in to the same Edge or Chrome account on each device.
2. Enable browser synchronization.
3. Click Sync Now in the management page or the top-right corner of the extension popup.
4. When Local and cloud are aligned is displayed, local records and synchronized storage are consistent.

### Device Names

1. Open Devices at the top of the management page.
2. Edit a device name directly.
3. Updated names synchronize to other devices.

### Display Settings

1. Use the language menu in the top-right corner of the management page to switch between Chinese and English.
2. Use the Network information toggle in the top-right corner to control LAN and public IP collection.

### Backup

- Click Export backup to save all current shows and episode records.
- Click Import backup and select a previously exported JSON file. Records are merged by update time.
