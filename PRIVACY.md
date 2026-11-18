# VideoTracker Privacy Policy / 剧迹隐私政策

Last updated: 2026-11-18

## English

VideoTracker is a browser extension for recording episodic video progress and syncing watch history through the browser account's built-in extension sync storage. VideoTracker does not operate a separate account system or application server.

### Data stored

- Video page title and URL.
- Show name, episode label, playback position, duration, progress, and timestamps.
- Device display name, browser name, and operating-system platform.
- Optional LAN and public IP addresses, only after the user enables network information collection.

### Network information

LAN IP detection uses WebRTC candidates generated locally by the browser and does not send LAN addresses to VideoTracker servers. Public IP lookup contacts `api64.ipify.org`, then `api.ipify.org`, and then `api.myip.com` if earlier services fail. These third-party services receive the user's ordinary HTTPS request IP. No watch history, page title, device name, or account credentials are sent with that request.

Network information collection is disabled by default and can be disabled at any time from the extension's Devices panel.

### Storage and sharing

Watch records are stored locally and in Chromium's browser-sync extension storage. When browser sync is enabled, the browser provider may transfer extension data between devices signed into the same browser account. VideoTracker does not sell user data, use it for advertising, or share it with analytics providers.

### User controls

- Disable optional network information collection.
- Delete individual episodes or an entire show.
- Export records as a JSON backup.
- Delete local records from the extension.
- Disable or remove the extension at any time.

### Contact

For privacy questions or deletion requests, open an issue at:
https://github.com/Peterosh/VideoTracker/issues

## 中文

剧迹是一款用于记录连续剧观看进度，并通过浏览器自带的扩展同步存储在不同设备间同步观看历史的浏览器扩展。剧迹不提供独立账户系统，也不运营额外的应用服务器。

### 保存的数据

- 视频页面标题和 URL。
- 剧名、集数、播放位置、视频总时长、观看进度和时间。
- 用户设置的设备名称、浏览器名称和操作系统平台。
- 仅在用户主动开启网络信息功能后，才获取局域网 IP 和公网 IP。

### 网络信息

局域网 IP 通过浏览器本地生成的 WebRTC candidate 获取，不会发送到剧迹服务器。公网 IP 查询会依次访问 `api64.ipify.org`、`api.ipify.org` 和 `api.myip.com`。这些第三方服务会看到普通 HTTPS 请求的公网 IP，但请求中不会包含观看记录、页面标题、设备名称或账户凭据。

网络信息采集默认关闭，用户可以随时在扩展的设备列表中关闭。

### 存储与共享

观看记录保存在浏览器本地存储和 Chromium 的浏览器同步扩展存储中。开启浏览器同步后，登录同一浏览器账户的设备可能通过浏览器提供商同步这些数据。剧迹不会出售用户数据，不会用于广告，也不会提供给分析服务商。

### 用户控制

- 关闭可选的网络信息采集。
- 删除单集记录或整部剧记录。
- 导出 JSON 备份。
- 删除本地记录。
- 随时停用或移除扩展。

### 联系方式

隐私相关问题或删除请求：
https://github.com/Peterosh/VideoTracker/issues
