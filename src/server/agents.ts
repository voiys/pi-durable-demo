// v1: agent-to-agent messaging, Mario Zechner's model (RESEARCH.md "v1").
// A session = one Chat DO = the main agent (pi's root conversation) + its subagents (conversations owned by an anchor task).
// Every agent can list its session's agents, message them, read their last message and inspect them; the main agent can
// also spawn subagents and reach the main agent of the user's other sessions (other Chat DOs of the same user).
// Subagent machinery (Subagents doc, Anchor, Reporter) is adapted from pi-source-v1.3.0
// packages/durable/test/examples/23-subagent-background.ts.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type AssistantMessage, Type } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  type ConversationId,
  configure,
  defineDoc,
  defineExtension,
  defineTask,
  defineTool,
  type EntryId,
  type EntryRecord,
  type Extension,
  ROOT_CONVERSATION_ID,
  type TaskId,
} from "@earendil-works/pi-durable";
import type { PiHarness } from "agents/harness/pi";

type Subagent = { conversationId: ConversationId; reported: EntryId[] };
const Subagents = defineDoc<{ agents: Record<string, Subagent>; reporters: Record<string, TaskId> }>({
  kind: "app.subagents",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ agents: {}, reporters: {} }),
});

const textOf = (m: AssistantMessage | undefined) => (m?.content ?? []).flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");

// Owns a subagent's conversation so it outlives the main agent's turns (see example 23).
const Anchor = defineTask<null, { phase: "done" }, null>({
  name: "app.subagent-anchor",
  version: 1,
  initial: () => ({ phase: "done" }),
  phases: { done: (_t, runtime, ctx) => runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), ctx) },
  abort: (_t, runtime, ctx) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
});

// Delivers one message from the main agent to a subagent and reports the answer back to the main agent.
type ReporterInput = { name: string; conversationId: ConversationId; message: string; followUp: boolean };
type ReporterState = { phase: "deliver" } | { phase: "report"; report?: string };
const Reporter = defineTask<ReporterInput, ReporterState, null>({
  name: "app.subagent-reporter",
  version: 1,
  initial: () => ({ phase: "deliver" }),
  phases: {
    deliver: async (reporter, runtime, ctx) => {
      const { name, conversationId, message, followUp } = reporter.input;
      const subagent = (await runtime.conversation(conversationId, ctx))!;
      const request = { type: "input", content: message, whenBusy: followUp ? "followUp" : "steer" } as const;
      const settled = await (await subagent.submit({ ...request, requestId: `subagent:${reporter.id}` }, ctx)).wait(ctx);
      await runtime.commit(async (tx) => {
        const next = (report?: string) => ({ status: "running", checkpoint: { phase: "report", report } }) as const;
        if (settled.status === "unanswered") return next(settled.reason === "aborted" ? undefined : `[subagent ${name} failed: ${settled.reason}]`);
        if (settled.type !== "input") return next();
        const agent = (await tx.doc(Subagents, runtime.conversationId)).agents[name]!;
        if (agent.reported.includes(settled.answer)) return next();
        agent.reported.push(settled.answer);
        const answer = (await tx.entry(AssistantEntry, settled.answer))?.model?.[0] as AssistantMessage;
        return next(`[subagent ${name} answered, no reply needed] ${textOf(answer)}`);
      }, ctx);
    },
    report: async (reporter, runtime, ctx) => {
      const report = reporter.state.checkpoint.report;
      if (report !== undefined) {
        const main = (await runtime.conversation(runtime.conversationId, ctx))!;
        await main.submit({ type: "input", content: report, whenBusy: "followUp", requestId: `subagent-report:${reporter.id}` }, ctx);
      }
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), ctx);
    },
  },
  abort: (_t, runtime, ctx) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
});

/** What the Chat DO gives the tools: its harness and RPC to the user's other sessions. */
export type AgentHost = {
  harness: PiHarness;
  chatId: string;
  /** The user's other chats (never another user's: the User DO is this chat's owner). */
  sessions(): Promise<{ id: string; title: string }[]>;
  sendToSession(chatId: string, from: string, message: string): Promise<void>;
  lastOfSession(chatId: string): Promise<string>;
  /** Extensions subagents don't get (the main agent's OptChat memory). */
  childExcluded(): Extension[];
  /** Tells the User DO which subagents this chat has, for the sidebar. */
  agentsChanged(): Promise<void>;
};

