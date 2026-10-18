# OptChat port: verified gaps and fix plan

Verified 2026-10-18 against upstream jonaslsaa/pi-optchat@aae1caf (`UP=$(ctx path pi-optchat-main)`), pi-durable 1.3.0
(`$(ctx path pi-source-v1.3.0)/packages/durable`), `node_modules/agents/dist/harness/pi/index.js` (agents 0.28.1) and our
`src/optchat/*`, `src/server/{user,chat,agents}.ts`. Line numbers are from those files today. Fixed decisions stay as they
are: one memory per user, every chat writes to it, chat id in metadata plus a chat label, previous exchange on (16 KB), local only.

## Part 1. Confirmed gaps, most severe first

### G1 HIGH: the chat label is part of `Entry.text`, so the code that reads the text as upstream wrote it gets it wrong
- Upstream: rows are raw (`transcript.ts:49-62`). `memory.ts:305-312` `callOf` matches a result to its call with
  `text.startsWith(`${call.text.split(' ',1)[0]}:`)` (#153). `memory.ts:381` search skips the memory's own copies with
  `/^(zoom|search)[ :]/`.
- Ours: `user.ts:122` stores `[chat "${chat.title}"] ${r.text}` for every kind. `memory.ts:314-321` and `memory.ts:390` are
  unchanged copies of upstream.
- Failure: (a) a call's first word is now `[chat`, so no echo ever matches its call. Every tool result over 512 bytes is
  summarized without the call that produced it, which is the bug #153 fixed. It fails silently. (b) Logged `zoom`/`search`
  calls and results are no longer skipped, so `search` returns the memory's own copies of summaries. (c) The label can be
  searched: in a chat titled "Fix the budget view", `search("budget")` matches every row of that chat. (d) The title is fixed
  when the row is logged. After a rename, one chat shows up under two labels. A chat started by `receive()` (chat.ts:112;
  no socket submit, so no `syncIndex` before the first yield) gets the title `[message from session "X" (uuid)] …`
  (user.ts:171 titleFrom). Titles are not escaped, so a `"` in a title breaks the label.
- Fix: keep `Entry.text` raw and the chat in `Entry.chat`, which is already saved (memory.ts:29,172). Add the label only
  where text is shown to a model, through a `label(entry)` callback that the User DO passes in (G1 steps in Part 2).

### G2 HIGH: logging is end-of-turn only, starts before the answer is committed, and nothing logs a failed run
- Upstream: logs each message on `message_end` (`index.ts:393-429`). `startRun` calls `flush()` (`index.ts:372`). The first
  model call captures the view and only then logs the new input (`index.ts:436-449`). `agent_settled` flushes again
  (`index.ts:484-486`). Every earlier message is in memory before a run captures its view.
- Ours: only `chat.ts:50-53` logs: the root `onYield` runs `ctx.waitUntil(this.logTurn())`. pi-durable `generation.ts:544-553`
  runs the `onYield` hooks before `appendAssistant` commits the answer, so `logTurn`'s `messages()` read races that commit.
  An error, an abort, or a run past its retries never reaches `onYield` (`generation.ts:508-536`, `:385`).
- Failure: (a) The final answer of turn N is usually not in memory until the chat's next turn, and never if the user leaves
  that chat. From chat B, "what did A conclude?" finds A's question and tool steps but not A's answer. In A, the 16 KB
  previous exchange hides this, except when the answer is over 16 KB: then it is in neither the view nor the context.
  (b) A run that errors or is stopped stays out of memory until a later run in the same chat succeeds. (c) The log is
  ordered by turn completion. A 10-minute run in chat A lands after three quick turns in B even though A's rows are dated
  earlier, and VIEW_DOC tells the model "its latest word on a thing is the truth".
- Not verified at runtime: which side wins the `onYield` vs commit race. The fix removes the race either way.
- Fix: log committed entries at the points where upstream logs them (G2/G3 steps in Part 2): before the view at the first
  request of a run (everything settled), after the view (the run's input), after every tool round (`afterTools`,
  types.ts:769), and in `onYield`, where the answer comes from the hook's own argument.

### G3 HIGH: the log cursor counts entries in a list that can shrink, and its update is not atomic
- Upstream: one process, one writer. `flush()` keeps `logged` in the same synchronous loop as `memory.append`
  (`index.ts:129-142`). Receipts drop repeated reports (`index.ts:152,410-413`).
- Ours: `chat.ts:132-137` reads kv `optchat:logged` (a count), awaits `messages()`, awaits the `memoryLog` RPC, then saves
  `entries.length`. `messages()` is "the active transcript ... since the newest reset" (agents pi/index.js:627-629). After a
  pi compaction (G4) it is `[head marker, kept…]`, which is shorter. `user.ts:118-124` appends row by row with no dedupe.
- Failure: (a) After a pi compaction or a protocol `reset` (sockets.ts:190), `slice(logged)` is `[]` and the count is
  overwritten, so one turn is never logged. (b) If a row throws, the earlier rows stay appended and the cursor does not
  move, so every retry appends them again. `store.append` throws synchronously inside `enqueue` (memory.ts:185-188), before
  `root.push`. A user or talk row over the 2 MB DO SQLite value limit does this; only echo rows are capped (extension.ts:33).
  The result is duplicates on every turn and that chat is stuck. (c) The Chat DO can be evicted between the RPC and `kv.put`,
  or two root yields can overlap within one RPC round trip (rare). Both log rows twice.
- Fix: the User DO owns a per-chat cursor that holds an entry id (ids are monotonic numbers, ids.ts:4-6). `memoryLog` is
  one synchronous, idempotent method. Cap every row (G3 steps in Part 2).

### G4 HIGH: pi's own compaction is still on for the root conversation
- Upstream: `index.ts:475-478` `session_before_compact` returns `{ cancel: true }`: "OptChat manages history between turns".
- Ours: `chat.ts:63` `Harness.open(storage, { models, registry })`, so `DEFAULT_COMPACTION_POLICY` applies (agent.ts:27-32:
  enabled, reserve 16384, background 32768). `thresholdCompaction` (generation.ts:322-339) measures the whole raw
  transcript, not what our hook sends. Overflow compaction is on too (generation.ts:489-505).
- Failure: a long-lived chat (the reason OptChat exists) passes `contextWindow - 48K` raw tokens even though each request is
  small. pi then runs an LLM compaction on the user's plan nobody asked for: either a stall before a request, or a
  background task. The context then gets a summary head marker, which (a) shrinks `messages()` and causes G3a, and
  (b) puts pi's summary text into the run and into the previous exchange.
- Fix: decline compaction for the root conversation only, so subagents keep plain pi context (DECISIONS.md). Use
  `hook(CompactionTask, { beforeCompact: (_c, api) => api.conversationId === ROOT_CONVERSATION_ID ? { decline: true } : undefined })`
  (types.ts:801-811, compaction.ts:135-139: a declined threshold compaction leaves a request that may still fit). Cost: a long
  root chat creates one declined compaction task per request. Bounding the run is G9's job, as upstream does.

### G5 HIGH: the view is fetched and settled again before every request, and settle waits for other chats' new rows
- Upstream: `index.ts:436-449` builds `view` once per run (it is reset in `startRun`, `index.ts:372`) and changes it only at a
  mid-turn refresh (`index.ts:455-461`). One writer, so `settle()` waits only for this chat's history.
- Ours: `extension.ts:79` `await memory.view()` runs on every `beforeRequest`, that is every tool round, retry and recovery
  (types.ts:758). `user.ts:127-131` `settle()` then `render()`. `Memory.settle('turn')` (memory.ts:339-342) waits until
  every line of the current view is built, including rows other chats logged after the call.
- Failure: in a 20-step run, the first user message changes whenever another chat logs or a merge lands, so the provider
  prompt cache misses from that point on, and lines the model is reasoning about by id change mid-run. Each step of chat A
  waits for chat B's new rows to be summarized (one LLM call per row over 512 B). If B logs all the time (a subagent-heavy
  chat), A's turns stall. After a restart, a replayed request can see a different view.
