---
title: Voiceover
order: 11
summary: Add a voice, captions and music to a video, with a voice on your computer or a server you choose.
status: partial
note: Voiceover, captions and music are built. Setting up Piper is not built in the studio yet.
---
# Voiceover

Voiceover turns a script into spoken audio, lays it under your video, and can caption each line.

## Choose a voice

In **Settings, Voice**, pick where the voice comes from:

- **Built in** uses the voice that came with your computer. It needs no setup, and it is the plainest sounding. On Linux it uses espeak-ng, which you install yourself.
- **A voice server** is anything that speaks the OpenAI speech API, such as Kokoro or Piper behind llm-factory, LM Studio, or a cloud service. Give its **Server address**, **Model name** and **Voice**. If your model takes one, **Style** says how to say it, in words. **Other options (JSON)** go with every request. A key, if your server needs one, is kept in your computer's secret store (the Keychain on a Mac).
- **Piper** is listed, but the studio has no place yet to say where Piper and its voice file are. To use a Piper voice today, run it behind a voice server.

Set the **Speed**, and press **Hear it** to try a test sentence.

## Where your words go

The built-in voice runs on your computer, and so does a voice server you run yourself, so your script is not sent anywhere. A cloud service gets the words you send it. Nothing is sent anywhere unless you point it there.

## Make a voiceover

1. In the editor, open the **Voice** tool.
2. Under **What should it say?**, write one line per spoken sentence.
3. Pick a **Voice**, if there is a choice, and a **Speed**. Leave **Add captions** on to caption each line.
4. Press **Make voiceover**.

The whole script is spoken in one take, so the voice stays the same from start to end. Then it is cut at the pauses into a clip per line. If the voice ran two lines together without a clear pause, they stay one clip, and the panel says so. The lines start at the playhead, one after another, and the Pattern becomes a video long enough for them. Each line is saved in Yarn as a sound, tagged `voiceover`, so you can use it again.

To caption a line with other words than it says, like a command, put them after a bar: `Roll it back from the terminal | filefreak sites rollback 3`. If a line would read code aloud, the panel warns you, because nobody follows a command by ear.

If the panel says no built-in voice was found, choose another in Settings.

## Captions and subtitles

Each caption is a Stitch named `caption_1`, `caption_2` and so on, in the lower part of the frame. It fades in and out with its line. Move it or restyle it like any Stitch.

**Download subtitles (.srt)**, in the Voice panel, gives you a subtitle file for platforms that take their own.

## The sounds on a Pattern

Under **On the timeline**, the Voice panel lists each sound with when it starts. Press the sliders button beside it to change it:

- **Starts at**: when it plays, on the video's clock, in seconds.
- **Plays from**: where in its file it starts, so music can begin at its chorus instead of a quiet opening.
- **Loudness**: 1 is as it is, 0 is silent, 2 is twice as loud.
- **Loop to the end**, for music.

Remove a sound with its bin button.

## Music

**Add music from Yarn** puts an audio file from Yarn under the whole video. It loops, fades out at the end, and dips while the voice speaks. Set **Plays from** to start it at the part you want.

## Mixing

When you knit, each voice line and music track is brought to the same loudness first, so no line jumps out. The music dips when the voice speaks, and the final mix is set to one steady loudness, so your video plays at a sensible volume.

Press **Play** on the timeline to hear the voice and music with the motion. The speaker button beside it turns the sound off. It is a preview: the knit also brings every line and track to one loudness, so a quiet line sounds louder in the knit than in the editor.

## Your model

Your model sees the voices with `list_voices` and speaks a whole script with `synthesize_voiceover`. It can give a line as `{say, show}` to caption it with other words.
