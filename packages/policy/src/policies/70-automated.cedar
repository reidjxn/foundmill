// Automated mode (BUILD §9.6): everything non-gated within caps, including Chief of Staff decisions on the
// founder's behalf. Only hard gates queue (see 00-hard-gates); amounts above the approval threshold still ask.
@id("automated-allow-within-caps")
@reason("Automated mode: within caps")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { principal.businessMode == "automated" && context.amountMinor <= principal.approvalThresholdMinor };

@id("automated-ask-above-threshold")
@outcome("ask")
@reason("Automated mode: amount is above the approval threshold")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { principal.businessMode == "automated" && context.amountMinor > principal.approvalThresholdMinor };

@id("automated-ask-payment-record")
@outcome("ask")
@reason("Automated mode: an invoice or payment page needs approval unless you gave agents inbound payment powers")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { principal.businessMode == "automated" && resource.paymentRecord && !principal.inboundPaymentPower };
