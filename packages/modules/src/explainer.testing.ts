/**
 * Test helper for a screen's "Explain this page" explanation. Rendered without a shell, a screen's Explainer draws its
 * button in place (the inline fallback); opening it shows the three lines in a popover. `openExplainer` finds that
 * button by the screen id, opens it and returns the panel, so a test can assert what the explanation says.
 */
import { fireEvent, screen } from "@testing-library/react";

export function openExplainer(screenId: string): HTMLElement {
  const button = document.querySelector(`[data-explainer='${screenId}']`);
  if (!button) throw new Error(`No Explain this page button for ${screenId}`);
  fireEvent.click(button);
  return screen.getByTestId("explain-page-panel");
}
