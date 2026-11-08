---
title: Yarn
order: 4
summary: Your photos, logos, video, audio, fonts, PDFs and copy, kept per project.
status: shipped
---
# Yarn

Yarn is your raw material. Photos, logos, video, sound, fonts, PDFs and pieces of copy are all Yarn. Open a project's **Yarn** tab to see it.

## Where it lives

Yarn belongs to a project, and each file is kept in the project's folder on your computer. A Pattern points at the file itself, not at its name, so renaming a file does not break anything. **Replace file** swaps in a new file, and every Pattern that uses it shows the new one.

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

## Good Yarn

- Upload logos at least 1000 pixels wide so they print sharp. A file named as a logo that is narrower gets a warning.
- Use photos you have the rights to. See [Brand and legal guidance](/docs/brand-and-legal/).
- Give files plain names. Your model reads them, and a batch can pick a file by its name.

## Your model

Your model adds Yarn from a public web address, or from a file on your computer by its path, and saves pieces of text as copy. It copies a file in and leaves yours as it was. It does not read hidden folders or files, such as ~/.ssh. It can bring a piece of copy up to date, such as a note on how a job is going, instead of saving a second one beside it. The project's Activity shows each file it adds and each piece of copy it changes. It can look at a picture or a PDF with `view_yarn`, and cut a part out of one with `crop_to_yarn`. It cannot delete Yarn.