export type AgentInfo = { name: string; session: string; busy: boolean };

/** All agents of this session: the main agent plus its subagents. */
export async function sessionAgents(host: AgentHost): Promise<AgentInfo[]> {
  const doc = await (await host.harness.pi()).snapshot(Subagents, ROOT_CONVERSATION_ID, BACKGROUND_CONTEXT);
  const members: [string, ConversationId][] = [["main", ROOT_CONVERSATION_ID], ...Object.entries(doc?.agents ?? {}).map(([n, a]) => [n, a.conversationId] as [string, ConversationId])];
  return Promise.all(members.map(async ([name, id]) => ({ name, session: String(id), busy: await host.harness.session(String(id)).busy() })));
}

/** Stops a subagent and removes it from the session (UI action; the `subagent` tool's retire does the same from a turn).
 * Its transcript stays in storage, but nothing lists or reaches it any more. */
export async function retireSubagent(host: AgentHost, name: string) {
  const pi = await host.harness.pi();
  const root = (await pi.conversation(ROOT_CONVERSATION_ID, BACKGROUND_CONTEXT))!;
  const doc = await pi.snapshot(Subagents, ROOT_CONVERSATION_ID, BACKGROUND_CONTEXT);
  const agent = doc?.agents[name];
  if (!agent) throw new Error(`No subagent named ${name}`);
  await (await pi.conversation(agent.conversationId, BACKGROUND_CONTEXT))!.abort(BACKGROUND_CONTEXT);
  await root.commit(async (tx) => void delete (await tx.doc(Subagents, ROOT_CONVERSATION_ID)).agents[name], BACKGROUND_CONTEXT);
  await host.agentsChanged();
}

/** Last assistant text of a conversation, and its last tool call (for `inspect`). */
export async function lastOf(harness: PiHarness, session: string) {
  const entries: EntryRecord[] = await harness.session(session).messages();
  const assistants = entries.flatMap((e) => (e.model?.[0]?.role === "assistant" ? [e.model[0] as AssistantMessage] : []));
  const lastText = assistants.findLast((m) => textOf(m) !== "");
  const lastCall = assistants.flatMap((m) => m.content.flatMap((c) => (c.type === "toolCall" ? [c] : []))).at(-1);
  return { text: lastText ? textOf(lastText) : "(no answer yet)", toolCall: lastCall ? `${lastCall.name} ${JSON.stringify(lastCall.arguments)}` : "(none)" };
}

const say = (text: string) => ({ output: [{ type: "text" as const, text }] });

