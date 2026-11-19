// A tool on no list of a remote MCP server (the gateway's `call_unlisted_tool`) asks the founder in every mode, automated
// included (founder, 2026-11-19: "a tool on no list asks first"): the name cannot say what the call does, so no mode may
// let it run unasked. Names that would cross a hard gate are denied by the gateway before this is reached.
@id("unlisted-remote-tool-asks")
@outcome("ask")
@reason("This tool is not on the list of tools you approved, so you are asked first")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { resource.name == "call_unlisted_tool" };
