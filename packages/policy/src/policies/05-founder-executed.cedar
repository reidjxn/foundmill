// Founder-executed tools (founder, 2026-11-22): an action that files with the founder's identity or reaches a vendor's
// patent practitioners never runs for an agent. Only the founder's own press on the exact payload runs it: the gateway's
// `POST /v1/founder-actions/execute` evaluates it with `context.founderPress`, set nowhere else. For every agent call the
// forbid below holds in every business mode, automated mode and vacation included, whatever else permits the call.
@id("founder-executed")
@reason("Only your own press runs this: an agent never does, in any mode")
forbid (principal is Agent, action == Action::"call", resource is Tool)
when { resource.founderExecuted && !context.founderPress };

@id("founder-press")
@reason("You pressed it: this exact request, once")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { resource.founderExecuted && context.founderPress };
