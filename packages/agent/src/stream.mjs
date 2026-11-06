// An answer read as it is written, for a person to watch it come.
//
// A request with `stream: true` is answered as server-sent events: the message's start, each
// block's start, the pieces of each block, each block's end, and the message's end. Put
// together here, they are the same message a plain request returns, so the loop that reads
// one does not change: only what it shows while it waits. A server that answers all at
// once anyway (a proxy, a test's) is read whole.

/** What the stream said went wrong, as the API names it: overloaded_error, rate_limit_error. */
export class StreamError extends Error { constructor(m, type) { super(m); this.type = type; } }

/**
 * Read a streamed answer to the end. `onDelta({ index, type, text })` is called as each text
 * or thinking block grows, with all of that block's text so far: `type` is "text" or
 * "thinking". Returns the message, as a plain request would have.
 */
export async function readMessage(res, { onDelta } = {}) {
  if (!/text\/event-stream/i.test(res.headers.get("content-type") ?? "")) return res.json();
  const blocks = [];
  const json = new Map();
  let msg = null;
  const take = (ev) => {
    switch (ev.type) {
      case "message_start": msg = { ...ev.message, content: blocks }; break;
      case "content_block_start": {
        const b = { ...ev.content_block };
        if (b.type === "tool_use" || b.type === "server_tool_use") json.set(ev.index, "");
        blocks[ev.index] = b;
        break;
      }
      case "content_block_delta": {
        const b = blocks[ev.index], d = ev.delta ?? {};
        if (!b) break;
        if (d.type === "text_delta") { b.text = (b.text ?? "") + d.text; onDelta?.({ index: ev.index, type: "text", text: b.text }); }
        else if (d.type === "thinking_delta") { b.thinking = (b.thinking ?? "") + d.thinking; onDelta?.({ index: ev.index, type: "thinking", text: b.thinking }); }
        else if (d.type === "signature_delta") b.signature = (b.signature ?? "") + d.signature;
        else if (d.type === "input_json_delta") json.set(ev.index, (json.get(ev.index) ?? "") + d.partial_json);
        else if (d.type === "citations_delta") (b.citations ??= []).push(d.citation);
        break;
      }
      case "content_block_stop": {
        const b = blocks[ev.index];
        if (b && json.has(ev.index)) {
          const s = json.get(ev.index);
          // Cut off part way, the input may not be whole: it is sent back as nothing, and not run.
          try { b.input = s ? JSON.parse(s) : (b.input ?? {}); } catch { b.input = {}; }
          json.delete(ev.index);
        }
        break;
      }
      case "message_delta":
        if (!msg) break;
        Object.assign(msg, ev.delta ?? {});
        if (ev.usage) msg.usage = { ...msg.usage, ...ev.usage };
        break;
      case "error": throw new StreamError(ev.error?.message ?? "The answer stopped part way.", ev.error?.type ?? "api_error");
      default: break;   // ping, message_stop, and whatever is added later
    }
  };

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    buf += done ? dec.decode() : dec.decode(value, { stream: true });
    buf = buf.replace(/\r\n?/g, "\n");
    let at;
    while ((at = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, at); buf = buf.slice(at + 2);
      const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (!data) continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; }
      take(ev);
    }
    if (done) break;
  }
  if (!msg) throw new StreamError("The answer ended before it began.", "api_error");
  // Whatever did not close (the stream was cut): its input as far as it got, or nothing.
  for (const [i] of json) { if (blocks[i]) blocks[i].input = {}; }
  msg.content = blocks.filter(Boolean);
  return msg;
}
