// Finance module is read-only in v1 (BUILD §11.8, AC-11.8.5): agents analyse, categorise, forecast, reconcile;
// they never initiate payments. A Finance tool that would spend money is forbidden regardless of mode or caps.
@id("finance-never-spends")
@reason("Finance tools can never initiate payments (BUILD §11.8, AC-11.8.5)")
forbid (principal is Agent, action == Action::"call", resource is Tool)
when { resource.finance && resource.spendsMoney };
