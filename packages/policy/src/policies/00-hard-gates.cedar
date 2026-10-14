// Hard gates (BUILD §2.2): moving money, signing, identity filings, accepting terms, permanent deletion,
// security settings, acting on untrusted instructions. Connectors flag these tools with `hardGate`.
// Always forbidden for agents, in every business mode; the gateway turns the call into a founder task.
@id("hard-gate")
@reason("Hard gate: this action always requires a human (BUILD §2.2)")
forbid (principal is Agent, action == Action::"call", resource is Tool)
when { resource.hardGate };

// Security settings (BUILD §2.2): a call the gateway recognises as changing one (today: a DNS record that routes or
// authenticates the domain's email, such as MX, NS, CAA, SPF, DKIM or DMARC) is a hard gate whatever the connector's
// static hints say, because the record type is in the call's arguments. The gateway sets `securitySettings` itself.
@id("hard-gate-security-settings")
@reason("Hard gate: this changes a security setting, which always requires a human (BUILD §2.2)")
forbid (principal is Agent, action == Action::"call", resource is Tool)
when { resource.securitySettings };
