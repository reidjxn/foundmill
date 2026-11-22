/**
 * The Cedar schema (JSON format) for the tool-call policy (BUILD §9.5, ARCHITECTURE §7).
 * One action, `Action::"call"`, from an `Agent` to a `Tool`. Agents are members of their `Business`.
 * Every attribute a policy reads is `required` so that evaluation can never hit a missing-attribute error;
 * src/types.ts supplies the defaults. Optional context attributes are informational only.
 */
import type { SchemaJson } from "@cedar-policy/cedar-wasm/nodejs";

export const CEDAR_NAMESPACE = "";

const str = { type: "String" } as const;
const bool = { type: "Boolean" } as const;
const long = { type: "Long" } as const;

export const CEDAR_SCHEMA: SchemaJson<string> = {
  [CEDAR_NAMESPACE]: {
    entityTypes: {
      Agent: {
        memberOfTypes: ["Business"],
        shape: {
          type: "Record",
          attributes: {
            department: str,
            type: str,
            modelKey: str,
            autonomy: str,
            /** Effective mode for this agent: business mode unless the agent's autonomy overrides it. */
            businessMode: str,
            spendCapMinor: long,
            approvalThresholdMinor: long,
            /** The business gave agents the inbound payment power (invoices and payment pages without asking in automated mode). */
            inboundPaymentPower: bool,
          },
        },
      },
      Tool: {
        shape: {
          type: "Record",
          attributes: {
            connector: str,
            name: str,
            spendsMoney: bool,
            contactsThirdParty: bool,
            requiresKitMode: bool,
            irreversible: bool,
            hardGate: bool,
            finance: bool,
            contract: bool,
            /** This call changes a security setting (e.g. a DNS record that routes or authenticates the domain's email): a hard gate. */
            securitySettings: bool,
            /** The gateway could not classify what this call would do: it asks first in every mode. */
            unclassified: bool,
            /** Creates an immutable or customer-visible record that brings money in (a finalized invoice, a payment page). */
            paymentRecord: bool,
            askAlways: bool,
            founderExecuted: bool,
          },
        },
      },
      Business: {
        shape: {
          type: "Record",
          attributes: {
            businessMode: str,
            holidayActive: bool,
          },
        },
      },
    },
    actions: {
      call: {
        appliesTo: {
          principalTypes: ["Agent"],
          resourceTypes: ["Tool"],
          context: {
            type: "Record",
            attributes: {
              amountMinor: long,
              recipient: { ...str, required: false },
              recipientFirstSeenInUntrusted: bool,
              recipientCountry: { ...str, required: false },
              localTimeAtRecipient: { ...str, required: false },
              suppressed: bool,
              recipientBasis: { ...str, required: false },
              holidayActive: bool,
              kitMode: bool,
              founderPress: bool,
            },
          },
        },
      },
    },
  },
};
