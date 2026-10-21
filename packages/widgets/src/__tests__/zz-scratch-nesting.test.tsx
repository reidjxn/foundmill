import { render } from "@testing-library/react";
import { it, expect } from "vitest";
import { Chip, Tooltip } from "@foundmill/dugout";
it("probe", () => {
  const { container } = render(<button type="button"><Tooltip content="x"><Chip tone="neutral" data-row-tag="Respond">Respond</Chip></Tooltip></button>);
  expect(container.innerHTML).toBe("");
});