- Fix: pin the view per generation task with `api.memo` (types.ts:750-751: memos belong to the task, which is one run).
  Make `settle` wait only for rows that existed when it was called (G5 steps in Part 2).

### G6 MEDIUM: changing the Debug budget or resetting memory fails turns in flight, and the reset can hand out a closed Memory
- Upstream: `settle` rejects "Memory wait cancelled." only when the Memory is closed (`memory.ts:335-339`), and it is closed
  only on a profile switch or shutdown (`index.ts:162-176`).
- Ours: `user.ts:34-43` `#openMemory` runs `void this.#memory?.close()` from whichever RPC first sees a new `viewBytes`.
  `memoryView` is still waiting on the old instance (user.ts:128-130). `resetMemory` (user.ts:147-151) awaits `close()`
  while `#memory` still points at the stopped instance. `memoryLog`'s `waitUntil(settle(…'tree'))` rejection is never caught.
- Failure: the user picks a budget while chat A is in `memoryView()`. A's turn then fails with "Memory wait cancelled." A
  `memoryLog` that arrives during `resetMemory`'s `await` gets the stopped Memory, throws "Memory is closed.", and those
  rows are lost or logged twice (G3).
- Fix: see Part 2, user.ts.

### G7 MEDIUM: summarizing stops when the User DO is evicted, and retries run forever with no credential
- Upstream: a long-lived process. The pump starts in the constructor (`memory.ts:158`) and retries on timers.
- Ours: the Memory opens lazily on an RPC (user.ts:34). `onStart` (user.ts:45-52) never opens it, and there is no alarm. The
  pump is a microtask plus `setTimeout` (memory.ts:253-290). Only `ctx.waitUntil(settle)` (user.ts:123) keeps the work alive,
  and the Cloudflare docs say it does nothing in a DO (taken from the docs, not checked in code). `credential()` throws when
  ChatGPT is disconnected (user.ts:224-227), and each part retries every 10 s while the DO is awake.
