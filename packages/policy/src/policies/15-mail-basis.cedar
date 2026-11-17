// No email without a basis (WP-08 T10; audit a5 §3.8). The gateway finds the basis for the mail-sending tools only
// (`MAIL_SEND_TOOLS`); every other call has no `recipientBasis` and these rules do not apply.
// Nobody at the address agreed, wrote or paid, and the founder did not add them: never, in any mode.
@id("mail-needs-basis")
@reason("Nobody at this address has agreed to hear from the project, written to it or bought from it")
forbid (principal is Agent, action == Action::"call", resource is Tool)
when { resource.contactsThirdParty && context has recipientBasis && context.recipientBasis == "none" };

// The founder added this person: the founder approves each first message, in every mode (D4, Nov 16, 2026).
@id("mail-recorded-basis-asks")
@outcome("ask")
@reason("The founder added this person; the founder decides each first message")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { resource.contactsThirdParty && context has recipientBasis && context.recipientBasis == "recorded" };
