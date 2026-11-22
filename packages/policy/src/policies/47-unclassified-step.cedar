// A hosted-browser step the gateway could not classify (a button that does not say what it does, a ref it cannot read)
// asks the founder in every mode, automated included (founder, Nov 22, 2026: "the classifier fails closed: a step it
// cannot classify asks first"). A page chooses its own words, so no mode may let such a step run unasked. Steps that pay,
// agree, sign, delete or change a security setting are hard gates and never reach this.
@id("unclassified-step-asks")
@outcome("ask")
@reason("The team could not tell what this step on the website does, so you are asked first")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { resource.unclassified };
