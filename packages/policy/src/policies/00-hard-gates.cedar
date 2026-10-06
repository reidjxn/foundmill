// Hard gates (BUILD §2.2): moving money, signing, identity filings, accepting terms, permanent deletion,
// security settings, acting on untrusted instructions. Connectors flag these tools with `hardGate`.
// Always forbidden for agents, in every business mode; the gateway turns the call into a founder task.
@id("hard-gate")
@reason("Hard gate: this action always requires a human (BUILD §2.2)")
forbid (principal is Agent, action == Action::"call", resource is Tool)
when { resource.hardGate };
