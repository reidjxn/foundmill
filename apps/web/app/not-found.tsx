import { BrandPage } from "@/components/shell/BrandPage";

/**
 * Every address that resolves to nothing, including a business the founder cannot see (the /b/[bid] layout calls
 * notFound(), which lands here: a layout's own not-found file sits inside that layout). The same answer either way, so
 * nothing leaks about other tenants.
 */
export default function NotFound() {
  return <BrandPage title="Not found" heading="Nothing at this address" icon="search-x" description="The page does not exist, or it belongs to a business you cannot open. Open one of yours or start a new one." />;
}
