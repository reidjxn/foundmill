import { BrandPage } from "@/components/shell/BrandPage";

/** A business the founder cannot see reads the same as one that does not exist (no tenancy leak). */
export default function BusinessNotFound() {
  return <BrandPage title="Not found" icon="search-x" description="There is no business at this address for your account. Pick one from your businesses or start a new one." />;
}
