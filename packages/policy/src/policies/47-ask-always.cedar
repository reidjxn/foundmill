// A tool flagged `askAlways` asks the founder in every business mode, automated mode and vacation included (founder,
// 2026-11-22: what reaches another person from the founder's own account is never decided by a mode). The other permits
// may still allow the call; an `ask` outranks an `allow`.
@id("ask-always")
@outcome("ask")
@reason("This reaches someone outside the project from your own account, so you are asked first in every mode")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { resource.askAlways };
