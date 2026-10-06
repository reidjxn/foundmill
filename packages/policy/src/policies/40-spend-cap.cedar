// The spend cap is the founder's hard ceiling for a single spend (per agent, inherited from the business or a
// holiday budget ceiling). Above it the call is denied in every mode; the founder raises the cap, not the agent.
@id("spend-cap-exceeded")
@reason("Amount exceeds the spend cap set by the founder")
forbid (principal is Agent, action == Action::"call", resource is Tool)
when { resource.spendsMoney && context.amountMinor > principal.spendCapMinor };