export function agentExtensions(host: AgentHost) {
  const whoAmI = async (conversationId: ConversationId) =>
    (await sessionAgents(host)).find((a) => a.session === String(conversationId))!;
  const find = async (name: string) => {
    const agent = (await sessionAgents(host)).find((a) => a.name === name);
    if (!agent) throw new Error(`No agent named ${name} in this session`);
    return agent;
  };

  // Every agent of the session (main and subagents) gets these.
  const peers = defineTool({
    name: "agents",
    description:
      "Talk to the other agents of this session. Actions: list (all agents and whether they are working), " +
      "send (to, message: delivered to that agent as a new message; use to: \"main\" to report to the main agent), " +
      "last (name: that agent's last answer), inspect (name: status, last answer and last tool call, to check on a stuck agent).",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("send"), Type.Literal("last"), Type.Literal("inspect")]),
      name: Type.Optional(Type.String({ description: "Target agent for send/last/inspect" })),
      message: Type.Optional(Type.String()),
    }),
    replay: "unsafe",
    execute: async ({ action, name, message }, api, ctx) => {
      const me = await whoAmI(api.conversationId);
      if (action === "list")
        return say((await sessionAgents(host)).map((a) => `${a.name}${a.name === me.name ? " (you)" : ""}: ${a.busy ? "working" : "idle"}`).join("\n"));
      if (!name) return { ...say(`${action} needs a name`), isError: true };
      const target = await find(name);
      if (action === "last") return say((await lastOf(host.harness, target.session)).text);
      if (action === "inspect") {
        const last = await lastOf(host.harness, target.session);
        return say(`${target.name}: ${target.busy ? "working" : "idle"}\nlast tool call: ${last.toolCall}\nlast answer: ${last.text}`);
      }
      if (!message) return { ...say("send needs a message"), isError: true };
      if (target.name === me.name) return { ...say("That's you"), isError: true };
      const conversation = (await api.conversation(Number(target.session) as ConversationId, ctx))!;
      await conversation.submit({ type: "input", content: `[message from ${me.name}] ${message}`, whenBusy: "followUp", requestId: `agents:${api.taskId}` }, ctx);
      return say(`Sent to ${target.name}.`);
    },
  });

  // Only the main agent gets these: spawn/steer/stop subagents, and reach the user's other sessions.
  const subagent = defineTool({
    name: "subagent",
    description:
      "Manage background subagents of this session. Actions: spawn (name, message), send (name, message; followUp: true " +
      "queues it after the current answer instead of steering), stop (name: aborts its current work), retire (name: stops it " +
      "and removes it from the session for good). Their answers are reported back to you.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("spawn"), Type.Literal("send"), Type.Literal("stop"), Type.Literal("retire")]),
      name: Type.String(),
      message: Type.Optional(Type.String()),
      followUp: Type.Optional(Type.Boolean()),
    }),
    replay: "unsafe",
    execute: async ({ action, name, message, followUp }, api, ctx) => {
      const registry = (await api.snapshot(Subagents, api.conversationId, ctx)) ?? { agents: {}, reporters: {} };
      const agent = Object.hasOwn(registry.agents, name) ? registry.agents[name] : undefined;
      if (action !== "spawn" && !agent) return { ...say(`No subagent named ${name}.`), isError: true };
      if (action === "stop" || action === "retire") {
        await (await api.conversation(agent!.conversationId, ctx))!.abort(ctx);
        if (action === "stop") return say(`Stopped ${name}.`);
        await api.commit(async (tx) => void delete (await tx.doc(Subagents, api.conversationId)).agents[name], ctx);
        await host.agentsChanged();
        return say(`Retired ${name}.`);
      }
      if (!message) return { ...say(`${action} needs a message.`), isError: true };
      const result = await api.commit(async (tx) => {
        const state = await tx.doc(Subagents, api.conversationId);
        const background = { ownership: { kind: "conversation" }, background: true } as const;
        if (action === "spawn") {
          if (Object.hasOwn(state.agents, name) || name === "main") return `${name} already exists; use send.`;
          const anchor = await tx.createTask(Anchor, null, background);
          const child = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
          await configure(tx, child.id, {
            extensions: { remove: [MainTools, ...host.childExcluded()] },
            instructions: `You are the subagent "${name}" of this session. Answer the main agent's requests. Use the agents tool to talk to the main agent or other subagents.`,
          });
          state.agents[name] = { conversationId: child.id, reported: [] };
        }
        const input = { name, conversationId: state.agents[name]!.conversationId, message, followUp: action === "send" && followUp === true };
        state.reporters[api.taskId] = await tx.createTask(Reporter, input, background);
        return action === "send" ? `Sent to ${name}.` : `Started ${name}.`;
      }, ctx);
      if (action === "spawn") await host.agentsChanged();
      return say(result);
    },
  });

  const sessions = defineTool({
    name: "sessions",
    description:
      "Reach the main agent of the user's other chat sessions. Actions: list, send (id, message: delivered as a new message " +
      "to that session's main agent), last (id: that session's main agent's last answer).",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("send"), Type.Literal("last")]),
      id: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
    }),
    replay: "unsafe",
    execute: async ({ action, id, message }) => {
      const others = (await host.sessions()).filter((s) => s.id !== host.chatId);
      if (action === "list") return say(others.map((s) => `${s.id}: ${s.title}`).join("\n") || "No other sessions.");
      const target = others.find((s) => s.id === id);
      if (!target) return { ...say(`No other session with id ${id}`), isError: true };
      if (action === "last") return say(await host.lastOfSession(target.id));
      if (!message) return { ...say("send needs a message"), isError: true };
      await host.sendToSession(target.id, host.chatId, message);
      return say(`Sent to session "${target.title}".`);
    },
  });

  const MainTools = defineExtension({ name: "main-agent-tools", tasks: [Anchor, Reporter], tools: [subagent, sessions] });
  const PeerTools = defineExtension({ name: "session-agent-tools", tools: [peers] });
  return { MainTools, PeerTools };
}
