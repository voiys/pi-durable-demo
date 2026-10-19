# Several messages per turn ("typing, then sent")

2026-10-19. Can pi send a turn as several finished messages, Grok-bot style, instead of streaming one? Paths are in the
pi checkout (`packages/durable/src/harness/`) unless they start with `src/`.

## How output flows today

- One `AssistantMessage` per model request, always streamed through `models.streamSimple` (`generation.ts:425`).
- The in-progress message is committed as `live.generation.message` at most every `progress.partialIntervalMs`
  (default 100 ms, `agent.ts:34-36`, `generation.ts:401-421`); `classify` (`generation.ts:450`) commits the finished one.
- Events: `message_start` on the first partial, `message_update` with `text_start`/`text_delta`/`block` changes, and
  `message_end` when the entry is stored (`events.ts:282-287`, `:352-361`, `:425-460`).
- Ours: `src/pi/sockets.ts` forwards batches, `src/pi/view.ts` keeps `live` until `message_end`, `toTurns` joins a
  turn's messages, and `bot-pane.tsx` `groupParts` gives each text block its own bubble.
- Blocks are only appended, so a text block is complete once a later block starts, its message is stored, or the run
  ends. Text the model writes before a tool call is complete when the tool call starts.

## Options

1. **UI only (chosen).** Every complete text block is a bubble; the block still being written shows as typing. No server
   change, replay-safe, and memory already logs one `talk` row per text block (`src/optchat/extension.ts`). One prompt
   line nudges the model to say what it is about to do before longer work.
2. **A `say` tool.** Each call ends the request and re-reads the whole context (latency, tokens), logs as a tool row,
   needs activity-UI special cases, and a crash mid-tool can post twice. Worse than (1) in DMs.
3. **Pi features.** None outputs several messages: `onYield` `{continue}` only appends a fake user message, steering
   handles input, `stopReason: "deferred"` is a provider poll handle, `ToolControl.terminate`/`handoff` only end runs.
   Usable hooks: `afterResponse(message)` (every finished response, before classify; `types.ts:765`,
   `generation.ts:479`) and `afterTools(entryId)` (after storing, `generation.ts:645`).

Streaming can't be turned off (only `streamSimple`); `settings.progress.partialIntervalMs` on `Harness.open` batches
partial commits. A larger interval delays the first partial and the crash-recovery copy by that much; 250-500 ms is an
optional saving on SQLite writes, not needed for this feature.

## Recommendation

- DMs: (1), done in `bot-pane.tsx` (typing bubble, then the whole bubble) plus the prompt line in `bot.ts`.
- Between a run's steps nothing is live, so the UI bases its indicator on `session.running` and the last part being a
  settled tool call, not on `turn.live`.
- Groups (not done): post a group bot's pre-tool text from an `afterResponse` hook for `stopReason === "toolUse"`,
  keyed by `message.timestamp` so an aborted-and-retried attempt doesn't post twice, with the Group DO ignoring
  duplicate keys. `afterTools` is replay-safe but posts only after the tools finish.
