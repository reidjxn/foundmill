// Suppression list and untrusted recipients (BUILD §2.3, §9.5, §9.8).
// Checked before every contact with a third party, in every business mode.
@id("suppressed-recipient")
@reason("Recipient is on the suppression list")
forbid (principal is Agent, action == Action::"call", resource is Tool)
when { resource.contactsThirdParty && context.suppressed };

@id("untrusted-recipient")
@reason("Recipient was first seen inside untrusted content and has not been verified")
forbid (principal is Agent, action == Action::"call", resource is Tool)
when { resource.contactsThirdParty && context.recipientFirstSeenInUntrusted };
