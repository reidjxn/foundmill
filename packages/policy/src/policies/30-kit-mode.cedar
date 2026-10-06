// Channels that cannot be automated within their terms run in kit mode (BUILD §2.3): the agent prepares,
// the founder submits. A tool that requires kit mode may only be called from a kit-mode session.
@id("kit-mode-channel")
@reason("This channel runs in kit mode: the agent prepares, the founder submits")
forbid (principal is Agent, action == Action::"call", resource is Tool)
when { resource.requiresKitMode && !context.kitMode };
