---
title: Parts
order: 9
summary: Reusable pieces smaller than a Pattern, such as a lower-third or a footer.
status: shipped
---
# Parts

A Part is a reusable piece smaller than a whole Pattern. Think of a lower-third, a footer with the brand's wordmark and terms, or a captioned quote block.

## Why Parts

Some pieces turn up in many Patterns. Make the piece once, as a Part, and drop it into each Pattern. A Part dropped in stays linked: change the Part and every Pattern that uses it follows. **Detach** one copy to edit it freely.

## Making one

In the editor, select the Stitches the piece is made of and choose **Save as part** in the Inspector. Name it and say which of its slots are the brand's to lock, and the selection becomes a linked copy of the new Part. Your model can make one too, with `create_part`, from Stitches it names. Asked to, it swaps them for a linked copy, unless one of them is locked by the brand: only a person does that.

## Using one

The Parts panel in the editor lists the built-in Parts and the project's own. Choose one to add it to the Pattern. Your model fills a slot inside a Part as `part.slot`, like `footer.legal`.

## Changing one

On the Parts page, **Edit** opens one of your Parts in the editor. Its canvas is the Part itself, and its size is the Part's shape. A bar above the canvas says how many Patterns use it. Every change is saved to the Part as you go, and the changes you make in one sitting count as one new version. Choose **Done** to go back to Parts.

- Every Pattern that uses the Part shows the change at once. Select the Part in one and choose **Accept the update**. If you changed its shape, it keeps its width there and its height follows.
- A Stitch with a slot name is one of the Part's slots. Lock it and the brand decides it in every Pattern that uses the Part, straight away, even before the update is accepted.
- In a Pattern, select a Part and choose **Change the part** to open it.
- A Part written in code opens as its markup and CSS.
- The starter Parts stay as they come. **Edit a copy** makes one of your own and opens it.

Your model changes one of your Parts with `edit_part`, through the same tools it uses on a Pattern.

## Sorting them

Your own Parts can be sorted into folders on the Parts page. See [Folders](/docs/folders/). **To library** puts a Part in the library, and every project's Parts list it, marked Library.

## How they relate

A Part is made of Stitches. A Pattern is made of Stitches and Parts. Locked Stitches inside a Part stay locked wherever the Part is used.
