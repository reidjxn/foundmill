// Assisted mode (default, BUILD §9.6): internal changes and routine external work within caps run alone;
// above caps, irreversible steps and contracts ask.
@id("assisted-allow-within-caps")
@reason("Assisted mode: within caps, reversible, not a contract")
permit (principal is Agent, action == Action::"call", resource is Tool)
when {
  principal.businessMode == "assisted" &&
  context.amountMinor <= principal.approvalThresholdMinor &&
  !resource.irreversible && !resource.contract
};

@id("assisted-ask-above-threshold")
@outcome("ask")
@reason("Assisted mode: amount is above the approval threshold")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { principal.businessMode == "assisted" && context.amountMinor > principal.approvalThresholdMinor };

@id("assisted-ask-irreversible")
@outcome("ask")
@reason("Assisted mode: irreversible actions need approval")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { principal.businessMode == "assisted" && resource.irreversible };

@id("assisted-ask-contract")
@outcome("ask")
@reason("Assisted mode: contracts need approval")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { principal.businessMode == "assisted" && resource.contract };
