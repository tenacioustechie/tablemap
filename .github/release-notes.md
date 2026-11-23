## Download

| Computer | File |
| --- | --- |
| Windows (64-bit) | `TableMap-<version>-win-x64.exe` |
| Mac with Apple silicon (M1 and newer) | `TableMap-<version>-mac-arm64.dmg` |
| Mac with an Intel processor | `TableMap-<version>-mac-x64.dmg` |

(The `.zip`, `.yml` and `.blockmap` files are for automatic updates; you don't need to download them.)

These builds are not signed with a paid Microsoft or Apple certificate, so the first launch needs one extra step:

- **Windows:** if SmartScreen says "Windows protected your PC", click **More info** → **Run anyway**, then follow the installer.
- **Mac:** open the `.dmg` and drag **TableMap** to **Applications**. The first time you open it macOS will refuse; open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to the TableMap message. (Or, in Terminal: `xattr -dr com.apple.quarantine /Applications/TableMap.app`.)

**Updates:** once installed, TableMap checks for new versions by itself. On Windows it downloads them in the background and installs them when you close the app (or straight away if you click **Restart now**). On a Mac it tells you a new version is out and opens this page to download it.

Campaigns are stored on the computer running TableMap. Use **Export** in the campaign list to back one up or move it to another computer.
