# Installing knitted

Download the file for your computer from the site's [Download page](https://knitted.filefreak.page/download/), which picks it for you, open it, and you are done. knitted includes everything it needs, including the video tools. It works without an internet connection.

## First launch: the unsigned-app warning

These early builds are not signed with a paid developer certificate, so your system will ask you to confirm. This is expected, and it is safe to continue if you downloaded the file from the Download page. You only do this once.

**macOS.** Open the `.dmg`, drag knitted to Applications, and open it. macOS says "Apple could not verify knitted.app is free of malware": choose **Done**, not Move to Trash. Open **System Settings**, **Privacy & Security**, scroll to Security, and choose **Open Anyway** beside "knitted.app was blocked". Choose **Open Anyway** again and confirm with your password or Touch ID. Or, in Terminal, run `xattr -dr com.apple.quarantine /Applications/knitted.app` and open it as usual: that clears the flag macOS puts on downloads, and nothing else changes. If macOS says the app "is damaged", the download is from before the builds were signed or did not finish: download it again.

Apple silicon or Intel: the Apple menu, **About This Mac**, says. A **Chip** line naming Apple M1 or later is Apple silicon; a **Processor** line naming Intel is an Intel Mac.

**Windows.** Run the installer. If SmartScreen says "Windows protected your PC", choose **More info**, then **Run anyway**.

**Linux.** `.AppImage`: make it executable (`chmod +x knitted-*.AppImage`) and run it; if it will not start, install `libfuse2`. A `.deb` is not built yet.

## Updating

knitted can update itself. The first time it opens, it asks whether to check for updates by itself, once a day. **Check for Updates…**, in the knitted menu on a Mac and the Help menu on Windows and Linux, checks whenever you like. When there is a new version, knitted downloads it while you work, checks it against the SHA-256 on the Download page, and asks to restart. On a Mac, keep knitted in Applications: a copy opened from the disk image cannot replace itself. Version 0.1.0 does not update itself, so install 0.1.1 from the Download page once.

## Making videos and exporting pictures

The first time you knit, knitted asks to download a small browser (about 100 MB) it draws with. It happens once, only when you say yes, and is saved in your own data folder.

## Where your work lives

Your library is a normal folder (Settings, Storage shows where). Uninstalling knitted never deletes it. To remove everything, delete that folder yourself.

## Your model key

Settings, Model. The key is kept in your system keychain, never in knitted's files, and is sent only to Anthropic.