- Failure: rows logged just before an eviction stay unsummarized until some chat's next `memoryView`. That turn then waits
  for the whole backlog. After a disconnect, 8 parts retry every 10 s for as long as anything keeps the DO awake, and the
  only sign is `memoryStats`.
- Fix: open the Memory in `onStart` when the log is not empty, and keep an alarm (`this.schedule(15, "pump")`, agents SDK)
  while `pending > 0`. The alarm handler opens the Memory, which restarts the pump. Do not build while `siwc:connection`
  is missing: `memoryView` fails loudly with "Connect your ChatGPT plan first", as chat already does.

### G8 MEDIUM: messages from other sessions and peer agents are logged as the user's own words
- Upstream: `transcript.ts:34-48` `asUser` prefixes injected messages `[customType] ` so "the compactor never takes it for the
  user's words". Only receipted reports become `work` (`transcript.ts:51`).
- Ours: `extension.ts:31` only `[subagent ` counts as `work`. `chat.ts:112` `[message from session "T" (uuid)] …` and
  `agents.ts:165` `[message from <agent>] …` are logged as `user`. The uuid in the text is an id in compactor input
  (the recipe's "no ids" lesson).
- Failure: chat A's agent tells chat B "drop the migration". B's memory has `user: drop the migration`, the compactor ranks
  it as the user's order, and the model later acts on it as one.
- Fix: one exported list of agent-origin prefixes (`[subagent `, `[message from `), defined next to the strings in
  agents.ts/chat.ts. `logRows` maps them to `work`. Drop the uuid from `receive()`'s text, since the title is enough for
  the model.

### G9 MEDIUM: the current run is sent with no bound (no `boundedMessage`, no mid-turn refresh)
- Upstream: `transcript.ts:63-68` `boundedMessage` caps each tool result in the live context to CAP. `transcript.ts:198-222`
  plus `index.ts:455-461` move a long run's earlier steps into the view (`TURN_REFRESHED`).
- Ours: `extension.ts:82-89` sends `messages.slice(from)` unchanged. `cap()` applies only to the logged echo row.
  `TURN_REFRESHED` (prompts.ts:207) is never used.
- Failure: a 1 MB tool result goes, in full, into every later request of that run, while memory keeps 30 K characters of
  it. With G4 fixed, a long run grows until the provider reports a context overflow and the turn fails, which is the
  upstream behaviour for a run that is too long without refresh.
- Fix: step 1 is to map `toolResult` messages of the run through a `boundedMessage` port in `beforeRequest`. Step 2 (later,
  can be its own slice) is to port `refreshPoint`/`refreshedRun` using `api.models.getModel(...).contextWindow` and the
  `afterTools` logger from G2, with `keep` and the refreshed view kept in the same memo.

### G10 MEDIUM: the prompts describe upstream's runtime, not this one
- Ours: `prompts.ts:75` MODELS_HINT says to call `models()`, which is not a tool here (the tools are zoom, date, search,
  subagent, sessions and agents). MASTER (prompts.ts:78-94) says reports start with `"[id] "` (ours start with
  `[subagent <name> answered…]`, agents.ts:61,67), names `[OptChat status]` (never sent; PAPERCUTS), "computer tasks",
  "instructions at the end of this prompt" (there are none) and "a single chat that never ends". VIEW_DOC
  (prompts.ts:95-104) says work starts with `"[id] "`. COMPACT says one user in a single chat. `CHAT_LABELS`
  (extension.ts:68) says every item starts with `[chat "<title>"]`, which a merged line does not. `chat.ts:14` PREAMBLE
  ("You are a helpful, concise assistant.") comes before MASTER ("You are OptChat"), so the model gets two identities.
- Failure: "use the newest Luna" leads to a `models()` call and `tool_unavailable`. The model waits for a `[id]` report
  that never comes in that form. It treats the interleaved view of several chats as one thread.
- Fix: prompts.ts adaptations (Part 2). The model is not told which chat it is in, so add the current chat's label to the
  per-request user-side text, not the cached system section.

### G11 MEDIUM: the compactor's model, concurrency and missing timeout share the plan with the main turn
- Upstream: a cheap compactor model that can be configured (`profiles.ts:17`, `/optchat model`). Its "Summaries at once"
  setting says to keep below the provider's parallel limit.
- Ours: `user.ts:40` uses `MODEL.id` (gpt-6.1-sol, the flagship) at `medium` (PAPERCUTS documents this), `jobs` defaults to
  8 (memory.ts:146), `compactor.ts:26` has no timeout, and `memoryView` takes no signal, so Stop does not end the wait.
- Failure: a big paste starts 8 flagship calls at once on the same ChatGPT plan, and the main request is the one the rate
  limit refuses. A hung compactor request blocks the turn in `settle` with no way out.
- Fix: `jobs = 3` for the User DO. Use `AbortSignal.any([signal, AbortSignal.timeout(90_000)])` on each `completeSimple`.
  Default the compactor to `gpt-6-luna` at `low` when the plan lists it, checked against `availableModels()` and failing
  loudly if absent, and show it in Debug.

### G12 LOW: the previous exchange does not skip back past every unsuccessful run, and can be a report run
- Upstream: `transcript.ts:89-126` returns the latest successful run, skipping failed and unfinished ones. Size applies to
  that run only (an oversize run gives none).
- Ours: `extension.ts:56-65` looks only at the run that ends right before `from`. Error and aborted answers are already
  excluded from pi's context (context.ts:10,227), so those fall back correctly. A `length` stop or a `toolUse` stop with no
  calls (both end a run in `runStart`, extension.ts:48) gives no exchange at all. A run started by a subagent report or a
  peer message (G8) becomes "the previous exchange".
- Fix: loop back over runs until one ends with `stopReason === "stop"` and has text, then apply the 16 KB check to that run
  only. Skip runs whose requests all start with an agent-origin prefix (G8).

### G13 LOW: dates are shown in the Worker's UTC
- Upstream `memory.ts:390` `new Date(date).toString()` runs on the user's machine. Ours, memory.ts:397 and tools.ts:21, runs
  in the DO, which is UTC, so "yesterday evening" is mislabelled.
- Fix: save the browser's IANA zone in UserState once (from the client on connect) and format with
  `Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "full", timeStyle: "long" })`. Memory gets a `formatDate`
  callback, as with G1.

### G14 LOW: small correctness items
- `extension.ts:31`: a user who types `[subagent …` is logged as `work`. G8's prefix list has the same weakness. The full
  fix is to classify by the entry's origin (`EntryRecord.byTaskId` is set for task-made entries, types.ts:347): user-typed
  input has none, while report and peer submits come from tasks. Check this live before relying on it.
- `extension.ts:11-12`: an image-only user message is logged as an empty `user` row. Log `[image]` per image block instead
  (images are a documented drop, but the row should say one was there).
- `compactor.ts:8-12`: each retry sleep leaves an abort listener on the Memory-wide signal. Remove it when the timer fires.
- `user.ts:96-104` `deleteChat`: a `logTurn` already in flight after `wipe()` still logs to the chat while it is in the
  catalog, and `memoryLog` throws "Unknown chat" inside `waitUntil` once the chat is gone. With the G3 cursor in the User
  DO, delete removes the cursor row first, and `memoryLog` for an unknown chat throws as now (loud and correct).
- DECISIONS.md says `[chat: <title>]`, while the code and CHAT_LABELS say `[chat "<title>"]`. Fix the record when G1 lands.

### Refuted or dropped (one line each)
- "Aborted or errored turns are cut out of the next request" (spec analyst, HIGH): wrong. pi drops aborted, errored and
  deferred assistants from context (context.ts:10,227), so `runStart` does not treat them as a boundary. The failed run's
  user message and steps stay in the current run word for word, and the previous exchange falls back to the last good one.
  The part that holds (they are not logged) is G2.
- "`memory.ts` cannot run under node, no runnable spec": `scripts/optchat-upstream.ts` already runs upstream's memory suite
  with `--experimental-transform-types` (package.json:9). What is missing is tests for our own code (Part 3).
- "The first turn is permanently labelled New chat (race with syncIndex)": not for UI chats. `sockets.ts:185` runs
  `syncIndex` right after submit, so the title is set before the first yield. It holds only for `receive()`-started chats,
  which G1 covers.
- "The UI reset loses logging": the chat UI does not send `reset` (only protocol.ts/use-pi-session.ts define it, and
  chat-pane never calls it). The real trigger is pi compaction (G4). Both are handled by G3.
- "One oversize row sets `Memory.failed` and poisons every chat": wrong mechanism. `store.append` throws synchronously
  before `root.push`, so `failed` is not set. The real effect (a partial batch, then duplicates) is G3b.
- "Subagents get no view or SUBAGENT prompt" and "no running-subagent status line": these are decisions in DECISIONS.md
  ("Subagents keep plain pi context") and PAPERCUTS, so they are not reopened here. Only the prompt text that still promises
  them is kept (G10).
- "Compactor usage accounting": not a behaviour gap.
- Checked and fine: keeping every `system` message before the run (extension.ts:89) is correct for pi-durable, where system
  messages are deltas that must be replayed in order (context.ts:200-209). The view is not written into the transcript,
  because the `beforeRequest` result is used for that request only (types.ts:757-758).

## Part 2. Implementation plan, in order, by file

Order: G1 (pure, testable), then G3+G2 (one new logging path), G4, G5, G6/G7, G8/G12, G9 step 1, G10, G11, G13, G14. Each
step leaves the app working. No fallbacks. Asserts where the invariants are.

### src/optchat/memory.ts (G1, G5, G13)
1. Constructor option object instead of more positional args. Replace the parameter properties with explicit fields
   (erasable syntax): `constructor(source, compress, opts: { warn?, budget?, jobs?, retryMs?, label?: (e: Entry) => string, formatDate?: (iso: string) => string })`.
   `label` defaults to `() => ""` and `formatDate` to `d => new Date(d).toString()`, so upstream's suite still runs unchanged.
2. `build()` (memory.ts:294): a leaf's source becomes `${entry.kind}: ${this.label(entry)}${entry.text}`. A short message
   whose node is its own source keeps the label in its node, so the view shows it. `callOf` and `search` read raw
   `entry.text`, as upstream does. `call.text` sent to the compactor stays raw (`tool: name {...}`).
   `Entry.size` (memory.ts:154,172) stays `${kind}: ${text}`. It is not used for view sizing (Sawtooth uses node sizes), so
   leave it.
3. `zoom(id, 1)` (memory.ts:365,374): `${id}+1|${kind}: ${label(entry)}${text…}`. Paging offsets stay offsets into the raw
   text.
4. `settle(signal, until, upTo?)`: in `'turn'` mode, done is `this.view.every(p => start(p) >= upTo || this.node(p)) || this.stalled`.
   `memoryView` passes `upTo = root.length` taken when it is called. Lines from rows logged later may show as
   `(not summarized yet: zoom it)`. That is upstream's stalled-path rendering, and the only way a shared writer can't block
   a turn. Assert `upTo <= root.length`.
5. `date()` uses `this.formatDate`. `tools.ts:21` `searchPage` gets the formatter (or calls `memory.date(entry.i)`).

### src/server/user.ts (G1, G3, G6, G7, G11)
1. G1 `memoryLog` appends raw text with `chat = chatId`. `#openMemory` passes
   `label: e => e.chat ? `[chat "${clean(titleOf(e.chat))}"] ` : ""`, where `titleOf` reads the `chats` table (current title,
   or `deleted chat` when the row is gone) and `clean` removes `"`, newlines and over-long text (cut to 40 at a word, as
   `titleFrom`). Labels are fixed when a node is built, and later nodes use the new title. That is fine for one-line
   summaries, and zoom and search show the current title.
2. G3 table `optchat_cursor (chat_id TEXT PRIMARY KEY, entry INTEGER NOT NULL, answer_ts INTEGER)`, created in
   `onStart`. New RPCs:
   - `memoryCursor(chatId): number` returns `entry` or `-1`.
   - `memoryLog(chatId, items: { entryId: number; role: string; ts: number; rows: LogRow[] }[], answer?: { ts: number; rows: LogRow[] }): number`.
     It is synchronous (no `await`). Assert the chat exists (`hasChat`). Read the cursor. Skip items with
     `entryId <= cursor.entry`, and skip the one assistant item whose `ts === cursor.answer_ts` (that answer was already
     logged from `onYield`; clear `answer_ts` then). Assert that the remaining items have increasing ids. Append their
     rows, then the `answer` rows unless an item with that `ts` was just appended, in which case clear `answer_ts`;
     otherwise set it. Write the cursor last and return it. Everything happens in one synchronous block, so DO write
     coalescing commits the batch as a unit. Rows are capped in `logRows`, so `append` cannot throw on size. If it still
     throws, set `#memory = undefined` before rethrowing, so the next open reloads from SQLite and the in-RAM log can't run
     ahead of the database.
   - `deleteChat` deletes that chat's cursor row. `resetMemory` keeps every row's `entry` and clears `answer_ts`. That
     matches its docstring: turns already logged are not logged again, and the memory starts empty from each chat's next
     entry.
3. G6 no close or reopen from read paths. `#openMemory()` only opens when `#memory` is undefined. `setDebug` (user.ts:110)
   and `resetMemory` swap synchronously: `const old = this.#memory; this.#memory = undefined; …; await old?.close()`.
   `memoryView` waits on the instance it got and, if that instance was replaced while it waited, opens the new one and
   waits again. This is a loop on "replaced by us", not a fallback for errors:
   `for (;;) { const m = this.#openMemory(); try { await m.settle(undefined, "turn", m.root.length); return m.render(); } catch (e) { if (this.#memory === m) throw e; } }`.
   Catch the `waitUntil(settle(…'tree'))` promise in `memoryLog`, replacing it with the G7 alarm.
4. G7 `onStart`: when `optchat_log` exists and has rows and `siwc:connection` is set, call `this.#openMemory()`. Replace
   `ctx.waitUntil(settle('tree'))` with `this.#keepPumping()`, which calls `this.schedule(15, "pumpMemory")` unless one is
   already scheduled (`getSchedules`). `pumpMemory()` opens the Memory and, while `pending > 0 || active > 0`, schedules
   itself again. In `#openMemory`, assert that `siwc:connection` exists, so a disconnected user gets the same loud error as
   chat instead of endless compactor retries.
5. G11 pass `jobs: 3`. Choose the compactor: `gpt-6-luna` at `low` if `availableModels()` lists it, otherwise throw
   "Compactor model gpt-6-luna not on this plan". Make it a `DebugSettings.compactor` field shown in Debug, and update
   PAPERCUTS.

### src/server/chat.ts (G2, G3, G4)
1. Delete `logTurn` and kv `optchat:logged`. Add a private serialized logger:
   ```ts
   #logging: Promise<unknown> = Promise.resolve();
   #cursor: number | undefined; // cache of the User DO's cursor; the User DO is authoritative
   #log(scope: "settled" | "all", answer?: AssistantMessage): Promise<void> {
     const run = async () => {
       this.#cursor ??= await this.#user().memoryCursor(this.chatId);
       const entries = (await this.harness.session().messages()).filter((e) => (e.id as number) > this.#cursor!);
       const upTo = scope === "all" ? entries.length : settledEnd(entries); // settledEnd: same boundary as extension runStart
       const items = entries.slice(0, upTo).map((e) => ({ entryId: e.id as number, role: e.model?.[0]?.role ?? "", ts: e.model?.[0]?.timestamp ?? 0, rows: logRows(e) }));
       this.#cursor = await this.#user().memoryLog(this.chatId, items, answer && { ts: answer.timestamp, rows: logRows({ model: [answer] } as EntryRecord) });
     };
     return (this.#logging = this.#logging.then(run, run));
   }
   ```
   `settledEnd(entries)` is the index after the last entry whose message is an assistant with a stopReason outside
   `toolUse | error | aborted | deferred`. Export it from extension.ts next to `runStart`, so there is one definition of
   "run boundary" (pi drops error/aborted/deferred from context, context.ts:10).
2. The logging points (G2):
   - The optchat extension's `beforeRequest` calls `MemoryApi.flush("settled")` before the view, then `flush("all")` after
     the view is pinned. This matches upstream `index.ts:446-448`: capture the view, then log the input. The run's own rows
     never get into its pinned view.
   - New `hook(GenerationTask, { afterTools: (_a, _r, api) => api.conversationId === ROOT_CONVERSATION_ID ? this.#log("all") : undefined })`.
     Awaited: one cross-DO RPC per tool round, which lets other chats see this run as it goes (G2c).
   - `onYield: (answer, api) => { if root: this.ctx.waitUntil(this.syncIndex()); return void this.ctx.waitUntil(this.#log("all", answer)); }`.
     The answer is logged from the hook's argument, so the commit race no longer matters. The cursor's `answer_ts` stops the
     committed entry from being logged twice later.
   - The `MemoryApi` passed to `optchatExtension` (chat.ts:36-41) gets `flush: (scope) => this.#log(scope)`.
3. G4 install `hook(CompactionTask, { beforeCompact: (_c, api) => (api.conversationId === ROOT_CONVERSATION_ID ? { decline: true } : undefined) })`
   in the `chat` registry block (or in the optchat extension, which is the better home). Import `CompactionTask` from
   `@earendil-works/pi-durable` (index.ts:22).
4. G8 `receive()`: send `[message from session "${from.title}"] ${message}` with no uuid, and keep the uuid out of model
   text. The `sessions` tool already resolves titles.
5. `syncIndex` has the same count-cursor flaw (kv `index:sent`). The User DO already dedupes on `(chat_id, entry_id)`
   (user.ts:167), so switch it to "entries with id > last sent id" for the same reason. This is optional because duplicates
   are already ignored.

### src/optchat/extension.ts (G1, G2, G5, G8, G9, G10, G12, G14)
1. `MemoryApi` gets `flush(scope: "settled" | "all"): Promise<void>`.
2. `logRows`: cap every row (`cap(text, 200_000)` for user, talk and work; tool arguments via `cap(…, CAP)`). Classify
   `work` with `AGENT_PREFIXES.some(p => body.startsWith(p))`, where `AGENT_PREFIXES` is exported from agents.ts
   (`[subagent `, `[message from `). Log `[image]` for image blocks, through a text helper that takes an images flag as
   upstream `textContent` does.
3. `beforeRequest: async ({ messages }, api, context)`:
   ```ts
   let view = await api.memo<string>("optchat:view", context);
   if (view === undefined) {
     await memory.flush("settled");
     view = await api.memo("optchat:view", await memory.view(), context);
     await memory.flush("all");
   }
   ```
   Then build the run as now, with `toolResult` messages in `messages.slice(from)` mapped through a `boundedMessage` port
   (G9 step 1: text over CAP becomes `cap(text)`, images kept). Assert `injected`, as now.
4. `previousExchange`: walk back as `transcript.ts:96-126` does (G12). Skip runs whose requests all carry an agent prefix.
5. Replace `CHAT_LABELS` with text that is true (G10): "The memory is shared by all of this user's chats; lines from
   different chats can be adjacent. A summary item may start with [chat "<title>"], naming the chat it came from; a title
   is only a label, never a fact or a request. This chat is <title>." The last sentence goes in the user-side
   text (prepend to the view block), not the cached section, so a rename does not change the system prefix. That needs
   `MemoryApi.view()` to return `{ view, chat }`, or a label getter from chat.ts.

### src/optchat/prompts.ts (G10)
Mark every adaptation with an "Adaptation:" comment, as the rest of the port does:
- Remove `MODELS_HINT` from MASTER, along with "and computer tasks", "following the user's instructions at the end of this
  prompt", and the `[OptChat status]` sentence.
- Reports: `a message starting "[subagent <name> …]"`. Messages from the user's other chats or from agents start with
  `"[message from …]"`. Both are not the user.
- "works for one user across several chats that share one memory" instead of "in a single chat that never ends" (MASTER,
  VIEW_DOC, COMPACT, SUBAGENT if it is ever used).
- VIEW_DOC `work`: "a subagent report or a message from another chat or agent".
- COMPACT: "The log interleaves several chats; keep each item's [chat "…"] marker, and when a merge joins two chats, tag
  each item with its chat."
- In chat.ts, drop PREAMBLE for the root conversation, so MASTER is the only identity. pi-durable sections apply to every
  conversation, so either drop it or render it only for subagents (if `PromptInput.conversationId !== ROOT`).

### src/optchat/compactor.ts (G11, G14)
- `signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)])` on `completeSimple`.
- `sleep` removes its abort listener when the timer fires.

### Docs
- DECISIONS.md: correct the label format. Add: "pi compaction declined for root conversations (OptChat owns history,
  upstream index.ts:475)". Add: "memory cursor per chat lives in the User DO".
