---
title: Yarn
order: 4
summary: Your photos, logos, video, audio, fonts, PDFs and copy, kept per project or in the Library for every project.
status: shipped
---
# Yarn

Yarn is your raw material. Photos, logos, video, sound, fonts, PDFs and pieces of copy are all Yarn. Open a project's **Yarn** tab to see it.

## Where it lives

Yarn belongs to a project, or to the [Library](#the-library), which every project shares. Each file is kept in its project's folder on your computer. A Pattern points at the file itself, not at its name, so renaming a file does not break anything. **Replace file** swaps in a new file, and every Pattern that uses it shows the new one.

## Adding Yarn

- **Upload** picks files from your computer. You can also drop files on the page, or paste a screenshot. Add several at once: a tray shows each one as it goes up, and you can cancel one on the way.
- **From a link** fetches one file from a public web address. It does not fetch from your own computer or network.
- **Save text** keeps words to use again: headlines, captions, taglines, hashtags.

knitted checks each file as it comes in. A file that is not what its name says, like a PNG that is not really a picture, is refused, and the tray says why. An SVG is cleaned of anything that could run before it is kept. A file you already have is not added twice: the tray says it is already in Yarn.

In the editor, the **Yarn** tool has its own **Upload** button. Click a file there to add it to the Pattern, or to swap it into the selected picture. Drag it onto the canvas to place it exactly.

## Finding things

Filter by kind (**Images**, **Video**, **Audio**, **Fonts**, **PDFs** or **Saved text**), search by name, or pick a tag.

Show Yarn as a grid of pictures or as a list with more about each file, and sort it by when it was added, its name, its kind or its size. Each section remembers its own choice on this computer.

## One file, up close

Click a file to open it. There you can:

- Rename it, and add or remove tags. Tags let a batch pick from a group, like `tag:product`. See [Batch knitting](/docs/batch-knitting/).
- See its size, its dimensions or length, when it was added, and which Patterns use it.
- **Replace file**, **Download** it, or choose **Use as project picture** to show it on the project's card.
- **Ask your model** to change it.
- **Delete** it. **Undo** brings it back for a while. If a Pattern uses it, knitted names that Pattern before you delete, and the Stitch shows a missing-yarn marker until you choose another file.

Select several files to move, tag or delete them together.

## Folders

Sort Yarn into folders, like a folder for royalty free music with one inside it for each kind. Upload into a folder by opening it first. See [Folders](/docs/folders/).

## PDFs, and cutting a part out

Open a PDF to turn its pages, or choose **Read its words**. Open a picture or a PDF and choose **Cut out a part** to keep part of it as a new picture, such as a product from a brochure. The original stays as it is.

Files about the business that are not for patterns, like a menu to read, belong in the [Brief](/docs/brief/)'s reference. **Move to the Brief** puts one there.

## The Library

The Library is what every project shares: a logo, a font or a photo you use for every brand. Open **Library** in the side bar to see it, and add files there the way you add them to a project.

- Its files are in every project's Yarn in the editor, under **From the Library**, and your model sees them too.
- A project's Yarn page shows the project's own files, and says how many the Library has.
- **Move to the Library**, on a file in a project, puts it there. Every Pattern that uses it keeps it.
- On the Library page, **Move into a project** takes a file back into one project. A file that other projects use stays in the Library.
- The Brief's reference is about one business, so its files do not go in the Library.

## Drawing with your model

Your model can draw pictures as SVG and keep them in Yarn: an icon set for your website, your mascot in new poses, a badge, a divider. SVG stays sharp at any size.

- Choose **Draw with your model** on a project's Yarn page, and say what to draw. Your model works in a chat of its own while you carry on.
- To draw from a picture, like your mascot, upload the picture first and name it in what you ask. On the picture, **Ask your model** has ideas such as *Draw it as SVG in three new poses*.
- Your model sees each drawing on white, on dark, and at icon sizes before you do, and puts a set side by side to check it belongs together.
- A drawing is marked **Drawn by your model**, with what you asked for and what it was drawn from, and tagged *drawn*.
- When your model draws one again, it keeps its place: every Pattern that uses it shows the new one. It never draws over a file you uploaded.

Your model uses `draw_svg` and `view_sheet` for this. Drawing makes SVG only; for photos and video, see the next section.

## Making photos and video

With a key of your own from OpenAI or Google, you and your model can make photos and short videos from a description and your own pictures. Each one is charged to your key.

- Add a key in **Settings**, **Photos and video**. OpenAI makes photos. Google Gemini makes photos and video, and needs a key on its paid tier. When both have keys, you choose which makes what.
- Choose **Make** on a project's Yarn page. Say what to make, then choose its shape (square, 4:5 for a feed, 9:16 for a story, 16:9 wide), how many and the quality. The price shows before you make it.
- To work from your own pictures, like your product or your mascot, open one and choose **Make a photo from this**. A video can start from one picture, and end on a second.
- It is made while you carry on, and lands in Yarn tagged *made*. Its details say who made it, from what, what you asked for and what it cost.
- Leave words out of what you ask. Put the headline in the Pattern, where you can change it.
- It counts toward your limits in **Settings**, **Spending**, and stops when a limit is reached.
- Everything made this way carries an invisible mark saying it was made with AI. Some platforms ask for AI-made posts to be labelled.

Your model uses `generate_image` and `generate_video`, and can ask what one will cost before it makes it.

## Free stock

When a brand has no photo, footage, music or sound effect for something, **Stock** in the side bar finds free ones. **Free stock** on a project's Yarn page opens it for that project.

- Type a few plain words, like *coffee beans close up*, and choose **Photos**, **Videos** or **Sound**.
- **Openverse** works with no key. It finds openly licensed photos, music and sound from across the web.
- **Pixabay** adds photos and video once you add a free key of your own, in **Settings**, **Stock**. The key is kept in your computer's own secret store and only sent to Pixabay.
- **Pexels** works with a key you already have. Pexels is not giving out new keys for now.
- **Add to**, above the results, says where a file goes: a project, or the Library for every project. Choose **Add** on a result, or open it to look first.

Only work a business may use freely is shown: CC0, the public domain, CC BY, and Pixabay's and Pexels' own licences. Freesound is not a source, because its API is free only for non-commercial use. Its CC0 and CC BY sounds come through Openverse.

A file you add keeps its credit and licence. Open it in Yarn to see them, with **Copy the credit** and a link to its page.

- **Credit the maker where you use it** means its licence is CC BY. Put the credit in the post's caption.
- **Free to use, no credit needed** means CC0, the public domain, Pixabay or Pexels. A credit is still kind.
- Openverse does not check the licences it finds. Open the file's page before a post that matters.

Your model can search with `search_stock` and add the few you will use with `add_stock`.

## Good Yarn

- Upload logos at least 1000 pixels wide so they print sharp. A file named as a logo that is narrower gets a warning.
- Use photos you have the rights to. See [Brand and legal guidance](/docs/brand-and-legal/).
- Give files plain names. Your model reads them, and a batch can pick a file by its name.

## Your model

Your model adds Yarn from a public web address, or from a file on your computer by its path, and saves pieces of text as copy. It copies a file in and leaves yours as it was. It does not read hidden folders or files, such as ~/.ssh. It can bring a piece of copy up to date, such as a note on how a job is going, instead of saving a second one beside it. The project's Activity shows each file it adds and each piece of copy it changes. It can look at a picture or a PDF with `view_yarn`, and cut a part out of one with `crop_to_yarn`. It adds a file to the Library when asked, and `share_yarn` moves one in or out. It cannot delete Yarn.
