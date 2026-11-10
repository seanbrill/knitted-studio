---
title: Design sheets
order: 9.5
summary: A whole site's design on one board, like a Figma file, in labelled sections and in your brand.
status: shipped
---
# Design sheets

A design sheet is a whole site on one board: its colours and type, the pieces every page shares, and each page on a computer and a phone, in labelled sections. You can design one yourself or with your model. Open a project's **Designs** tab to see its sheets.

## Starting one

Choose **New design**, name it, and choose how it starts:

- **From your brand** starts with three sections. **Foundations** shows your colours, type, buttons and fields. **Components** has a header and a footer. **Pages** has a home page on a computer and on a phone. It is all drawn with your Swatch, so start by making the words your own.
- **Blank** starts with one empty section.

Or choose **Design with your model** and say what you want, like *our whole site: home, about, pricing and contact*. Your model designs it in a chat of its own while you carry on. You can watch the board change as it saves each frame.

## The board

- Each section has a name, and can have a note beside it. Use **Add a section** for one of your own, such as *Shop* or *Checkout*. A section's menu renames it, moves it up or down, downloads it (as a picture, as code, or everything in it with a style guide), or deletes it.
- A frame is a page, a screen or a piece of one, at a width: **Desktop** 1440, **Tablet** 834, **Mobile** 390, or one of your own. A frame is as tall as what is in it, unless you give it a fixed height, such as one phone screen.
- **Fit the width** shows the widest section across the window, and **Whole sheet**, in the same zoom menu, shows all of it. Zoom goes from 2% to 400%. Pinch, or hold Ctrl and scroll, to zoom about the pointer; the zoom buttons and keys glide there. The labels stay the same size at any zoom.
- Double-click a frame to zoom to it, whole and in the middle, or a section's name to zoom to that section. Double-click the space between frames to fit again.
- Scroll to move about the board, or drag the space between frames. Hold Space, or turn on the **Hand** (press H), to drag over the frames too. The keys are the editor's: Shift+1 fits, Shift+2 zooms to the selected frame, and Shift+0 is 100%.
- When the sheet is bigger than the window, a map in the bottom left corner shows its sections and the part you are looking at. Press or drag on it to go there.

## Arranging the board

The board is a canvas on a grid of dots, like a Figma file. Sections stand in a column until you place one.

- Drag a section by its name to put it anywhere. It lands on the 40 pixel grid, and the sections you have not placed stay where they are. Or press its name and use the arrow keys: each press moves it 40 pixels, and 200 with Shift.
- Drag a section's right edge in to wrap its frames into rows, and out again for one row. Pressed, the edge takes the left and right arrow keys too.
- Sections never cover one another. One that grows, by wrapping or by more frames, pushes those under it down. Put a section down over another and it stays where you put it, while the other moves under it.
- Drag a frame to move it along its section, or into another section. A bar shows where it will go.
- **Tidy up**, on the board's bar once a section is placed, puts every section back in one column, in their order. **Undo** puts them back where they were.
- **Undo** takes back the last change to the sheet, whether you made it or your model did. Press it again to go further back.

Your model can place sections too, with `arrange_design`.

## Changing a frame

Select a frame to open it beside the board. You can change its name, width, height and note, and the HTML and CSS it is written in. What you type shows on the board a moment later. **Save** keeps it (or press Ctrl+S), and **Discard** goes back to what was saved. A frame keeps what you have not saved while you look at another: open it again and your changes are still there.

- Colours, fonts and corners come from the Swatch as CSS variables, like `var(--color-primary)`, `var(--font-display)` and `var(--radius)`. Change the Swatch, and every frame follows.
- A picture from Yarn is `yarn:` and its id, like `<img src="yarn:yn_01..." alt="...">`. Your logo is `yarn:logo`.
- A design is a picture of a site: scripts do not run, and nothing loads from the web. Show each state as its own frame, such as *Menu, open*.
- **Make a copy**, **Picture**, **Delete** and the **Section** list work on the frame you have open.

## Patterns, Yarn and parts on the sheet

A sheet can hold the project's own things beside its pages, such as a campaign's posts beside the landing page they go with, or the photos a page uses.

