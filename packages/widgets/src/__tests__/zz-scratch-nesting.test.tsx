import { render } from "@testing-library/react";
import { it } from "vitest";
import { Chip, Tooltip } from "@foundmill/dugout";
it("probe", () => {
  const { container } = render(<button type="button"><Tooltip content="x"><Chip tone="neutral" data-row-tag="Respond">Respond</Chip></Tooltip></button>);
  console.log("PROBE", container.innerHTML);
});
