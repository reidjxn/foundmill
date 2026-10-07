import { createContext, forwardRef, useContext, type ReactNode } from "react";
import type { ShellLinkProps, ShellLinkRenderer } from "./types";

/** Default renderer: a plain anchor. Apps provide their router link through ShellLinkProvider. */
const DefaultLink: ShellLinkRenderer = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

const ShellLinkContext = createContext<ShellLinkRenderer>(DefaultLink);

export interface ShellLinkProviderProps {
  /** Renders every navigational link in the shell (Sidebar, TabBar, Breadcrumbs). */
  render: ShellLinkRenderer;
  children: ReactNode;
}

/** Put one around the AppShell so sidebar and tab links use the app's router (Next.js Link). */
export function ShellLinkProvider({ render, children }: ShellLinkProviderProps) {
  return <ShellLinkContext.Provider value={render}>{children}</ShellLinkContext.Provider>;
}

export function useShellLink(): ShellLinkRenderer {
  return useContext(ShellLinkContext);
}

/** A link rendered through the current shell link renderer. */
export const ShellLink = forwardRef<HTMLAnchorElement, ShellLinkProps>(function ShellLink(props, ref) {
  const render = useShellLink();
  return <>{render({ ...props, ref })}</>;
});