- The **+** beside a section's name adds **A frame**, **A pattern**, **Yarn** (a photo, a logo or a video) or **A part**. Pick one by its picture, or find it by name.
- What goes on the sheet is the thing itself, not a copy. A pattern or a part is drawn by the editor's own renderer, in your brand, so a change to it in the editor, by your model or anywhere else shows on the sheet. Big on screen it is drawn live; small, it is a picture of it.
- It starts at its own size, in its own shape, and moves, zooms and sits in rows like any frame. Its label says what it is and how big, such as *Pattern 1080 x 1350*.
- Select one, and the pane's first tab is named for it. A pattern has **Open in the editor**, **Knit** and **Ask your model**. Yarn has **Open in Yarn**. A part has **Open in the editor**, or **Open in Parts** for a starter part or one written in code. **Take it off the sheet** leaves the thing itself where it is.
- A pattern's pane lists **Its words**, the ones you can fill: change one and leave the field (or press Ctrl+Enter), and it is saved into the pattern itself, so the editor, its knits and every sheet show it. **Undo** on the message that says so takes it back; the editor's own Undo does not reach a change made on the sheet. Words the brand locked are not on offer.
- **Size on the sheet** shows a pattern at another of the sizes it knits at, such as a Story beside the Post, laid out there the way a knit at that size would be. The pattern keeps its own size, and **Knit** starts at the one the sheet shows. Put a pattern on the sheet twice to see it at two sizes.
- A part's pane lists its slots.
- Pin a comment to a pattern as to a frame. Your model is told which stitch is under the pin, and **Ask your model to do this** changes the pattern itself.
- If the thing is deleted, the sheet shows a note in its place until you take it off.
- **The code** download lists each one, but it has no page of code: it is in the picture of the sheet.

## Taking it away

**Download** has three choices:

- **The sheet, as a picture**: a PNG of the whole board, with its labels. **Picture** on a frame downloads that frame at twice the size.
- **The code**: a ZIP with a page of HTML for each frame, filed by section. It also holds `tokens.css` with your brand, your fonts and the pictures the design uses. Open its `index.html` to see every page. A developer, or a model building the real site, can start from it.
- **Everything**: a ZIP with the sheet as a picture, each section as a picture, all of the code, the fonts and the pictures the design uses, and a style guide. A big sheet takes a moment to put together. The style guide comes as `style-guide.html` and as a picture of it, and shows what the design is drawn with:
  - the brand's colours, fonts and corners, each with the CSS variable the pages use, such as `var(--color-primary)`, and how often and where it is used
  - any colour written out in the code instead of through a variable, saying when it is one of the brand's, so you can see what is off-brand
  - every type size and weight, largest first, each drawn in the display font
  - the other corners, the spacing (padding, margins and gaps) and the shadows in the code

  `tokens.json` has the brand's colours, fonts, corners, type sizes and spacing as data, for a design tool or a build.

The list of design sheets has **Download the code** and **Download everything** in each sheet's menu too.

Each section downloads on its own from its menu, in the same three ways: **Download as a picture**, **Download its code**, and **Download everything, with a style guide**. Everything for a section is a ZIP named for the sheet and the section, such as `website-pages.zip`. It has `section.png`, that section's frames as code, the fonts and pictures they use, and a style guide of just what that section is drawn with.

## Comments

The pane beside the board has two tabs, as a knit's does: **Frame**, for the frame you picked, and **Comments**, with how many are open. **Comments** on the board's bar opens it.

- Under the frame you pick are **Zoom to it**, **Pin a comment** and **Ask your model**. Press **Pin a comment** (or **Add a comment** in the Comments tab), click the spot on a frame that should change, and say what. For a comment about the sheet as a whole, choose **the whole sheet** instead.
- With a frame picked, its comments come first, and **all on the sheet** shows the rest.
- The pins stay on the board when the pane is closed, the same size at any zoom. Press one to pick its frame and open its comment. Pressing a comment in the pane brings its frame into view.
- **Ask your model** under a frame starts a chat about that frame, so your model changes that one.

A comment can be replied to, resolved, opened again or deleted. **Comments** on the bar shows how many are open, and so does the sheet's card in the list of designs.

**Ask your model to do this** on a comment, or **Ask your model to do all** for every open one. Your model sees the frame with the pin on it and a close-up of the spot, and is told which element of the frame's HTML is under the pin. It changes the frame, looks at it again, and answers each comment, resolving it when it is done.

## Your model

Your model uses `create_design`, `set_design_frame`, `arrange_design`, `get_design` and `view_design`. Each frame it designs is drawn back to it, so it checks its own work. Its frames are marked **by your model** on the board. It puts patterns, Yarn and parts on a sheet with `arrange_design` too, and changes a pattern on the sheet with its pattern tools.

On a big sheet, your model can add up to 50 frames in one go with `arrange_design`, then look at the section they are in once, instead of a picture for every frame. It can copy a section, with all its frames, from one of the project's sheets to another. Several models can work on one sheet at the same time: each change is kept whole, and each picture a model gets is of the frame it asked for.

While it works, the frame it is designing or looking at is outlined in red on the board, with what it is doing, and a panel in the corner says the same. Press **Follow** there, and each frame it works on is brought into view.
