---
title: Posting to social accounts
order: 11.5
summary: Post knits to Instagram, TikTok, LinkedIn, Threads, X and YouTube, now or at a time, and see what works.
status: shipped
---
# Posting to social accounts

Open a knit and press **Post**, or pick several and press **Post together** for a carousel. Pick the accounts, check the caption, and post it now, at a time, or keep it as a draft. Every post is in the project's **Posts** tab: what went out, with a link to it, what is scheduled, and anything that needs you.

## Why each platform needs an app of your own

knitted runs on your computer and has no server in between. So you sign in to each platform through a developer app that is yours, made once, and your sign-ins stay on this computer, in its secret store (the Keychain on a Mac). Nobody else's app can post as you, and no knitted company sees your accounts.

Making an app takes ten minutes or so per platform, and the sections below walk through each. In knitted, go to **Settings, Social**, and each platform's card shows what to copy where.

## When posts go out

Posts go out while knitted is running. A post due while it was closed goes out when you open it, if that is within two hours. Later than that, it waits as **missed**, for you to post it now or pick another time, because a post meant for 9 in the morning may be wrong at 4 in the afternoon.

So knitted keeps running while posts are waiting. Close its window and it stays in the menu bar (the system tray on Windows and Linux), saying how many posts are to go out and when the next goes. Once the last one is out, it quits, as closing the window would have. Its menu opens the window again, or quits. Quitting from the menu or with Cmd+Q asks first while posts are waiting. To have closing the window always quit, turn off **Keep knitted running when its window is closed** in Settings, Social.

YouTube is the exception. A post scheduled at least 15 minutes ahead is uploaded straight away as a private video with its time, and YouTube makes it public then, whether or not your computer is on. Cancelling it in knitted takes it off YouTube.

If a post fails because the network dropped or the platform was busy, before anything was sent, knitted tries again twice, a few minutes apart. If it fails after the post was sent, knitted does not try again: it says to look on the platform first, so nothing is posted twice.

## Your model and posts

Your model can make posts too (the `schedule_post` tool). Unless you turn on **Let your model schedule posts** in Settings, Social, what it makes are drafts, and you schedule them from Posts.

## How posts did

knitted asks each platform how a post is doing an hour after it goes out, then after 6 hours, a day, 3 days, a week, 2 weeks and a month, while it is running. Each post that went out shows its numbers in Posts, like "1,240 views · 87 likes · 12 comments · 8.5% engaged", and **Check now** asks straight away. Engaged is likes, comments, shares, reposts and saves, out of views.

**Insights**, in the side bar, puts them together, for every project or one:

- **By platform**: the views on each, and, from 3 posts on, the views and engagement of a usual post.
- **What your posts say**: what did better, in a sentence, such as "Videos got 1.8 times your usual views (6 posts); single pictures 0.7 times (4)." It looks at what the post was (a video, a carousel, one picture), how long a video was, whether it had sound, the time it went out, the length of the caption, how many hashtags, which pattern made it, and whether you or your model wrote it.
- **Every post**, with its numbers and how it did against its usual.

To be fair to each post, it is compared with the usual for its own account, using its numbers about a week in: a new post has not had its week yet, and a big account's usual is not a small one's. So comparing starts once an account has 3 posts at least three days old, and a difference is said only when each side has 3 posts or more and one is clearly ahead. Even then it is what happened, not proof: a few posts can be lucky.

Your model reads the same with `post_insights`, and the guide asks it to before it plans posts for an account that has posted before.

What each platform gives:

- **Instagram**: views, reach, likes, comments, saves and shares; for a Reel, how long it was watched on average. A Story's numbers go when the Story does, after a day, so knitted asks sooner, and Instagram shows them only once 5 people have seen it.
- **Threads**: views, likes, replies, reposts, quotes and shares.
- **TikTok**: views, likes, comments and shares, for a public video, once TikTok has checked it. Until TikTok has audited your app, what it posts is private, so there are none.
- **X**: views, likes, replies, reposts, quotes and bookmarks. X charges your developer credits for each look, so knitted asks only once you turn on **Ask X for numbers too** in Settings, Social.
- **YouTube**: views, likes and comments, and from three days in, when YouTube Analytics has caught up, minutes watched, the average watch, shares and new subscribers. A YouTube connected before November 9, 2026 needs **Connect again** for the last of those.
- **LinkedIn**: none. LinkedIn gives a post's numbers only to apps it has approved for registered businesses. See them on the post.

## Instagram

Posts pictures, carousels of up to 10 and Reels. A picture taller than 4:5 goes to your Story. Instagram needs a [media host](#media-host).

1. Your Instagram account has to be a professional one, Business or Creator. In Instagram: **Settings, Account type and tools, Switch to professional account**.
2. At [developers.facebook.com/apps](https://developers.facebook.com/apps/), create an app. Pick the use case for managing content on Instagram (or **Other**, then **Business**), and add the **Instagram** product. Choose **API setup with Instagram login**.
3. Under **Set up Instagram business login**, open the business login settings and add this to the OAuth redirect URIs: `https://knitted.filefreak.page/oauth/`
4. In **App roles, Roles**, add your Instagram account as an **Instagram Tester**, then accept the invitation in Instagram (**Settings, Apps and websites, Tester invites**). Your own account needs no review by Meta.
5. Copy the **Instagram app ID** and **Instagram app secret** (on the Instagram API setup page, not the Facebook app's ID) into knitted, then press **Connect Instagram**.

If Instagram says **Invalid Request: Request parameters are invalid: Invalid platform app**, knitted has the Meta app's own App ID, from **App settings, Basic**. Instagram's sign-in takes only the Instagram app ID. If the app has no Instagram app ID yet, add the Instagram use case with **API setup with Instagram login** (step 2), and it appears on that page.

The sign-in lasts 60 days and knitted renews it while it is open, so it does not run out unless knitted stays closed that long.

## Threads

Posts words, pictures, video and carousels. Threads needs a [media host](#media-host) for pictures and video.

1. At [developers.facebook.com/apps](https://developers.facebook.com/apps/), create an app with the use case **Access the Threads API**.
2. In its permissions, add `threads_basic`, `threads_content_publish` and `threads_manage_insights`.
3. In its settings, add this to the redirect callback URLs: `https://knitted.filefreak.page/oauth/`
4. In **App roles, Roles**, add your Threads account as a **Threads Tester**, then accept it in Threads (**Settings, Account, Website permissions, Invites**).
5. Copy the **Threads app ID** and **Threads app secret** into knitted, then press **Connect Threads**.

## LinkedIn

Posts words, pictures (up to 20 at once) and video, as you, not as a Company Page.

1. At [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps), create an app. LinkedIn asks for a Company Page to link it to: any page you look after works.
2. In **Products**, add **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**. Both are there for any app, with no review.
3. In **Auth**, add this to the authorized redirect URLs: `https://knitted.filefreak.page/oauth/`
4. Copy the **Client ID** and **Primary Client Secret** into knitted, then press **Connect LinkedIn**.

LinkedIn's sign-in for an app like this lasts 60 days and cannot be renewed without you. Settings, Social shows the date; press **Connect again** before then. A post due after it runs out fails, saying so.

## X

Posts words, up to 4 pictures, or one video.

X charges for each post from credits you buy in its developer console, and a post with a link costs more. Asking how a post did costs a little too, so it is off until you turn it on. See the prices there before you start.

1. At [console.x.com](https://console.x.com/), make an app, and buy some credits.
2. In the app's **User authentication settings**, turn on OAuth 2.0, set **App permissions** to **Read and write**, and pick **Native App** as the type. (A **Web App** works too, and comes with a client secret to add in knitted.)
3. Add this as the callback URI: `https://knitted.filefreak.page/oauth/`. For the website address, any address of yours works.
4. Copy the **OAuth 2.0 Client ID** (not the API key) into knitted, then press **Connect X**.

X's sign-in lasts two hours, and knitted renews it each time it posts.

## TikTok

Posts videos. TikTok takes pictures only from an address it has verified as yours, which a desktop app does not have, so pictures cannot be posted there from knitted.

1. At [developers.tiktok.com](https://developers.tiktok.com/apps/), make an app. It asks for an icon, a description, and the addresses of terms of service and a privacy policy.
2. Pick **Desktop** as its platform.
3. Add the products **Login Kit**, **Content Posting API** (turn on **Direct Post**) and **Display API**, and the scopes `user.info.basic`, `user.info.stats`, `video.publish`, `video.upload` and `video.list`.
4. In Login Kit, add this redirect URI: `http://127.0.0.1:*/api/social/callback/`. The star is any port: knitted picks one each time it starts. If TikTok will not take the star, add the address Settings, Social shows, with its port.
5. Copy the **Client key** and **Client secret** into knitted, then press **Connect TikTok**. While the app is in TikTok's sandbox, add your own account as a target user first.

Until TikTok has audited your app for posting, what it posts is visible only to you, and your account has to be private at the time it posts. Once it is audited, you choose who sees each post. Each time, the Post dialog asks who can see it, with nothing chosen for you, and comments, duets and stitches are off until you turn them on. Those are TikTok's rules for apps that post.

## YouTube

Posts videos, and Shorts when they are upright and up to 3 minutes. Scheduled posts are published by YouTube itself.

1. At [console.cloud.google.com](https://console.cloud.google.com/), make a project.
2. In **APIs and Services, Library**, turn on **YouTube Data API v3** and **YouTube Analytics API** (for how long people watched).
3. In **Google Auth Platform**, set it up for external users, with your own address as the support email, and add yourself as a test user. Then, in **Audience**, press **Publish app**. While it is in testing, Google ends its sign-ins after 7 days. Published, it shows a warning that Google has not verified it, which is about your own app: press **Advanced**, then go on.
4. In **Clients**, make an OAuth client of the type **Desktop app**. It needs no redirect.
5. Copy the **Client ID** and **Client secret** into knitted, then press **Connect YouTube**.

Uploads count against your project's daily YouTube allowance, which is about 100 videos a day.

## Media host

Instagram and Threads do not take a file sent to them: they fetch it from a public web address. So knitted puts each file in storage of yours just before posting, and removes it straight after. The other platforms do not need one.

In **Settings, Social, Media host**, pick one, fill it in, and press **Test**: it puts a small file there, reads it back from its public address, and removes it.

**A bucket** that speaks S3: Cloudflare R2, Amazon S3, Backblaze B2, DigitalOcean Spaces, MinIO. Its files have to be readable by anyone at their public address.

- On **Cloudflare R2**: make a bucket, turn on public access in its settings (its r2.dev address, or a domain of yours), and make an API token with object read and write for that bucket. The address is `https://<your account id>.r2.cloudflarestorage.com`, the region is `auto`, and the public address is the bucket's public URL.
- On **Amazon S3**: leave the address empty, give the bucket's region, let anyone read the `knitted/` folder in the bucket's policy, and use a key that may put and delete objects there. The public address is `https://<bucket>.s3.<region>.amazonaws.com`.

**FileFreak**: a folder in your FileFreak account, with an app's API key. Your FileFreak public page has to be on, because each file is made public while the platform fetches it.

## What knitted keeps

Each account's sign-in, each app's secret and the media host's key are in your computer's secret store, never in knitted's library or its backups. **Disconnect** forgets the sign-in and cancels that account's posts still to go out; posts already out stay where they are. To take away an app's access on the platform too, remove it in the platform's own settings.
