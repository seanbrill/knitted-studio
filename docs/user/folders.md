---
title: Folders
order: 3.5
summary: Sort Patterns, Yarn, Parts, Swatches and Knits into folders, and folders inside them.
status: shipped
---
# Folders

Every section of a project can be sorted into folders: Patterns, Yarn, Swatch, Parts and Knits. A folder can hold folders of its own, so Yarn can have a folder for royalty free music with one inside it for each kind, instead of one long list.

## Making folders

Choose **New folder** in a section. Type a `/` to make a folder inside a folder in one go: `Royalty free music/Lo-fi` makes both. Folders go six deep.

Each section has folders of its own, so a folder in Yarn does not show in Patterns. The Yarn, Parts and Patterns panels in the editor show the same folders as their sections.

## Putting things in them

Drag a thing onto a folder, or onto a step of the trail at the top to move it back up. Or choose **Move to folder**: in a Pattern's menu, in the selection bar in Yarn, on one of your Parts, on a Swatch, or when you open a Knit. In Yarn, select several files to move them together. Moving things shows **Undo** for a few seconds.

Whatever you make or add goes into the folder you are in: an upload, a pasted screenshot, a new Pattern, Swatch or Part, an imported file. A copy goes next to the original. A file that is already in Yarn stays where it is, and the upload says where that is.

Moving a thing changes nothing else about it. A Pattern in a folder knits the same, and a file in a folder fills the same slots.

The starter Parts stay where they are. Duplicate one while you are in a folder to put the copy there. A Part kept in the library is in the same folder in every project.

## Renaming, moving and deleting folders

Open a folder's menu, or right-click it, to rename it, move it into another folder, or delete it. You can also drag one folder onto another. What is in a folder goes with it. Rename a folder to the name of one beside it and the two become one.

Deleting a folder deletes nothing in it. What it held, files and folders, moves up into the folder that held it.

## Finding things

A search or a filter in Yarn looks in the folder you are in and every folder inside it, and each result says which folder it is in. From the top of Yarn, it looks everywhere. When you choose a file in the editor or in the Swatch, the list is grouped by folder.

In Knits, **Download folder** makes a zip of the folder you are in, with the folders inside it as folders in the zip.

## Your model

Your model can sort a project too. It sees which folder each thing is in, lists the folders with `list_folders`, files things with `move_to_folder`, and renames or moves a folder with `rename`. It can put a new Pattern, Part, Swatch or piece of Yarn straight into a folder. It cannot delete a folder: that stays your call. See the [MCP reference](/docs/mcp-reference/).
