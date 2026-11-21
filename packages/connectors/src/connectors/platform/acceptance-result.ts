/** One acceptance result of `complete_task` (acceptance.ts has the rules); its own file so tools.ts and acceptance.ts import it without a cycle. */
import { z } from "zod";

export const AcceptanceResult = z.object({
  line: z.number().int().min(1).max(30),
  met: z.boolean(),
  /** A heading of the report this session saved with save_report (its words, without the #), where the line is shown. */
  reportSection: z.string().trim().min(1).max(200).optional(),
  /** The outside tool call that did it, by tool name ("send_mail", or "platform_mail:send_mail"); never a platform tool. */
  tool: z.string().trim().min(1).max(100).optional(),
});
export type AcceptanceResultT = z.infer<typeof AcceptanceResult>;
