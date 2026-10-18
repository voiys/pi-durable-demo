import { Agent } from "agents";
import type { Env } from "../env.ts";
import { botObjectName, type GroupMessage, type GroupState } from "../shared.ts";

/** Bot posts one message of the user's can set off, so bots @-mentioning each other can't loop forever. */
const BOT_POSTS_PER_ROUND = 6;

/**
 * A group chat (name = `<userId>--<groupId>`): the user and some of their bots in one room, until the user disbands it.
 * The room holds only its transcript (agent state, synced to the browser). Each member bot answers in its own group
 * conversation and remembers what it saw in its own memory (Bot.receiveGroup). RPC only; nothing is `@callable`.
 *
 * Who hears what: the user's message goes to every member, or only to the ones it @-mentions; a bot's message goes
 * only to the bots it @-mentions, within the round's budget.
 */
export class Group extends Agent<Env, GroupState> {
  initialState: GroupState = { title: "", members: [], messages: [], typing: [] };
  readonly #userId = () => this.name.split("--")[0];
  #budget = BOT_POSTS_PER_ROUND;

  init(title: string, members: { id: string; name: string }[]) {
    if (members.length < 2) throw new Error("A group needs at least two bots");
    this.setState({ title, members, messages: [], typing: [] });
  }

  #post(message: Omit<GroupMessage, "id" | "ts">) {
    const posted = { ...message, id: crypto.randomUUID(), ts: Date.now() };
    this.setState({ ...this.state, messages: [...this.state.messages, posted] });
    return posted;
  }

  /** Members a message reaches: the ones it @-mentions, or for the user's message with no mentions, all of them. */
  #audience(text: string, from?: string) {
    const mentioned = this.state.members.filter((m) => new RegExp(`(^|\\W)@${m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
    return (mentioned.length || from ? mentioned : this.state.members).filter((m) => m.id !== from);
  }

  #deliver(text: string, sender: string, from?: string) {
    const audience = this.#audience(text, from);
    this.setState({ ...this.state, typing: [...new Set([...this.state.typing, ...audience.map((m) => m.id)])] });
    const groupId = this.name.split("--")[1];
    for (const m of audience)
      this.ctx.waitUntil(this.env.Bot.getByName(botObjectName(this.#userId(), m.id)).receiveGroup(groupId, this.state.title, this.state.members.map((x) => x.name), sender, text));
  }

  /** The user posts: a new round. */
  userPost(text: string) {
    if (!text.trim()) throw new Error("Empty message");
    this.#budget = BOT_POSTS_PER_ROUND;
    this.#post({ from: null, text });
    this.#deliver(text, "the user");
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
