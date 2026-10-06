// Augmented mode (BUILD §9.6): acts alone on research, drafts, internal prep and code on branches;
// asks for every external action, every spend and every irreversible step (e.g. a merge to main).
@id("augmented-ask-external")
@outcome("ask")
@reason("Augmented mode: external actions and spending need approval")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { principal.businessMode == "augmented" && (resource.contactsThirdParty || resource.spendsMoney) };

@id("augmented-ask-irreversible")
@outcome("ask")
@reason("Augmented mode: irreversible actions need approval")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { principal.businessMode == "augmented" && resource.irreversible };

@id("augmented-allow-internal")
@reason("Augmented mode: internal, reversible, non-spending work")
permit (principal is Agent, action == Action::"call", resource is Tool)
when {
  principal.businessMode == "augmented" &&
  !resource.contactsThirdParty && !resource.spendsMoney && !resource.irreversible
};
