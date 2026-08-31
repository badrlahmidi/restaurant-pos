import {Suspense} from "react";
import {Outlet} from "react-router";
import {PageLoader} from "@/components/common/loader/page-loader.tsx";
import {RouteErrorBoundary} from "@/components/common/error-boundary/route-error-boundary.tsx";

export const SuspenseOutlet = () => (
  <RouteErrorBoundary>
    <Suspense fallback={<PageLoader/>}>
      <Outlet/>
    </Suspense>
  </RouteErrorBoundary>
);
