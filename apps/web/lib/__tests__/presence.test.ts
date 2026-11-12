import { describe, expect, it } from "vitest";
import { readNotificationParams, withoutNotificationParams } from "../presence";

const N = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("presence link parameters", () => {
  it("reads a notification link's via and id", () => {
    expect(readNotificationParams(`?via=email&n=${N}`)).toEqual({ via: "email", notificationId: N });
    expect(readNotificationParams(`?via=browser_notification&n=${N}&tab=all`)).toEqual({ via: "browser_notification", notificationId: N });
  });
  it("ignores a link without both, an unknown via, a direct via or a malformed id", () => {
    expect(readNotificationParams("?via=email")).toBeNull();
    expect(readNotificationParams(`?via=sms&n=${N}`)).toBeNull();
    expect(readNotificationParams(`?via=direct&n=${N}`)).toBeNull();
    expect(readNotificationParams("?via=email&n=1234")).toBeNull();
  });
  it("takes them off the address and keeps the rest", () => {
    expect(withoutNotificationParams(`https://foundmill.com/b/x/inbox/i?via=email&n=${N}&tab=all`)).toBe("https://foundmill.com/b/x/inbox/i?tab=all");
  });
});