- PAPERCUTS.md: remove "Logging happens when the main agent finishes a turn…" and "turn that errors… not logged" once G2
  lands. Update the compactor model line (G11) and the pump line (G7). Add "no mid-turn refresh yet" until G9 step 2.

## Part 3. scripts/optchat-spec.ts (run: `node --experimental-transform-types --no-warnings --test scripts/optchat-spec.ts`)

Use `node:test` with `node:assert/strict`. Fakes: an array-backed `Store` (`append`, `appendNode`, `saveView`, and `load()`
returning `Saved`). A compressor that returns `S<i>` and records each `Compression` input. A `MemoryApi` with `view`,
`flush` and the rest. The extension hook is reached as `optchatExtension(api).hooks[0].handlers.beforeRequest(req, hookApi, ctx)`,
with `hookApi = { conversationId: ROOT_CONVERSATION_ID, memo }` and an in-memory `memo`. Add it to package.json as
`check:optchat-spec`. Keep `check:optchat-upstream`; it must stay green after the memory.ts constructor change, which
needs `label` and the other new options to default.

- S1 call pairing with labels (G1, upstream memory.test.ts:846-869): the 7-row tool/echo sequence, appended raw with
  `chat: "c1"` and a `label` that returns `[chat "T"] `. Leaf 3's `call.i === 1` and leaf 4's `call.i === 2`, the others
  have none, and the compactor's `source` for a big echo starts with `echo: [chat "T"] `.
