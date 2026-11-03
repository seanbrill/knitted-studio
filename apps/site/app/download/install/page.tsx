import Link from "next/link";
import { PageHero } from "../../../components/PageHero";
import releases from "../../../content/releases.json";
import { pageMeta } from "../../../lib/meta";

export const metadata = pageMeta({
  title: "Install guide",
  description: "How to open the first knitted.studio installers on macOS and Windows, which are unsigned previews and show a first-launch warning.",
  path: "/download/install/",
});

export default function Install() {
  return (
    <>
      <PageHero eyebrow="Install guide" title="Opening an unsigned preview." lead="The first installers are previews and are not signed yet. Your computer will warn you the first time. Here is how to get past it." />
      <section className="sec-tight">
        <div className="wrap-narrow doc">
          {releases.releases.length === 0 ? (
            <p className="notice notice-soon">There are no installers yet. This guide is here ahead of time so the first release does not surprise anyone. <Link className="link" href="/download/">Check the download page</Link> for status.</p>
          ) : null}
          <h2>Why the warning appears</h2>
          <p>Signing an app with a developer certificate proves who made it. Early previews do not have one yet, so macOS and Windows treat them as from an unknown developer. Only open an installer you downloaded from this site or from the project&rsquo;s GitHub releases, and compare its SHA-256 with the one listed on the download page.</p>
          <h2>macOS</h2>
          <ol>
            <li>Open the downloaded disk image and drag knitted to Applications.</li>
            <li>Open knitted. macOS says &ldquo;Apple could not verify knitted.app is free of malware&rdquo;. Choose <strong>Done</strong>, not Move to Trash.</li>
            <li>Open <strong>System Settings</strong>, then <strong>Privacy &amp; Security</strong>.</li>
            <li>Scroll to the Security section. You will see a note that knitted.app was blocked. Choose <strong>Open Anyway</strong>.</li>
            <li>Choose <strong>Open Anyway</strong> again and confirm with your password or Touch ID. knitted opens. You only do this once.</li>
          </ol>
          <p>Prefer Terminal? <code>xattr -dr com.apple.quarantine /Applications/knitted.app</code> clears the flag macOS puts on downloads, and then knitted opens as usual. If macOS says knitted &ldquo;is damaged&rdquo;, the copy is from before the builds were signed or did not download whole: download it again.</p>
          <p>Not sure which Mac you have? The Apple menu, <strong>About This Mac</strong>, says. A Chip line naming Apple M1 or later is Apple silicon. A Processor line naming Intel is an Intel Mac.</p>
          <h2>Windows</h2>
          <ol>
            <li>Run the installer. A blue box says <strong>Windows protected your PC</strong>.</li>
            <li>Choose <strong>More info</strong>. The publisher shows as unknown.</li>
            <li>Choose <strong>Run anyway</strong>.</li>
            <li>Finish the installer as usual.</li>
          </ol>
          <h2>Linux</h2>
          <p>Linux does not show a signing warning. Make the AppImage executable (<code>chmod +x</code>) and run it, or install the package with your package manager.</p>
          <h2>Still stuck?</h2>
          <p>Read the <Link className="link" href="/docs/troubleshooting/">troubleshooting page</Link>, or open an issue on GitHub.</p>
        </div>
      </section>
    </>
  );
}
