import { Agent } from "agents";
import type { Env } from "../env.ts";
import { botObjectName, replyText, type GroupMessage, type GroupState } from "../shared.ts";

/** Bot posts one message of the user's can set off, so bots @-mentioning each other can't loop forever. */
const BOT_POSTS_PER_ROUND = 6;

/**
 * A group chat (name = `<userId>--<groupId>`): the user and some of their bots in one room, until the user disbands it.
 * The room holds only its transcript (agent state, synced to the browser). Each member bot answers in its own group
 * conversation and remembers what it saw in its own memory (Bot.receiveGroup). RPC only; nothing is `@callable`.
 *
 * Who answers what: the user's message goes to every member, or only to the ones it @-mentions or replies to; a bot's
 * message goes only to the bots it @-mentions, within the round's budget. Everyone sees the whole room: a delivery
 * carries what was said since that bot last heard from the room (`heard:<botId>` counts the messages it has had), so an
 * addressed bot knows what the others posted without being asked to answer each of them.
 */
export class Group extends Agent<Env, GroupState> {
  initialState: GroupState = { title: "", purpose: "", members: [], messages: [], typing: [] };
  readonly #userId = () => this.name.split("--")[0];
  #budget = BOT_POSTS_PER_ROUND;

  onStart() {
    if (this.state.purpose === undefined) this.setState({ ...this.state, purpose: "" }); // rooms from before `purpose`
  }

  init(title: string, purpose: string, members: { id: string; name: string }[]) {
    if (members.length < 2) throw new Error("A group needs at least two bots");
    this.setState({ title, purpose, members, messages: [], typing: [] });
  }

  /** The members get the new title and purpose with the next message they hear (Bot.receiveGroup). */
  update(patch: { title?: string; purpose?: string }) {
    this.setState({ ...this.state, ...patch });
  }

  #post(message: Omit<GroupMessage, "id" | "ts">) {
    const posted = { ...message, id: crypto.randomUUID(), ts: Date.now() };
    this.setState({ ...this.state, messages: [...this.state.messages, posted] });
    return posted;
  }

  /** Members a message reaches: the ones it @-mentions or replies to, or for the user's message with neither, all of them. */
  #audience(text: string, from?: string, repliedTo?: string | null) {
    const mentioned = this.state.members.filter((m) => m.id === repliedTo || new RegExp(`(^|\\W)@${m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
    return (mentioned.length || from ? mentioned : this.state.members).filter((m) => m.id !== from);
  }

  #deliver(text: string, sender: string, from?: string, replied?: GroupMessage) {
    const audience = this.#audience(text, from, replied?.from);
    if (replied) text = replyText(`${replied.from ? this.state.members.find((m) => m.id === replied.from)!.name : "the user"} said:\n${replied.text}`, text);
    this.setState({ ...this.state, typing: [...new Set([...this.state.typing, ...audience.map((m) => m.id)])] });
    const groupId = this.name.split("--")[1];
    const { messages } = this.state;
    const name = (from: string | null) => (from ? this.state.members.find((x) => x.id === from)!.name : "the user");
    for (const m of audience) {
      // The message being delivered is the room's last one; what came before it since this bot last heard is context.
      const since = (this.ctx.storage.kv.get(`heard:${m.id}`) as number | undefined) ?? 0;
      const context = messages.slice(since, -1).filter((x) => x.from !== m.id).map((x) => ({ from: name(x.from), text: x.text }));
      this.ctx.storage.kv.put(`heard:${m.id}`, messages.length);
      this.ctx.waitUntil(this.env.Bot.getByName(botObjectName(this.#userId(), m.id)).receiveGroup(groupId, this.state.title, this.state.purpose, this.state.members.map((x) => x.name), context, sender, text));
    }
  }

  /** The user posts, optionally replying to the room message `replyTo` (a bot's message reaches that bot): a new round. */
  userPost(text: string, replyTo?: string) {
    if (!text.trim()) throw new Error("Empty message");
    const replied = replyTo === undefined ? undefined : this.state.messages.find((m) => m.id === replyTo);
    if (replyTo !== undefined && !replied) throw new Error(`No message ${replyTo} in this group`);
    this.#budget = BOT_POSTS_PER_ROUND;
    this.#post({ from: null, text, ...(replied && { replyTo }) });
    this.#deliver(text, "the user", undefined, replied);
  }

  /** A member bot's message while it is still working (what it says before using tools). Posted once per `key`; it
   * reaches nobody (only the final answer can hand work on) and the bot stays "typing". */
  botInterim(botId: string, text: string, key: string) {
    if (!this.state.members.some((m) => m.id === botId)) throw new Error(`${botId} is not in this group`);
    if (this.ctx.storage.kv.get(`interim:${key}`)) return;
    this.ctx.storage.kv.put(`interim:${key}`, true);
    this.#post({ from: botId, text });
  }

  /** A member bot's answer to what it heard (`null` when it had nothing to add). */
  botReply(botId: string, text: string | null) {
    const member = this.state.members.find((m) => m.id === botId);
    if (!member) throw new Error(`${botId} is not in this group`);
    this.setState({ ...this.state, typing: this.state.typing.filter((id) => id !== botId) });
    if (text === null) return;
    this.#post({ from: botId, text });
    if (this.#budget-- > 0) this.#deliver(text, member.name, botId);
  }

  async wipe() {
    await this.ctx.storage.deleteAll();
  }
}