- S2 search with labels (G1, upstream search.test.ts:10-37): labelled `zoom {…}` and `zoom: …` rows are skipped.
  `search("T")` where T is only in the title returns nothing. Newest first, 20 per page, `before` continues.
- S3 zoom label: `zoom(id, 1)` returns `id+1|kind: [chat "T"] text`, and paging offsets count raw text only.
- S4 settle bound (G5): log 3 rows and render once built. Append 1 big row whose compressor never resolves:
  `settle(undefined, "turn", 3)` resolves, while `settle()` with no bound does not resolve within 50 ms.
- S5 view pinned per run (G5): two `beforeRequest` calls with the same `memo` call `view()` once. Between them,
  `flush("settled")` then `flush("all")` are called in that order, once.
- S6 previous exchange (upstream transcript.test.ts:27-56): the exact last answer and all its requests, steering
  included. Thinking blocks and earlier tool output are absent. The view is a separate text block, then `\n\n` and the
  user's words. The input `messages` are not mutated.
- S7 previous exchange fallback (G12, transcript.test.ts:58-77): after a run that ends in `length`, or in `toolUse` with
  no calls, the older completed exchange is replayed. After a run of only `[subagent x answered…]` requests, the user's
  last real exchange is replayed.
- S8 size limit (transcript.test.ts:78-91): exactly 16000 bytes is replayed in full. 16001 bytes is left out, not swapped
  for an older exchange.
