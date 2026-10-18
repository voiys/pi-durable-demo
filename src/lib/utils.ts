import { toast } from "sonner";

export { cn } from "cn";

/** A rejected server call as an error toast: `.catch(fail("rename chat"))` shows "Couldn't rename chat" with the reason. */
export const fail = (action: string) => (e: Error) => void toast.error(`Couldn't ${action}`, { description: e.message });
