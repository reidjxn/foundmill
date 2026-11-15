import { ConfigError, type PlatformMailEnvelope, type ToolContext } from "../../contract";
import { PLATFORM_MAIL_KEY } from "./tools";

/**
 * The sender and custom args the gateway resolved for this call. Missing means the call did not come through the
 * gateway's platform-mail guards, so nothing is sent (a configuration fault, never the agent's).
 */
export function requireEnvelope(ctx: ToolContext): PlatformMailEnvelope {
  const envelope = ctx.platformMail;
  if (!envelope?.from?.email || !envelope.projectName || !envelope.messageRef || !envelope.unsubscribeUrl || !envelope.customArgs?.fm_b) {
    throw new ConfigError(PLATFORM_MAIL_KEY, "the project's sending address", "the gateway resolves it before the call");
  }
  if (envelope.customArgs.fm_b !== ctx.businessId) throw new ConfigError(PLATFORM_MAIL_KEY, "a sender for this business", "the envelope names another business");
  // A commercial message without the founders' postal address is never sent (US CAN-SPAM): unsure counts as commercial.
  if (envelope.commercial !== false && !envelope.postalAddress?.trim()) throw new ConfigError(PLATFORM_MAIL_KEY, "the founders' postal address", "a marketing email must carry it; the gateway refuses the send first");
  return envelope;
}