- S9 no user message: `beforeRequest` with no user message after the boundary throws `/no current user message/`.
- S10 logRows: user goes to `user`. `[subagent ` and `[message from ` go to `work`. Assistant text, toolCall and
  toolResult go to `talk`, `tool` and `echo`. Error or aborted adds an `Agent <reason>: …` echo. Every row is at most its
  cap, and order is kept. An image-only user message becomes `[image]`.
- S11 bounded run (G9): a 100 K-character tool result in the current run reaches the request capped to CAP, with images
  kept.
- S12 cursor semantics (G3): run the User DO's `memoryLog` decision logic as a pure function `planLog(cursor, items, answer)`
  that `user.ts` uses too, so the test calls the real code. Sending the same items twice appends once. An answer logged
  from `onYield`, then sent again as a committed entry, appends once. Items at or below the cursor are dropped.
  Decreasing ids assert.
- S13 settledEnd vs runStart: for the same transcript (with error, aborted, toolUse and length answers), `settledEnd` on
  entries and `runStart` on the context messages mark the same boundary.
- S14 compactor (upstream compactor-size.test.ts:52-96, compactor.test.ts:106-125), via `createCompressor` with fake
  `Models`: 640 bytes is accepted and 641 retried. A `length` stop or a toolCall reply is retried. Five failures give
  "no whole line in 5 tries". A merge must come out shorter than its source. A leading `id+n|` is stripped. A timeout
  aborts the call.

Live checks (not scriptable here, run by hand): G4. A root chat with a forced small `contextWindow` does not compact,
because a declined `CompactionTask` appears and no summary head marker is written, while a subagent still compacts. G2.
After a turn in chat A, `memoryStats().entries` in chat B's view includes A's final `talk` row without a second turn in A.
