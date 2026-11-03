# Installing knitted

Download the file for your computer from the [releases page](https://github.com/knitted-studio/knitted-studio/releases), open it, and you are done. knitted includes everything it needs, including the video tools. It works without an internet connection.

## First launch: the unsigned-app warning

These early builds are not signed with a paid developer certificate, so your system will ask you to confirm. This is expected, and it is safe to continue if you downloaded the file from the releases page. You only do this once.

**macOS.** Open the `.dmg`, drag knitted to Applications. The first time, right-click (or Control-click) the app and choose **Open**, then **Open** again. If macOS says the app "is damaged", open Terminal and run `xattr -dr com.apple.quarantine /Applications/knitted.app`. That clears the download flag; nothing else changes.

**Windows.** Run the installer. If SmartScreen says "Windows protected your PC", choose **More info**, then **Run anyway**.

**Linux.** `.AppImage`: make it executable (`chmod +x knitted-*.AppImage`) and run it; if it will not start, install `libfuse2`. A `.deb` is not built yet.

## Making videos and exporting pictures

The first time you knit, knitted asks to download a small browser (about 100 MB) it draws with. It happens once, only when you say yes, and is saved in your own data folder.

## Where your work lives

Your library is a normal folder (Settings, Storage shows where). Uninstalling knitted never deletes it. To remove everything, delete that folder yourself.

## Your model key

Settings, Model. The key is kept in your system keychain, never in knitted's files, and is sent only to Anthropic.
