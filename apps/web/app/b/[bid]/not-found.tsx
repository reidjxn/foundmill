import { LazyBrandPage } from "@/components/shell/LazyBrandPage";

/** A business the founder cannot see reads the same as one that does not exist (no tenancy leak). */
export default function BusinessNotFound() {
  return <LazyBrandPage title="Not found" heading="No business at this address" icon="search-x" description="There is no business here for your account. Open one of yours or start a new one." />;
}
